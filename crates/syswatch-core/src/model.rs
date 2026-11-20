//! Structures échangées avec l'interface (sérialisées en camelCase).

use serde::Serialize;

/// Mesures instantanées, émises à chaque tick de l'échantillonneur.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    /// Horodatage (ms depuis l'époque Unix).
    pub t: u64,
    pub uptime_s: u64,
    pub cpu: CpuSnapshot,
    pub memory: MemorySnapshot,
    /// Tous les capteurs de température lisibles (hwmon + GPU NVIDIA via NVML).
    pub sensors: Vec<SensorReading>,
    /// Ventilateurs exposés par hwmon ou NVML.
    pub fans: Vec<FanReading>,
    /// Une entrée par GPU découvert au démarrage (même ordre que `SystemInfo::gpus`).
    pub gpus: Vec<GpuSnapshot>,
    /// Batteries du système (hors périphériques : souris, téléphone…).
    pub batteries: Vec<BatterySnapshot>,
    /// Secteur branché ; `None` sur une machine sans adaptateur détecté.
    pub ac_online: Option<bool>,
    pub network: NetworkSnapshot,
    pub disks: Vec<DiskSnapshot>,
    /// FPS du jeu en cours (journal MangoHud), si un jeu tourne avec MangoHud.
    pub fps: Option<crate::fps::FpsSnapshot>,
    /// Mémoire utilisée par SysWatch lui-même (PSS, processus principal + webviews enfants).
    pub self_mem_bytes: Option<u64>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CpuSnapshot {
    /// Charge globale, 0–100.
    pub usage: f32,
    /// Charge par processeur logique (thread), 0–100.
    pub per_thread: Vec<f32>,
    /// Fréquence moyenne des cœurs, en MHz.
    pub freq_mhz: Option<u32>,
    /// Fréquence par cœur physique, en MHz.
    pub per_core_freq_mhz: Vec<u32>,
    /// Température de référence du processeur (Tctl, Tdie ou Package).
    pub temp_c: Option<f32>,
    /// Pic de température depuis le lancement de SysWatch.
    pub temp_peak_c: Option<f32>,
    /// Consommation du processeur en watts, quand une source lisible existe.
    pub power_w: Option<f32>,
    pub processes: u32,
    pub threads: u32,
    /// Capteurs de température liés au processeur.
    pub sensors: Vec<TempReading>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TempReading {
    pub label: String,
    pub value_c: f32,
}

/// Mémoire vive, d'après /proc/meminfo (octets). `used` = total − disponible.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemorySnapshot {
    pub total: u64,
    pub used: u64,
    pub available: u64,
    pub free: u64,
    /// Cache de pages récupérable (Cached + SReclaimable − Shmem).
    pub cached: u64,
    pub buffers: u64,
    /// Mémoire partagée (tmpfs, mémoire partagée entre processus).
    pub shared: u64,
    /// Pages modifiées en attente d'écriture sur disque.
    pub dirty: u64,
    pub swap_total: u64,
    pub swap_used: u64,
    /// Pages de swap encore présentes en RAM.
    pub swap_cached: u64,
    /// « zram », « partition » ou « fichier » (premier périphérique de /proc/swaps).
    pub swap_kind: Option<String>,
}

