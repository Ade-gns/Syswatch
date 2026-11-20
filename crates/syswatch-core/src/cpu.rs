//! Processeur : charge (sysinfo), fréquences (cpufreq), températures (hwmon), puissance
//! (RAPL si lisible, sinon PPT amdgpu sur les APU AMD).

use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use std::time::Instant;

use sysinfo::{CpuRefreshKind, System};

use crate::hwmon::{self, TempProbe};
use crate::model::{CpuInfo, CpuSnapshot, Feature, TempReading};
use crate::sysfs::{read_trim, read_u64, readable};

const CPU_SYS: &str = "/sys/devices/system/cpu";
const RAPL: &str = "/sys/class/powercap/intel-rapl:0";
/// Puces hwmon qui mesurent la température du processeur.
const CPU_CHIPS: [&str; 4] = ["k10temp", "zenpower", "coretemp", "cpu_thermal"];
/// Libellés de température « package », par ordre de préférence.
const PACKAGE_LABELS: [&str; 4] = ["Tdie", "Tctl", "Package id 0", "Package"];
const MAX_SENSOR_ROWS: usize = 5;

pub struct CpuCollector {
    sys: System,
    /// `scaling_cur_freq` de chaque processeur logique.
    thread_freq: Vec<PathBuf>,
    /// `scaling_cur_freq` d'un thread représentatif par cœur physique.
    core_freq: Vec<PathBuf>,
    temps: CpuTemps,
    power: Option<PowerSource>,
    peak: Option<f32>,
    pub info: CpuInfo,
    pub cap_temp: Feature,
    pub cap_power: Feature,
    pub cap_freq: Feature,
}

impl CpuCollector {
    pub fn new() -> Option<Self> {
        let mut sys = System::new().ok()?;
        sys.refresh_cpu_specifics(CpuRefreshKind::nothing().with_usage());

        let (thread_freq, core_freq) = topology();
        let info = cpu_info(core_freq.len(), sys.cpus().len());
        let temps = CpuTemps::discover();
        let power = PowerSource::detect(&info.model);

        let cap_temp = match &temps.package {
            Some(p) => Feature::yes(format!("{} · {}", p.chip, p.raw_label)),
            None => Feature::no("Aucun capteur de température processeur (k10temp, coretemp) trouvé"),
        };
        let cap_power = match &power {
            Some(p) => Feature::yes(p.describe()),
            None => Feature::no("Compteurs RAPL réservés à root : nécessite le service SysWatch"),
        };
        let cap_freq = if thread_freq.is_empty() {
            Feature::no("cpufreq indisponible sur ce système")
        } else {
            Feature::yes(info.driver.clone().unwrap_or_else(|| "cpufreq".into()))
        };

        Some(Self { sys, thread_freq, core_freq, temps, power, peak: None, info, cap_temp, cap_power, cap_freq })
    }

    pub fn sample(&mut self) -> CpuSnapshot {
        self.sys.refresh_cpu_specifics(CpuRefreshKind::nothing().with_usage());
        let per_thread: Vec<f32> = self.sys.cpus().iter().map(|c| c.usage()).collect();

        let mhz = |p: &PathBuf| read_u64(p).map(|khz| (khz / 1000) as u32);
        let threads: Vec<u32> = self.thread_freq.iter().filter_map(mhz).collect();
        let freq_mhz = (!threads.is_empty()).then(|| threads.iter().sum::<u32>() / threads.len() as u32);
        let per_core_freq_mhz = self.core_freq.iter().filter_map(mhz).collect();

        let temp_c = self.temps.package.as_ref().and_then(TempProbe::read);
        if let Some(t) = temp_c {
            self.peak = Some(self.peak.map_or(t, |p| p.max(t)));
        }

        let (processes, threads_total) = task_counts();
        CpuSnapshot {
            usage: self.sys.global_cpu_usage(),
            per_thread,
            freq_mhz,
            per_core_freq_mhz,
            temp_c,
            temp_peak_c: self.peak,
            power_w: self.power.as_mut().and_then(PowerSource::read),
            processes,
            threads: threads_total,
            sensors: self.temps.read(),
        }
    }
}

