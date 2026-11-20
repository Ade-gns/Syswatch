//! Application SysWatch (processus utilisateur, jamais root).

mod config;
mod sampler;

use std::sync::{Arc, Mutex};
use std::time::Duration;

use config::Settings;
use sampler::{Ctl, SamplerHandle};
use syswatch_core::model::SystemInfo;
use syswatch_core::procs::{self, ProcCollector, ProcessList};
use syswatch_core::startup::{self, StartupInfo};
use syswatch_core::Collector;
use tauri::{Manager, State};

struct AppState {
    info: SystemInfo,
    settings: Mutex<Settings>,
    sampler: SamplerHandle,
    /// Collecte des processus, à la demande (pages Processus, Réseau, widget Top processus).
    procs: Arc<Mutex<ProcCollector>>,
}

/// Exécute un travail bloquant (lecture de /proc, sous-processus) hors du thread principal.
async fn blocking<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn list_processes(state: State<'_, AppState>, connections: bool) -> Result<ProcessList, String> {
    let p = Arc::clone(&state.procs);
    blocking(move || p.lock().unwrap().sample(connections)).await
}

/// SIGTERM à chaque PID ; renvoie un message lisible si certains n'ont pas pu être fermés.
#[tauri::command]
async fn terminate(pids: Vec<u32>) -> Result<(), String> {
    let failed = blocking(move || procs::terminate(&pids)).await?;
    match failed.first() {
        None => Ok(()),
        Some((pid, why)) if failed.len() == 1 => Err(format!("Processus {pid} non fermé : {why}")),
        Some((_, why)) => Err(format!("{} processus non fermés : {why}", failed.len())),
    }
}

#[tauri::command]
async fn get_startup() -> Result<StartupInfo, String> {
    blocking(startup::read).await
}

#[tauri::command]
async fn set_autostart(id: String, enabled: bool) -> Result<(), String> {
    blocking(move || startup::set_autostart(&id, enabled)).await?
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
            app.manage(AppState { info, settings: Mutex::new(settings), sampler, procs: Arc::new(Mutex::new(ProcCollector::new())) });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_system_info, get_settings, save_settings, set_visible, list_processes, terminate, get_startup, set_autostart])
        .run(tauri::generate_context!())
        .expect("erreur au lancement de SysWatch");
}