/// Famille d'un capteur de température : choisit les seuils et l'ordre d'affichage.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SensorKind {
    Cpu,
    Gpu,
    Ssd,
    Ram,
    Board,
    Battery,
    Wifi,
    Other,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SensorReading {
    /// Identifiant stable (« k10temp/temp1 »), utilisé pour les seuils réglables.
    pub id: String,
    pub label: String,
    pub kind: SensorKind,
    pub value_c: f32,
    /// Seuil critique annoncé par le pilote, s'il est plausible.
    pub crit_c: Option<f32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FanReading {
    pub id: String,
    pub label: String,
    pub rpm: Option<u32>,
    /// Consigne en pourcentage (pwm ou NVML), si lisible.
    pub pct: Option<f32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum GpuState {
    /// Mesures disponibles.
    Active,
    /// GPU en veille (runtime PM) : SysWatch ne le réveille pas.
    Sleeping,
    /// Présent mais illisible (pilote, bibliothèque manquante) ; voir `detail`.
    Unavailable,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuSnapshot {
    pub id: String,
    pub state: GpuState,
    pub detail: Option<String>,
    /// Charge du moteur graphique, 0–100.
    pub usage: Option<f32>,
    pub temp_c: Option<f32>,
    pub power_w: Option<f32>,
    pub core_mhz: Option<u32>,
    pub mem_mhz: Option<u32>,
    pub vram_used: Option<u64>,
    pub vram_total: Option<u64>,
    pub fan_pct: Option<f32>,
    pub fan_rpm: Option<u32>,
    /// Processus utilisant le GPU (NVML uniquement).
    pub processes: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuInfo {
    /// Adresse PCI (« 0000:01:00.0 »).
    pub id: String,
    pub name: String,
    /// « NVIDIA », « AMD », « Intel » ou identifiant brut.
    pub vendor: String,
    pub driver: String,
    pub integrated: bool,
    pub max_core_mhz: Option<u32>,
    pub max_mem_mhz: Option<u32>,
    pub power_limit_w: Option<f32>,
    /// Vrai si la puissance mesurée est celle du SoC entier (APU), partagée avec le CPU.
    pub power_shared: bool,
    pub driver_version: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum BatteryStatus {
    Charging,
    Discharging,
    Full,
    NotCharging,
    Unknown,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatterySnapshot {
    /// Nom sysfs (« BAT0 »).
    pub id: String,
    pub status: BatteryStatus,
    pub percent: f32,
    pub energy_now_wh: Option<f32>,
    pub energy_full_wh: Option<f32>,
    pub energy_design_wh: Option<f32>,
    /// Perte de capacité par rapport à la capacité d'origine, 0–100.
    pub wear_pct: Option<f32>,
    pub cycles: Option<u32>,
    /// Puissance absorbée ou fournie, lissée (W, toujours positive).
    pub power_w: Option<f32>,
    pub voltage_v: Option<f32>,
    /// Temps restant estimé : jusqu'à vide en décharge, jusqu'à plein en charge.
    pub time_left_s: Option<u64>,
    /// Seuil de fin de charge configuré dans le firmware, s'il existe.
    pub charge_limit: Option<u8>,
    pub technology: Option<String>,
    pub manufacturer: Option<String>,
    pub model: Option<String>,
}

/// Informations stables, lues au démarrage (et rafraîchies à la demande).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    pub os_name: String,
    pub host_name: Option<String>,
    pub kernel: Option<String>,
    pub boot_time_s: u64,
    pub cpu: CpuInfo,
    pub gpus: Vec<GpuInfo>,
    pub capabilities: Capabilities,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CpuInfo {
    pub model: String,
    pub physical_cores: u32,
    pub logical_cpus: u32,
    pub max_freq_mhz: Option<u32>,
    pub l3_cache_kb: Option<u64>,
    pub governor: Option<String>,
    pub epp: Option<String>,
    pub driver: Option<String>,
}

/// Ce que la machine permet de mesurer ou de piloter. Une fonction non prise en charge
/// porte une raison lisible, affichée telle quelle dans l'interface.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    pub cpu_temp: Feature,
    pub cpu_power: Feature,
    pub cpu_freq: Feature,
    /// Lecture des GPU NVIDIA (NVML) ; non pertinente sans carte NVIDIA.
    pub nvml: Feature,
    pub battery: Feature,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Feature {
    pub supported: bool,
    /// Source utilisée (si prise en charge) ou raison de l'absence.
    pub detail: String,
}

impl Feature {
    pub fn yes(detail: impl Into<String>) -> Self {
        Self { supported: true, detail: detail.into() }
    }
    pub fn no(reason: impl Into<String>) -> Self {
        Self { supported: false, detail: reason.into() }
    }
}

/// Ordre de tri des interfaces : physiques d'abord.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum IfaceKind {
    Wifi,
    Ethernet,
    Other,
    Virtual,
    Loopback,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IfaceSnapshot {
    pub name: String,
    pub kind: IfaceKind,
    pub up: bool,
    /// Octets/s.
    pub rx_bps: f64,
    pub tx_bps: f64,
    /// Octets depuis le démarrage.
    pub rx_total: u64,
    pub tx_total: u64,
    pub mac: Option<String>,
    /// Adresses avec préfixe (« 192.168.1.20/24 »).
    pub ipv4: Vec<String>,
    pub ipv6: Vec<String>,
    /// Vitesse du lien filaire négociée (Mb/s).
    pub speed_mbps: Option<u32>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WifiInfo {
    pub iface: String,
    pub ssid: Option<String>,
    pub signal_dbm: Option<i32>,
    pub freq_mhz: Option<u32>,
    pub rx_mbps: Option<f32>,
    pub tx_mbps: Option<f32>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkSnapshot {
    /// Débit total des interfaces physiques (hors boucle locale et interfaces virtuelles).
    pub rx_bps: f64,
    pub tx_bps: f64,
    /// Une route par défaut existe.
    pub connected: bool,
    pub default_iface: Option<String>,
    pub gateway: Option<String>,
    pub dns: Vec<String>,
    /// Latence vers la passerelle locale (ms) ; `None` si sans réponse.
    pub ping_ms: Option<f32>,
    pub ping_target: Option<String>,
    pub wifi: Option<WifiInfo>,
    pub interfaces: Vec<IfaceSnapshot>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DiskKind {
    Nvme,
    Ssd,
    Hdd,
    Usb,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MountSnapshot {
    /// Partition ou volume (« nvme0n1p2 », « dm-0 »).
    pub device: String,
    pub fstype: String,
    /// Points de montage de ce système de fichiers (plusieurs pour les sous-volumes btrfs).
    pub targets: Vec<String>,
    pub total: u64,
    pub used: u64,
    /// Espace utilisable par un utilisateur non root.
    pub available: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskSnapshot {
    /// Nom noyau (« nvme0n1 », « sda »).
    pub id: String,
    pub model: Option<String>,
    pub size: u64,
    pub kind: DiskKind,
    pub removable: bool,
    /// Octets/s.
    pub read_bps: f64,
    pub write_bps: f64,
    /// Octets depuis le démarrage.
    pub read_total: u64,
    pub write_total: u64,
    pub temp_c: Option<f32>,
    /// Systèmes de fichiers montés, le plus grand d'abord.
    pub mounts: Vec<MountSnapshot>,
}
