//! Mémoire vive et swap, lus directement dans /proc/meminfo (une seule lecture par tick).

use std::fs;

use crate::model::MemorySnapshot;

pub fn read() -> MemorySnapshot {
    let mut m = fs::read_to_string("/proc/meminfo").map(|s| parse(&s)).unwrap_or_default();
    m.swap_kind = swap_kind();
    m
}

fn parse(s: &str) -> MemorySnapshot {
    let mut v = std::collections::HashMap::new();
    for line in s.lines() {
        let Some((k, rest)) = line.split_once(':') else { continue };
        let kb: u64 = rest.split_whitespace().next().and_then(|n| n.parse().ok()).unwrap_or(0);
        v.insert(k, kb * 1024);
    }
    let g = |k: &str| v.get(k).copied().unwrap_or(0);
    let total = g("MemTotal");
    // Noyaux très anciens sans MemAvailable : approximation libre + cache.
    let available = v.get("MemAvailable").copied().unwrap_or_else(|| g("MemFree") + g("Cached") + g("Buffers"));
    let shared = g("Shmem");
    MemorySnapshot {
        total,
        used: total.saturating_sub(available),
        available,
        free: g("MemFree"),
        cached: (g("Cached") + g("SReclaimable")).saturating_sub(shared),
        buffers: g("Buffers"),
        shared,
        dirty: g("Dirty"),
        swap_total: g("SwapTotal"),
        swap_used: g("SwapTotal").saturating_sub(g("SwapFree")),
        swap_cached: g("SwapCached"),
        swap_kind: None,
    }
}

/// Type du premier périphérique de swap actif.
fn swap_kind() -> Option<String> {
    let s = fs::read_to_string("/proc/swaps").ok()?;
    let line = s.lines().nth(1)?;
    let mut f = line.split_whitespace();
    let (name, kind) = (f.next()?, f.next()?);
    Some(if name.contains("zram") { "zram" } else if kind == "partition" { "partition" } else { "fichier" }.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_meminfo() {
        let m = parse("MemTotal: 16000 kB\nMemFree: 2000 kB\nMemAvailable: 6000 kB\nBuffers: 100 kB\nCached: 5000 kB\nSReclaimable: 500 kB\nShmem: 300 kB\nSwapTotal: 8000 kB\nSwapFree: 7000 kB\n");
        assert_eq!(m.total, 16000 * 1024);
        assert_eq!(m.used, 10000 * 1024);
        assert_eq!(m.cached, 5200 * 1024);
        assert_eq!(m.swap_used, 1000 * 1024);
    }
}
