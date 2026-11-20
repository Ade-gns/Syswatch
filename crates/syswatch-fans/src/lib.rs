//! Ventilateurs pilotables (hwmon) et courbes température → vitesse.
//!
//! Partagé par l'application (affichage, sans droits) et par le service root (écriture).
//! Le service ne reçoit jamais de chemin du client : il redécouvre lui-même les canaux
//! et n'accepte qu'un identifiant (« nct6775/pwm2 ») qui doit figurer dans cette liste.
//!
//! Deux niveaux de contrôle :
//! - `Full` : `pwmN` (0–255) + `pwmN_enable` (1 = manuel, 2+ = automatique) ;
//! - `EnableOnly` : seulement `pwmN_enable` (ex. hp-wmi : 2 = automatique, 0 = pleine
//!   vitesse). Dans les deux cas, `pwmN_enable = 0` signifie « pleine vitesse »
//!   (documentation hwmon du noyau).

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

pub const HWMON: &str = "/sys/class/hwmon";
/// Bornes de l'éditeur de courbe (design : points de 30 à 100 °C).
pub const CURVE_MIN_C: f32 = 30.0;
pub const CURVE_MAX_C: f32 = 100.0;
/// Garde-fou : au-delà, pleine vitesse quelle que soit la consigne.
pub const SAFETY_C: f32 = 90.0;
/// Vitesse minimale imposée en mode manuel ou courbe pour ne jamais arrêter un ventilateur
/// sous charge par erreur de saisie.
pub const MIN_PCT: u8 = 20;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Control {
    Full,
    EnableOnly,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FanChannel {
    /// « hp/pwm1 », « nct6775/pwm2 » : identifiant stable, seul paramètre accepté du client.
    pub id: String,
    pub chip: String,
    pub label: String,
    pub control: Control,
    #[serde(skip)]
    pub pwm: Option<PathBuf>,
    #[serde(skip)]
    pub enable: PathBuf,
    /// Compteur de tours associé (fanN_input), s'il existe.
    #[serde(skip)]
    pub input: Option<PathBuf>,
    /// Valeur de `pwmN_enable` trouvée au démarrage, restaurée à la fin.
    pub original_enable: Option<u8>,
}

impl FanChannel {
    pub fn rpm(&self) -> Option<u32> {
        self.input.as_ref().and_then(|p| read_u64(p)).map(|v| v as u32)
    }
    pub fn enable_value(&self) -> Option<u8> {
        read_u64(&self.enable).map(|v| v as u8)
    }
    /// Consigne actuelle en %, si le pilote expose `pwmN`.
    pub fn pct(&self) -> Option<f32> {
        self.pwm.as_ref().and_then(|p| read_u64(p)).map(|v| v as f32 / 255.0 * 100.0)
    }
}

fn read_trim(p: &Path) -> Option<String> {
    fs::read_to_string(p).ok().map(|s| s.trim().to_owned()).filter(|s| !s.is_empty())
}
fn read_u64(p: &Path) -> Option<u64> {
    read_trim(p)?.parse().ok()
}

/// Canaux pilotables sous `root` (/sys/class/hwmon en production, dossier de test sinon).
pub fn discover(root: &Path) -> Vec<FanChannel> {
    let mut out = Vec::new();
    let Ok(rd) = fs::read_dir(root) else { return out };
    let mut dirs: Vec<PathBuf> = rd.flatten().map(|e| e.path()).collect();
    dirs.sort();
    for dir in dirs {
        let Some(chip) = read_trim(&dir.join("name")) else { continue };
        // Les GPU dédiés ont leur propre logique (pilote, firmware) : on ne les touche pas.
        if ["amdgpu", "nouveau", "radeon", "i915", "xe"].contains(&chip.as_str()) {
            continue;
        }
        let Ok(files) = fs::read_dir(&dir) else { continue };
        let mut idx: Vec<u32> = files
            .flatten()
            .filter_map(|e| e.file_name().to_str()?.strip_prefix("pwm")?.strip_suffix("_enable")?.parse().ok())
            .collect();
        idx.sort_unstable();
        let many = idx.len() > 1;
        for i in idx {
            let enable = dir.join(format!("pwm{i}_enable"));
            let pwm = dir.join(format!("pwm{i}"));
            let input = dir.join(format!("fan{i}_input"));
            let label = read_trim(&dir.join(format!("fan{i}_label")))
                .map(|l| format!("Ventilateur {l}"))
                .unwrap_or_else(|| if many { format!("Ventilateur {i}") } else { "Ventilateurs".into() });
            out.push(FanChannel {
                id: format!("{chip}/pwm{i}"),
                chip: chip.clone(),
                label,
                control: if pwm.exists() { Control::Full } else { Control::EnableOnly },
                original_enable: read_u64(&enable).map(|v| v as u8),
                pwm: pwm.exists().then_some(pwm),
                enable,
                input: input.exists().then_some(input),
            });
        }
    }
    out
}

/// Température de référence du processeur (k10temp Tctl, coretemp Package…), en °C.
pub fn cpu_temp_path(root: &Path) -> Option<PathBuf> {
    let mut dirs: Vec<PathBuf> = fs::read_dir(root).ok()?.flatten().map(|e| e.path()).collect();
    dirs.sort();
    for dir in dirs {
        let name = read_trim(&dir.join("name")).unwrap_or_default();
        if !["k10temp", "zenpower", "coretemp", "cpu_thermal"].contains(&name.as_str()) {
            continue;
        }
        for label in ["Tdie", "Tctl", "Package id 0"] {
            for i in 1..=16 {
                if read_trim(&dir.join(format!("temp{i}_label"))).as_deref() == Some(label) {
                    return Some(dir.join(format!("temp{i}_input")));
                }
            }
        }
        let p = dir.join("temp1_input");
        if p.exists() {
            return Some(p);
        }
    }
    None
}

pub fn read_temp(p: &Path) -> Option<f32> {
    read_trim(p)?.parse::<i64>().ok().map(|m| m as f32 / 1000.0)
}

/// Mode demandé pour un canal.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "mode")]
pub enum Mode {
    /// Rendu au firmware (valeur `pwmN_enable` d'origine).
    Auto,
    /// Pleine vitesse.
    Max,
    /// Vitesse fixe (canaux `Full` seulement).
    Manual { pct: u8 },
    /// Courbe appliquée par le service toutes les 2 s (canaux `Full` seulement).
    Curve { curve: Curve },
}

/// Points (°C, %) triés par température. Invariants (design) : chaque point reste entre
/// ses voisins, températures dans [30, 100] °C, vitesses dans [0, 100] % et croissantes.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Curve {
    pub points: Vec<(u8, u8)>,
}

