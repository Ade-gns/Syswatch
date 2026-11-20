//! Espace par dossier : taille de chaque sous-dossier d'une racine (le dossier personnel
//! s'il est sur le disque choisi, sinon le point de montage principal). Analyse lancée à
//! la demande, en tâche de fond, sur quelques threads à priorité basse (nice 10), sans
//! traverser d'autre système de fichiers ni suivre les liens symboliques. Le résultat est
//! gardé 10 minutes. Taille = blocs réellement alloués (fichiers creux comptés au plus juste).

use std::collections::HashMap;
use std::fs;
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;

use crate::disks::{self, Disks};

const KEEP: Duration = Duration::from_secs(600);
const WORKERS: usize = 4;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderEntry {
    /// Nom affiché (« ~/Jeux », « /var »).
    pub name: String,
    pub bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderScan {
    pub disk: String,
    pub root: String,
    pub running: bool,
    pub files: u64,
    /// Dossiers terminés, du plus gros au plus petit.
    pub entries: Vec<FolderEntry>,
    /// Dossiers illisibles (droits) : leur taille n'est pas comptée.
    pub denied: u64,
    pub finished_s: Option<u64>,
}

#[derive(Default, Clone)]
pub struct DirScanner {
    scans: Arc<Mutex<HashMap<String, (Instant, FolderScan)>>>,
}

impl DirScanner {
    /// Lance (ou relance si `force` ou trop ancien) l'analyse du disque et renvoie l'état courant.
    pub fn scan(&self, disk: &str, force: bool) -> Result<FolderScan, String> {
        let mut map = self.scans.lock().unwrap();
        if let Some((t, s)) = map.get(disk) {
            if s.running || (!force && t.elapsed() < KEEP) {
                return Ok(s.clone());
            }
        }
        let root = root_for(disk).ok_or("Aucun système de fichiers monté sur ce disque")?;
        let display = display_root(&root);
        let state = FolderScan { disk: disk.into(), root: display, running: true, files: 0, entries: Vec::new(), denied: 0, finished_s: None };
        map.insert(disk.to_owned(), (Instant::now(), state.clone()));
        drop(map);
        let scans = Arc::clone(&self.scans);
        let disk = disk.to_owned();
        thread::Builder::new().name("syswatch-dirscan".into()).spawn(move || run(scans, disk, root)).map_err(|e| e.to_string())?;
        Ok(state)
    }
}

/// Racine analysée : le dossier personnel s'il est sur ce disque, sinon le plus grand montage.
fn root_for(disk: &str) -> Option<PathBuf> {
    let snaps = Disks::new().sample();
    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        if disks::mount_of(&home, &snaps).is_some_and(|(d, _)| d == disk) {
            return Some(home);
        }
    }
    let d = snaps.into_iter().find(|d| d.id == disk)?;
    d.mounts.first().and_then(|m| m.targets.first()).map(PathBuf::from)
}

fn display_root(p: &Path) -> String {
    let home = std::env::var("HOME").unwrap_or_default();
    let s = p.to_string_lossy().into_owned();
    if !home.is_empty() && s.starts_with(&home) { s.replacen(&home, "~", 1) } else { s }
}

