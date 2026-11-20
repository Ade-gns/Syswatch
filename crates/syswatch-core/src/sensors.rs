//! Tous les capteurs de température et ventilateurs exposés par hwmon, avec un libellé
//! français et une famille (CPU, GPU, SSD…) qui fixe les seuils côté interface.
//! Découverte une fois au démarrage ; chaque tick relit seulement les fichiers `*_input`.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use crate::hwmon::{self, Chip};
use crate::model::{FanReading, SensorKind, SensorReading};
use crate::sysfs::{read_i64, read_trim, read_u64};

struct Probe {
    id: String,
    label: String,
    kind: SensorKind,
    input: PathBuf,
    crit_c: Option<f32>,
}

struct FanProbe {
    id: String,
    label: String,
    input: PathBuf,
    pwm: Option<PathBuf>,
}

pub struct Sensors {
    probes: Vec<Probe>,
    fans: Vec<FanProbe>,
}

impl Sensors {
    pub fn discover() -> Self {
        Self::discover_from(&hwmon::chips())
    }

    fn discover_from(chips: &[Chip]) -> Self {
        let mut probes = Vec::new();
        let mut fans = Vec::new();
        // Plusieurs puces du même nom (deux SSD NVMe…) : on les numérote.
        let mut seen: HashMap<String, u32> = HashMap::new();
        let counts = chips.iter().fold(HashMap::<&str, u32>::new(), |mut m, c| {
            *m.entry(c.name.as_str()).or_default() += 1;
            m
        });

        for chip in chips {
            let n = seen.entry(chip.name.clone()).or_default();
            let ordinal = *n;
            *n += 1;
            let multi = counts.get(chip.name.as_str()).copied().unwrap_or(1) > 1;
            let gpu = gpu_kind(&chip.dir);
            for t in hwmon::temps(chip) {
                let idx = t.input.file_name().and_then(|f| f.to_str()).and_then(|f| f.strip_suffix("_input")).unwrap_or("temp").to_owned();
                let (kind, mut label) = classify(&chip.name, &t.raw_label, gpu);
                if multi {
                    label = format!("{label} {}", ordinal + 1);
                }
                let crit_c = crit_of(&chip.dir, &idx);
                probes.push(Probe { id: format!("{}{}/{idx}", chip.name, if multi { ordinal.to_string() } else { String::new() }), label, kind, input: t.input, crit_c });
            }
            fans.extend(fans_of(chip, gpu));
        }
        // Ordre d'affichage : CPU, GPU, SSD, mémoire, carte mère, batterie, Wi-Fi, autres.
        probes.sort_by_key(|p| p.kind);
        Self { probes, fans }
    }

    pub fn read_temps(&self) -> Vec<SensorReading> {
        self.probes
            .iter()
            .filter_map(|p| {
                let v = read_i64(&p.input)? as f32 / 1000.0;
                // Valeurs absurdes (capteur débranché, 0 °C, −273 °C) : ignorées.
                (v > 1.0 && v < 150.0).then(|| SensorReading { id: p.id.clone(), label: p.label.clone(), kind: p.kind, value_c: v, crit_c: p.crit_c })
            })
            .collect()
    }

    pub fn read_fans(&self) -> Vec<FanReading> {
        self.fans
            .iter()
            .map(|f| FanReading {
                id: f.id.clone(),
                label: f.label.clone(),
                rpm: read_u64(&f.input).map(|v| v as u32),
                pct: f.pwm.as_ref().and_then(read_u64).map(|p| p as f32 / 255.0 * 100.0),
            })
            .collect()
    }
}

/// Pour une puce amdgpu/nouveau : GPU intégré ou dédié. `None` si la puce n'est pas un GPU.
#[derive(Clone, Copy, PartialEq)]
enum GpuType {
    Integrated,
    Discrete,
}

fn gpu_kind(chip_dir: &Path) -> Option<GpuType> {
    let dev = chip_dir.join("device");
    let class = read_trim(dev.join("class"))?;
    if !class.starts_with("0x03") {
        return None;
    }
    // Heuristique robuste : un GPU dédié a de la VRAM propre (> 1 Gio) ou un ventilateur.
    let vram = read_u64(dev.join("mem_info_vram_total")).unwrap_or(0);
    let has_fan = hwmon::has_fan(&Chip { name: String::new(), dir: chip_dir.to_path_buf() });
    Some(if vram > (1 << 30) || has_fan { GpuType::Discrete } else { GpuType::Integrated })
}

