//! Raccourci global Ctrl + Maj + F (afficher / masquer l'overlay) via le portail
//! xdg-desktop-portal GlobalShortcuts : sous Wayland, une application ne peut pas
//! intercepter le clavier elle-même. Le bureau (KDE, GNOME 48+) peut demander une
//! confirmation la première fois et laisse l'utilisateur changer la touche.
//! Sans portail, l'overlay reste accessible par l'icône et la page Accueil.

use std::collections::HashMap;

use tauri::AppHandle;
use zbus::blocking::{Connection, Proxy};
use zbus::zvariant::{ObjectPath, OwnedObjectPath, OwnedValue, Value};

const PORTAL: &str = "org.freedesktop.portal.Desktop";
const PATH: &str = "/org/freedesktop/portal/desktop";
pub const SHORTCUT_ID: &str = "toggle-overlay";

pub fn spawn(app: AppHandle) {
    std::thread::Builder::new()
        .name("syswatch-shortcut".into())
        .spawn(move || {
            if let Err(e) = run(&app) {
                log::warn!("raccourci global indisponible : {e}");
            }
        })
        .ok();
}

/// Appelle une méthode du portail et attend la réponse sur l'objet Request associé.
fn request(conn: &Connection, token: &str, call: impl FnOnce() -> zbus::Result<OwnedObjectPath>) -> zbus::Result<HashMap<String, OwnedValue>> {
    let sender = conn.unique_name().map(|n| n.trim_start_matches(':').replace('.', "_")).unwrap_or_default();
    let path = format!("{PATH}/request/{sender}/{token}");
    let req = Proxy::new(conn, PORTAL, path.as_str(), "org.freedesktop.portal.Request")?;
    let mut responses = req.receive_signal("Response")?;
    call()?;
    let msg = responses.next().ok_or_else(|| zbus::Error::Failure("pas de réponse du portail".into()))?;
    let (code, results): (u32, HashMap<String, OwnedValue>) = msg.body().deserialize()?;
    if code != 0 {
        return Err(zbus::Error::Failure(format!("refusé par le portail (code {code})")));
    }
    Ok(results)
}

fn run(app: &AppHandle) -> zbus::Result<()> {
    let conn = Connection::session()?;
    // Identité de l'application auprès du portail (xdg-desktop-portal ≥ 1.19), si disponible.
    if let Ok(reg) = Proxy::new(&conn, PORTAL, PATH, "org.freedesktop.host.portal.Registry") {
        let _ = reg.call::<_, _, ()>("Register", &("dev.syswatch.app", HashMap::<&str, Value>::new()));
    }
    let gs = Proxy::new(&conn, PORTAL, PATH, "org.freedesktop.portal.GlobalShortcuts")?;

    let results = request(&conn, "syswatch_session", || {
        let opts: HashMap<&str, Value> = HashMap::from([("handle_token", Value::from("syswatch_session")), ("session_handle_token", Value::from("syswatch"))]);
        gs.call("CreateSession", &(opts,))
    })?;
    let session: String = results.get("session_handle").and_then(|v| v.try_clone().ok()).and_then(|v| String::try_from(v).ok()).ok_or_else(|| zbus::Error::Failure("session absente".into()))?;
    let session_path = ObjectPath::try_from(session.as_str())?;

    request(&conn, "syswatch_bind", || {
        let shortcut: HashMap<&str, Value> = HashMap::from([("description", Value::from("Afficher ou masquer l'overlay du mode jeu")), ("preferred_trigger", Value::from("CTRL+SHIFT+F"))]);
        let opts: HashMap<&str, Value> = HashMap::from([("handle_token", Value::from("syswatch_bind"))]);
        gs.call("BindShortcuts", &(&session_path, vec![(SHORTCUT_ID, shortcut)], "", opts))
    })?;
    log::info!("raccourci global enregistré auprès du portail");

    for msg in gs.receive_signal("Activated")? {
        let (_s, id, _t, _o): (OwnedObjectPath, String, u64, HashMap<String, OwnedValue>) = msg.body().deserialize()?;
        if id == SHORTCUT_ID {
            crate::toggle_overlay(app);
        }
    }
    Ok(())
}
