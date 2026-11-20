//! GPU : AMD via sysfs (amdgpu), NVIDIA via NVML (bibliothèque du pilote chargée
//! dynamiquement, aucune dépendance à l'édition de liens), Intel en lecture minimale.
//!
//! Règle d'or sur les portables hybrides : un GPU en veille (runtime PM `suspended`) n'est
//! jamais interrogé, car toute lecture le réveillerait et viderait la batterie. Quand le
//! pilote NVIDIA gère la mise en veille fine (RTD3), NVML n'est ouvert que le temps d'une
//! lecture, au plus toutes les 10 s, pour laisser la carte se rendormir.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use nvml_wrapper::enum_wrappers::device::{Clock, TemperatureSensor};
use nvml_wrapper::Nvml;

use crate::model::{FanReading, Feature, GpuInfo, GpuSnapshot, GpuState, SensorKind, SensorReading};
use crate::sysfs::{read_i64, read_trim, read_u64};

const DRM: &str = "/sys/class/drm";
const RTD3_POLL: Duration = Duration::from_secs(10);
const VENDOR_AMD: &str = "0x1002";
const VENDOR_NVIDIA: &str = "0x10de";
const VENDOR_INTEL: &str = "0x8086";

enum Kind {
    Amd { hwmon: Option<PathBuf> },
    Nvidia { last: Option<(Instant, GpuSnapshot)> },
    Intel { hwmon: Option<PathBuf>, card: PathBuf },
    /// nouveau, pilote inconnu : température hwmon au mieux.
    Other { hwmon: Option<PathBuf> },
}

struct Card {
    info: GpuInfo,
    dev: PathBuf,
    kind: Kind,
}

pub struct Gpus {
    cards: Vec<Card>,
    nvml: Option<Nvml>,
    nvml_error: Option<String>,
    /// Mise en veille fine du pilote NVIDIA active : NVML ouvert seulement le temps d'une lecture.
    rtd3: bool,
    pub cap_nvml: Feature,
}

impl Gpus {
    pub fn discover(cpu_model: &str) -> Self {
        let mut me = Self { cards: Vec::new(), nvml: None, nvml_error: None, rtd3: false, cap_nvml: Feature::no("Aucune carte NVIDIA") };
        let mut seen: Vec<PathBuf> = Vec::new();
        let Ok(rd) = fs::read_dir(DRM) else { return me };
        let mut entries: Vec<PathBuf> = rd
            .flatten()
            .filter(|e| e.file_name().to_str().and_then(|n| n.strip_prefix("card")).is_some_and(|n| n.bytes().all(|b| b.is_ascii_digit())))
            .map(|e| e.path())
            .collect();
        entries.sort();
        for card in entries {
            let Ok(dev) = fs::canonicalize(card.join("device")) else { continue };
            if seen.contains(&dev) {
                continue;
            }
            seen.push(dev.clone());
            let vendor = read_trim(dev.join("vendor")).unwrap_or_default();
            let device = read_trim(dev.join("device")).unwrap_or_default();
            let driver = fs::read_link(dev.join("driver")).ok().and_then(|p| p.file_name().map(|n| n.to_string_lossy().into_owned())).unwrap_or_else(|| "aucun".into());
            let id = dev.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            let hwmon = first_hwmon(&dev);
            let pci_name = pci_name(&vendor, &device);

            let (vendor_name, kind, integrated) = match vendor.as_str() {
                VENDOR_AMD if driver == "amdgpu" => {
                    let has_fan = hwmon.as_ref().is_some_and(|h| h.join("fan1_input").exists());
                    let vram = read_u64(dev.join("mem_info_vram_total")).unwrap_or(0);
                    let integrated = !has_fan && (cpu_model.contains("Radeon") || vram <= 1 << 30);
                    ("AMD", Kind::Amd { hwmon }, integrated)
                }
                VENDOR_NVIDIA if driver == "nvidia" => ("NVIDIA", Kind::Nvidia { last: None }, false),
                VENDOR_INTEL => ("Intel", Kind::Intel { hwmon, card: card.clone() }, id == "0000:00:02.0"),
                VENDOR_AMD => ("AMD", Kind::Other { hwmon }, false),
                VENDOR_NVIDIA => ("NVIDIA", Kind::Other { hwmon }, false),
                v => (v, Kind::Other { hwmon }, false),
            };
            let mut info = GpuInfo {
                id,
                name: pci_name.unwrap_or_else(|| format!("GPU {vendor_name}")),
                vendor: vendor_name.into(),
                driver,
                integrated,
                max_core_mhz: None,
                max_mem_mhz: None,
                power_limit_w: None,
                power_shared: false,
                driver_version: None,
            };
            if let Kind::Amd { hwmon } = &kind {
                info.max_core_mhz = max_dpm_mhz(&dev.join("pp_dpm_sclk"));
                info.max_mem_mhz = max_dpm_mhz(&dev.join("pp_dpm_mclk"));
                info.power_limit_w = hwmon.as_ref().and_then(|h| read_u64(h.join("power1_cap"))).map(|uw| uw as f32 / 1e6).filter(|w| *w > 0.0);
                // APU : la puissance « PPT » est celle du SoC entier, partagée avec le CPU.
                info.power_shared = integrated;
            }
            if let Kind::Intel { card, .. } = &kind {
                info.max_core_mhz = read_u64(card.join("gt_max_freq_mhz")).or_else(|| read_u64(dev.join("tile0/gt0/freq0/max_freq"))).map(|v| v as u32);
            }
            me.cards.push(Card { info, dev, kind });
        }

        if me.cards.iter().any(|c| matches!(c.kind, Kind::Nvidia { .. })) {
            me.rtd3 = me.cards.iter().any(|c| matches!(c.kind, Kind::Nvidia { .. }) && rtd3_enabled(&c.info.id));
            me.init_nvidia_info();
        }
        me
    }

