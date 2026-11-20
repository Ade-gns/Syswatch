//! Découverte des capteurs hwmon (/sys/class/hwmon). Les chemins sont découverts une fois,
//! puis seules les valeurs sont relues à chaque tick.

use std::fs;
use std::path::PathBuf;

use crate::sysfs::{read_i64, read_trim};

const HWMON: &str = "/sys/class/hwmon";

#[derive(Debug, Clone)]
pub struct Chip {
    pub name: String,
    pub dir: PathBuf,
}

#[derive(Debug, Clone)]
pub struct TempProbe {
    pub chip: String,
    /// Libellé du pilote (`temp1_label`) ou `tempN` à défaut.
    pub raw_label: String,
    pub input: PathBuf,
}

impl TempProbe {
    /// Température en °C, ou `None` si le capteur ne répond pas.
    pub fn read(&self) -> Option<f32> {
        read_i64(&self.input).map(|m| m as f32 / 1000.0)
    }
}

/// Liste les puces hwmon présentes.
pub fn chips() -> Vec<Chip> {
    let Ok(rd) = fs::read_dir(HWMON) else { return Vec::new() };
    let mut v: Vec<Chip> = rd
        .flatten()
        .filter_map(|e| {
            let dir = e.path();
            Some(Chip { name: read_trim(dir.join("name"))?, dir })
        })
        .collect();
    v.sort_by(|a, b| a.dir.cmp(&b.dir));
    v
}

/// Capteurs de température d'une puce, triés par index.
pub fn temps(chip: &Chip) -> Vec<TempProbe> {
    let Ok(rd) = fs::read_dir(&chip.dir) else { return Vec::new() };
    let mut idx: Vec<u32> = rd
        .flatten()
        .filter_map(|e| {
            let n = e.file_name().into_string().ok()?;
            n.strip_prefix("temp")?.strip_suffix("_input")?.parse().ok()
        })
        .collect();
    idx.sort_unstable();
    idx.into_iter()
        .map(|i| TempProbe {
            chip: chip.name.clone(),
            raw_label: read_trim(chip.dir.join(format!("temp{i}_label"))).unwrap_or_else(|| format!("temp{i}")),
            input: chip.dir.join(format!("temp{i}_input")),
        })
        .collect()
}

/// Vrai si la puce expose au moins un ventilateur.
pub fn has_fan(chip: &Chip) -> bool {
    fs::read_dir(&chip.dir)
        .map(|rd| rd.flatten().any(|e| e.file_name().to_string_lossy().starts_with("fan")))
        .unwrap_or(false)
}
