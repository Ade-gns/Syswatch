//! Collecte des mesures système de SysWatch. Tout est lu localement (sysfs, procfs),
//! sans droits root ; les mesures qui en exigent passent par le service privilégié.

pub mod battery;
pub mod cpu;
pub mod desktop;
pub mod dirscan;
pub mod disks;
pub mod fanctl;
/// Types partagés avec le service privilégié (modes, courbes).
pub use syswatch_fans as fans;
pub mod gpu;
pub mod hwmon;
pub mod memory;
pub mod model;
pub mod network;
pub mod procs;
pub mod selfmem;
pub mod sensors;
pub mod smart;
pub mod sockdiag;
pub mod startup;
pub mod sysfs;

use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use sysinfo::System;

use battery::Batteries;
use cpu::CpuCollector;
use disks::Disks;
use gpu::Gpus;
use network::Network;
use model::{BatterySnapshot, Capabilities, Feature, FanReading, GpuSnapshot, SensorReading, Snapshot, SystemInfo};
use selfmem::SelfMem;
use sensors::Sensors;

/// La PSS coûte un parcours des pages mémoire : 2 s suffisent pour un affichage discret.
const SELF_MEM_EVERY: Duration = Duration::from_secs(2);
/// NVML coûte quelques millisecondes : le GPU est lu au plus toutes les 2 s.
const GPU_EVERY: Duration = Duration::from_secs(2);
/// La batterie évolue lentement et ses pilotes (ACPI) sont lents à interroger.
const BATTERY_EVERY: Duration = Duration::from_secs(5);

/// Valeur recalculée seulement quand elle a vieilli de plus que `every`.
struct Tier<T> {
    every: Duration,
    last: Option<(Instant, T)>,
}

impl<T: Clone> Tier<T> {
    fn new(every: Duration) -> Self {
        Self { every, last: None }
    }
    fn get(&mut self, f: impl FnOnce() -> T) -> T {
        match &self.last {
            Some((t, v)) if t.elapsed() < self.every => v.clone(),
            _ => {
                let v = f();
                self.last = Some((Instant::now(), v.clone()));
                v
            }
        }
    }
}

type GpuRead = (Vec<GpuSnapshot>, Vec<SensorReading>, Vec<FanReading>);

pub struct Collector {
    cpu: CpuCollector,
    sensors: Sensors,
    gpus: Gpus,
    batteries: Batteries,
    network: Network,
    disks: Disks,
    self_mem: SelfMem,
    self_mem_tier: Tier<Option<u64>>,
    gpu_tier: Tier<GpuRead>,
    battery_tier: Tier<(Vec<BatterySnapshot>, Option<bool>)>,
}

impl Collector {
    pub fn new() -> Option<Self> {
        let cpu = CpuCollector::new()?;
        let gpus = Gpus::discover(&cpu.info.model);
        Some(Self {
            cpu,
            sensors: Sensors::discover(),
            gpus,
            batteries: Batteries::discover(),
            network: Network::new(),
            disks: Disks::new(),
            self_mem: SelfMem::new(),
            self_mem_tier: Tier::new(SELF_MEM_EVERY),
            gpu_tier: Tier::new(GPU_EVERY),
            battery_tier: Tier::new(BATTERY_EVERY),
        })
    }

    pub fn system_info(&self) -> SystemInfo {
        SystemInfo {
            os_name: os_pretty_name(),
            host_name: System::host_name().ok(),
            kernel: System::kernel_version().ok(),
            boot_time_s: System::boot_time().unwrap_or(0),
            cpu: self.cpu.info.clone(),
            gpus: self.gpus.infos(),
            capabilities: Capabilities {
                cpu_temp: self.cpu.cap_temp.clone(),
                cpu_power: self.cpu.cap_power.clone(),
                cpu_freq: self.cpu.cap_freq.clone(),
                nvml: self.gpus.cap_nvml.clone(),
                battery: if self.batteries.present() {
                    Feature::yes("power_supply")
                } else {
                    Feature::no("Aucune batterie détectée : ordinateur de bureau ou batterie non reconnue")
                },
            },
        }
    }

    pub fn sample(&mut self) -> Snapshot {
        let self_mem = &mut self.self_mem;
        let self_mem_bytes = self.self_mem_tier.get(|| self_mem.read());
        let gpus = &mut self.gpus;
        let (gpus, gpu_sensors, gpu_fans) = self.gpu_tier.get(|| gpus.read());
        let bats = &mut self.batteries;
        let (batteries, ac_online) = self.battery_tier.get(|| (bats.read(), bats.ac_online()));

        let mut sensors = self.sensors.read_temps();
        sensors.extend(gpu_sensors);
        sensors.sort_by_key(|s| s.kind);
        let mut fans = self.sensors.read_fans();
        fans.extend(gpu_fans);

        Snapshot {
            t: SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0),
            uptime_s: System::uptime().unwrap_or(0),
            cpu: self.cpu.sample(),
            memory: memory::read(),
            sensors,
            fans,
            gpus,
            batteries,
            ac_online,
            network: self.network.sample(),
            disks: self.disks.sample(),
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