    pub fn infos(&self) -> Vec<GpuInfo> {
        self.cards.iter().map(|c| c.info.clone()).collect()
    }

    /// Ouvre NVML si besoin. Renvoie faux (avec l'erreur mémorisée) si c'est impossible.
    fn ensure_nvml(&mut self) -> bool {
        if self.nvml.is_some() {
            return true;
        }
        match Nvml::init() {
            Ok(n) => {
                self.nvml = Some(n);
                self.nvml_error = None;
                true
            }
            Err(e) => {
                self.nvml_error = Some(format!("NVML indisponible ({e}) : pilote propriétaire NVIDIA requis"));
                false
            }
        }
    }

    /// Nom commercial, version du pilote, limites : lus une fois, sans réveiller une carte en veille.
    fn init_nvidia_info(&mut self) {
        let awake: Vec<usize> = (0..self.cards.len())
            .filter(|&i| matches!(self.cards[i].kind, Kind::Nvidia { .. }) && !suspended(&self.cards[i].dev))
            .collect();
        if !self.ensure_nvml() {
            self.cap_nvml = Feature::no(self.nvml_error.clone().unwrap_or_default());
            return;
        }
        self.cap_nvml = Feature::yes(if self.rtd3 { "NVML (lecture espacée : mise en veille fine active)" } else { "NVML" });
        let nvml = self.nvml.as_ref().expect("NVML ouvert");
        let version = nvml.sys_driver_version().ok();
        for i in self.cards.iter().enumerate().filter(|(_, c)| matches!(c.kind, Kind::Nvidia { .. })).map(|(i, _)| i).collect::<Vec<_>>() {
            let card = &mut self.cards[i];
            card.info.driver_version = version.clone();
            if !awake.contains(&i) {
                continue;
            }
            if let Ok(d) = nvml.device_by_pci_bus_id(nvml_bus_id(&card.info.id)) {
                if let Ok(n) = d.name() {
                    card.info.name = n.trim_start_matches("NVIDIA ").to_owned();
                }
                card.info.max_core_mhz = d.max_clock_info(Clock::Graphics).ok();
                card.info.max_mem_mhz = d.max_clock_info(Clock::Memory).ok();
                card.info.power_limit_w = d.enforced_power_limit().ok().map(|mw| mw as f32 / 1000.0);
            }
        }
        if self.rtd3 {
            self.nvml = None;
        }
    }

    /// Mesures de chaque GPU, plus les capteurs et ventilateurs qu'il ajoute à la liste
    /// globale (les GPU NVIDIA n'ont pas de hwmon).
    pub fn read(&mut self) -> (Vec<GpuSnapshot>, Vec<SensorReading>, Vec<FanReading>) {
        let mut snaps = Vec::with_capacity(self.cards.len());
        let mut sensors = Vec::new();
        let mut fans = Vec::new();
        for i in 0..self.cards.len() {
            let s = self.read_card(i);
            let c = &self.cards[i];
            if matches!(c.kind, Kind::Nvidia { .. }) {
                if let Some(t) = s.temp_c {
                    sensors.push(SensorReading { id: format!("nvidia/{}", c.info.id), label: gpu_label(&c.info), kind: SensorKind::Gpu, value_c: t, crit_c: None });
                }
                if s.fan_pct.is_some() || s.fan_rpm.is_some() {
                    fans.push(FanReading { id: format!("nvidia/{}", c.info.id), label: "Ventilateur GPU".into(), rpm: s.fan_rpm, pct: s.fan_pct });
                }
            }
            snaps.push(s);
        }
        if self.rtd3 {
            self.nvml = None; // laisse la carte se rendormir
        }
        (snaps, sensors, fans)
    }

