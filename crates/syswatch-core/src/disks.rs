//! Disques : inventaire (/sys/block), systèmes de fichiers montés (/proc/self/mountinfo +
//! statvfs), débits de lecture/écriture (/sys/block/X/stat) et température (hwmon du
//! disque : nvme, drivetemp). Les sous-volumes btrfs d'un même système de fichiers
//! (/ et /home sur CachyOS) sont regroupés : l'espace n'est compté qu'une fois.

use std::collections::HashMap;
use std::ffi::CString;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;

use crate::model::{DiskKind, DiskSnapshot, MountSnapshot};
use crate::sysfs::{read_i64, read_trim, read_u64};

const SECTOR: u64 = 512;
/// Systèmes de fichiers réels : le reste (tmpfs, proc, overlay…) n'a pas de disque.
const REAL_FS: [&str; 12] = ["ext4", "ext3", "ext2", "btrfs", "xfs", "f2fs", "vfat", "exfat", "ntfs", "ntfs3", "fuseblk", "bcachefs"];

pub struct Disks {
    prev: HashMap<String, (u64, u64)>,
    last: Option<Instant>,
}

impl Default for Disks {
    fn default() -> Self {
        Self::new()
    }
}

impl Disks {
    pub fn new() -> Self {
        Self { prev: HashMap::new(), last: None }
    }

    pub fn sample(&mut self) -> Vec<DiskSnapshot> {
        let now = Instant::now();
        let dt = self.last.map(|t| now.duration_since(t).as_secs_f64()).filter(|d| *d > 0.05);
        self.last = Some(now);
        let mounts = mounts_by_disk();
        let mut out = Vec::new();
        let mut next = HashMap::new();
        let Ok(rd) = fs::read_dir("/sys/block") else { return out };
        let mut names: Vec<String> = rd.flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
        names.sort();
        for name in names {
            if ["loop", "ram", "zram", "dm-", "md", "sr", "fd"].iter().any(|p| name.starts_with(p)) {
                continue;
            }
            let dir = Path::new("/sys/block").join(&name);
            let size = read_u64(dir.join("size")).unwrap_or(0) * SECTOR;
            if size == 0 {
                continue; // lecteur de cartes vide, etc.
            }
            let (r, w) = read_stat(&dir.join("stat")).unwrap_or((0, 0));
            let (read_bps, write_bps) = match (self.prev.get(&name), dt) {
                (Some((r0, w0)), Some(dt)) => (r.saturating_sub(*r0) as f64 / dt, w.saturating_sub(*w0) as f64 / dt),
                _ => (0.0, 0.0),
            };
            next.insert(name.clone(), (r, w));
            let usb = fs::canonicalize(&dir).is_ok_and(|p| p.to_string_lossy().contains("/usb"));
            let rot = read_u64(dir.join("queue/rotational")) == Some(1);
            let kind = if name.starts_with("nvme") {
                DiskKind::Nvme
            } else if usb {
                DiskKind::Usb
            } else if rot {
                DiskKind::Hdd
            } else {
                DiskKind::Ssd
            };
            let mut mounts = mounts.get(&name).cloned().unwrap_or_default();
            mounts.sort_by(|a, b| b.total.cmp(&a.total));
            out.push(DiskSnapshot {
                model: read_trim(dir.join("device/model")).map(|m| m.split_whitespace().collect::<Vec<_>>().join(" ")),
                size,
                kind,
                removable: read_u64(dir.join("removable")) == Some(1) || usb,
                read_bps,
                write_bps,
                read_total: r,
                write_total: w,
                temp_c: disk_temp(&dir),
                mounts,
                id: name,
            });
        }
        self.prev = next;
        out
    }
}

/// (octets lus, octets écrits) depuis le démarrage : champs 3 et 7 de /sys/block/X/stat.
fn read_stat(p: &Path) -> Option<(u64, u64)> {
    let s = fs::read_to_string(p).ok()?;
    let f: Vec<u64> = s.split_whitespace().filter_map(|v| v.parse().ok()).collect();
    Some((f.get(2)? * SECTOR, f.get(6)? * SECTOR))
}

fn disk_temp(dir: &Path) -> Option<f32> {
    let hw = fs::read_dir(dir.join("device")).ok()?.flatten().find(|e| e.file_name().to_string_lossy().starts_with("hwmon"))?.path();
    read_i64(hw.join("temp1_input")).map(|m| m as f32 / 1000.0).filter(|v| *v > 1.0 && *v < 150.0)
}

