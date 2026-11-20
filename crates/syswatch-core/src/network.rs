//! Réseau : débit par interface (/proc/net/dev), adresses (getifaddrs), passerelle
//! (/proc/net/route), DNS (resolv.conf), Wi-Fi (`iw`, sinon /proc/net/wireless) et latence.
//!
//! Confidentialité : la seule émission est un ping ICMP vers la passerelle locale
//! (la box), toutes les 5 s. Aucune requête vers Internet, pas d'IP publique.

use std::collections::HashMap;
use std::ffi::CStr;
use std::fs;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use std::path::Path;
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use crate::model::{IfaceKind, IfaceSnapshot, NetworkSnapshot, WifiInfo};
use crate::sysfs::{read_trim, read_u64};

const PING_EVERY: Duration = Duration::from_secs(5);
const PING_TIMEOUT: Duration = Duration::from_secs(1);
const SLOW_EVERY: Duration = Duration::from_secs(10);

#[derive(Default, Clone)]
struct Slow {
    addrs: HashMap<String, (Vec<String>, Vec<String>)>,
    wifi: Option<WifiInfo>,
    dns: Vec<String>,
}

pub struct Network {
    prev: HashMap<String, (u64, u64)>,
    last: Option<Instant>,
    slow: Slow,
    slow_at: Option<Instant>,
    ping: Arc<Mutex<Option<(String, Option<f32>)>>>,
}

impl Default for Network {
    fn default() -> Self {
        Self::new()
    }
}

impl Network {
    pub fn new() -> Self {
        let ping = Arc::new(Mutex::new(None));
        let p = Arc::clone(&ping);
        let _ = thread::Builder::new().name("syswatch-ping".into()).spawn(move || pinger(p));
        Self { prev: HashMap::new(), last: None, slow: Slow::default(), slow_at: None, ping }
    }

    pub fn sample(&mut self) -> NetworkSnapshot {
        let now = Instant::now();
        let dt = self.last.map(|t| now.duration_since(t).as_secs_f64()).filter(|d| *d > 0.05);
        self.last = Some(now);
        if self.slow_at.is_none_or(|t| t.elapsed() >= SLOW_EVERY) {
            self.slow = Slow { addrs: addresses(), wifi: None, dns: dns_servers() };
            self.slow_at = Some(now);
            self.slow.wifi = wifi_info();
        }

        let (gw, gw_iface) = default_route().unzip();
        let mut ifaces = Vec::new();
        let (mut rx_bps, mut tx_bps) = (0.0, 0.0);
        let dev = fs::read_to_string("/proc/net/dev").unwrap_or_default();
        let mut next = HashMap::new();
        for (name, rx, tx) in parse_net_dev(&dev) {
            let kind = iface_kind(&name);
            let (rb, tb) = match (self.prev.get(&name), dt) {
                (Some((r0, t0)), Some(dt)) => (rx.saturating_sub(*r0) as f64 / dt, tx.saturating_sub(*t0) as f64 / dt),
                _ => (0.0, 0.0),
            };
            next.insert(name.clone(), (rx, tx));
            if matches!(kind, IfaceKind::Wifi | IfaceKind::Ethernet | IfaceKind::Other) {
                rx_bps += rb;
                tx_bps += tb;
            }
            let sys = Path::new("/sys/class/net").join(&name);
            let (v4, v6) = self.slow.addrs.get(&name).cloned().unwrap_or_default();
            ifaces.push(IfaceSnapshot {
                up: read_trim(sys.join("operstate")).is_some_and(|s| s == "up" || (s == "unknown" && !v4.is_empty())),
                mac: read_trim(sys.join("address")).filter(|m| m != "00:00:00:00:00:00"),
                speed_mbps: if kind == IfaceKind::Ethernet { read_u64(sys.join("speed")).map(|v| v as u32).filter(|v| *v > 0 && *v < 1_000_000) } else { None },
                name,
                kind,
                rx_bps: rb,
                tx_bps: tb,
                rx_total: rx,
                tx_total: tx,
                ipv4: v4,
                ipv6: v6,
            });
        }
        self.prev = next;
        // Interfaces utiles d'abord : celle de la route par défaut, puis physiques, puis virtuelles.
        ifaces.sort_by_key(|i| (Some(&i.name) != gw_iface.as_ref(), i.kind, i.name.clone()));
        let ping = self.ping.lock().ok().and_then(|g| g.clone());
        NetworkSnapshot {
            rx_bps,
            tx_bps,
            connected: gw.is_some(),
            default_iface: gw_iface,
            gateway: gw.map(|g| g.to_string()),
            dns: self.slow.dns.clone(),
            ping_target: ping.as_ref().map(|p| p.0.clone()),
            ping_ms: ping.and_then(|p| p.1),
            wifi: self.slow.wifi.clone(),
            interfaces: ifaces,
        }
    }
}

