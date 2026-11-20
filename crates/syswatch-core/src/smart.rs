//! Santé SMART via udisks2 (D-Bus système), lisible sans droits root : le démon udisksd
//! interroge lui-même le contrôleur NVMe ou ATA. Lecture à la demande (page Disques).
//!
//! Seuils de la table : ceux annoncés par le disque (réserve minimale, seuils ATA,
//! températures d'alerte NVMe). L'usure suit les seuils d'espace disque du design
//! (attention 80 %, critique 100 % = durée de vie nominale atteinte).

use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use zbus::blocking::{Connection, Proxy};
use zbus::zvariant::{OwnedObjectPath, OwnedValue, Value};

const DEST: &str = "org.freedesktop.UDisks2";
const NBSP: char = '\u{a0}';
const THIN: char = '\u{202f}';
/// Le design marque « Attention » à partir de 11 arrêts non sécurisés.
const UNSAFE_SHUTDOWNS_WARN: u64 = 10;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub enum Status {
    Ok,
    Warn,
    Crit,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartAttr {
    pub id: String,
    pub name: String,
    pub value: String,
    pub threshold: String,
    pub status: Status,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartInfo {
    pub available: bool,
    /// Raison de l'indisponibilité, ou précision sur la source.
    pub detail: Option<String>,
    /// « NVMe » ou « ATA ».
    pub protocol: Option<&'static str>,
    pub health: Option<Status>,
    /// Durée de vie restante estimée (NVMe : 100 − pourcentage utilisé).
    pub remaining_pct: Option<f32>,
    pub wear_pct: Option<f32>,
    pub power_on_hours: Option<u64>,
    pub temp_c: Option<f32>,
    pub attributes: Vec<SmartAttr>,
    /// Dernière lecture du disque par udisks2 (secondes depuis l'époque Unix).
    pub updated_s: Option<u64>,
}

impl SmartInfo {
    fn none(why: impl Into<String>) -> Self {
        Self { available: false, detail: Some(why.into()), protocol: None, health: None, remaining_pct: None, wear_pct: None, power_on_hours: None, temp_c: None, attributes: Vec::new(), updated_s: None }
    }
}

/// SMART du disque `id` (« nvme0n1 », « sda »).
pub fn read(id: &str) -> SmartInfo {
    if id.contains('/') {
        return SmartInfo::none("Disque inconnu");
    }
    let Ok(conn) = Connection::system() else { return SmartInfo::none("Bus système D-Bus inaccessible") };
    let path = format!("/org/freedesktop/UDisks2/block_devices/{id}");
    let drive: OwnedObjectPath = match Proxy::new(&conn, DEST, path.as_str(), "org.freedesktop.UDisks2.Block").and_then(|p| p.get_property("Drive")) {
        Ok(d) => d,
        Err(_) => return SmartInfo::none("Service udisks2 indisponible : installez le paquet udisks2 pour lire la santé SMART"),
    };
    if let Ok(p) = Proxy::new(&conn, DEST, drive.as_str(), "org.freedesktop.UDisks2.NVMe.Controller") {
        if let Ok(attrs) = p.call::<_, _, HashMap<String, OwnedValue>>("SmartGetAttributes", &(HashMap::<&str, Value>::new(),)) {
            return nvme(&p, &attrs);
        }
    }
    if let Ok(p) = Proxy::new(&conn, DEST, drive.as_str(), "org.freedesktop.UDisks2.Drive.Ata") {
        if p.get_property::<bool>("SmartSupported").unwrap_or(false) {
            return ata(&p);
        }
    }
    SmartInfo::none("Ce disque ne transmet pas de données SMART (clé USB, adaptateur USB…)")
}

fn get<T: TryFrom<OwnedValue>>(m: &HashMap<String, OwnedValue>, k: &str) -> Option<T> {
    m.get(k).and_then(|v| v.try_clone().ok()).and_then(|v| T::try_from(v).ok())
}

fn now_s() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn nvme(p: &Proxy<'_>, a: &HashMap<String, OwnedValue>) -> SmartInfo {
    let warnings: Vec<String> = p.get_property("SmartCriticalWarning").unwrap_or_default();
    let hours: Option<u64> = p.get_property("SmartPowerOnHours").ok();
    let temp_k: Option<u16> = p.get_property("SmartTemperature").ok().filter(|t: &u16| *t > 0);
    let updated: Option<u64> = p.get_property("SmartUpdated").ok().filter(|t: &u64| *t > 0);
    let spare: Option<u8> = get(a, "avail_spare");
    let spare_thr: Option<u8> = get(a, "spare_thresh");
    let used: Option<u8> = get(a, "percent_used");
    let read: Option<u64> = get(a, "total_data_read");
    let written: Option<u64> = get(a, "total_data_written");
    let cycles: Option<u64> = get(a, "power_cycles");
    let unsafe_sd: Option<u64> = get(a, "unsafe_shutdowns");
    let media: Option<u64> = get(a, "media_errors");
    let errlog: Option<u64> = get(a, "num_err_log_entries");
    let wctemp: Option<u16> = get(a, "wctemp");
    let temp_c = temp_k.map(|k| k as f32 - 273.15);
    let warn_c = wctemp.filter(|t| *t > 0).map(|k| k as f32 - 273.15);

    let mut rows = Vec::new();
    let mut row = |id: &str, name: &str, value: String, thr: String, status: Status| rows.push(SmartAttr { id: id.into(), name: name.into(), value, threshold: thr, status });
    row("00", "Avertissement critique", if warnings.is_empty() { "0".into() } else { warnings.iter().map(|w| warning_fr(w)).collect::<Vec<_>>().join(", ") }, "—".into(), if warnings.is_empty() { Status::Ok } else { Status::Crit });
    if let Some(t) = temp_c {
        row("01", "Température", format!("{}{NBSP}°C", int(t.round() as u64)), warn_c.map_or("—".into(), |w| format!("{}{NBSP}°C", int(w.round() as u64))), if warn_c.is_some_and(|w| t >= w) { Status::Warn } else { Status::Ok });
    }
    if let Some(s) = spare {
        let thr = spare_thr.unwrap_or(0);
        row("03", "Réserve disponible", pct(s as f32), pct(thr as f32), if s < thr { Status::Crit } else { Status::Ok });
    }
    if let Some(u) = used {
        row("05", "Usure (utilisé)", pct(u as f32), pct(100.0), if u >= 100 { Status::Crit } else if u >= 80 { Status::Warn } else { Status::Ok });
    }
    if let Some(r) = read {
        row("20", "Données lues", size(r), "—".into(), Status::Ok);
    }
    if let Some(w) = written {
        row("30", "Données écrites", size(w), "—".into(), Status::Ok);
    }
    if let Some(c) = cycles {
        row("70", "Cycles d’alimentation", int(c), "—".into(), Status::Ok);
    }
    if let Some(h) = hours {
        row("80", "Heures sous tension", format!("{}{NBSP}h", int(h)), "—".into(), Status::Ok);
    }
    if let Some(u) = unsafe_sd {
        row("90", "Arrêts non sécurisés", int(u), "—".into(), if u > UNSAFE_SHUTDOWNS_WARN { Status::Warn } else { Status::Ok });
    }
    if let Some(m) = media {
        row("A0", "Erreurs média", int(m), "—".into(), if m > 0 { Status::Warn } else { Status::Ok });
    }
    if let Some(e) = errlog {
        row("B0", "Entrées du journal d’erreurs", int(e), "—".into(), Status::Ok);
    }

    // Santé globale : les lignes purement informatives (arrêts non sécurisés) n'y comptent pas.
    let health = if !warnings.is_empty() || spare.zip(spare_thr).is_some_and(|(s, t)| s < t) || used.is_some_and(|u| u >= 100) {
        Status::Crit
    } else if used.is_some_and(|u| u >= 80) || media.is_some_and(|m| m > 0) {
        Status::Warn
    } else {
        Status::Ok
    };
    SmartInfo {
        available: true,
        detail: Some("udisks2".into()),
        protocol: Some("NVMe"),
        health: Some(health),
        remaining_pct: used.map(|u| (100 - u.min(100)) as f32),
        wear_pct: used.map(|u| u as f32),
        power_on_hours: hours,
        temp_c,
        attributes: rows,
        updated_s: updated.or(Some(now_s())),
    }
}

type AtaAttr = (u8, String, u16, i32, i32, i32, i64, i32, HashMap<String, OwnedValue>);

fn ata(p: &Proxy<'_>) -> SmartInfo {
    let failing: bool = p.get_property("SmartFailing").unwrap_or(false);
    let secs: Option<u64> = p.get_property("SmartPowerOnSeconds").ok().filter(|s: &u64| *s > 0);
    let temp_k: Option<f64> = p.get_property("SmartTemperature").ok().filter(|t: &f64| *t > 0.0);
    let bad: i64 = p.get_property("SmartNumBadSectors").unwrap_or(0);
    let updated: Option<u64> = p.get_property("SmartUpdated").ok().filter(|t: &u64| *t > 0);
    let attrs: Vec<AtaAttr> = p.call("SmartGetAttributes", &(HashMap::<&str, Value>::new(),)).unwrap_or_default();
    let rows = attrs
        .into_iter()
        .map(|(id, name, _flags, value, worst, thr, pretty, unit, _)| {
            let status = if thr > 0 && value >= 0 && value <= thr {
                Status::Crit
            } else if (thr > 0 && worst >= 0 && worst <= thr) || ([5, 197, 198].contains(&id) && pretty > 0) {
                Status::Warn
            } else {
                Status::Ok
            };
            let v = match unit {
                2 => format!("{}{NBSP}h", int((pretty / 3_600_000).max(0) as u64)),
                3 => format!("{} secteurs", int(pretty.max(0) as u64)),
                4 => format!("{}{NBSP}°C", int(((pretty as f64 / 1000.0) - 273.15).round().max(0.0) as u64)),
                _ => int(pretty.max(0) as u64),
            };
            SmartAttr { id: format!("{id:02X}"), name: ata_name(&name), value: v, threshold: if thr > 0 { thr.to_string() } else { "—".into() }, status }
        })
        .collect();
    let health = if failing { Status::Crit } else if bad > 0 { Status::Warn } else { Status::Ok };
    SmartInfo {
        available: true,
        detail: Some("udisks2".into()),
        protocol: Some("ATA"),
        health: Some(health),
        remaining_pct: None,
        wear_pct: None,
        power_on_hours: secs.map(|s| s / 3600),
        temp_c: temp_k.map(|k| (k - 273.15) as f32),
        attributes: rows,
        updated_s: updated.or(Some(now_s())),
    }
}

fn warning_fr(w: &str) -> String {
    match w {
        "spare" => "réserve épuisée",
        "temperature" => "température",
        "degraded" => "fiabilité dégradée",
        "readonly" => "lecture seule",
        "volatile_mem" => "mémoire de secours",
        "pmr_readonly" => "PMR en lecture seule",
        other => other,
    }
    .to_owned()
}

/// Noms d'attributs ATA courants en français ; les autres gardent le nom du fabricant.
fn ata_name(n: &str) -> String {
    match n {
        "raw-read-error-rate" => "Erreurs de lecture",
        "spin-up-time" => "Temps de démarrage",
        "start-stop-count" => "Démarrages/arrêts",
        "reallocated-sector-count" => "Secteurs réalloués",
        "seek-error-rate" => "Erreurs de positionnement",
        "power-on-hours" => "Heures sous tension",
        "power-cycle-count" => "Cycles d’alimentation",
        "temperature-celsius-2" | "temperature-celsius" | "airflow-temperature-celsius" => "Température",
        "current-pending-sector" => "Secteurs en attente",
        "offline-uncorrectable" => "Secteurs irrécupérables",
        "udma-crc-error-count" => "Erreurs CRC (câble)",
        "power-off-retract-count" => "Arrêts brusques",
        "unsafe-shutdown-count" => "Arrêts non sécurisés",
        "wear-leveling-count" => "Nivellement d’usure",
        "total-lbas-written" => "Données écrites",
        "total-lbas-read" => "Données lues",
        other => other,
    }
    .to_owned()
}

/// Entier avec espace fine entre les milliers : « 4 212 ».
fn int(n: u64) -> String {
    let s = n.to_string();
    let mut out = String::new();
    for (i, c) in s.chars().enumerate() {
        if i > 0 && (s.len() - i) % 3 == 0 {
            out.push(THIN);
        }
        out.push(c);
    }
    out
}

fn pct(v: f32) -> String {
    format!("{}{NBSP}%", int(v.round() as u64))
}

/// Octets en To / Go avec virgule décimale (unités décimales, comme les fabricants).
fn size(b: u64) -> String {
    let (v, u) = if b >= 1_000_000_000_000 { (b as f64 / 1e12, "To") } else { (b as f64 / 1e9, "Go") };
    format!("{}{NBSP}{u}", format!("{v:.1}").replace('.', ","))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats() {
        assert_eq!(int(4212), "4\u{202f}212");
        assert_eq!(int(12), "12");
        assert_eq!(size(26_100_591_616_000), "26,1\u{a0}To");
    }

    #[test]
    fn reads_this_machine() {
        let s = read("nvme0n1");
        println!("{:?} {:?} restant {:?} {:?} h", s.protocol, s.health, s.remaining_pct, s.power_on_hours);
        for a in &s.attributes {
            println!("  {} {:<30} {:>12} {:>8} {:?}", a.id, a.name, a.value, a.threshold, a.status);
        }
        if !s.available {
            println!("indisponible : {:?}", s.detail);
        }
    }
}