/// Disque physique qui porte un périphérique bloc (« nvme0n1p2 » → « nvme0n1 »,
/// « dm-0 » → disque sous-jacent du volume chiffré ou LVM).
fn parent_disk(dev: &str) -> Option<String> {
    let class = Path::new("/sys/class/block").join(dev);
    let real = fs::canonicalize(&class).ok()?;
    if dev.starts_with("dm-") || dev.starts_with("md") {
        let slave = fs::read_dir(real.join("slaves")).ok()?.flatten().next()?.file_name().to_string_lossy().into_owned();
        return parent_disk(&slave);
    }
    if real.join("partition").exists() {
        return real.parent()?.file_name().map(|n| n.to_string_lossy().into_owned());
    }
    real.file_name().map(|n| n.to_string_lossy().into_owned())
}

/// Systèmes de fichiers montés, regroupés par disque physique.
fn mounts_by_disk() -> HashMap<String, Vec<MountSnapshot>> {
    let mut by_source: HashMap<String, (String, Vec<String>)> = HashMap::new();
    let mut order = Vec::new();
    for line in fs::read_to_string("/proc/self/mountinfo").unwrap_or_default().lines() {
        let Some((left, right)) = line.split_once(" - ") else { continue };
        let target = left.split_whitespace().nth(4).map(unescape_mount);
        let mut r = right.split_whitespace();
        let (Some(fstype), Some(source), Some(target)) = (r.next(), r.next(), target) else { continue };
        if !REAL_FS.contains(&fstype) || !source.starts_with("/dev/") {
            continue;
        }
        let e = by_source.entry(source.to_owned()).or_insert_with(|| {
            order.push(source.to_owned());
            (fstype.to_owned(), Vec::new())
        });
        e.1.push(target);
    }
    let mut out: HashMap<String, Vec<MountSnapshot>> = HashMap::new();
    for source in order {
        let (fstype, mut targets) = by_source.remove(&source).unwrap_or_default();
        let dev = fs::canonicalize(&source).ok().and_then(|p| p.file_name().map(|n| n.to_string_lossy().into_owned()));
        let Some(disk) = dev.as_deref().and_then(parent_disk) else { continue };
        // Points de montage les plus parlants d'abord : /, /home, puis par longueur.
        targets.sort_by_key(|t| (t != "/", t != "/home", t.len()));
        let Some((total, avail, free)) = statvfs(&targets[0]) else { continue };
        out.entry(disk).or_default().push(MountSnapshot {
            device: dev.unwrap_or_default(),
            fstype,
            total,
            used: total.saturating_sub(free),
            available: avail,
            targets,
        });
    }
    out
}

/// « /mnt/Mes\040Jeux » → « /mnt/Mes Jeux » (échappements octaux de mountinfo).
fn unescape_mount(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'\\' && i + 3 < b.len() && b[i + 1..i + 4].iter().all(|c| (b'0'..=b'7').contains(c)) {
            out.push(u8::from_str_radix(&s[i + 1..i + 4], 8).unwrap_or(b'?'));
            i += 4;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// (taille, disponible pour l'utilisateur, libre) en octets.
fn statvfs(path: &str) -> Option<(u64, u64, u64)> {
    let c = CString::new(path).ok()?;
    // SAFETY: chemin C valide, structure de sortie locale initialisée à zéro.
    unsafe {
        let mut s: libc::statvfs = std::mem::zeroed();
        if libc::statvfs(c.as_ptr(), &mut s) != 0 {
            return None;
        }
        let f = s.f_frsize as u64;
        Some((s.f_blocks as u64 * f, s.f_bavail as u64 * f, s.f_bfree as u64 * f))
    }
}

/// Point de montage le plus long qui contient `path` (pour savoir si ~ est sur un disque).
pub fn mount_of(path: &Path, disks: &[DiskSnapshot]) -> Option<(String, PathBuf)> {
    let p = path.to_string_lossy();
    disks
        .iter()
        .flat_map(|d| d.mounts.iter().flat_map(move |m| m.targets.iter().map(move |t| (d.id.clone(), t.clone()))))
        .filter(|(_, t)| p == t.as_str() || p.starts_with(&format!("{}/", t.trim_end_matches('/'))) || t == "/")
        .max_by_key(|(_, t)| t.len())
        .map(|(d, t)| (d, PathBuf::from(t)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unescapes() {
        assert_eq!(unescape_mount("/mnt/Mes\\040Jeux"), "/mnt/Mes Jeux");
    }

    #[test]
    fn samples_this_machine() {
        let mut d = Disks::new();
        d.sample();
        std::thread::sleep(std::time::Duration::from_millis(300));
        for s in d.sample() {
            println!("{} {:?} {:?} {} Go  {:?} °C", s.id, s.kind, s.model, s.size / 1_000_000_000, s.temp_c);
            for m in &s.mounts {
                println!("   {} {} {:?} {}/{} Go", m.device, m.fstype, m.targets, m.used / 1_000_000_000, m.total / 1_000_000_000);
            }
        }
    }
}