fn classify(chip: &str, raw: &str, gpu: Option<GpuType>) -> (SensorKind, String) {
    use SensorKind::*;
    let gpu_name = || if gpu == Some(GpuType::Integrated) { "GPU intégré" } else { "GPU" };
    match chip {
        "k10temp" | "zenpower" | "coretemp" | "cpu_thermal" => {
            let l = match raw {
                "Tctl" | "Tdie" | "Package id 0" | "Package" => "CPU".to_owned(),
                l if l.starts_with("Tccd") => format!("CPU · CCD{}", &l[4..]),
                l if l.starts_with("Core ") => format!("CPU · cœur {}", &l[5..]),
                l => format!("CPU · {l}"),
            };
            (Cpu, l)
        }
        "amdgpu" | "nouveau" | "radeon" | "i915" | "xe" => {
            let l = match raw {
                "edge" | "temp1" | "GPU core" => gpu_name().to_owned(),
                "junction" => format!("{} · point chaud", gpu_name()),
                "mem" => format!("{} · mémoire", gpu_name()),
                l => format!("{} · {l}", gpu_name()),
            };
            (Gpu, l)
        }
        "nvme" => (
            Ssd,
            match raw {
                "Composite" => "SSD NVMe".to_owned(),
                l => format!("SSD NVMe · {}", l.replace("Sensor", "capteur")),
            },
        ),
        "drivetemp" => (Ssd, "Disque SATA".into()),
        "jc42" | "spd5118" => (Ram, "Mémoire (barrette)".into()),
        "acpitz" => (Board, "Zone ACPI".into()),
        "pch_cannonlake" | "pch_skylake" | "pch_cometlake" => (Board, "Chipset".into()),
        c if c.starts_with("nct") || c.starts_with("it87") || c.starts_with("it86") || c == "asus_wmi_sensors" || c == "asusec" => {
            (Board, if raw.starts_with("temp") { "Carte mère".into() } else { format!("Carte mère · {raw}") })
        }
        c if c.starts_with("BAT") => (Battery, "Batterie".into()),
        c if c.starts_with("iwlwifi") || c.starts_with("mt79") || c.starts_with("ath") || c.contains("phy") => (Wifi, "Wi-Fi".into()),
        c => (Other, if raw.starts_with("temp") { c.to_owned() } else { format!("{c} · {raw}") }),
    }
}

/// Seuil critique du pilote, retenu seulement s'il est plausible (certains pilotes renvoient 0 ou 65 261 °C).
fn crit_of(dir: &Path, idx: &str) -> Option<f32> {
    ["crit", "max"]
        .iter()
        .filter_map(|s| read_i64(dir.join(format!("{idx}_{s}"))))
        .map(|m| m as f32 / 1000.0)
        .find(|v| (40.0..=125.0).contains(v))
}

fn fans_of(chip: &Chip, gpu: Option<GpuType>) -> Vec<FanProbe> {
    let Ok(rd) = fs::read_dir(&chip.dir) else { return Vec::new() };
    let mut idx: Vec<u32> = rd
        .flatten()
        .filter_map(|e| e.file_name().to_str()?.strip_prefix("fan")?.strip_suffix("_input")?.parse().ok())
        .collect();
    idx.sort_unstable();
    let many = idx.len() > 1;
    idx.into_iter()
        .map(|i| {
            let raw = read_trim(chip.dir.join(format!("fan{i}_label")));
            let label = match (gpu.is_some(), raw) {
                (true, _) => "Ventilateur GPU".to_owned(),
                (false, Some(l)) => format!("Ventilateur {l}"),
                (false, None) if many => format!("Ventilateur {i}"),
                (false, None) => "Ventilateur".to_owned(),
            };
            let pwm = chip.dir.join(format!("pwm{i}"));
            FanProbe { id: format!("{}/fan{i}", chip.name), label, input: chip.dir.join(format!("fan{i}_input")), pwm: pwm.exists().then_some(pwm) }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn labels() {
        assert_eq!(classify("k10temp", "Tctl", None), (SensorKind::Cpu, "CPU".into()));
        assert_eq!(classify("k10temp", "Tccd1", None).1, "CPU · CCD1");
        assert_eq!(classify("amdgpu", "edge", Some(GpuType::Integrated)).1, "GPU intégré");
        assert_eq!(classify("amdgpu", "junction", Some(GpuType::Discrete)).1, "GPU · point chaud");
        assert_eq!(classify("nvme", "Composite", None), (SensorKind::Ssd, "SSD NVMe".into()));
        assert_eq!(classify("nvme", "Sensor 2", None).1, "SSD NVMe · capteur 2");
        assert_eq!(classify("mt7921_phy0", "temp1", None).0, SensorKind::Wifi);
        assert_eq!(classify("jc42", "temp1", None).0, SensorKind::Ram);
    }

    #[test]
    fn reads_this_machine() {
        let s = Sensors::discover();
        for r in s.read_temps() {
            println!("{:<28} {:>6.1} °C  {:?} {:?}", r.label, r.value_c, r.kind, r.crit_c);
        }
        for f in s.read_fans() {
            println!("{:<28} {:?} tr/min {:?} %", f.label, f.rpm, f.pct);
        }
    }
}
