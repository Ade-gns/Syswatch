//! Application SysWatch (processus utilisateur, jamais root).

mod config;
mod logger;
mod sampler;
mod shortcut;
mod tray;
mod update;
mod windows;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use config::Settings;
use sampler::{Ctl, SamplerHandle};
use serde::Serialize;
use syswatch_core::alerts::{self, AlertEngine, AlertEvent};
use syswatch_core::fps;
use syswatch_core::model::SystemInfo;
use syswatch_core::dirscan::{DirScanner, FolderScan};
use syswatch_core::fanctl::{self, FanStatus};
use syswatch_core::fans::Mode;
use syswatch_core::procs::{self, ProcCollector, ProcessList};
use syswatch_core::smart::{self, SmartInfo};
use syswatch_core::startup::{self, StartupInfo};
use syswatch_core::Collector;
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};

struct AppState {
    info: SystemInfo,
    settings: Arc<Mutex<Settings>>,
    alerts: Arc<Mutex<AlertEngine>>,
    /// Overlay du mode jeu affiché (raccourci, icône, interrupteur « Mode jeu »).
    overlay_shown: AtomicBool,
    tray: Mutex<Option<tray::Tray>>,
    sampler: SamplerHandle,
    /// Collecte des processus, à la demande (pages Processus, Réseau, widget Top processus).
    procs: Arc<Mutex<ProcCollector>>,
    /// Analyses d'espace par dossier en cours ou récentes.
    dirscan: DirScanner,
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
async fn disk_smart(id: String) -> Result<SmartInfo, String> {
    blocking(move || smart::read(&id)).await
}

/// Lance l'analyse d'espace par dossier si besoin et renvoie son état (à rappeler tant
/// que `running` est vrai).
#[tauri::command]
async fn scan_folders(state: State<'_, AppState>, disk: String, force: bool) -> Result<FolderScan, String> {
    let s = state.dirscan.clone();
    blocking(move || s.scan(&disk, force)).await?
}

#[tauri::command]
async fn fan_status() -> Result<FanStatus, String> {
    blocking(fanctl::status).await
}

#[tauri::command]
async fn set_fan_mode(id: String, mode: Mode) -> Result<(), String> {
    blocking(move || fanctl::set_mode(&id, &mode)).await?
}

#[tauri::command]
async fn set_power_profile(name: String) -> Result<(), String> {
    blocking(move || fanctl::set_power_profile(&name)).await?
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
async fn check_update(app: AppHandle) -> Result<update::UpdateInfo, String> {
    update::check(&app).await
}

#[tauri::command]
async fn install_update(app: AppHandle) -> Result<(), String> {
    update::install(&app).await
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
fn save_settings(app: AppHandle, state: State<'_, AppState>, settings: Settings) -> Result<Settings, String> {
    let s = settings.sanitized();
    config::save(&s).map_err(|e| format!("Impossible d'enregistrer les paramètres : {e}"))?;
    let mut cur = state.settings.lock().unwrap();
    if cur.interval_ms != s.interval_ms {
        state.sampler.send(Ctl::Interval(Duration::from_millis(s.interval_ms)));
    }
    *cur = s.clone();
    drop(cur);
    refresh_extras(&app, &state);
    Ok(s)
}

/* ---------- Lancement à l'ouverture de session ---------- */

const AUTOSTART_FILE: &str = "syswatch.desktop";

fn autostart_path() -> std::path::PathBuf {
    syswatch_core::desktop::config_home().join("autostart").join(AUTOSTART_FILE)
}

#[tauri::command]
fn get_launch_at_login() -> bool {
    std::fs::read_to_string(autostart_path()).is_ok_and(|s| !s.contains("Hidden=true"))
}

/// Entrée d'autostart XDG (KDE, GNOME…) qui lance SysWatch réduit dans la zone de notification.
#[tauri::command]
fn set_launch_at_login(enabled: bool) -> Result<(), String> {
    let path = autostart_path();
    if !enabled {
        return match std::fs::remove_file(&path) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(format!("Suppression de {} impossible : {e}", path.display())),
            _ => Ok(()),
        };
    }
    // AppImage : current_exe() pointe dans le montage temporaire (/tmp/.mount_…), qui change
    // à chaque lancement ; $APPIMAGE est le chemin du fichier lui-même.
    let exe = match std::env::var_os("APPIMAGE") {
        Some(p) => std::path::PathBuf::from(p),
        None => std::env::current_exe().map_err(|e| e.to_string())?,
    };
    let entry = format!(
        "[Desktop Entry]\nType=Application\nName=SysWatch\nComment=Surveillance du PC, réduit dans la zone de notification\nExec=\"{}\" --tray\nIcon=syswatch\nTerminal=false\nX-GNOME-Autostart-enabled=true\n",
        exe.display()
    );
    if let Some(d) = path.parent() {
        std::fs::create_dir_all(d).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, entry).map_err(|e| format!("Écriture de {} impossible : {e}", path.display()))
}

#[tauri::command]
fn get_layout() -> Option<serde_json::Value> {
    config::load_layout()
}

#[tauri::command]
fn save_layout(layout: serde_json::Value) -> Result<(), String> {
    config::save_layout(&layout).map_err(|e| format!("Disposition non enregistrée : {e}"))
}

#[tauri::command]
fn set_visible(state: State<'_, AppState>, visible: bool) {
    state.sampler.send(Ctl::Visible(visible));
}

/* ---------- Widget, overlay, icône ---------- */

/// Synchronise widget, overlay et cases de l'icône avec les réglages et l'état courant.
fn refresh_extras(app: &AppHandle, state: &AppState) {
    let s = state.settings.lock().unwrap().clone();
    let shown = state.overlay_shown.load(Ordering::SeqCst);
    windows::apply(app, &s, shown);
    if let Some(t) = state.tray.lock().unwrap().as_ref() {
        t.update(s.widget.enabled, shown && s.overlay.enabled);
    }
    let _ = app.emit("overlay-shown", shown && s.overlay.enabled);
}

pub(crate) fn set_overlay(app: &AppHandle, shown: bool) {
    let state = app.state::<AppState>();
    state.overlay_shown.store(shown, Ordering::SeqCst);
    refresh_extras(app, &state);
}

pub(crate) fn toggle_overlay(app: &AppHandle) {
    let shown = app.state::<AppState>().overlay_shown.load(Ordering::SeqCst);
    // Les fenêtres se créent sur le thread principal.
    let a = app.clone();
    let _ = app.run_on_main_thread(move || set_overlay(&a, !shown));
}

pub(crate) fn toggle_widget(app: &AppHandle) {
    let state = app.state::<AppState>();
    let s = {
        let mut s = state.settings.lock().unwrap();
        s.widget.enabled = !s.widget.enabled;
        s.clone()
    };
    if let Err(e) = config::save(&s) {
        log::warn!("réglages non enregistrés : {e}");
    }
    let _ = app.emit("settings-changed", &s);
    refresh_extras(app, &state);
}

#[tauri::command]
fn set_overlay_shown(app: AppHandle, shown: bool) {
    set_overlay(&app, shown);
}

#[tauri::command]
fn get_overlay_shown(state: State<'_, AppState>) -> bool {
    state.overlay_shown.load(Ordering::SeqCst) && state.settings.lock().unwrap().overlay.enabled
}

/// Le widget ou l'overlay a changé de taille : replacer dans son coin (X11).
#[tauri::command]
fn reposition(app: AppHandle, state: State<'_, AppState>, label: String) {
    let s = state.settings.lock().unwrap().clone();
    windows::replace(&app, &label, &s);
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MangohudStatus {
    installed: bool,
    configured: bool,
    log_dir: String,
}

#[tauri::command]
fn mangohud_status() -> MangohudStatus {
    let (installed, configured) = fps::mangohud_state();
    MangohudStatus { installed, configured, log_dir: fps::log_dir().display().to_string() }
}

/// Ajoute à MangoHud.conf les lignes de journalisation lues par l'overlay (sur demande).
#[tauri::command]
async fn setup_mangohud() -> Result<String, String> {
    blocking(fps::setup_mangohud).await?
}

/* ---------- Alertes ---------- */

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AlertsView {
    history: Vec<AlertEvent>,
    unread: u32,
}

#[tauri::command]
fn get_alerts(state: State<'_, AppState>) -> AlertsView {
    let a = state.alerts.lock().unwrap();
    AlertsView { history: a.history.clone(), unread: a.unread }
}

#[tauri::command]
fn mark_alerts_read(app: AppHandle, state: State<'_, AppState>) {
    state.alerts.lock().unwrap().unread = 0;
    let _ = app.emit("alerts-read", ());
}

#[tauri::command]
fn clear_alerts(app: AppHandle, state: State<'_, AppState>) {
    let mut a = state.alerts.lock().unwrap();
    a.history.clear();
    a.unread = 0;
    let _ = app.emit("alerts-read", ());
}

/// Après chaque mesure : alertes (historique, notification, événement) et info-bulle.
fn sample_hook(settings: Arc<Mutex<Settings>>, alerts: Arc<Mutex<AlertEngine>>) -> sampler::Hook {
    let mut tip_at = Instant::now() - Duration::from_secs(60);
    // Détection automatique des jeux : (affiché par la détection, dernier FPS vu).
    let mut auto_shown = false;
    let mut last_fps = Instant::now() - Duration::from_secs(60);
    Box::new(move |app, snap| {
        let s = settings.lock().unwrap().clone();
        if s.overlay.enabled && s.overlay.auto_show {
            let shown = app.state::<AppState>().overlay_shown.load(Ordering::SeqCst);
            if snap.fps.is_some() {
                last_fps = Instant::now();
                if !shown {
                    auto_shown = true;
                    toggle_overlay(app);
                }
            } else if auto_shown && shown && last_fps.elapsed() > Duration::from_secs(10) {
                auto_shown = false;
                toggle_overlay(app);
            }
        }
        let events = alerts.lock().unwrap().evaluate(snap, &s.alerts, s.temp_unit == "f");
        if !events.is_empty() {
            for e in &events {
                if s.alerts.notify && (e.level == alerts::Level::Crit || s.alerts.notify_warn) {
                    alerts::notify(e);
                }
            }
            let unread = alerts.lock().unwrap().unread;
            let _ = app.emit("alerts", serde_json::json!({ "events": events, "unread": unread }));
        }
        if tip_at.elapsed() >= Duration::from_secs(5) {
            tip_at = Instant::now();
            let ram = if snap.memory.total > 0 { snap.memory.used as f64 / snap.memory.total as f64 * 100.0 } else { 0.0 };
            let temp = snap.cpu.temp_c.map(|t| format!(" · {t:.0} °C")).unwrap_or_default();
            let tip = format!("SysWatch\nCPU {:.0} %{temp} · RAM {ram:.0} %", snap.cpu.usage);
            if let Some(t) = app.state::<AppState>().tray.lock().unwrap().as_ref() {
                let _ = t.icon.set_tooltip(Some(tip));
            }
        }
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    logger::init();
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(update::Pending::default())
        .setup(|app| {
            let settings = config::load();
            let collector = Collector::new().ok_or("Impossible d'initialiser la collecte système")?;
            let info = collector.system_info();
            fps::cleanup();
            let interval = Duration::from_millis(settings.interval_ms);
            let settings = Arc::new(Mutex::new(settings));
            let alerts = Arc::new(Mutex::new(AlertEngine::new()));
            let sampler = sampler::spawn(app.handle().clone(), collector, interval, sample_hook(Arc::clone(&settings), Arc::clone(&alerts)));
            app.manage(AppState {
                info,
                settings,
                alerts,
                overlay_shown: AtomicBool::new(false),
                tray: Mutex::new(None),
                sampler,
                procs: Arc::new(Mutex::new(ProcCollector::new())),
                dirscan: DirScanner::default(),
            });
            let handle = app.handle().clone();
            let state = app.state::<AppState>();
            let widget_on = state.settings.lock().unwrap().widget.enabled;
            match tray::build(&handle, widget_on, false) {
                Ok(t) => *state.tray.lock().unwrap() = Some(t),
                Err(e) => log::warn!("icône de notification indisponible : {e}"),
            }
            refresh_extras(&handle, &state);
            // Lancé avec --tray (ouverture de session) : rester dans la zone de notification.
            let to_tray = std::env::args().any(|a| a == "--tray") && state.tray.lock().unwrap().is_some();
            if !to_tray {
                if let Some(w) = handle.get_webview_window("main") {
                    let _ = w.show();
                }
            }
            if state.settings.lock().unwrap().check_updates {
                update::check_at_startup(handle.clone());
            }
            shortcut::spawn(handle);
            Ok(())
        })
        // Fermer la fenêtre principale la range dans la zone de notification (si l'icône existe).
        .on_window_event(|w, e| {
            if let WindowEvent::CloseRequested { api, .. } = e {
                if w.label() != "main" {
                    return;
                }
                let state = w.app_handle().state::<AppState>();
                let to_tray = state.settings.lock().unwrap().close_to_tray && state.tray.lock().unwrap().is_some();
                if to_tray {
                    api.prevent_close();
                    let _ = w.hide();
                } else {
                    w.app_handle().exit(0);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_system_info, get_settings, save_settings, set_visible, list_processes, terminate, get_startup, set_autostart, disk_smart, scan_folders, fan_status,
            set_fan_mode, set_power_profile, get_alerts, mark_alerts_read, clear_alerts, set_overlay_shown, get_overlay_shown, reposition, mangohud_status, setup_mangohud, get_layout, save_layout, get_launch_at_login, set_launch_at_login, check_update, install_update
        ])
        .run(tauri::generate_context!())
        .expect("erreur au lancement de SysWatch");
}