impl Curve {
    /// Préréglages des profils de la maquette.
    pub fn preset(profile: &str) -> Option<Self> {
        let points = match profile {
            // « Max 2 800 tr/min · bruit minimal » : plafonnée bas jusqu'à 80 °C.
            "silencieux" => vec![(30, 20), (50, 25), (65, 35), (80, 55), (90, 100)],
            // « Monte dès 60 °C · équilibré » (courbe par défaut de l'éditeur du design).
            "jeu" => vec![(30, 20), (45, 28), (60, 45), (75, 75), (88, 100)],
            // « Refroidissement maximal ».
            "performance" => vec![(30, 40), (45, 55), (60, 75), (70, 90), (80, 100)],
            _ => return None,
        };
        Some(Self { points })
    }

    pub fn validate(&self) -> Result<(), String> {
        if self.points.len() < 2 || self.points.len() > 10 {
            return Err("La courbe doit compter de 2 à 10 points".into());
        }
        for w in self.points.windows(2) {
            if w[1].0 <= w[0].0 {
                return Err("Les températures de la courbe doivent être croissantes".into());
            }
            if w[1].1 < w[0].1 {
                return Err("La vitesse ne peut pas diminuer quand la température monte".into());
            }
        }
        for &(t, p) in &self.points {
            if (t as f32) < CURVE_MIN_C || (t as f32) > CURVE_MAX_C || p > 100 {
                return Err("Point hors bornes (30–100 °C, 0–100 %)".into());
            }
        }
        Ok(())
    }

