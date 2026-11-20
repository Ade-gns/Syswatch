//! Paramètres persistés dans ~/.config/syswatch/settings.json.

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use syswatch_core::fans::Curve;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// « dark », « light » ou « system ».
    pub theme: String,
    /// Identifiant de préréglage (« cyan »…) ou couleur libre « #rrggbb ».
    pub accent: String,
    /// Intervalle d'échantillonnage quand la fenêtre est visible.
    pub interval_ms: u64,
    /// Durée d'historique des courbes temps réel.
    pub history_s: u32,
    pub sidebar_collapsed: bool,
    /// « c » ou « f ».
    pub temp_unit: String,
    /// Profil de ventilation choisi : « silencieux », « jeu » ou « performance ».
    pub fan_profile: String,
    /// Courbe température → vitesse éditée (°C, %), appliquée en mode automatique.
    pub fan_curve: Vec<(u8, u8)>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: "dark".into(),
            accent: "cyan".into(),
            interval_ms: 1000,
            history_s: 60,
            sidebar_collapsed: false,
            temp_unit: "c".into(),
            fan_profile: "jeu".into(),
            fan_curve: Curve::preset("jeu").map(|c| c.points).unwrap_or_default(),
        }
    }
}

impl Settings {
    /// Ramène les valeurs dans des bornes sûres (fichier édité à la main, version ancienne…).
    pub fn sanitized(mut self) -> Self {
        self.interval_ms = self.interval_ms.clamp(250, 10_000);
        self.history_s = self.history_s.clamp(30, 3600);
        if !matches!(self.theme.as_str(), "dark" | "light" | "system") {
            self.theme = "dark".into();
        }
        if !matches!(self.temp_unit.as_str(), "c" | "f") {
            self.temp_unit = "c".into();
        }
        if !matches!(self.fan_profile.as_str(), "silencieux" | "jeu" | "performance") {
            self.fan_profile = "jeu".into();
        }
        if (Curve { points: self.fan_curve.clone() }).validate().is_err() {
            self.fan_curve = Curve::preset(&self.fan_profile).map(|c| c.points).unwrap_or_default();
        }
        self
    }
}

/// $XDG_CONFIG_HOME/syswatch, ou ~/.config/syswatch.
pub fn dir() -> PathBuf {
    std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))
        .unwrap_or_else(|| PathBuf::from("/tmp"))
        .join("syswatch")
}

pub fn load() -> Settings {
    let path = dir().join("settings.json");
    match fs::read_to_string(&path) {
        Ok(s) => serde_json::from_str::<Settings>(&s)
            .inspect_err(|e| log::warn!("{} illisible ({e}), paramètres par défaut", path.display()))
            .unwrap_or_default()
            .sanitized(),
        Err(_) => Settings::default(),
    }
}

/// Écriture atomique : fichier temporaire puis renommage.
pub fn save(s: &Settings) -> std::io::Result<()> {
    let d = dir();
    fs::create_dir_all(&d)?;
    let tmp = d.join("settings.json.tmp");
    fs::write(&tmp, serde_json::to_vec_pretty(s)?)?;
    fs::rename(tmp, d.join("settings.json"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn partial_file_keeps_defaults() {
        let s: Settings = serde_json::from_str(r#"{"intervalMs": 50, "theme": "neon"}"#).unwrap();
        let s = s.sanitized();
        assert_eq!(s.interval_ms, 250);
        assert_eq!(s.theme, "dark");
        assert_eq!(s.history_s, 60);
    }
}