    fn read_card(&mut self, i: usize) -> GpuSnapshot {
        let id = self.cards[i].info.id.clone();
        let mut s = empty(&id, GpuState::Active);
        if suspended(&self.cards[i].dev) {
            s.state = GpuState::Sleeping;
            s.detail = Some("En veille : SysWatch ne le réveille pas pour le mesurer".into());
            return s;
        }
        let dev = self.cards[i].dev.clone();
        match &self.cards[i].kind {
            Kind::Amd { hwmon } => {
                s.usage = read_u64(dev.join("gpu_busy_percent")).map(|v| v as f32);
                s.vram_used = read_u64(dev.join("mem_info_vram_used"));
                s.vram_total = read_u64(dev.join("mem_info_vram_total"));
                if let Some(h) = hwmon {
                    s.temp_c = read_i64(h.join("temp1_input")).map(|m| m as f32 / 1000.0);
                    s.power_w = read_u64(h.join("power1_average")).or_else(|| read_u64(h.join("power1_input"))).map(|uw| uw as f32 / 1e6);
                    s.core_mhz = read_u64(h.join("freq1_input")).map(|hz| (hz / 1_000_000) as u32);
                    s.mem_mhz = read_u64(h.join("freq2_input")).map(|hz| (hz / 1_000_000) as u32);
                    s.fan_rpm = read_u64(h.join("fan1_input")).map(|v| v as u32);
                    s.fan_pct = read_u64(h.join("pwm1")).map(|p| p as f32 / 255.0 * 100.0);
                }
            }
            Kind::Intel { hwmon, card } => {
                s.core_mhz = read_u64(card.join("gt_cur_freq_mhz")).or_else(|| read_u64(dev.join("tile0/gt0/freq0/cur_freq"))).map(|v| v as u32);
                s.temp_c = hwmon.as_ref().and_then(|h| read_i64(h.join("temp1_input"))).map(|m| m as f32 / 1000.0);
                s.detail = Some("Charge du GPU Intel non exposée sans droits root".into());
            }
            Kind::Other { hwmon } => {
                s.temp_c = hwmon.as_ref().and_then(|h| read_i64(h.join("temp1_input"))).map(|m| m as f32 / 1000.0);
                s.detail = Some(format!("Pilote {} : seule la température est lisible", self.cards[i].info.driver));
            }
            Kind::Nvidia { .. } => return self.read_nvidia(i, s),
        }
        s
    }

    fn read_nvidia(&mut self, i: usize, mut s: GpuSnapshot) -> GpuSnapshot {
        let id = self.cards[i].info.id.clone();
        if self.rtd3 {
            if let Kind::Nvidia { last: Some((t, prev)) } = &self.cards[i].kind {
                if t.elapsed() < RTD3_POLL {
                    return prev.clone();
                }
            }
        }
        if !self.ensure_nvml() {
            s.state = GpuState::Unavailable;
            s.detail = self.nvml_error.clone();
            return s;
        }
        let nvml = self.nvml.as_ref().expect("NVML ouvert");
        match nvml.device_by_pci_bus_id(nvml_bus_id(&id)) {
            Ok(d) => {
                s.usage = d.utilization_rates().ok().map(|u| u.gpu as f32);
                s.temp_c = d.temperature(TemperatureSensor::Gpu).ok().map(|t| t as f32);
                s.power_w = d.power_usage().ok().map(|mw| mw as f32 / 1000.0);
                s.core_mhz = d.clock_info(Clock::Graphics).ok();
                s.mem_mhz = d.clock_info(Clock::Memory).ok();
                if let Ok(m) = d.memory_info() {
                    s.vram_used = Some(m.used);
                    s.vram_total = Some(m.total);
                }
                // Portables : ventilateur piloté par l'EC, NVML répond « non pris en charge ».
                s.fan_pct = d.fan_speed(0).ok().map(|p| p as f32);
                let g = d.running_graphics_processes().map(|v| v.len()).unwrap_or(0);
                let c = d.running_compute_processes().map(|v| v.len()).unwrap_or(0);
                s.processes = Some((g + c) as u32);
            }
            Err(e) => {
                s.state = GpuState::Unavailable;
                s.detail = Some(format!("Carte introuvable dans NVML ({e})"));
            }
        }
        if let Kind::Nvidia { last } = &mut self.cards[i].kind {
            *last = Some((Instant::now(), s.clone()));
        }
        s
    }
}

fn empty(id: &str, state: GpuState) -> GpuSnapshot {
    GpuSnapshot {
        id: id.to_owned(),
        state,
        detail: None,
        usage: None,
        temp_c: None,
        power_w: None,
        core_mhz: None,
        mem_mhz: None,
        vram_used: None,
        vram_total: None,
        fan_pct: None,
        fan_rpm: None,
        processes: None,
    }
}

