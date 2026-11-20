//! Processus et applications ouvertes, lus dans /proc à la demande (page Processus,
//! Réseau ou widget « Top processus » visibles), jamais en tâche de fond.
//!
//! - CPU : part de la machine entière (100 % = tous les threads occupés), comme le design.
//! - RAM : mémoire résidente privée (résidente − partagée) ; évite de compter N fois les
//!   bibliothèques communes.
//! - Disque : /proc/PID/io, lisible seulement pour les processus de l'utilisateur.
//! - Réseau : octets TCP de chaque socket (sock_diag), rattachés au processus via ses
//!   descripteurs. Approximation : UDP et sockets très brèves ne sont pas comptés.
//! - Applications : les lanceurs de bureau (KDE, GNOME) placent chaque application dans
//!   un scope systemd « app-<id>-<n>.scope » ; on regroupe les processus par scope.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::net::IpAddr;
use std::time::Instant;

use serde::Serialize;

use crate::desktop;
use crate::sockdiag::{self, Proto, Sock};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcInfo {
    pub pid: u32,
    pub ppid: u32,
    pub name: String,
    pub user: String,
    pub cmd: String,
    pub threads: u32,
    /// Démarrage (secondes depuis l'époque Unix).
    pub start_s: u64,
    /// Part du CPU de la machine, 0–100.
    pub cpu: f32,
    pub mem: u64,
    /// Octets/s ; `None` si /proc/PID/io est illisible (processus d'un autre utilisateur).
    pub disk_read: Option<f64>,
    pub disk_write: Option<f64>,
    pub net_rx: Option<f64>,
    pub net_tx: Option<f64>,
    /// Identifiant de l'application à laquelle appartient le processus.
    pub app: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    /// Identifiant de bureau (« org.kde.dolphin »).
    pub id: String,
    pub name: String,
    /// Processus principal (le plus ancien du groupe).
    pub pid: u32,
    pub pids: Vec<u32>,
    pub cpu: f32,
    pub mem: u64,
    pub disk_read: f64,
    pub disk_write: f64,
    pub net_rx: f64,
    pub net_tx: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    pub proto: &'static str,
    pub state: &'static str,
    pub local: String,
    pub local_port: u16,
    pub remote: String,
    pub remote_port: u16,
    pub pid: Option<u32>,
    pub listening: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessList {
    pub processes: Vec<ProcInfo>,
    pub apps: Vec<AppInfo>,
    /// Rempli seulement à la demande (page Réseau).
    pub connections: Vec<Connection>,
}

struct Prev {
    ticks: u64,
    io: Option<(u64, u64)>,
}

pub struct ProcCollector {
    clk: f64,
    ncpu: f64,
    page: u64,
    boot_s: u64,
    users: HashMap<u32, String>,
    names: HashMap<String, String>,
    prev: HashMap<u32, Prev>,
    socks_prev: HashMap<u32, (u64, u64)>,
    last: Option<Instant>,
    cache: Option<(Instant, bool, ProcessList)>,
}

impl Default for ProcCollector {
    fn default() -> Self {
        Self::new()
    }
}

impl ProcCollector {
    pub fn new() -> Self {
        // SAFETY: sysconf sans effet de bord.
        let (clk, page, ncpu) = unsafe { (libc::sysconf(libc::_SC_CLK_TCK), libc::sysconf(libc::_SC_PAGESIZE), libc::sysconf(libc::_SC_NPROCESSORS_ONLN)) };
        Self {
            clk: if clk > 0 { clk as f64 } else { 100.0 },
            ncpu: ncpu.max(1) as f64,
            page: if page > 0 { page as u64 } else { 4096 },
            boot_s: boot_time(),
            users: read_users(),
            names: HashMap::new(),
            prev: HashMap::new(),
            socks_prev: HashMap::new(),
            last: None,
            cache: None,
        }
    }

    /// Liste complète. Un second appel dans la seconde renvoie le résultat précédent
    /// (deux vues ouvertes ne doublent pas le coût).
    pub fn sample(&mut self, with_connections: bool) -> ProcessList {
        if let Some((t, conns, l)) = &self.cache {
            if t.elapsed().as_millis() < 900 && (*conns || !with_connections) {
                return l.clone();
            }
        }
        let l = self.collect(with_connections);
        self.cache = Some((Instant::now(), with_connections, l.clone()));
        l
    }

    fn collect(&mut self, with_connections: bool) -> ProcessList {
        let now = Instant::now();
        let dt = self.last.map(|t| now.duration_since(t).as_secs_f64()).filter(|d| *d > 0.05);
        self.last = Some(now);

        let socks = sockdiag::dump();
        let tcp_by_inode: HashMap<u32, &Sock> = socks.iter().filter(|s| s.proto == Proto::Tcp && s.inode != 0).map(|s| (s.inode, s)).collect();
        let mut inode_pid: HashMap<u32, u32> = HashMap::new();
        let mut net: HashMap<u32, (f64, f64)> = HashMap::new();

        let mut out = Vec::new();
        let mut next_prev = HashMap::new();
        let mut scopes: HashMap<u32, String> = HashMap::new();

        let Ok(rd) = fs::read_dir("/proc") else { return ProcessList { processes: out, apps: Vec::new(), connections: Vec::new() } };
        for e in rd.flatten() {
            let Some(pid) = e.file_name().to_str().and_then(|s| s.parse::<u32>().ok()) else { continue };
            let dir = e.path();
            let Some(stat) = fs::read_to_string(dir.join("stat")).ok().and_then(|s| parse_stat(&s)) else { continue };
            // Threads noyau (kthreadd et ses enfants) : pas de mémoire utilisateur, sans intérêt ici.
            if stat.ppid == 2 || pid == 2 {
                continue;
            }
            let statm = fs::read_to_string(dir.join("statm")).unwrap_or_default();
            let mut sm = statm.split_whitespace().map(|v| v.parse::<u64>().unwrap_or(0));
            let (_size, resident, shared) = (sm.next().unwrap_or(0), sm.next().unwrap_or(0), sm.next().unwrap_or(0));
            let io = fs::read_to_string(dir.join("io")).ok().and_then(|s| parse_io(&s));
            let uid = fs::read_to_string(dir.join("status")).ok().and_then(|s| parse_uid(&s)).unwrap_or(0);
            let cmdline = fs::read(dir.join("cmdline")).unwrap_or_default();
            let cmd: String = String::from_utf8_lossy(&cmdline).replace('\0', " ").trim().chars().take(400).collect();

            let ticks = stat.utime + stat.stime;
            let prev = self.prev.get(&pid);
            let cpu = match (prev, dt) {
                (Some(p), Some(dt)) => ((ticks.saturating_sub(p.ticks)) as f64 / self.clk / dt * 100.0 / self.ncpu) as f32,
                _ => 0.0,
            };
            let (disk_read, disk_write) = match (prev.and_then(|p| p.io), io, dt) {
                (Some((r0, w0)), Some((r, w)), Some(dt)) => (Some(r.saturating_sub(r0) as f64 / dt), Some(w.saturating_sub(w0) as f64 / dt)),
                (_, Some(_), _) => (Some(0.0), Some(0.0)),
                _ => (None, None),
            };
            next_prev.insert(pid, Prev { ticks, io });

            // Sockets du processus (lisible seulement pour nos propres processus).
            let mut readable_fds = false;
            if let Ok(fds) = fs::read_dir(dir.join("fd")) {
                readable_fds = true;
                for fd in fds.flatten() {
                    if let Ok(target) = fs::read_link(fd.path()) {
                        if let Some(inode) = target.to_str().and_then(|t| t.strip_prefix("socket:[")).and_then(|t| t.strip_suffix(']')).and_then(|t| t.parse::<u32>().ok()) {
                            inode_pid.insert(inode, pid);
                            if let (Some(s), Some(dt)) = (tcp_by_inode.get(&inode), dt) {
                                if let (Some(tx), Some(rx), Some((tx0, rx0))) = (s.sent, s.received, self.socks_prev.get(&inode)) {
                                    let e = net.entry(pid).or_default();
                                    e.0 += rx.saturating_sub(*rx0) as f64 / dt;
                                    e.1 += tx.saturating_sub(*tx0) as f64 / dt;
                                }
                            }
                        }
                    }
                }
            }

            // Deux lancements de la même application = une seule ligne « Applications ».
            if let Some(scope) = fs::read_to_string(dir.join("cgroup")).ok().and_then(|c| app_scope(&c)) {
                scopes.insert(pid, scope_app_id(&scope));
            }

            let name = proc_name(&stat.comm, &cmdline);
            out.push(ProcInfo {
                pid,
                ppid: stat.ppid,
                name,
                user: self.users.get(&uid).cloned().unwrap_or_else(|| uid.to_string()),
                cmd,
                threads: stat.threads,
                start_s: self.boot_s + (stat.start_ticks as f64 / self.clk) as u64,
                cpu,
                mem: resident.saturating_sub(shared) * self.page,
                disk_read,
                disk_write,
                net_rx: readable_fds.then_some(0.0),
                net_tx: readable_fds.then_some(0.0),
                app: None,
            });
        }
        self.prev = next_prev;
        self.socks_prev = tcp_by_inode.iter().filter_map(|(i, s)| Some((*i, (s.sent?, s.received?)))).collect();

        for p in &mut out {
            if let Some((rx, tx)) = net.get(&p.pid) {
                p.net_rx = Some(*rx);
                p.net_tx = Some(*tx);
            }
            p.app = scopes.get(&p.pid).cloned();
        }
        let apps = self.group_apps(&out);
        let connections = if with_connections { connections(&socks, &inode_pid) } else { Vec::new() };
        ProcessList { processes: out, apps, connections }
    }

    fn group_apps(&mut self, procs: &[ProcInfo]) -> Vec<AppInfo> {
        let mut groups: HashMap<&str, Vec<&ProcInfo>> = HashMap::new();
        for p in procs {
            if let Some(k) = &p.app {
                groups.entry(k.as_str()).or_default().push(p);
            }
        }
        let mut apps: Vec<AppInfo> = groups
            .into_iter()
            .map(|(key, members)| {
                let pids: HashSet<u32> = members.iter().map(|p| p.pid).collect();
                let leader = members.iter().filter(|p| !pids.contains(&p.ppid)).min_by_key(|p| p.start_s).or_else(|| members.iter().min_by_key(|p| p.pid)).copied().expect("groupe non vide");
                let id = key.to_owned();
                let name = self.names.entry(id.clone()).or_insert_with(|| desktop::app_name(&id).unwrap_or_default()).clone();
                let sum = |f: fn(&ProcInfo) -> Option<f64>| members.iter().filter_map(|p| f(p)).sum::<f64>();
                AppInfo {
                    name: if name.is_empty() { leader.name.clone() } else { name },
                    id,
                    pid: leader.pid,
                    pids: members.iter().map(|p| p.pid).collect(),
                    cpu: members.iter().map(|p| p.cpu).sum(),
                    mem: members.iter().map(|p| p.mem).sum(),
                    disk_read: sum(|p| p.disk_read),
                    disk_write: sum(|p| p.disk_write),
                    net_rx: sum(|p| p.net_rx),
                    net_tx: sum(|p| p.net_tx),
                }
            })
            .collect();
        apps.sort_by(|a, b| b.cpu.total_cmp(&a.cpu));
        apps
    }
}

fn connections(socks: &[Sock], inode_pid: &HashMap<u32, u32>) -> Vec<Connection> {
    let fmt = |ip: &IpAddr| match ip {
        IpAddr::V4(a) => a.to_string(),
        IpAddr::V6(a) => a.to_string(),
    };
    socks
        .iter()
        // Écoutes UDP sans pair : trop nombreuses et sans intérêt pour « qui parle à qui ».
        .filter(|s| !(s.proto == Proto::Udp && s.listening()))
        .filter(|s| !(s.proto == Proto::Tcp && s.state == 6)) // TIME_WAIT : plus de processus
        .map(|s| Connection {
            proto: if s.proto == Proto::Tcp { "TCP" } else { "UDP" },
            state: if s.proto == Proto::Tcp { sockdiag::tcp_state_name(s.state) } else { "Connectée" },
            local: fmt(&s.local),
            local_port: s.local_port,
            remote: fmt(&s.remote),
            remote_port: s.remote_port,
            pid: inode_pid.get(&s.inode).copied(),
            listening: s.listening(),
        })
        .collect()
}

struct Stat {
    comm: String,
    ppid: u32,
    utime: u64,
    stime: u64,
    threads: u32,
    start_ticks: u64,
}

/// /proc/PID/stat : le nom (2e champ) est entre parenthèses et peut contenir des espaces.
fn parse_stat(s: &str) -> Option<Stat> {
    let open = s.find('(')?;
    let close = s.rfind(')')?;
    let comm = s[open + 1..close].to_owned();
    let f: Vec<&str> = s[close + 2..].split_whitespace().collect();
    // Après le nom : état(0) ppid(1) … utime(11) stime(12) … num_threads(17) … starttime(19)
    Some(Stat { comm, ppid: f.get(1)?.parse().ok()?, utime: f.get(11)?.parse().ok()?, stime: f.get(12)?.parse().ok()?, threads: f.get(17)?.parse().ok()?, start_ticks: f.get(19)?.parse().ok()? })
}

fn parse_io(s: &str) -> Option<(u64, u64)> {
    let get = |k: &str| s.lines().find_map(|l| l.strip_prefix(k)).and_then(|v| v.trim().parse::<u64>().ok());
    Some((get("read_bytes:")?, get("write_bytes:")?))
}

fn parse_uid(s: &str) -> Option<u32> {
    s.lines().find_map(|l| l.strip_prefix("Uid:"))?.split_whitespace().next()?.parse().ok()
}

/// Le nom noyau (comm) est tronqué à 15 caractères : on préfère alors le nom de l'exécutable.
fn proc_name(comm: &str, cmdline: &[u8]) -> String {
    if comm.len() >= 15 {
        let argv0 = cmdline.split(|b| *b == 0).next().map(|a| String::from_utf8_lossy(a).into_owned()).unwrap_or_default();
        let base = argv0.rsplit('/').next().unwrap_or("").split_whitespace().next().unwrap_or("");
        if base.starts_with(comm) {
            return base.to_owned();
        }
    }
    comm.to_owned()
}

/// Scope d'application d'un processus d'après /proc/PID/cgroup, sans les services lancés
/// automatiquement à l'ouverture de session (« …@autostart.service »).
fn app_scope(cgroup: &str) -> Option<String> {
    let path = cgroup.lines().find_map(|l| l.strip_prefix("0::"))?;
    let unit = path.split('/').rev().find(|c| c.starts_with("app-"))?;
    if !path.contains("/app.slice/") || unit.contains("@autostart") || unit.ends_with(".slice") {
        return None;
    }
    Some(unit.to_owned())
}

/// « app-brave\x2dbrowser-1234.scope » → « brave-browser » ;
/// « app-flatpak-com.discordapp.Discord-55.scope » → « com.discordapp.Discord » ;
/// « app-org.kde.konsole@a1b2.service » → « org.kde.konsole ».
fn scope_app_id(unit: &str) -> String {
    let s = unit.strip_prefix("app-").unwrap_or(unit);
    let s = if let Some(base) = s.strip_suffix(".scope") {
        base.rsplit_once('-').map(|(a, b)| if b.bytes().all(|c| c.is_ascii_hexdigit()) { a } else { base }).unwrap_or(base)
    } else {
        let base = s.strip_suffix(".service").unwrap_or(s);
        base.split('@').next().unwrap_or(base)
    };
    let s = ["gnome-", "flatpak-", "kde-"].iter().find_map(|p| s.strip_prefix(p)).unwrap_or(s);
    unescape(s)
}

/// Décodage des échappements systemd (« \x2d » → « - »).
fn unescape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let b = s.as_bytes();
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'\\' && i + 3 < b.len() && b[i + 1] == b'x' {
            if let Ok(v) = u8::from_str_radix(&s[i + 2..i + 4], 16) {
                out.push(v as char);
                i += 4;
                continue;
            }
        }
        out.push(b[i] as char);
        i += 1;
    }
    out
}

