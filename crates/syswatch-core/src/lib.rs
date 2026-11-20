//! Collecte des mesures système de SysWatch. Tout est lu localement (sysfs, procfs),
//! sans droits root ; les mesures qui en exigent passent par le service privilégié.

pub mod cpu;
pub mod hwmon;
pub mod model;
pub mod selfmem;
pub mod sysfs;

use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use sysinfo::{MemoryRefreshKind, System};

use cpu::CpuCollector;
use model::{Capabilities, MemorySnapshot, Snapshot, SystemInfo};
use selfmem::SelfMem;

/// La PSS coûte un parcours des pages mémoire : 2 s suffisent pour un affichage discret.
const SELF_MEM_EVERY: Duration = Duration::from_secs(2);

pub struct Collector {
    sys: System,
    cpu: CpuCollector,
    self_mem: SelfMem,
    self_mem_last: Option<(Instant, Option<u64>)>,
}

impl Collector {
    pub fn new() -> Option<Self> {
        Some(Self { sys: System::new().ok()?, cpu: CpuCollector::new()?, self_mem: SelfMem::new(), self_mem_last: None })
    }

    pub fn system_info(&self) -> SystemInfo {
        SystemInfo {
            os_name: os_pretty_name(),
            host_name: System::host_name().ok(),
            kernel: System::kernel_version().ok(),
            boot_time_s: System::boot_time().unwrap_or(0),
            cpu: self.cpu.info.clone(),
            capabilities: Capabilities {
                cpu_temp: self.cpu.cap_temp.clone(),
                cpu_power: self.cpu.cap_power.clone(),
                cpu_freq: self.cpu.cap_freq.clone(),
            },
        }
    }

    pub fn sample(&mut self) -> Snapshot {
        self.sys.refresh_memory_specifics(MemoryRefreshKind::everything());
        let memory = MemorySnapshot {
            total: self.sys.total_memory(),
            used: self.sys.used_memory(),
            available: self.sys.available_memory(),
            swap_total: self.sys.total_swap(),
            swap_used: self.sys.used_swap(),
        };
        let self_mem_bytes = match self.self_mem_last {
            Some((t, v)) if t.elapsed() < SELF_MEM_EVERY => v,
            _ => {
                let v = self.self_mem.read();
                self.self_mem_last = Some((Instant::now(), v));
                v
            }
        };
        Snapshot {
            t: SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0),
            uptime_s: System::uptime().unwrap_or(0),
            cpu: self.cpu.sample(),
            memory,
            self_mem_bytes,
        }
    }
}

/// Nom de la distribution (PRETTY_NAME de /etc/os-release), par ex. « CachyOS ».
fn os_pretty_name() -> String {
    std::fs::read_to_string("/etc/os-release")
        .ok()
        .and_then(|s| {
            s.lines()
                .find_map(|l| l.strip_prefix("PRETTY_NAME="))
                .map(|v| v.trim_matches('"').to_owned())
        })
        .or_else(|| System::name().ok())
        .unwrap_or_else(|| "Linux".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Test sur la machine réelle : vérifie que la collecte fonctionne de bout en bout.
    #[test]
    fn samples_this_machine() {
        let mut c = Collector::new().expect("collecteur");
        std::thread::sleep(Duration::from_millis(300));
        let s = c.sample();
        let info = c.system_info();
        println!("{}", serde_json::to_string_pretty(&info).unwrap());
        println!("{}", serde_json::to_string_pretty(&s).unwrap());
        assert!(s.memory.total > 0);
        assert!(!s.cpu.per_thread.is_empty());
        assert_eq!(s.cpu.per_thread.len() as u32, info.cpu.logical_cpus);
    }
}
