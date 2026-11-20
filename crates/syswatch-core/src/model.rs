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

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemorySnapshot {
    pub total: u64,
    pub used: u64,
    pub available: u64,
    pub swap_total: u64,
    pub swap_used: u64,
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
