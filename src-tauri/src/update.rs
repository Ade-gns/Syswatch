//! Mises à jour depuis les Releases GitHub du dépôt (plugin officiel Tauri).
//!
//! Confidentialité : aucune requête tant que l'utilisateur n'a pas activé la vérification
//! au démarrage ou cliqué « Vérifier maintenant ». La requête télécharge `latest.json`
//! depuis GitHub, sans rien envoyer d'autre que ce qu'implique une requête HTTPS.
//!
//! Seule l'AppImage se remplace elle-même ; les paquets .deb, .rpm et Arch restent à la
//! charge du gestionnaire de paquets. Chaque fichier téléchargé est vérifié avec la clé
//! publique de `tauri.conf.json` avant installation.

use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_updater::{Update, UpdaterExt};

/// Mise à jour trouvée par la dernière vérification, en attente d'installation.
#[derive(Default)]
pub struct Pending(Mutex<Option<Update>>);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub current: String,
    /// Version disponible, ou None si à jour.
    pub version: Option<String>,
    pub notes: Option<String>,
    /// Date de publication (RFC 3339).
    pub date: Option<String>,
    /// L'application peut s'installer elle-même (lancée depuis une AppImage).
    pub can_install: bool,
}

/// Lancée depuis une AppImage : seul format que SysWatch remplace lui-même.
pub fn self_updatable() -> bool {
    std::env::var_os("APPIMAGE").is_some()
}

pub async fn check<R: Runtime>(app: &AppHandle<R>) -> Result<UpdateInfo, String> {
    let updater = app
        .updater_builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| format!("Mises à jour indisponibles : {e}"))?;
    let found = updater.check().await.map_err(|e| format!("Vérification impossible : {e}"))?;
    let info = UpdateInfo {
        current: app.package_info().version.to_string(),
        version: found.as_ref().map(|u| u.version.clone()),
        notes: found.as_ref().and_then(|u| u.body.clone()).filter(|b| !b.trim().is_empty()),
        date: found.as_ref().and_then(|u| u.date).and_then(|d| d.format(&time::format_description::well_known::Rfc3339).ok()),
        can_install: self_updatable(),
    };
    *app.state::<Pending>().0.lock().unwrap() = found;
    Ok(info)
}

/// Télécharge, vérifie la signature, remplace l'AppImage et redémarre.
pub async fn install<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    if !self_updatable() {
        return Err("SysWatch a été installé par un paquet : mettez-le à jour avec le gestionnaire de paquets.".into());
    }
    let update = app.state::<Pending>().0.lock().unwrap().clone().ok_or("Aucune mise à jour en attente : relancez la vérification.")?;
    let mut done: u64 = 0;
    let progress = app.clone();
    update
        .download_and_install(
            move |chunk, total| {
                done += chunk as u64;
                let _ = progress.emit("update-progress", serde_json::json!({ "done": done, "total": total }));
            },
            || {},
        )
        .await
        .map_err(|e| format!("Installation impossible : {e}"))?;
    app.restart();
}

/// Vérification au démarrage (si activée) : prévient l'interface quand une version existe.
pub fn check_at_startup<R: Runtime>(app: AppHandle<R>) {
    tauri::async_runtime::spawn(async move {
        // Laisser la fenêtre s'ouvrir avant de toucher au réseau.
        tokio_sleep(Duration::from_secs(10)).await;
        match check(&app).await {
            Ok(info) if info.version.is_some() => {
                log::info!("mise à jour disponible : {:?}", info.version);
                let _ = app.emit("update-available", info);
            }
            Ok(_) => {}
            Err(e) => log::warn!("{e}"),
        }
    });
}

async fn tokio_sleep(d: Duration) {
    let _ = tauri::async_runtime::spawn_blocking(move || std::thread::sleep(d)).await;
}