fn gpu_label(info: &GpuInfo) -> String {
    if info.integrated { "GPU intégré".into() } else { "GPU".into() }
}

/// Lire runtime_status ne réveille pas le périphérique.
fn suspended(dev: &Path) -> bool {
    read_trim(dev.join("power/runtime_status")).is_some_and(|s| s == "suspended" || s == "suspending")
}

fn rtd3_enabled(bus: &str) -> bool {
    fs::read_to_string(format!("/proc/driver/nvidia/gpus/{bus}/power"))
        .ok()
        .and_then(|s| s.lines().find(|l| l.starts_with("Runtime D3 status")).map(|l| l.contains("Enabled")))
        .unwrap_or(false)
}

/// sysfs « 0000:01:00.0 » → NVML « 00000000:01:00.0 ».
fn nvml_bus_id(id: &str) -> String {
    format!("0000{id}")
}

fn first_hwmon(dev: &Path) -> Option<PathBuf> {
    let mut v: Vec<PathBuf> = fs::read_dir(dev.join("hwmon")).ok()?.flatten().map(|e| e.path()).collect();
    v.sort();
    v.into_iter().next()
}

/// Dernière ligne de pp_dpm_sclk (« 2: 2000Mhz * ») = fréquence maximale.
fn max_dpm_mhz(p: &Path) -> Option<u32> {
    parse_dpm_max(&fs::read_to_string(p).ok()?)
}

fn parse_dpm_max(s: &str) -> Option<u32> {
    s.lines()
        .filter_map(|l| l.split_whitespace().nth(1)?.to_ascii_lowercase().strip_suffix("mhz")?.parse::<u32>().ok())
        .max()
}

/// Nom du périphérique d'après la base pci.ids (paquet hwdata), raccourci :
/// « TU117M [GeForce GTX 1650 Mobile / Max-Q] » → « GeForce GTX 1650 Mobile ».
fn pci_name(vendor: &str, device: &str) -> Option<String> {
    let v = vendor.trim_start_matches("0x");
    let d = device.trim_start_matches("0x");
    let db = ["/usr/share/hwdata/pci.ids", "/usr/share/misc/pci.ids", "/usr/share/pci.ids"].iter().find_map(|p| fs::read_to_string(p).ok())?;
    lookup_pci(&db, v, d).map(|n| shorten(&n))
}

fn lookup_pci(db: &str, vendor: &str, device: &str) -> Option<String> {
    let mut in_vendor = false;
    for line in db.lines() {
        if line.starts_with('#') || line.is_empty() {
            continue;
        }
        if !line.starts_with('\t') {
            if in_vendor {
                return None;
            }
            in_vendor = line.get(..4).is_some_and(|x| x.eq_ignore_ascii_case(vendor));
        } else if in_vendor && !line.starts_with("\t\t") {
            let l = &line[1..];
            if l.get(..4).is_some_and(|x| x.eq_ignore_ascii_case(device)) {
                return Some(l[4..].trim().to_owned());
            }
        }
    }
    None
}

fn shorten(name: &str) -> String {
    match (name.find('['), name.rfind(']')) {
        (Some(a), Some(b)) if b > a => name[a + 1..b].split(" / ").next().unwrap_or(name).trim().to_owned(),
        _ => name.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names() {
        assert_eq!(shorten("TU117M [GeForce GTX 1650 Mobile / Max-Q]"), "GeForce GTX 1650 Mobile");
        assert_eq!(shorten("Cezanne [Radeon Vega Series / Radeon Vega Mobile Series]"), "Radeon Vega Series");
        assert_eq!(shorten("Navi 31"), "Navi 31");
        let db = "10de  NVIDIA Corporation\n\t1f9d  TU117M [GeForce GTX 1650 Mobile / Max-Q]\n\t\t1043 1f9d  sub\n1002  AMD\n";
        assert_eq!(lookup_pci(db, "10de", "1f9d").as_deref(), Some("TU117M [GeForce GTX 1650 Mobile / Max-Q]"));
        assert_eq!(lookup_pci(db, "10de", "0000"), None);
    }

    #[test]
    fn dpm() {
        assert_eq!(parse_dpm_max("0: 200Mhz\n1: 1000Mhz *\n2: 2100Mhz\n"), Some(2100));
    }

    #[test]
    fn reads_this_machine() {
        let mut g = Gpus::discover("AMD Ryzen 5 5600H with Radeon Graphics");
        println!("{:#?}\n{:?}", g.infos(), g.cap_nvml);
        let (s, t, f) = g.read();
        println!("{s:#?}\n{t:?}\n{f:?}");
    }
}
