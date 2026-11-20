//! Lecture minimale des fichiers .desktop (spécification XDG) : nom affiché (localisé
//! en français si disponible), commande, icône et clés d'autostart.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Default)]
pub struct DesktopEntry {
    pub name: Option<String>,
    pub comment: Option<String>,
    pub exec: Option<String>,
    pub icon: Option<String>,
    pub hidden: bool,
    pub no_display: bool,
    /// `X-GNOME-Autostart-enabled=false` désactive aussi une entrée.
    pub gnome_disabled: bool,
    pub only_show_in: Vec<String>,
    pub not_show_in: Vec<String>,
    /// Pièce du bureau lui-même (Plasma, agent polkit, indexeur…) d'après les clés
    /// d'autostart que posent KDE et GNOME : phase 0, X-systemd-skip, phase GNOME d'initialisation.
    pub desktop_component: bool,
}

impl DesktopEntry {
    /// Visible dans le bureau courant (XDG_CURRENT_DESKTOP), d'après OnlyShowIn / NotShowIn.
    pub fn shown_in(&self, desktops: &[String]) -> bool {
        if !self.only_show_in.is_empty() && !self.only_show_in.iter().any(|d| desktops.contains(d)) {
            return false;
        }
        !self.not_show_in.iter().any(|d| desktops.contains(d))
    }
}

pub fn parse(text: &str) -> DesktopEntry {
    let mut in_main = false;
    let mut kv: HashMap<&str, &str> = HashMap::new();
    for line in text.lines() {
        let l = line.trim();
        if l.starts_with('[') {
            in_main = l == "[Desktop Entry]";
            continue;
        }
        if !in_main || l.starts_with('#') {
            continue;
        }
        if let Some((k, v)) = l.split_once('=') {
            kv.entry(k.trim()).or_insert(v.trim());
        }
    }
    let list = |k: &str| kv.get(k).map(|v| v.split(';').filter(|s| !s.is_empty()).map(str::to_owned).collect()).unwrap_or_default();
    let get = |k: &str| kv.get(k).map(|v| v.to_string()).filter(|v| !v.is_empty());
    let only_show_in: Vec<String> = list("OnlyShowIn");
    let no_display = kv.get("NoDisplay").is_some_and(|v| *v == "true");
    let desktop_component = kv.get("X-systemd-skip").is_some_and(|v| *v == "true")
        || kv.get("X-KDE-autostart-phase").is_some_and(|v| *v == "0")
        || kv.contains_key("X-GNOME-Autostart-Phase")
        || (no_display && !only_show_in.is_empty());
    DesktopEntry {
        desktop_component,
        name: get("Name[fr_FR]").or_else(|| get("Name[fr]")).or_else(|| get("Name")),
        comment: get("Comment[fr_FR]").or_else(|| get("Comment[fr]")).or_else(|| get("Comment")),
        exec: get("Exec"),
        icon: get("Icon"),
        hidden: kv.get("Hidden").is_some_and(|v| *v == "true"),
        no_display,
        gnome_disabled: kv.get("X-GNOME-Autostart-enabled").is_some_and(|v| *v == "false"),
        only_show_in,
        not_show_in: list("NotShowIn"),
    }
}

pub fn read(path: &Path) -> Option<DesktopEntry> {
    fs::read_to_string(path).ok().map(|t| parse(&t))
}

fn home() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

pub fn config_home() -> PathBuf {
    std::env::var_os("XDG_CONFIG_HOME").map(PathBuf::from).filter(|p| p.is_absolute()).or_else(|| home().map(|h| h.join(".config"))).unwrap_or_else(|| "/tmp".into())
}

/// Dossiers « applications » par ordre de priorité (utilisateur, flatpak, système).
pub fn application_dirs() -> Vec<PathBuf> {
    let mut v = Vec::new();
    let data_home = std::env::var_os("XDG_DATA_HOME").map(PathBuf::from).or_else(|| home().map(|h| h.join(".local/share")));
    if let Some(d) = data_home {
        v.push(d.join("applications"));
        v.push(d.join("flatpak/exports/share/applications"));
    }
    v.push("/var/lib/flatpak/exports/share/applications".into());
    let dirs = std::env::var("XDG_DATA_DIRS").unwrap_or_else(|_| "/usr/local/share:/usr/share".into());
    v.extend(dirs.split(':').filter(|s| !s.is_empty()).map(|d| Path::new(d).join("applications")));
    v
}

/// Bureaux courants (« KDE », « GNOME »…).
pub fn current_desktops() -> Vec<String> {
    std::env::var("XDG_CURRENT_DESKTOP").unwrap_or_default().split(':').filter(|s| !s.is_empty()).map(str::to_owned).collect()
}

/// Nom affiché d'une application d'après son identifiant de bureau (« brave-browser »,
/// « org.kde.dolphin »). Résultat mis en cache par l'appelant.
pub fn app_name(id: &str) -> Option<String> {
    let file = format!("{id}.desktop");
    let lower = file.to_lowercase();
    for dir in application_dirs() {
        let p = dir.join(&file);
        if let Some(n) = read(&p).and_then(|e| e.name) {
            return Some(n);
        }
        // Certains identifiants de scope diffèrent par la casse du fichier.
        if let Ok(rd) = fs::read_dir(&dir) {
            for e in rd.flatten() {
                if e.file_name().to_string_lossy().to_lowercase() == lower {
                    if let Some(n) = read(&e.path()).and_then(|e| e.name) {
                        return Some(n);
                    }
                }
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_main_section_only() {
        let e = parse("[Desktop Entry]\nName=Brave\nName[fr]=Brave FR\nExec=brave %U\nOnlyShowIn=KDE;GNOME;\n[Desktop Action new]\nName=New Window\n");
        assert_eq!(e.name.as_deref(), Some("Brave FR"));
        assert_eq!(e.exec.as_deref(), Some("brave %U"));
        assert!(e.shown_in(&["KDE".into()]));
        assert!(!e.shown_in(&["XFCE".into()]));
    }
}
