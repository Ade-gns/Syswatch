//! Sockets TCP et UDP du système via netlink `sock_diag` (comme `ss`), sans droits root.
//! Pour TCP, l'attribut `tcp_info` donne les octets envoyés (acquittés) et reçus de chaque
//! socket : c'est ce qui permet d'estimer le débit réseau par processus sans capture de
//! paquets. Les sockets UDP n'ont pas de compteur : elles sont listées, pas mesurées.

use std::mem;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

const NETLINK_SOCK_DIAG: i32 = 4;
const SOCK_DIAG_BY_FAMILY: u16 = 20;
const NLMSG_ERROR: u16 = 2;
const NLMSG_DONE: u16 = 3;
const INET_DIAG_INFO: u16 = 2;
const NLMSG_HDR: usize = 16;
const DIAG_MSG: usize = 72;
/// Décalages dans `struct tcp_info` (linux/tcp.h, noyau ≥ 4.2).
const TCPI_BYTES_ACKED: usize = 120;
const TCPI_BYTES_RECEIVED: usize = 128;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Proto {
    Tcp,
    Udp,
}

#[derive(Debug, Clone)]
pub struct Sock {
    pub proto: Proto,
    /// État TCP du noyau (1 = établie, 10 = écoute…) ; pour UDP, 1 = connectée.
    pub state: u8,
    pub local: IpAddr,
    pub local_port: u16,
    pub remote: IpAddr,
    pub remote_port: u16,
    pub uid: u32,
    pub inode: u32,
    /// Octets envoyés et reçus depuis l'ouverture (TCP uniquement).
    pub sent: Option<u64>,
    pub received: Option<u64>,
}

impl Sock {
    pub fn listening(&self) -> bool {
        match self.proto {
            Proto::Tcp => self.state == 10,
            Proto::Udp => self.state != 1,
        }
    }
}

pub const fn tcp_state_name(s: u8) -> &'static str {
    match s {
        1 => "Établie",
        2 => "Ouverture",
        3 => "Ouverture",
        4 | 5 | 6 | 8 | 9 | 11 => "Fermeture",
        7 => "Fermée",
        10 => "Écoute",
        _ => "Inconnu",
    }
}

/// Toutes les sockets TCP et UDP, IPv4 et IPv6. Liste vide si netlink est indisponible.
pub fn dump() -> Vec<Sock> {
    let mut out = Vec::new();
    for family in [libc::AF_INET as u8, libc::AF_INET6 as u8] {
        for proto in [Proto::Tcp, Proto::Udp] {
            if let Err(e) = dump_one(family, proto, &mut out) {
                log::debug!("sock_diag {family}/{proto:?} : {e}");
            }
        }
    }
    out
}

struct Fd(i32);
impl Drop for Fd {
    fn drop(&mut self) {
        // SAFETY: descripteur ouvert par socket() et possédé par cette structure.
        unsafe { libc::close(self.0) };
    }
}