    /// Vitesse (%) pour une température, par interpolation linéaire ; constante aux extrémités.
    pub fn at(&self, t: f32) -> f32 {
        let p = &self.points;
        if t <= p[0].0 as f32 {
            return p[0].1 as f32;
        }
        for w in p.windows(2) {
            let (a, b) = ((w[0].0 as f32, w[0].1 as f32), (w[1].0 as f32, w[1].1 as f32));
            if t <= b.0 {
                return a.1 + (b.1 - a.1) * (t - a.0) / (b.0 - a.0).max(1.0);
            }
        }
        p[p.len() - 1].1 as f32
    }
}

/// Consigne finale avec garde-fous : plancher, pleine vitesse au-delà de 90 °C ou si la
/// température est illisible.
pub fn safe_pct(requested: f32, temp: Option<f32>) -> u8 {
    match temp {
        None => 100,
        Some(t) if t >= SAFETY_C => 100,
        Some(_) => requested.round().clamp(MIN_PCT as f32, 100.0) as u8,
    }
}

pub fn pct_to_pwm(pct: u8) -> u8 {
    ((pct.min(100) as u32 * 255 + 50) / 100) as u8
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fake_hwmon(dir: &Path, name: &str, files: &[(&str, &str)]) {
        fs::create_dir_all(dir).unwrap();
        fs::write(dir.join("name"), name).unwrap();
        for (f, v) in files {
            fs::write(dir.join(f), v).unwrap();
        }
    }

    #[test]
    fn discovers_full_and_enable_only() {
        let root = std::env::temp_dir().join(format!("swfans-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fake_hwmon(&root.join("hwmon0"), "hp", &[("pwm1_enable", "2"), ("fan1_input", "2700"), ("fan2_input", "2400")]);
        fake_hwmon(&root.join("hwmon1"), "nct6775", &[("pwm1_enable", "5"), ("pwm1", "120"), ("fan1_input", "900"), ("pwm2_enable", "5"), ("pwm2", "80")]);
        fake_hwmon(&root.join("hwmon2"), "amdgpu", &[("pwm1_enable", "2"), ("pwm1", "100")]);
        fake_hwmon(&root.join("hwmon3"), "k10temp", &[("temp1_input", "61250"), ("temp1_label", "Tctl")]);
        let v = discover(&root);
        assert_eq!(v.len(), 3, "amdgpu ignoré");
        assert_eq!(v[0].id, "hp/pwm1");
        assert_eq!(v[0].control, Control::EnableOnly);
        assert_eq!(v[0].rpm(), Some(2700));
        assert_eq!(v[1].control, Control::Full);
        assert_eq!(v[1].original_enable, Some(5));
        assert!((v[1].pct().unwrap() - 47.06).abs() < 0.1);
        assert_eq!(read_temp(&cpu_temp_path(&root).unwrap()), Some(61.25));
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn curve_math_and_validation() {
        let c = Curve::preset("jeu").unwrap();
        c.validate().unwrap();
        assert_eq!(c.at(20.0), 20.0);
        assert_eq!(c.at(60.0), 45.0);
        assert!((c.at(67.5) - 60.0).abs() < 0.01);
        assert_eq!(c.at(99.0), 100.0);
        assert!(Curve { points: vec![(50, 50), (40, 60)] }.validate().is_err());
        assert!(Curve { points: vec![(40, 60), (50, 50)] }.validate().is_err());
        assert!(Curve { points: vec![(20, 10), (50, 50)] }.validate().is_err());
        for p in ["silencieux", "jeu", "performance"] {
            Curve::preset(p).unwrap().validate().unwrap();
        }
    }

    #[test]
    fn safety() {
        assert_eq!(safe_pct(5.0, Some(50.0)), MIN_PCT);
        assert_eq!(safe_pct(40.0, Some(92.0)), 100);
        assert_eq!(safe_pct(40.0, None), 100);
        assert_eq!(pct_to_pwm(100), 255);
        assert_eq!(pct_to_pwm(35), 89);
    }
}