/// Retourne (fréquence de chaque thread, fréquence d'un thread par cœur physique).
fn topology() -> (Vec<PathBuf>, Vec<PathBuf>) {
    let mut threads: Vec<(u32, PathBuf)> = Vec::new();
    let mut cores: BTreeMap<(u64, u64), (u32, PathBuf)> = BTreeMap::new();
    let Ok(rd) = fs::read_dir(CPU_SYS) else { return (Vec::new(), Vec::new()) };
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        let Some(n) = name.strip_prefix("cpu").and_then(|s| s.parse::<u32>().ok()) else { continue };
        let dir = e.path();
        let f = dir.join("cpufreq/scaling_cur_freq");
        if !f.exists() {
            continue; // processeur hors ligne ou sans cpufreq
        }
        let pkg = read_u64(dir.join("topology/physical_package_id")).unwrap_or(0);
        let core = read_u64(dir.join("topology/core_id")).unwrap_or(n as u64);
        cores.entry((pkg, core)).and_modify(|c| if n < c.0 { *c = (n, f.clone()) }).or_insert((n, f.clone()));
        threads.push((n, f));
    }
    threads.sort_by_key(|t| t.0);
    let mut c: Vec<(u32, PathBuf)> = cores.into_values().collect();
    c.sort_by_key(|t| t.0);
    (threads.into_iter().map(|t| t.1).collect(), c.into_iter().map(|t| t.1).collect())
}

fn cpu_info(physical: usize, logical: usize) -> CpuInfo {
    let model = fs::read_to_string("/proc/cpuinfo")
        .ok()
        .and_then(|s| {
            s.lines()
                .find(|l| l.starts_with("model name"))
                .and_then(|l| l.split_once(':'))
                .map(|(_, v)| v.trim().to_owned())
        })
        .unwrap_or_else(|| "Processeur inconnu".into());
    let f = |n: &str| read_trim(format!("{CPU_SYS}/cpu0/cpufreq/{n}"));
    CpuInfo {
        model,
        physical_cores: physical.max(1) as u32,
        logical_cpus: logical as u32,
        max_freq_mhz: f("cpuinfo_max_freq").and_then(|v| v.parse::<u64>().ok()).map(|k| (k / 1000) as u32),
        l3_cache_kb: read_trim(format!("{CPU_SYS}/cpu0/cache/index3/size")).and_then(|s| parse_cache_kb(&s)),
        governor: f("scaling_governor"),
        epp: f("energy_performance_preference"),
        driver: f("scaling_driver"),
    }
}

/// « 16384K » → 16384 ; « 32M » → 32768.
fn parse_cache_kb(s: &str) -> Option<u64> {
    let (num, mul) = match s.chars().last()? {
        'K' | 'k' => (&s[..s.len() - 1], 1),
        'M' | 'm' => (&s[..s.len() - 1], 1024),
        _ => (s, 1),
    };
    num.parse::<u64>().ok().map(|n| n * mul)
}

/// (nombre de processus, nombre total de threads). Lecture peu coûteuse :
/// /proc/loadavg donne le total des tâches, un `readdir` de /proc compte les processus.
fn task_counts() -> (u32, u32) {
    let threads = fs::read_to_string("/proc/loadavg").ok().and_then(|s| parse_loadavg_tasks(&s)).unwrap_or(0);
    let procs = fs::read_dir("/proc")
        .map(|rd| rd.flatten().filter(|e| e.file_name().to_string_lossy().bytes().all(|b| b.is_ascii_digit())).count())
        .unwrap_or(0);
    (procs as u32, threads)
}

fn parse_loadavg_tasks(s: &str) -> Option<u32> {
    s.split_whitespace().nth(3)?.split_once('/')?.1.parse().ok()
}

/* ---------- Températures ---------- */

struct CpuTemps {
    package: Option<TempProbe>,
    /// Capteurs affichés tels quels (libellé français, sonde).
    listed: Vec<(String, TempProbe)>,
    /// Cœurs individuels (coretemp) : on n'affiche que le plus chaud.
    cores: Vec<TempProbe>,
}