fn run(scans: Arc<Mutex<HashMap<String, (Instant, FolderScan)>>>, disk: String, root: PathBuf) {
    lower_priority();
    let Ok(meta) = fs::symlink_metadata(&root) else { return finish(&scans, &disk) };
    let dev = meta.dev();
    let files = Arc::new(AtomicU64::new(0));
    let denied = Arc::new(AtomicU64::new(0));
    let mut loose = 0u64;
    let mut dirs = Vec::new();
    if let Ok(rd) = fs::read_dir(&root) {
        for e in rd.flatten() {
            let Ok(m) = e.metadata() else { continue };
            if m.is_dir() && m.dev() == dev {
                dirs.push(e.path());
            } else if m.is_file() {
                loose += m.blocks() * 512;
                files.fetch_add(1, Ordering::Relaxed);
            }
        }
    }
    let queue = Arc::new(Mutex::new(dirs));
    let prefix = display_root(&root);
    thread::scope(|s| {
        for _ in 0..WORKERS {
            let (queue, files, denied, scans, disk, prefix) = (Arc::clone(&queue), Arc::clone(&files), Arc::clone(&denied), &scans, &disk, &prefix);
            s.spawn(move || {
                lower_priority();
                loop {
                    let Some(dir) = queue.lock().unwrap().pop() else { break };
                    let bytes = du(&dir, dev, &files, &denied);
                    let name = format!("{}/{}", prefix.trim_end_matches('/'), dir.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default());
                    if let Some((_, st)) = scans.lock().unwrap().get_mut(disk) {
                        st.entries.push(FolderEntry { name, bytes });
                        st.entries.sort_by(|a, b| b.bytes.cmp(&a.bytes));
                        st.files = files.load(Ordering::Relaxed);
                        st.denied = denied.load(Ordering::Relaxed);
                    }
                }
            });
        }
    });
    if let Some((t, st)) = scans.lock().unwrap().get_mut(&disk) {
        if loose > 0 {
            st.entries.push(FolderEntry { name: format!("{} (fichiers)", prefix), bytes: loose });
            st.entries.sort_by(|a, b| b.bytes.cmp(&a.bytes));
        }
        st.files = files.load(Ordering::Relaxed);
        st.denied = denied.load(Ordering::Relaxed);
        *t = Instant::now();
    }
    finish(&scans, &disk);
}

fn finish(scans: &Mutex<HashMap<String, (Instant, FolderScan)>>, disk: &str) {
    if let Some((_, st)) = scans.lock().unwrap().get_mut(disk) {
        st.running = false;
        st.finished_s = SystemTime::now().duration_since(UNIX_EPOCH).ok().map(|d| d.as_secs());
    }
}

/// Taille allouée d'une arborescence, parcours itératif (pas de récursion profonde).
fn du(root: &Path, dev: u64, files: &AtomicU64, denied: &AtomicU64) -> u64 {
    let mut total = 0;
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(rd) = fs::read_dir(&dir) else {
            denied.fetch_add(1, Ordering::Relaxed);
            continue;
        };
        for e in rd.flatten() {
            let Ok(m) = e.metadata() else { continue };
            if m.dev() != dev {
                continue; // autre système de fichiers ou sous-volume btrfs
            }
            total += m.blocks() * 512;
            if m.is_dir() {
                stack.push(e.path());
            } else {
                files.fetch_add(1, Ordering::Relaxed);
            }
        }
    }
    total
}

/// Priorité CPU basse (nice 10) et E/S en classe « idle » pour ce thread.
fn lower_priority() {
    // SAFETY: appels système sans pointeur, appliqués au thread courant.
    unsafe {
        let tid = libc::syscall(libc::SYS_gettid) as libc::id_t;
        libc::setpriority(libc::PRIO_PROCESS, tid, 10);
        // ioprio_set(IOPRIO_WHO_PROCESS = 1, tid, IOPRIO_CLASS_IDLE << 13)
        libc::syscall(libc::SYS_ioprio_set, 1, tid, 3 << 13);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scans_a_small_tree() {
        let s = DirScanner::default();
        let disk = Disks::new().sample().into_iter().find(|d| !d.mounts.is_empty()).map(|d| d.id);
        let Some(disk) = disk else { return };
        let t = Instant::now();
        s.scan(&disk, true).unwrap();
        loop {
            let st = s.scan(&disk, false).unwrap();
            if !st.running {
                println!("{} : {} fichiers en {:?}, {} illisibles", st.root, st.files, t.elapsed(), st.denied);
                for e in st.entries.iter().take(6) {
                    println!("  {:<30} {} Mo", e.name, e.bytes / 1_048_576);
                }
                break;
            }
            thread::sleep(Duration::from_millis(200));
        }
    }
}
