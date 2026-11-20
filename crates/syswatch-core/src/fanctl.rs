//! Pilotage des ventilateurs côté application (sans droits) :
//! - état et commandes via le service privilégié `dev.syswatch.Helper1` (D-Bus système) ;
//! - profils d'énergie via power-profiles-daemon, que l'utilisateur de la session active
//!   peut changer sans root (sur les portables comme le HP Victus, le firmware y règle
//!   aussi la ventilation).
//! Sans service installé, les canaux sont listés en lecture seule avec la marche à suivre.

use std::path::Path;

use serde::{Deserialize, Serialize};
use syswatch_fans::{self as fans, Control, Mode};
use zbus::blocking::{Connection, Proxy};
use zbus::zvariant::OwnedValue;

const HELPER: &str = "dev.syswatch.Helper1";
const HELPER_PATH: &str = "/dev/syswatch/Helper1";
const INSTALL_HINT: &str = "Service SysWatch non installé : lancez « cargo build --release -p syswatch-helper » puis « sudo ./scripts/install-helper.sh »";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelStatus {
    pub id: String,
    pub chip: String,
    pub label: String,
    pub control: Control,
    pub mode: Mode,
    pub rpm: Option<u32>,
    pub pct: Option<f32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HelperStatus {
    pub installed: bool,
    pub version: Option<String>,
    /// Raison lisible quand le service est absent ou en erreur.
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PowerProfiles {
    pub active: String,
    pub choices: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FanStatus {
    pub helper: HelperStatus,
    pub channels: Vec<ChannelStatus>,
    pub power_profiles: Option<PowerProfiles>,
}

#[derive(Deserialize)]
struct HelperState {
    version: String,
    channels: Vec<ChannelStatus>,
}

fn helper(conn: &Connection) -> zbus::Result<Proxy<'_>> {
    Proxy::new(conn, HELPER, HELPER_PATH, HELPER)
}

/// Message lisible pour une erreur D-Bus du service.
fn explain(e: zbus::Error) -> String {
    match e {
        zbus::Error::MethodError(name, msg, _) => match name.as_str() {
            "org.freedesktop.DBus.Error.ServiceUnknown" | "org.freedesktop.DBus.Error.NameHasNoOwner" => INSTALL_HINT.into(),
            _ => msg.unwrap_or_else(|| name.to_string()),
        },
        zbus::Error::FDO(f) => match *f {
            zbus::fdo::Error::ServiceUnknown(_) | zbus::fdo::Error::NameHasNoOwner(_) => INSTALL_HINT.into(),
            zbus::fdo::Error::AccessDenied(m) | zbus::fdo::Error::Failed(m) | zbus::fdo::Error::InvalidArgs(m) | zbus::fdo::Error::NotSupported(m) => m,
            other => other.to_string(),
        },
        other => other.to_string(),
    }
}

pub fn status() -> FanStatus {
    let conn = Connection::system().ok();
    let from_helper = conn.as_ref().map(|c| helper(c).and_then(|p| p.call::<_, _, String>("GetState", &())));
    let (helper, channels) = match from_helper {
        Some(Ok(json)) => match serde_json::from_str::<HelperState>(&json) {
            Ok(s) => (HelperStatus { installed: true, version: Some(s.version), detail: None }, s.channels),
            Err(e) => (HelperStatus { installed: true, version: None, detail: Some(format!("Réponse du service illisible : {e}")) }, local_channels()),
        },
        Some(Err(e)) => {
            let d = explain(e);
            (HelperStatus { installed: d != INSTALL_HINT, version: None, detail: Some(d) }, local_channels())
        }
        None => (HelperStatus { installed: false, version: None, detail: Some("Bus système D-Bus inaccessible".into()) }, local_channels()),
    };
    FanStatus { helper, channels, power_profiles: conn.as_ref().and_then(power_profiles) }
}

/// Canaux vus sans le service (lecture seule, mode supposé automatique).
fn local_channels() -> Vec<ChannelStatus> {
    fans::discover(Path::new(fans::HWMON))
        .into_iter()
        .map(|c| ChannelStatus { rpm: c.rpm(), pct: c.pct(), id: c.id, chip: c.chip, label: c.label, control: c.control, mode: Mode::Auto })
        .collect()
}

pub fn set_mode(id: &str, mode: &Mode) -> Result<(), String> {
    if let Mode::Curve { curve } = mode {
        curve.validate()?;
    }
    let conn = Connection::system().map_err(|e| e.to_string())?;
    let json = serde_json::to_string(mode).map_err(|e| e.to_string())?;
    helper(&conn).and_then(|p| p.call::<_, _, ()>("SetFanMode", &(id, json))).map_err(explain)
}

/* ---------- power-profiles-daemon ---------- */

const PPD: [(&str, &str); 2] = [("org.freedesktop.UPower.PowerProfiles", "/org/freedesktop/UPower/PowerProfiles"), ("net.hadess.PowerProfiles", "/net/hadess/PowerProfiles")];

fn ppd(conn: &Connection) -> Option<Proxy<'_>> {
    PPD.iter().find_map(|(name, path)| {
        let p = Proxy::new(conn, *name, *path, *name).ok()?;
        p.get_property::<String>("ActiveProfile").ok().map(|_| p)
    })
}

fn power_profiles(conn: &Connection) -> Option<PowerProfiles> {
    let p = ppd(conn)?;
    let active: String = p.get_property("ActiveProfile").ok()?;
    let list: Vec<std::collections::HashMap<String, OwnedValue>> = p.get_property("Profiles").unwrap_or_default();
    let choices = list.iter().filter_map(|m| m.get("Profile").and_then(|v| v.try_clone().ok()).and_then(|v| String::try_from(v).ok())).collect();
    Some(PowerProfiles { active, choices })
}

pub fn set_power_profile(name: &str) -> Result<(), String> {
    if !["power-saver", "balanced", "performance"].contains(&name) {
        return Err("Profil d'énergie inconnu".into());
    }
    let conn = Connection::system().map_err(|e| e.to_string())?;
    let p = ppd(&conn).ok_or("power-profiles-daemon n'est pas lancé")?;
    p.set_property("ActiveProfile", name).map_err(|e| format!("Changement de profil refusé : {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_on_this_machine() {
        let s = status();
        println!("{:?}\n{:?}", s.helper, s.power_profiles);
        for c in &s.channels {
            println!("  {} {:?} {:?} {:?} tr/min", c.id, c.control, c.mode, c.rpm);
        }
    }
}