impl CpuTemps {
    fn discover() -> Self {
        let mut package = None;
        let mut listed = Vec::new();
        let mut cores = Vec::new();
        let mut acpi = None;
        for chip in hwmon::chips() {
            if chip.name == "acpitz" && acpi.is_none() {
                acpi = hwmon::temps(&chip).into_iter().next();
                continue;
            }
            if !CPU_CHIPS.contains(&chip.name.as_str()) {
                continue;
            }
            let probes = hwmon::temps(&chip);
            if package.is_none() {
                package = PACKAGE_LABELS
                    .iter()
                    .find_map(|l| probes.iter().find(|p| p.raw_label == *l))
                    .or_else(|| probes.first())
                    .cloned();
            }
            for p in probes {
                if p.raw_label.starts_with("Core ") {
                    cores.push(p);
                } else {
                    listed.push((label_fr(&p.raw_label), p));
                }
            }
        }
        if let Some(a) = acpi {
            listed.push(("Zone ACPI".into(), a));
        }
        Self { package, listed, cores }
    }

    fn read(&self) -> Vec<TempReading> {
        let mut out: Vec<TempReading> = self
            .listed
            .iter()
            .filter_map(|(label, p)| Some(TempReading { label: label.clone(), value_c: p.read()? }))
            .collect();
        if let Some(hot) = self.cores.iter().filter_map(TempProbe::read).reduce(f32::max) {
            out.insert(out.len().min(1), TempReading { label: "Cœur le plus chaud".into(), value_c: hot });
        }
        out.truncate(MAX_SENSOR_ROWS);
        out
    }
}

fn label_fr(raw: &str) -> String {
    match raw {
        "Tctl" | "Tdie" => format!("{raw} (package)"),
        l if l.starts_with("Tccd") => format!("{l} (cœurs)"),
        l if l.starts_with("Package id") => "Package".into(),
        l => l.to_owned(),
    }
}

/* ---------- Puissance ---------- */

enum PowerSource {
    /// Compteur d'énergie RAPL (µJ) : la puissance est la dérivée entre deux lectures.
    Rapl { energy: PathBuf, range: u64, last: Option<(u64, Instant)> },
    /// Puissance instantanée hwmon (µW), par ex. PPT amdgpu d'un APU = puissance du SoC.
    Hwmon { path: PathBuf, label: String },
}

impl PowerSource {
    fn detect(cpu_model: &str) -> Option<Self> {
        let energy = PathBuf::from(RAPL).join("energy_uj");
        if readable(&energy) {
            let range = read_u64(PathBuf::from(RAPL).join("max_energy_range_uj")).unwrap_or(u64::MAX);
            return Some(Self::Rapl { energy, range, last: None });
        }
        // APU AMD : le GPU intégré (sans ventilateur propre) rapporte la puissance du SoC entier.
        if cpu_model.contains("Radeon") {
            for chip in hwmon::chips().into_iter().filter(|c| c.name == "amdgpu" && !hwmon::has_fan(c)) {
                for f in ["power1_input", "power1_average"] {
                    let path = chip.dir.join(f);
                    if read_u64(&path).is_some() {
                        let label = read_trim(chip.dir.join("power1_label")).unwrap_or_else(|| "PPT".into());
                        return Some(Self::Hwmon { path, label });
                    }
                }
            }
        }
        None
    }

    fn describe(&self) -> String {
        match self {
            Self::Rapl { .. } => "RAPL (package)".into(),
            Self::Hwmon { label, .. } => format!("{label} du SoC (amdgpu)"),
        }
    }

    fn read(&mut self) -> Option<f32> {
        match self {
            Self::Hwmon { path, .. } => read_u64(path).map(|uw| uw as f32 / 1e6),
            Self::Rapl { energy, range, last } => {
                let now = (read_u64(energy)?, Instant::now());
                let prev = last.replace(now)?;
                let dt = now.1.duration_since(prev.1).as_secs_f32();
                if dt <= 0.0 {
                    return None;
                }
                let de = if now.0 >= prev.0 { now.0 - prev.0 } else { *range - prev.0 + now.0 };
                Some(de as f32 / 1e6 / dt)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loadavg() {
        assert_eq!(parse_loadavg_tasks("0.47 0.72 0.63 1/1769 14397\n"), Some(1769));
        assert_eq!(parse_loadavg_tasks("garbage"), None);
    }

    #[test]
    fn cache() {
        assert_eq!(parse_cache_kb("16384K"), Some(16384));
        assert_eq!(parse_cache_kb("32M"), Some(32768));
        assert_eq!(parse_cache_kb("512"), Some(512));
    }

    #[test]
    fn labels() {
        assert_eq!(label_fr("Tctl"), "Tctl (package)");
        assert_eq!(label_fr("Tccd1"), "Tccd1 (cœurs)");
        assert_eq!(label_fr("Package id 0"), "Package");
    }
}