fn parse_net_dev(s: &str) -> Vec<(String, u64, u64)> {
    s.lines()
        .skip(2)
        .filter_map(|l| {
            let (name, rest) = l.split_once(':')?;
            let f: Vec<u64> = rest.split_whitespace().filter_map(|v| v.parse().ok()).collect();
            Some((name.trim().to_owned(), *f.first()?, *f.get(8)?))
        })
        .collect()
}

fn iface_kind(name: &str) -> IfaceKind {
    let sys = Path::new("/sys/class/net").join(name);
    if name == "lo" {
        IfaceKind::Loopback
    } else if sys.join("wireless").exists() || sys.join("phy80211").exists() {
        IfaceKind::Wifi
    } else if sys.join("device").exists() {
        IfaceKind::Ethernet
    } else if ["veth", "docker", "br-", "virbr", "vmnet", "tun", "tap", "wg", "tailscale", "zt"].iter().any(|p| name.starts_with(p)) {
        IfaceKind::Virtual
    } else {
        IfaceKind::Other
    }
}

/// (passerelle, interface) de la route IPv4 par défaut.
fn default_route() -> Option<(Ipv4Addr, String)> {
    let s = fs::read_to_string("/proc/net/route").ok()?;
    s.lines().skip(1).find_map(|l| {
        let f: Vec<&str> = l.split_whitespace().collect();
        if f.get(1)? != &"00000000" {
            return None;
        }
        let gw = u32::from_str_radix(f.get(2)?, 16).ok()?;
        (gw != 0).then(|| (Ipv4Addr::from(gw.to_le_bytes()), f[0].to_owned()))
    })
}

fn dns_servers() -> Vec<String> {
    let read = |p: &str| -> Vec<String> {
        fs::read_to_string(p).unwrap_or_default().lines().filter_map(|l| l.trim().strip_prefix("nameserver")).map(|v| v.trim().to_owned()).collect()
    };
    let v = read("/etc/resolv.conf");
    // systemd-resolved : le résolveur local masque les vrais serveurs.
    if v.iter().all(|a| a.starts_with("127.")) {
        let up = read("/run/systemd/resolve/resolv.conf");
        if !up.is_empty() {
            return up;
        }
    }
    v
}

/// Adresses IPv4 et IPv6 (hors lien local fe80::) de chaque interface.
fn addresses() -> HashMap<String, (Vec<String>, Vec<String>)> {
    let mut out: HashMap<String, (Vec<String>, Vec<String>)> = HashMap::new();
    let mut head: *mut libc::ifaddrs = std::ptr::null_mut();
    // SAFETY: getifaddrs alloue une liste chaînée libérée par freeifaddrs ci-dessous ;
    // chaque nœud est lu sans être modifié.
    unsafe {
        if libc::getifaddrs(&mut head) != 0 {
            return out;
        }
        let mut cur = head;
        while !cur.is_null() {
            let ifa = &*cur;
            if !ifa.ifa_addr.is_null() {
                let name = CStr::from_ptr(ifa.ifa_name).to_string_lossy().into_owned();
                let fam = (*ifa.ifa_addr).sa_family as i32;
                let prefix = if ifa.ifa_netmask.is_null() { None } else { prefix_len(&*ifa.ifa_netmask, fam) };
                let fmt = |ip: IpAddr| prefix.map_or(ip.to_string(), |p| format!("{ip}/{p}"));
                if fam == libc::AF_INET {
                    let sa = &*(ifa.ifa_addr as *const libc::sockaddr_in);
                    let ip = Ipv4Addr::from(u32::from_be(sa.sin_addr.s_addr));
                    out.entry(name).or_default().0.push(fmt(IpAddr::V4(ip)));
                } else if fam == libc::AF_INET6 {
                    let sa = &*(ifa.ifa_addr as *const libc::sockaddr_in6);
                    let ip = Ipv6Addr::from(sa.sin6_addr.s6_addr);
                    if (ip.segments()[0] & 0xffc0) != 0xfe80 {
                        out.entry(name).or_default().1.push(fmt(IpAddr::V6(ip)));
                    }
                }
            }
            cur = ifa.ifa_next;
        }
        libc::freeifaddrs(head);
    }
    out
}

