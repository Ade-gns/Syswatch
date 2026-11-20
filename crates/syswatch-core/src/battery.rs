//! Batteries et secteur (/sys/class/power_supply). Les batteries de périphériques
//! (souris, téléphone branché en USB : `scope=Device`) sont ignorées.
//!
//! Les pilotes exposent soit l'énergie (`energy_*`, µWh) soit la charge (`charge_*`, µAh) ;
//! la charge est convertie en énergie avec la tension nominale. La puissance instantanée
//! est bruitée : elle est lissée (moyenne exponentielle) avant d'estimer l'autonomie.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;

use crate::model::{BatterySnapshot, BatteryStatus};
use crate::sysfs::{read_trim, read_u64};

const PS: &str = "/sys/class/power_supply";
/// Poids de la nouvelle mesure dans la moyenne lissée de la puissance.
const ALPHA: f32 = 0.25;

struct Battery {
    id: String,
    dir: PathBuf,
    smooth_w: Option<f32>,
    /// Dernière énergie connue, pour dériver la puissance quand `power_now` manque.
    last_energy: Option<(f32, Instant)>,
}

pub struct Batteries {
    list: Vec<Battery>,
    ac: Vec<PathBuf>,
}

impl Batteries {
    pub fn discover() -> Self {
        let mut list = Vec::new();
        let mut ac = Vec::new();
        let Ok(rd) = fs::read_dir(PS) else { return Self { list, ac } };
        let mut dirs: Vec<PathBuf> = rd.flatten().map(|e| e.path()).collect();
        dirs.sort();
        for dir in dirs {
            let ty = read_trim(dir.join("type")).unwrap_or_default();
            let scope = read_trim(dir.join("scope")).unwrap_or_default();
            match ty.as_str() {
                "Battery" if scope != "Device" => {
                    let id = dir.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
                    list.push(Battery { id, dir, smooth_w: None, last_energy: None });
                }
                "Mains" => ac.push(dir.join("online")),
                _ => {}
            }
        }
        Self { list, ac }
    }

    pub fn present(&self) -> bool {
        !self.list.is_empty()
    }

    pub fn ac_online(&self) -> Option<bool> {
        let v: Vec<bool> = self.ac.iter().filter_map(read_u64).map(|v| v == 1).collect();
        (!v.is_empty()).then(|| v.iter().any(|&b| b))
    }

    pub fn read(&mut self) -> Vec<BatterySnapshot> {
        self.list.iter_mut().filter_map(Battery::read).collect()
    }
}

/// Microunité sysfs → unité (µWh → Wh, µV → V…).
fn micro(dir: &Path, f: &str) -> Option<f32> {
    read_u64(dir.join(f)).map(|v| v as f32 / 1e6)
}

impl Battery {
    fn read(&mut self) -> Option<BatterySnapshot> {
        let dir = self.dir.clone();
        let d = &dir;
        if read_u64(d.join("present")) == Some(0) {
            return None;
        }
        let status = match read_trim(d.join("status")).as_deref() {
            Some("Charging") => BatteryStatus::Charging,
            Some("Discharging") => BatteryStatus::Discharging,
            Some("Full") => BatteryStatus::Full,
            Some("Not charging") => BatteryStatus::NotCharging,
            _ => BatteryStatus::Unknown,
        };
        let voltage_v = micro(d, "voltage_now");
        let v_design = micro(d, "voltage_min_design").or(voltage_v);

        // Énergie (Wh), directement ou via la charge (Ah × V nominale).
        let energy = |e: &str, c: &str| micro(d, e).or_else(|| Some(micro(d, c)? * v_design?));
        let now_wh = energy("energy_now", "charge_now");
        let full_wh = energy("energy_full", "charge_full");
        let design_wh = energy("energy_full_design", "charge_full_design");

        let percent = read_u64(d.join("capacity"))
            .map(|v| v as f32)
            .or_else(|| Some(now_wh? / full_wh? * 100.0))
            .unwrap_or(0.0)
            .clamp(0.0, 100.0);

        // Puissance : power_now, sinon courant × tension, sinon dérivée de l'énergie.
        let raw_w = micro(d, "power_now")
            .or_else(|| Some(micro(d, "current_now")? * voltage_v?))
            .filter(|w| *w > 0.05);
        let derived = self.derived_power(now_wh);
        let raw_w = raw_w.or(derived);
        let power_w = match (status, raw_w) {
            (BatteryStatus::Full | BatteryStatus::NotCharging, _) => {
                self.smooth_w = None;
                None
            }
            (_, Some(w)) => {
                let s = self.smooth_w.map_or(w, |s| s + ALPHA * (w - s));
                self.smooth_w = Some(s);
                Some(s)
            }
            (_, None) => self.smooth_w,
        };

        let time_left_s = match (status, power_w, now_wh, full_wh) {
            (BatteryStatus::Discharging, Some(w), Some(now), _) if w > 0.5 => Some((now / w * 3600.0) as u64),
            (BatteryStatus::Charging, Some(w), Some(now), Some(full)) if w > 0.5 && full > now => Some(((full - now) / w * 3600.0) as u64),
            _ => None,
        };
        // Garde-fou : une estimation de plus de 48 h n'a pas de sens (puissance mal mesurée).
        let time_left_s = time_left_s.filter(|s| *s < 48 * 3600);

        let wear_pct = match (full_wh, design_wh) {
            (Some(f), Some(dsg)) if dsg > 0.0 => Some(((1.0 - f / dsg) * 100.0).clamp(0.0, 100.0)),
            _ => None,
        };

        Some(BatterySnapshot {
            id: self.id.clone(),
            status,
            percent,
            energy_now_wh: now_wh,
            energy_full_wh: full_wh,
            energy_design_wh: design_wh,
            wear_pct,
            cycles: read_u64(d.join("cycle_count")).map(|c| c as u32).filter(|c| *c > 0),
            power_w,
            voltage_v,
            time_left_s,
            charge_limit: read_u64(d.join("charge_control_end_threshold")).map(|v| v as u8).filter(|v| *v > 0 && *v < 100),
            technology: read_trim(d.join("technology")),
            manufacturer: read_trim(d.join("manufacturer")),
            model: read_trim(d.join("model_name")),
        })
    }

    /// Puissance déduite de la variation d'énergie (pilotes sans power_now ni current_now).
    /// L'énergie avance par paliers : on ne calcule qu'au changement de palier.
    fn derived_power(&mut self, now_wh: Option<f32>) -> Option<f32> {
        let now = now_wh?;
        match self.last_energy {
            Some((prev, _)) if (now - prev).abs() < 1e-4 => None,
            Some((prev, t)) => {
                let dt = t.elapsed().as_secs_f32();
                self.last_energy = Some((now, Instant::now()));
                let w = (now - prev).abs() / dt * 3600.0;
                (dt >= 5.0 && w > 0.05).then_some(w)
            }
            None => {
                self.last_energy = Some((now, Instant::now()));
                None
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_this_machine() {
        let mut b = Batteries::discover();
        println!("secteur : {:?}", b.ac_online());
        for s in b.read() {
            println!("{s:#?}");
            assert!((0.0..=100.0).contains(&s.percent));
        }
    }
}