fn dump_one(family: u8, proto: Proto, out: &mut Vec<Sock>) -> std::io::Result<()> {
    // SAFETY: appel système sans pointeur ; le résultat est vérifié.
    let fd = unsafe { libc::socket(libc::AF_NETLINK, libc::SOCK_DGRAM | libc::SOCK_CLOEXEC, NETLINK_SOCK_DIAG) };
    if fd < 0 {
        return Err(std::io::Error::last_os_error());
    }
    let fd = Fd(fd);

    // nlmsghdr (16 o) + inet_diag_req_v2 (56 o).
    let mut req = [0u8; NLMSG_HDR + 56];
    let len = req.len() as u32;
    req[0..4].copy_from_slice(&len.to_ne_bytes());
    req[4..6].copy_from_slice(&SOCK_DIAG_BY_FAMILY.to_ne_bytes());
    let flags = (libc::NLM_F_REQUEST | libc::NLM_F_DUMP) as u16;
    req[6..8].copy_from_slice(&flags.to_ne_bytes());
    req[8..12].copy_from_slice(&1u32.to_ne_bytes());
    req[16] = family;
    req[17] = match proto {
        Proto::Tcp => libc::IPPROTO_TCP as u8,
        Proto::Udp => libc::IPPROTO_UDP as u8,
    };
    req[18] = if proto == Proto::Tcp { 1 << (INET_DIAG_INFO - 1) } else { 0 };
    req[20..24].copy_from_slice(&u32::MAX.to_ne_bytes()); // tous les états

    // SAFETY: sockaddr_nl est un POD ; zéro = noyau.
    let mut addr: libc::sockaddr_nl = unsafe { mem::zeroed() };
    addr.nl_family = libc::AF_NETLINK as u16;
    // SAFETY: tampon et adresse valides pendant l'appel.
    let sent = unsafe {
        libc::sendto(fd.0, req.as_ptr().cast(), req.len(), 0, (&addr as *const libc::sockaddr_nl).cast(), mem::size_of::<libc::sockaddr_nl>() as u32)
    };
    if sent < 0 {
        return Err(std::io::Error::last_os_error());
    }

    let mut buf = vec![0u8; 64 * 1024];
    loop {
        // SAFETY: le tampon appartient à cette fonction et sa taille est passée.
        let n = unsafe { libc::recv(fd.0, buf.as_mut_ptr().cast(), buf.len(), 0) };
        if n < 0 {
            return Err(std::io::Error::last_os_error());
        }
        let n = n as usize;
        let mut off = 0;
        while off + NLMSG_HDR <= n {
            let mlen = u32::from_ne_bytes(buf[off..off + 4].try_into().unwrap()) as usize;
            let mtype = u16::from_ne_bytes(buf[off + 4..off + 6].try_into().unwrap());
            if mlen < NLMSG_HDR || off + mlen > n {
                return Ok(());
            }
            match mtype {
                NLMSG_DONE => return Ok(()),
                NLMSG_ERROR => return Err(std::io::Error::other("réponse d'erreur netlink")),
                SOCK_DIAG_BY_FAMILY => {
                    if let Some(s) = parse_msg(&buf[off + NLMSG_HDR..off + mlen], proto) {
                        out.push(s);
                    }
                }
                _ => {}
            }
            off += (mlen + 3) & !3;
        }
    }
}

fn parse_msg(m: &[u8], proto: Proto) -> Option<Sock> {
    if m.len() < DIAG_MSG {
        return None;
    }
    let family = m[0];
    let state = m[1];
    let sport = u16::from_be_bytes([m[4], m[5]]);
    let dport = u16::from_be_bytes([m[6], m[7]]);
    let addr = |b: &[u8]| -> IpAddr {
        if family == libc::AF_INET as u8 {
            IpAddr::V4(Ipv4Addr::new(b[0], b[1], b[2], b[3]))
        } else {
            let a: [u8; 16] = b[..16].try_into().unwrap();
            let v6 = Ipv6Addr::from(a);
            v6.to_ipv4_mapped().map(IpAddr::V4).unwrap_or(IpAddr::V6(v6))
        }
    };
    let local = addr(&m[8..24]);
    let remote = addr(&m[24..40]);
    let uid = u32::from_ne_bytes(m[64..68].try_into().unwrap());
    let inode = u32::from_ne_bytes(m[68..72].try_into().unwrap());

    let (mut sent, mut received) = (None, None);
    let mut off = DIAG_MSG;
    while off + 4 <= m.len() {
        let alen = u16::from_ne_bytes([m[off], m[off + 1]]) as usize;
        let atype = u16::from_ne_bytes([m[off + 2], m[off + 3]]);
        if alen < 4 || off + alen > m.len() {
            break;
        }
        if atype == INET_DIAG_INFO {
            let info = &m[off + 4..off + alen];
            if info.len() >= TCPI_BYTES_RECEIVED + 8 {
                sent = Some(u64::from_ne_bytes(info[TCPI_BYTES_ACKED..TCPI_BYTES_ACKED + 8].try_into().unwrap()));
                received = Some(u64::from_ne_bytes(info[TCPI_BYTES_RECEIVED..TCPI_BYTES_RECEIVED + 8].try_into().unwrap()));
            }
        }
        off += (alen + 3) & !3;
    }
    Some(Sock { proto, state, local, local_port: sport, remote, remote_port: dport, uid, inode, sent, received })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dumps_this_machine() {
        let v = dump();
        let tcp = v.iter().filter(|s| s.proto == Proto::Tcp).count();
        let with_bytes = v.iter().filter(|s| s.received.is_some()).count();
        println!("{} sockets, {tcp} TCP, {with_bytes} avec compteurs", v.len());
        for s in v.iter().filter(|s| s.state == 1 && s.proto == Proto::Tcp).take(5) {
            println!("{:?} :{} → port {} inode {} ↑{:?} ↓{:?}", s.proto, s.local_port, s.remote_port, s.inode, s.sent, s.received);
        }
        assert!(!v.is_empty(), "au moins une socket attendue");
    }
}