/// SAFETY: `mask` doit pointer sur une sockaddr de la famille `fam`.
unsafe fn prefix_len(mask: &libc::sockaddr, fam: i32) -> Option<u32> {
    // SAFETY: famille vérifiée par l'appelant ; lecture seule.
    unsafe {
        if fam == libc::AF_INET {
            Some(u32::from_be((*(mask as *const _ as *const libc::sockaddr_in)).sin_addr.s_addr).count_ones())
        } else if fam == libc::AF_INET6 {
            Some((*(mask as *const _ as *const libc::sockaddr_in6)).sin6_addr.s6_addr.iter().map(|b| b.count_ones()).sum())
        } else {
            None
        }
    }
}

/* ---------- Wi-Fi ---------- */

fn wifi_iface() -> Option<String> {
    fs::read_dir("/sys/class/net").ok()?.flatten().map(|e| e.file_name().to_string_lossy().into_owned()).find(|n| iface_kind(n) == IfaceKind::Wifi)
}

fn wifi_info() -> Option<WifiInfo> {
    let iface = wifi_iface()?;
    let mut w = Command::new("iw")
        .args(["dev", &iface, "link"])
        .env("LC_ALL", "C")
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| parse_iw_link(&String::from_utf8_lossy(&o.stdout)))
        .unwrap_or_default();
    if w.signal_dbm.is_none() {
        // Sans iw : le niveau du signal reste lisible dans /proc/net/wireless.
        w.signal_dbm = fs::read_to_string("/proc/net/wireless").ok().and_then(|s| {
            s.lines().find(|l| l.trim_start().starts_with(&format!("{iface}:"))).and_then(|l| l.split_whitespace().nth(3)?.trim_end_matches('.').parse::<f32>().ok()).map(|v| v as i32)
        });
    }
    w.iface = iface;
    (w.ssid.is_some() || w.signal_dbm.is_some()).then_some(w)
}

fn parse_iw_link(s: &str) -> WifiInfo {
    let mut w = WifiInfo::default();
    for l in s.lines().map(str::trim) {
        if let Some(v) = l.strip_prefix("SSID: ") {
            w.ssid = Some(unescape_ssid(v));
        } else if let Some(v) = l.strip_prefix("freq: ") {
            w.freq_mhz = v.split('.').next().and_then(|x| x.trim().parse().ok());
        } else if let Some(v) = l.strip_prefix("signal: ") {
            w.signal_dbm = v.split_whitespace().next().and_then(|x| x.parse().ok());
        } else if let Some(v) = l.strip_prefix("rx bitrate: ") {
            w.rx_mbps = v.split_whitespace().next().and_then(|x| x.parse().ok());
        } else if let Some(v) = l.strip_prefix("tx bitrate: ") {
            w.tx_mbps = v.split_whitespace().next().and_then(|x| x.parse().ok());
        }
    }
    w
}

/// `iw` échappe les octets non imprimables du SSID en « \xNN ».
fn unescape_ssid(s: &str) -> String {
    let mut bytes = Vec::with_capacity(s.len());
    let b = s.as_bytes();
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'\\' && i + 3 < b.len() && b[i + 1] == b'x' {
            if let Ok(v) = u8::from_str_radix(&s[i + 2..i + 4], 16) {
                bytes.push(v);
                i += 4;
                continue;
            }
        }
        bytes.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&bytes).into_owned()
}

/* ---------- Ping de la passerelle ---------- */

fn pinger(out: Arc<Mutex<Option<(String, Option<f32>)>>>) {
    let mut seq: u16 = 0;
    loop {
        let res = default_route().map(|(gw, _)| {
            seq = seq.wrapping_add(1);
            (gw.to_string(), ping(gw, seq).ok().map(|d| d.as_secs_f32() * 1000.0))
        });
        if let Ok(mut g) = out.lock() {
            *g = res;
        }
        thread::sleep(PING_EVERY);
    }
}

