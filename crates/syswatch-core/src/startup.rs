//! Démarrage : durée du boot et services les plus lents (`systemd-analyze`, sans root),
//! programmes lancés à l'ouverture de session (autostart XDG, comme les réglages de KDE
//! et GNOME). Désactiver un programme écrit une surcharge `Hidden=true` dans
//! ~/.config/autostart, sans jamais toucher aux fichiers système.

use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use std::process::Command;

use serde::Serialize;

use crate::desktop::{self, DesktopEntry};

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootTimes {
    pub firmware_s: Option<f32>,
    pub loader_s: Option<f32>,
    pub kernel_s: Option<f32>,
    pub initrd_s: Option<f32>,
    pub userspace_s: Option<f32>,
    pub total_s: Option<f32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SlowUnit {
    pub unit: String,
    pub seconds: f32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutostartEntry {
    /// Nom du fichier (« org.kde.kdeconnect.daemon.desktop ») : identifiant stable.
    pub id: String,
    pub name: String,
    pub comment: Option<String>,
    pub command: Option<String>,
    pub enabled: bool,
    /// « user » : ajouté par l'utilisateur ; « system » : fourni par un paquet.
    pub source: &'static str,
    /// Composant du bureau lui-même : affiché, mais pas désactivable depuis SysWatch.
    pub component: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupInfo {
    pub boot: Option<BootTimes>,
    /// Raison de l'absence des temps de démarrage.
    pub boot_detail: Option<String>,
    pub slowest: Vec<SlowUnit>,
    pub autostart: Vec<AutostartEntry>,
}

pub fn read() -> StartupInfo {
    let (boot, boot_detail) = match analyze(&["time"]) {
        Ok(out) => match parse_time(&out) {
            Some(b) => (Some(b), None),
            None => (None, Some("Démarrage pas encore terminé selon systemd".into())),
        },
        Err(e) => (None, Some(e)),
    };
    let slowest = analyze(&["blame", "--no-pager"]).map(|o| parse_blame(&o, 8)).unwrap_or_default();
    StartupInfo { boot, boot_detail, slowest, autostart: autostart_entries() }
}

fn analyze(args: &[&str]) -> Result<String, String> {
    let o = Command::new("systemd-analyze").args(args).env("LC_ALL", "C").output().map_err(|_| "systemd-analyze introuvable : système sans systemd ?".to_string())?;
    if !o.status.success() {
        return Err(String::from_utf8_lossy(&o.stderr).trim().to_owned());
    }
    Ok(String::from_utf8_lossy(&o.stdout).into_owned())
}

/// « 1min 2.5s », « 910ms », « 4.866s », « 2h 3min » → secondes.
fn parse_duration(s: &str) -> Option<f32> {
    let mut total = 0.0;
    let mut any = false;
    for tok in s.split_whitespace() {
        let (num, unit) = tok.split_at(tok.find(|c: char| c.is_ascii_alphabetic())?);
        let v: f32 = num.parse().ok()?;
        total += v * match unit {
            "ms" => 0.001,
            "us" | "µs" => 0.000_001,
            "s" => 1.0,
            "min" => 60.0,
            "h" => 3600.0,
            _ => return None,
        };
        any = true;
    }
    any.then_some(total)
}

fn parse_time(out: &str) -> Option<BootTimes> {
    let line = out.lines().find(|l| l.starts_with("Startup finished in "))?;
    let body = line.strip_prefix("Startup finished in ")?;
    let (parts, total) = body.split_once(" = ")?;
    let mut b = BootTimes { total_s: parse_duration(total.trim()), ..Default::default() };
    for part in parts.split(" + ") {
        let (dur, label) = part.trim().split_once(" (")?;
        let v = parse_duration(dur);
        match label.trim_end_matches(')') {
            "firmware" => b.firmware_s = v,
            "loader" => b.loader_s = v,
            "kernel" => b.kernel_s = v,
            "initrd" => b.initrd_s = v,
            "userspace" => b.userspace_s = v,
            _ => {}
        }
    }
    Some(b)
}

/// Services les plus lents. Les « .device » (attente de matériel) ne sont pas actionnables.
fn parse_blame(out: &str, n: usize) -> Vec<SlowUnit> {
    out.lines()
        .filter_map(|l| {
            let l = l.trim();
            let i = l.rfind(' ')?;
            let (dur, unit) = (&l[..i], &l[i + 1..]);
            (unit.ends_with(".service")).then(|| Some(SlowUnit { unit: unit.trim_end_matches(".service").to_owned(), seconds: parse_duration(dur)? }))?
        })
        .take(n)
        .collect()
}

fn user_dir() -> PathBuf {
    desktop::config_home().join("autostart")
}

fn system_dirs() -> Vec<PathBuf> {
    let dirs = std::env::var("XDG_CONFIG_DIRS").unwrap_or_else(|_| "/etc/xdg".into());
    dirs.split(':').filter(|s| !s.is_empty()).map(|d| PathBuf::from(d).join("autostart")).collect()
}

fn autostart_entries() -> Vec<AutostartEntry> {
    let desktops = desktop::current_desktops();
    // Fichier système d'abord, surcharge utilisateur ensuite (même nom = même entrée).
    let mut files: BTreeMap<String, (Option<DesktopEntry>, Option<DesktopEntry>)> = BTreeMap::new();
    for dir in system_dirs().into_iter().rev() {
        for (id, e) in list_dir(&dir) {
            files.entry(id).or_default().0 = Some(e);
        }
    }
    for (id, e) in list_dir(&user_dir()) {
        files.entry(id).or_default().1 = Some(e);
    }
    let mut v: Vec<AutostartEntry> = files
        .into_iter()
        .filter_map(|(id, (sys, user))| {
            let eff = user.as_ref().or(sys.as_ref())?;
            if !eff.shown_in(&desktops) {
                return None;
            }
            let base = sys.as_ref().unwrap_or(eff);
            Some(AutostartEntry {
                name: eff.name.clone().or_else(|| base.name.clone()).unwrap_or_else(|| id.trim_end_matches(".desktop").to_owned()),
                comment: eff.comment.clone().or_else(|| base.comment.clone()),
                command: eff.exec.clone().or_else(|| base.exec.clone()),
                enabled: !eff.hidden && !eff.gnome_disabled,
                source: if sys.is_some() { "system" } else { "user" },
                component: base.desktop_component,
                id,
            })
        })
        .collect();
    v.sort_by(|a, b| (a.component, a.name.to_lowercase()).cmp(&(b.component, b.name.to_lowercase())));
    v
}

fn list_dir(dir: &PathBuf) -> Vec<(String, DesktopEntry)> {
    let Ok(rd) = fs::read_dir(dir) else { return Vec::new() };
    rd.flatten()
        .filter_map(|e| {
            let id = e.file_name().to_str()?.to_owned();
            id.ends_with(".desktop").then(|| Some((id, desktop::read(&e.path())?)))?
        })
        .collect()
}

/// Active ou désactive un programme au démarrage, par surcharge dans ~/.config/autostart.
pub fn set_autostart(id: &str, enabled: bool) -> Result<(), String> {
    if id.contains('/') || !id.ends_with(".desktop") {
        return Err("Identifiant d'entrée invalide".into());
    }
    let user = user_dir().join(id);
    let source = if user.exists() { Some(user.clone()) } else { system_dirs().into_iter().map(|d| d.join(id)).find(|p| p.exists()) };
    let Some(source) = source else { return Err("Entrée introuvable".into()) };
    let text = fs::read_to_string(&source).map_err(|e| format!("Lecture impossible : {e}"))?;
    if desktop::parse(&text).desktop_component {
        return Err("Composant du bureau : à gérer depuis les réglages du bureau".into());
    }
    let mut text = set_key(&text, "Hidden", if enabled { "false" } else { "true" });
    if !enabled || text.contains("X-GNOME-Autostart-enabled") {
        text = set_key(&text, "X-GNOME-Autostart-enabled", if enabled { "true" } else { "false" });
    }
    fs::create_dir_all(user_dir()).map_err(|e| format!("Création de {} impossible : {e}", user_dir().display()))?;
    let tmp = user.with_extension("desktop.tmp");
    fs::write(&tmp, text).and_then(|_| fs::rename(&tmp, &user)).map_err(|e| format!("Écriture impossible : {e}"))
}

/// Remplace (ou ajoute) une clé dans la section [Desktop Entry].
fn set_key(text: &str, key: &str, value: &str) -> String {
    let mut out = Vec::new();
    let mut in_main = false;
    let mut done = false;
    for line in text.lines() {
        let t = line.trim();
        if t.starts_with('[') {
            if in_main && !done {
                out.push(format!("{key}={value}"));
                done = true;
            }
            in_main = t == "[Desktop Entry]";
        } else if in_main && t.split_once('=').is_some_and(|(k, _)| k.trim() == key) {
            if !done {
                out.push(format!("{key}={value}"));
                done = true;
            }
            continue;
        }
        out.push(line.to_owned());
    }
    if !done {
        if !in_main {
            out.push("[Desktop Entry]".into());
        }
        out.push(format!("{key}={value}"));
    }
    out.join("\n") + "\n"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn durations() {
        assert_eq!(parse_duration("910ms"), Some(0.91));
        assert_eq!(parse_duration("1min 2.5s"), Some(62.5));
        let b = parse_time("Startup finished in 4.866s (firmware) + 5.284s (loader) + 910ms (kernel) + 5.757s (initrd) + 9.882s (userspace) = 26.702s \n").unwrap();
        assert_eq!(b.kernel_s, Some(0.91));
        assert_eq!(b.total_s, Some(26.702));
        let s = parse_blame("6.078s dev-tpm0.device\n2.1s NetworkManager.service\n1min 3s foo.service\n", 5);
        assert_eq!(s.len(), 2);
        assert_eq!(s[0].unit, "NetworkManager");
    }

    #[test]
    fn set_key_in_main_section() {
        let t = set_key("[Desktop Entry]\nName=A\nHidden=false\n[Desktop Action x]\nName=B\n", "Hidden", "true");
        assert_eq!(t, "[Desktop Entry]\nName=A\nHidden=true\n[Desktop Action x]\nName=B\n");
        let t = set_key("[Desktop Entry]\nName=A\n[Desktop Action x]\n", "Hidden", "true");
        assert!(t.starts_with("[Desktop Entry]\nName=A\nHidden=true\n[Desktop Action x]"));
    }

    #[test]
    fn reads_this_machine() {
        let s = read();
        println!("{:?}\n{:?}", s.boot, s.slowest.iter().map(|u| &u.unit).collect::<Vec<_>>());
        for a in &s.autostart {
            println!("  {:<40} actif={} composant={} {}", a.name, a.enabled, a.component, a.source);
        }
    }
}
