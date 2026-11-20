//! Application SysWatch (processus utilisateur, jamais root).

mod config;
mod sampler;

use std::sync::Mutex;
use std::time::Duration;

use config::Settings;
use sampler::{Ctl, SamplerHandle};
use syswatch_core::model::SystemInfo;
use syswatch_core::Collector;
use tauri::{Manager, State};

struct AppState {
    info: SystemInfo,
    settings: Mutex<Settings>,
    sampler: SamplerHandle,
}

#[tauri::command]
fn get_system_info(state: State<'_, AppState>) -> SystemInfo {
    state.info.clone()
}

#[tauri::command]
fn get_settings(state: State<'_, AppState>) -> Settings {
    state.settings.lock().unwrap().clone()
}

#[tauri::command]
fn save_settings(state: State<'_, AppState>, settings: Settings) -> Result<Settings, String> {
    let s = settings.sanitized();
    config::save(&s).map_err(|e| format!("Impossible d'enregistrer les paramètres : {e}"))?;
    let mut cur = state.settings.lock().unwrap();
    if cur.interval_ms != s.interval_ms {
        state.sampler.send(Ctl::Interval(Duration::from_millis(s.interval_ms)));
    }
    *cur = s.clone();
    Ok(s)
}

#[tauri::command]
fn set_visible(state: State<'_, AppState>, visible: bool) {
    state.sampler.send(Ctl::Visible(visible));
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let settings = config::load();
            let collector = Collector::new().ok_or("Impossible d'initialiser la collecte système")?;
            let info = collector.system_info();
            let sampler = sampler::spawn(app.handle().clone(), collector, Duration::from_millis(settings.interval_ms));
            app.manage(AppState { info, settings: Mutex::new(settings), sampler });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_system_info, get_settings, save_settings, set_visible])
        .run(tauri::generate_context!())
        .expect("erreur au lancement de SysWatch");
}