/// Écho ICMP par socket « ping » non privilégiée (net.ipv4.ping_group_range) : le noyau
/// remplit l'identifiant et la somme de contrôle.
fn ping(addr: Ipv4Addr, seq: u16) -> std::io::Result<Duration> {
    struct Fd(i32);
    impl Drop for Fd {
        fn drop(&mut self) {
            // SAFETY: descripteur possédé.
            unsafe { libc::close(self.0) };
        }
    }
    // SAFETY: appels système sur un descripteur possédé et des tampons locaux.
    unsafe {
        let fd = libc::socket(libc::AF_INET, libc::SOCK_DGRAM | libc::SOCK_CLOEXEC, libc::IPPROTO_ICMP);
        if fd < 0 {
            return Err(std::io::Error::last_os_error());
        }
        let fd = Fd(fd);
        let tv = libc::timeval { tv_sec: PING_TIMEOUT.as_secs() as _, tv_usec: 0 };
        libc::setsockopt(fd.0, libc::SOL_SOCKET, libc::SO_RCVTIMEO, (&tv as *const libc::timeval).cast(), std::mem::size_of::<libc::timeval>() as u32);
        let mut pkt = [0u8; 16];
        pkt[0] = 8; // echo request
        pkt[6..8].copy_from_slice(&seq.to_be_bytes());
        pkt[8..16].copy_from_slice(b"SysWatch");
        let mut sa: libc::sockaddr_in = std::mem::zeroed();
        sa.sin_family = libc::AF_INET as u16;
        sa.sin_addr.s_addr = u32::from(addr).to_be();
        let start = Instant::now();
        if libc::sendto(fd.0, pkt.as_ptr().cast(), pkt.len(), 0, (&sa as *const libc::sockaddr_in).cast(), std::mem::size_of::<libc::sockaddr_in>() as u32) < 0 {
            return Err(std::io::Error::last_os_error());
        }
        let mut buf = [0u8; 128];
        while start.elapsed() < PING_TIMEOUT {
            let n = libc::recv(fd.0, buf.as_mut_ptr().cast(), buf.len(), 0);
            if n < 0 {
                return Err(std::io::Error::last_os_error());
            }
            if n >= 8 && buf[0] == 0 && buf[6..8] == seq.to_be_bytes() {
                return Ok(start.elapsed());
            }
        }
        Err(std::io::Error::from(std::io::ErrorKind::TimedOut))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses() {
        let d = parse_net_dev("Inter-|\n face |\n  wlan0: 556808760 441005 0 0 0 0 0 0 48239201 190200 0 0 0 0 0 0\n");
        assert_eq!(d, vec![("wlan0".into(), 556808760, 48239201)]);
        let w = parse_iw_link("Connected to aa (on wlan0)\n\tSSID: Box\\xc3\\xa9\n\tfreq: 5600.0\n\tsignal: -58 dBm\n\trx bitrate: 154.8 MBit/s HE\n\ttx bitrate: 172.0 MBit/s\n");
        assert_eq!(w.ssid.as_deref(), Some("Boxé"));
        assert_eq!(w.freq_mhz, Some(5600));
        assert_eq!(w.signal_dbm, Some(-58));
        assert_eq!(w.rx_mbps, Some(154.8));
    }

    #[test]
    fn samples_this_machine() {
        let mut n = Network::new();
        n.sample();
        thread::sleep(Duration::from_millis(1500));
        let s = n.sample();
        println!("↓ {:.0} o/s ↑ {:.0} o/s, passerelle {:?}, ping {:?} ms, DNS {:?}", s.rx_bps, s.tx_bps, s.gateway, s.ping_ms, s.dns.len());
        for i in &s.interfaces {
            println!("  {:<10} {:?} up={} v4={} v6={}", i.name, i.kind, i.up, i.ipv4.len(), i.ipv6.len());
        }
        if let Some(w) = &s.wifi {
            println!("  Wi-Fi {} MHz {:?} dBm", w.freq_mhz.unwrap_or(0), w.signal_dbm);
        }
    }
}