fn boot_time() -> u64 {
    fs::read_to_string("/proc/stat").ok().and_then(|s| s.lines().find_map(|l| l.strip_prefix("btime ")?.trim().parse().ok())).unwrap_or(0)
}

fn read_users() -> HashMap<u32, String> {
    fs::read_to_string("/etc/passwd")
        .unwrap_or_default()
        .lines()
        .filter_map(|l| {
            let f: Vec<&str> = l.split(':').collect();
            Some((f.get(2)?.parse().ok()?, f.first()?.to_string()))
        })
        .collect()
}

/// Envoie SIGTERM à chaque PID. Renvoie la liste des échecs (PID, raison).
pub fn terminate(pids: &[u32]) -> Vec<(u32, String)> {
    let me = std::process::id();
    pids.iter()
        .filter_map(|&pid| {
            if pid <= 1 || pid == me {
                return Some((pid, "processus protégé".into()));
            }
            // SAFETY: kill() n'accède à aucune mémoire ; le PID est un entier.
            let r = unsafe { libc::kill(pid as i32, libc::SIGTERM) };
            if r == 0 {
                None
            } else {
                let e = std::io::Error::last_os_error();
                Some((pid, match e.raw_os_error() {
                    Some(libc::EPERM) => "appartient à un autre utilisateur".into(),
                    Some(libc::ESRCH) => "déjà terminé".into(),
                    _ => e.to_string(),
                }))
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stat_with_spaces() {
        let s = parse_stat("1234 (Web Content) S 1000 1234 1234 0 -1 4194560 100 0 0 0 250 50 0 0 20 0 27 0 9876 1 2 3").unwrap();
        assert_eq!(s.comm, "Web Content");
        assert_eq!(s.ppid, 1000);
        assert_eq!(s.utime + s.stime, 300);
        assert_eq!(s.threads, 27);
        assert_eq!(s.start_ticks, 9876);
    }

    #[test]
    fn scopes() {
        assert_eq!(scope_app_id("app-brave\\x2dbrowser-1234.scope"), "brave-browser");
        assert_eq!(scope_app_id("app-com.microsoft.VSCode-5622.scope"), "com.microsoft.VSCode");
        assert_eq!(scope_app_id("app-flatpak-com.discordapp.Discord-55.scope"), "com.discordapp.Discord");
        assert_eq!(scope_app_id("app-gnome-org.gnome.Nautilus-4021.scope"), "org.gnome.Nautilus");
        assert_eq!(scope_app_id("app-org.kde.konsole@a1b2c3.service"), "org.kde.konsole");
        assert_eq!(app_scope("0::/user.slice/user-1000.slice/user@1000.service/app.slice/app-discord-9.scope\n").as_deref(), Some("app-discord-9.scope"));
        assert_eq!(app_scope("0::/user.slice/user-1000.slice/user@1000.service/app.slice/app-org.kde.kdeconnect.daemon@autostart.service\n"), None);
        assert_eq!(app_scope("0::/system.slice/sshd.service\n"), None);
    }

    #[test]
    fn samples_this_machine() {
        let mut c = ProcCollector::new();
        c.sample(false);
        std::thread::sleep(std::time::Duration::from_millis(1200));
        let t = Instant::now();
        let l = c.sample(true);
        println!("{} processus, {} apps, {} connexions en {:?}", l.processes.len(), l.apps.len(), l.connections.len(), t.elapsed());
        for a in l.apps.iter().take(8) {
            println!("  {:<28} {:>3} proc  {:>5.1} %  {:>6} Mo  ↓{:.0} o/s", a.name, a.pids.len(), a.cpu, a.mem / 1_048_576, a.net_rx);
        }
        assert!(!l.processes.is_empty());
    }
}
