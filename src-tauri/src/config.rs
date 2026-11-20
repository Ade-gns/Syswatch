//! Paramètres persistés dans ~/.config/syswatch/settings.json.

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use syswatch_core::alerts::AlertSettings;
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
    pub alerts: AlertSettings,
    pub widget: WidgetSettings,
    pub overlay: OverlaySettings,
    /// Le bouton Fermer réduit dans la zone de notification au lieu de quitter.
    pub close_to_tray: bool,
}

/// Widget compact toujours visible (maquette CompactOverlay, réglages de SettingsScreen).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct WidgetSettings {
    pub enabled: bool,
    /// « bar », « card » ou « pill ».
    pub style: String,
    /// Coin de l'écran : « hg », « hd », « bg », « bd ».
    pub corner: String,
    /// Opacité, 30–100 %.
    pub opacity: u8,
    pub on_top: bool,
}

impl Default for WidgetSettings {
    fn default() -> Self {
        Self { enabled: false, style: "bar".into(), corner: "hd".into(), opacity: 85, on_top: true }
    }
}

/// Overlay du mode jeu (FPS via MangoHud).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct OverlaySettings {
    /// « Overlay FPS en jeu » : autorise l'affichage par le raccourci ou le menu.
    pub enabled: bool,
    /// « standard », « minimal » ou « detailed ».
    pub style: String,
    pub corner: String,
    /// Éléments affichés : fps, cpu, gpu, ram, vram, temp, net, battery.
    pub items: Vec<String>,
    /// Cible de FPS : en dessous, point « warn » et mention « sous la cible ».
    pub fps_target: u32,
    /// Afficher l'overlay dès qu'un jeu tourne avec MangoHud, le masquer à la fin.
    pub auto_show: bool,
}

impl Default for OverlaySettings {
    fn default() -> Self {
        Self {
            enabled: true,
            style: "standard".into(),
            corner: "hg".into(),
            items: ["fps", "cpu", "gpu", "ram", "vram", "temp"].map(String::from).to_vec(),
            fps_target: 60,
            auto_show: true,
        }
    }
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
            alerts: AlertSettings::default(),
            widget: WidgetSettings::default(),
            overlay: OverlaySettings::default(),
            close_to_tray: true,
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
        self.alerts = self.alerts.sanitized();
        let corner = |c: &str| matches!(c, "hg" | "hd" | "bg" | "bd");
        if !matches!(self.widget.style.as_str(), "bar" | "card" | "pill") {
            self.widget.style = "bar".into();
        }
        if !corner(&self.widget.corner) {
            self.widget.corner = "hd".into();
        }
        self.widget.opacity = self.widget.opacity.clamp(30, 100);
        if !matches!(self.overlay.style.as_str(), "standard" | "minimal" | "detailed") {
            self.overlay.style = "standard".into();
        }
        if !corner(&self.overlay.corner) {
            self.overlay.corner = "hg".into();
        }
        self.overlay.fps_target = self.overlay.fps_target.clamp(20, 500);
        self.overlay.items.retain(|i| ["fps", "cpu", "gpu", "ram", "vram", "temp", "net", "battery"].contains(&i.as_str()));
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

/// Disposition de l'Accueil (~/.config/syswatch/layout.json). Validée côté interface :
/// ici, seulement un tableau JSON de taille raisonnable.
pub fn load_layout() -> Option<serde_json::Value> {
    let v: serde_json::Value = serde_json::from_str(&fs::read_to_string(dir().join("layout.json")).ok()?).ok()?;
    v.is_array().then_some(v)
}

pub fn save_layout(v: &serde_json::Value) -> std::io::Result<()> {
    if !v.as_array().is_some_and(|a| a.len() <= 40) {
        return Err(std::io::Error::other("disposition invalide"));
    }
    let d = dir();
    fs::create_dir_all(&d)?;
    let tmp = d.join("layout.json.tmp");
    fs::write(&tmp, serde_json::to_vec_pretty(v)?)?;
    fs::rename(tmp, d.join("layout.json"))
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
