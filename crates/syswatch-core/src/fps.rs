//! FPS des jeux, lus dans le journal CSV de MangoHud (seul moyen fiable sous Linux :
//! MangoHud est injecté dans le jeu, SysWatch ne l'est pas). MangoHud écrit son journal
//! au fil de l'eau dans un dossier dédié à SysWatch ; un fichier modifié il y a moins de
//! 3 s signale un jeu en cours.
//!
//! `setup_mangohud` ajoute (sur demande explicite) trois lignes repérées à la config de
//! MangoHud ; `cleanup` supprime les journaux de plus de 24 h de ce dossier.

use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;
use std::time::{Duration, SystemTime};

use serde::Serialize;

const LIVE: Duration = Duration::from_secs(3);
const TAIL: u64 = 24 * 1024;
const MARK: &str = "# SysWatch : journal lu pour l'overlay FPS";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FpsSnapshot {
    pub fps: f32,
    pub frametime_ms: f32,
    /// 1 % les plus lents (FPS) sur les dernières secondes.
    pub low1: Option<f32>,
    /// Pic de temps de trame sur la même fenêtre.
    pub frametime_peak_ms: Option<f32>,
    /// Nom du jeu (préfixe du fichier de journal).
    pub game: String,
}

fn home() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(|| "/tmp".into())
}

/// Dossier des journaux MangoHud lus par SysWatch.
pub fn log_dir() -> PathBuf {
    std::env::var_os("XDG_STATE_HOME").map(PathBuf::from).filter(|p| p.is_absolute()).unwrap_or_else(|| home().join(".local/state")).join("syswatch/mangohud")
}

fn conf_path() -> PathBuf {
    crate::desktop::config_home().join("MangoHud/MangoHud.conf")
}

/// MangoHud est-il installé, et sa config écrit-elle dans notre dossier ?
pub fn mangohud_state() -> (bool, bool) {
    let installed = ["/usr/bin/mangohud", "/usr/local/bin/mangohud"].iter().any(|p| std::path::Path::new(p).exists());
    let configured = fs::read_to_string(conf_path()).is_ok_and(|s| s.contains(MARK));
    (installed, configured)
}

/// Ajoute à MangoHud.conf : dossier de journal, démarrage automatique, intervalle 250 ms.
pub fn setup_mangohud() -> Result<String, String> {
    let dir = log_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("Création de {} impossible : {e}", dir.display()))?;
    let path = conf_path();
    let current = fs::read_to_string(&path).unwrap_or_default();
    if current.contains(MARK) {
        return Ok(path.display().to_string());
    }
    // Une clé déjà présente l'emporterait : on la commente plutôt que de la dupliquer.
    let mut lines: Vec<String> = current
        .lines()
        .map(|l| {
            let k = l.trim().split('=').next().unwrap_or("").trim();
            if ["output_folder", "autostart_log", "log_interval", "log_duration"].contains(&k) { format!("# {l}  (désactivé par SysWatch)") } else { l.to_owned() }
        })
        .collect();
    lines.extend([String::new(), MARK.into(), format!("output_folder={}", dir.display()), "autostart_log=1".into(), "log_interval=250".into()]);
    if let Some(p) = path.parent() {
        fs::create_dir_all(p).map_err(|e| e.to_string())?;
    }
    fs::write(&path, lines.join("\n") + "\n").map_err(|e| format!("Écriture de {} impossible : {e}", path.display()))?;
    Ok(path.display().to_string())
}

/// Supprime les journaux de plus de 24 h (MangoHud en crée un par session de jeu).
pub fn cleanup() {
    let Ok(rd) = fs::read_dir(log_dir()) else { return };
    for e in rd.flatten() {
        let old = e.metadata().and_then(|m| m.modified()).ok().and_then(|t| t.elapsed().ok()).is_some_and(|d| d > Duration::from_secs(86_400));
        if old {
            let _ = fs::remove_file(e.path());
        }
    }
}

/// FPS du jeu en cours, ou `None` s'il n'y a pas de journal vivant.
pub fn read() -> Option<FpsSnapshot> {
    let newest = fs::read_dir(log_dir())
        .ok()?
        .flatten()
        .filter(|e| e.file_name().to_string_lossy().ends_with(".csv") && !e.file_name().to_string_lossy().ends_with("_summary.csv"))
        .filter_map(|e| Some((e.metadata().ok()?.modified().ok()?, e.path())))
        .max_by_key(|(t, _)| *t)?;
    if SystemTime::now().duration_since(newest.0).unwrap_or_default() > LIVE {
        return None;
    }
    let mut f = fs::File::open(&newest.1).ok()?;
    let len = f.metadata().ok()?.len();
    // Ligne d'en-tête (« fps,frametime,… ») : dans les premières lignes du fichier.
    let mut head = vec![0u8; 4096.min(len as usize)];
    f.read_exact(&mut head).ok()?;
    let head = String::from_utf8_lossy(&head);
    let header = head.lines().find(|l| l.starts_with("fps,"))?;
    let cols: Vec<&str> = header.split(',').collect();
    let (ifps, ift) = (cols.iter().position(|c| *c == "fps")?, cols.iter().position(|c| *c == "frametime")?);
    f.seek(SeekFrom::Start(len.saturating_sub(TAIL))).ok()?;
    let mut tail = String::new();
    f.read_to_string(&mut tail).ok()?;
    let rows: Vec<(f32, f32)> = tail
        .lines()
        .filter(|l| !l.starts_with("fps,"))
        .filter_map(|l| {
            let v: Vec<&str> = l.split(',').collect();
            if v.len() != cols.len() {
                return None; // ligne coupée par la lecture partielle
            }
            Some((v[ifps].parse().ok()?, v[ift].parse().ok()?))
        })
        .collect();
    let &(fps, ft) = rows.last()?;
    let recent = &rows[rows.len().saturating_sub(40)..]; // ~10 s à 250 ms
    let mut sorted: Vec<f32> = recent.iter().map(|r| r.0).collect();
    sorted.sort_by(f32::total_cmp);
    let low1 = (sorted.len() >= 10).then(|| sorted[(sorted.len() / 100).min(sorted.len() - 1)]);
    let game = newest.1.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    // « <jeu>_<AAAA-MM-JJ>_<HH-MM-SS> » : on retire la date et l'heure.
    let game = game.rsplitn(3, '_').last().map(str::to_owned).unwrap_or(game);
    Some(FpsSnapshot { fps, frametime_ms: ft, low1, frametime_peak_ms: recent.iter().map(|r| r.1).reduce(f32::max), game })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_live_log() {
        let dir = log_dir();
        fs::create_dir_all(&dir).unwrap();
        let p = dir.join("testgame_2026-11-20_10-00-00.csv");
        let mut s = String::from("os,cpu,gpu,ram,kernel,driver,cpuscheduler\nLinux,R5,GTX,16,7.3,620,\n");
        s.push_str("fps,frametime,cpu_load,gpu_load,cpu_temp,gpu_temp,elapsed\n");
        for i in 0..60 {
            let fps = if i == 30 { 40.0 } else { 144.0 };
            s.push_str(&format!("{fps},{:.2},40,97,63,71,{i}\n", 1000.0 / fps));
        }
        fs::write(&p, s).unwrap();
        let r = read().expect("journal vivant");
        assert_eq!(r.fps, 144.0);
        assert!((r.frametime_ms - 6.94).abs() < 0.01);
        assert_eq!(r.game, "testgame");
        assert_eq!(r.low1, Some(40.0));
        fs::remove_file(&p).unwrap();
    }
}
