//! Mémoire utilisée par SysWatch lui-même : processus principal + descendants
//! (processus WebKit de la webview). On somme la PSS (part proportionnelle des pages
//! partagées), plus juste que la RSS qui compterait plusieurs fois les bibliothèques.

use std::fs;
use std::time::{Duration, Instant};

/// La liste des descendants change rarement : on la recalcule toutes les 10 s.
const TREE_TTL: Duration = Duration::from_secs(10);

pub struct SelfMem {
    root: u32,
    pids: Vec<u32>,
    scanned: Option<Instant>,
}

impl SelfMem {
    pub fn new() -> Self {
        Self { root: std::process::id(), pids: Vec::new(), scanned: None }
    }

    /// Mémoire totale en octets, ou `None` si /proc est illisible.
    pub fn read(&mut self) -> Option<u64> {
        if self.scanned.is_none_or(|t| t.elapsed() > TREE_TTL) {
            self.pids = descendants(self.root);
            self.scanned = Some(Instant::now());
        }
        let mut total = 0u64;
        let mut any = false;
        for pid in &self.pids {
            if let Some(kb) = fs::read_to_string(format!("/proc/{pid}/smaps_rollup")).ok().and_then(|s| parse_pss_kb(&s)) {
                total += kb * 1024;
                any = true;
            }
        }
        any.then_some(total)
    }
}

impl Default for SelfMem {
    fn default() -> Self {
        Self::new()
    }
}

/// `root` et tous ses descendants, d'après le champ ppid de /proc/<pid>/stat.
fn descendants(root: u32) -> Vec<u32> {
    let mut parent: Vec<(u32, u32)> = Vec::new();
    if let Ok(rd) = fs::read_dir("/proc") {
        for e in rd.flatten() {
            let Ok(pid) = e.file_name().to_string_lossy().parse::<u32>() else { continue };
            if let Some(pp) = fs::read_to_string(format!("/proc/{pid}/stat")).ok().and_then(|s| parse_ppid(&s)) {
                parent.push((pid, pp));
            }
        }
    }
    let mut out = vec![root];
    let mut i = 0;
    while i < out.len() {
        let p = out[i];
        out.extend(parent.iter().filter(|(_, pp)| *pp == p).map(|(c, _)| *c));
        i += 1;
    }
    out
}

/// Le nom du processus (2e champ) peut contenir des espaces et des parenthèses :
/// on repart de la dernière parenthèse fermante.
fn parse_ppid(stat: &str) -> Option<u32> {
    let rest = &stat[stat.rfind(')')? + 1..];
    rest.split_whitespace().nth(1)?.parse().ok()
}

fn parse_pss_kb(rollup: &str) -> Option<u64> {
    rollup.lines().find(|l| l.starts_with("Pss:"))?.split_whitespace().nth(1)?.parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ppid() {
        assert_eq!(parse_ppid("1234 (Web Content (x)) S 42 1234 1234 0"), Some(42));
    }

    #[test]
    fn pss() {
        let s = "55d0-7fff ---p 00000000 00:00 0 [rollup]\nRss: 120000 kB\nPss: 48123 kB\nPss_Anon: 1 kB\n";
        assert_eq!(parse_pss_kb(s), Some(48123));
    }

    #[test]
    fn reads_own_memory() {
        assert!(SelfMem::new().read().unwrap_or(0) > 0);
    }
}
