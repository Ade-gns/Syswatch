//! Alertes : comparaison de chaque mesure aux seuils réglés dans la page Alertes, avec
//! anti-rebond (le dépassement doit durer) et hystérésis (on ne revient à « Normal » que
//! nettement sous le seuil), puis notification de bureau via D-Bus
//! (org.freedesktop.Notifications, local). Une alerte tient en une ligne :
//! la grandeur, la valeur, l'heure — « Disque /home à 91 % », « SSD NVMe à 69 °C ».

use std::collections::HashMap;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::model::{SensorKind, Snapshot};

const HISTORY: usize = 200;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Level {
    Ok,
    Warn,
    Crit,
}

/// Un seuil réglable : « cpuTemp », « gpuTemp », « ssdTemp », « ram », « disk ».
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlertRule {
    pub id: String,
    pub enabled: bool,
    pub warn: f32,
    pub crit: f32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AlertSettings {
    /// Notifications de bureau pour les alertes critiques.
    pub notify: bool,
    /// Notifier aussi le niveau « Attention » (sinon seulement l'historique).
    pub notify_warn: bool,
    pub rules: Vec<AlertRule>,
}

impl Default for AlertSettings {
    fn default() -> Self {
        // Seuils du design (README, « Jauges et seuils »).
        let r = |id: &str, warn, crit| AlertRule { id: id.into(), enabled: true, warn, crit };
        Self { notify: true, notify_warn: false, rules: vec![r("cpuTemp", 80.0, 90.0), r("gpuTemp", 80.0, 90.0), r("ssdTemp", 65.0, 75.0), r("ram", 75.0, 90.0), r("disk", 80.0, 90.0)] }
    }
}

impl AlertSettings {
    /// Bornes sûres, règles manquantes complétées, seuil critique ≥ seuil d'attention.
    pub fn sanitized(mut self) -> Self {
        let defaults = Self::default();
        let mut rules = Vec::new();
        for d in defaults.rules {
            let mut r = self.rules.iter().find(|r| r.id == d.id).cloned().unwrap_or(d);
            let max = if r.id.ends_with("Temp") { 110.0 } else { 100.0 };
            r.warn = r.warn.clamp(1.0, max);
            r.crit = r.crit.clamp(r.warn, max);
            rules.push(r);
        }
        self.rules = rules;
        self
    }

    fn rule(&self, id: &str) -> Option<&AlertRule> {
        self.rules.iter().find(|r| r.id == id && r.enabled)
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlertEvent {
    pub seq: u64,
    /// Clé de la mesure (« disk:/home »), pour regrouper.
    pub key: String,
    pub rule: String,
    pub level: Level,
    /// « Disque /home à 91 % ».
    pub text: String,
    pub value: f32,
    /// Secondes depuis l'époque Unix.
    pub t: u64,
}

struct Track {
    /// Niveau confirmé (notifié).
    level: Level,
    /// Niveau candidat et depuis quand il dure.
    pending: Option<(Level, Instant)>,
}

pub struct AlertEngine {
    tracks: HashMap<String, Track>,
    seq: u64,
    pub history: Vec<AlertEvent>,
    pub unread: u32,
}

impl Default for AlertEngine {
    fn default() -> Self {
        Self::new()
    }
}

/// Durée minimale d'un dépassement avant alerte, et marge de retour à la normale.
fn timing(rule: &str) -> (Duration, f32) {
    match rule {
        "ram" => (Duration::from_secs(10), 2.0),
        "disk" => (Duration::ZERO, 1.0),
        _ => (Duration::from_secs(5), 3.0),
    }
}

impl AlertEngine {
    pub fn new() -> Self {
        Self { tracks: HashMap::new(), seq: 0, history: Vec::new(), unread: 0 }
    }

    /// Évalue une mesure ; renvoie les nouvelles alertes (montées de niveau confirmées).
    pub fn evaluate(&mut self, s: &Snapshot, cfg: &AlertSettings, fahrenheit: bool) -> Vec<AlertEvent> {
        let now = Instant::now();
        let mut out = Vec::new();
        for (key, rule_id, label, value, temp) in measures(s) {
            let Some(rule) = cfg.rule(rule_id) else {
                self.tracks.remove(&key);
                continue;
            };
            let (hold, margin) = timing(rule_id);
            let track = self.tracks.entry(key.clone()).or_insert(Track { level: Level::Ok, pending: None });
            let raw = if value >= rule.crit { Level::Crit } else if value >= rule.warn { Level::Warn } else { Level::Ok };
            // Hystérésis : on ne redescend que sous (seuil − marge).
            let target = match track.level {
                Level::Crit if value >= rule.crit - margin => Level::Crit,
                Level::Warn | Level::Crit if raw < Level::Warn && value >= rule.warn - margin => Level::Warn,
                _ => raw,
            };
            if target <= track.level {
                track.pending = None;
                track.level = target; // descente immédiate (avec hystérésis)
                continue;
            }
            let since = match track.pending {
                Some((l, t)) if l == target => t,
                _ => {
                    track.pending = Some((target, now));
                    now
                }
            };
            if now.duration_since(since) >= hold {
                track.level = target;
                track.pending = None;
                self.seq += 1;
                let v = if temp { format_temp(value, fahrenheit) } else { format!("{}\u{a0}%", value.round()) };
                out.push(AlertEvent {
                    seq: self.seq,
                    key: key.clone(),
                    rule: rule_id.into(),
                    level: target,
                    text: format!("{label} à {v}"),
                    value,
                    t: SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0),
                });
            }
        }
        for e in &out {
            self.history.insert(0, e.clone());
            self.unread += 1;
        }
        self.history.truncate(HISTORY);
        out
    }
}

fn format_temp(c: f32, fahrenheit: bool) -> String {
    if fahrenheit { format!("{}\u{a0}°F", (c * 1.8 + 32.0).round()) } else { format!("{}\u{a0}°C", c.round()) }
}

/// (clé, règle, libellé, valeur, est une température) pour chaque grandeur surveillée.
fn measures(s: &Snapshot) -> Vec<(String, &'static str, String, f32, bool)> {
    let mut v = Vec::new();
    if let Some(t) = s.cpu.temp_c {
        v.push(("cpuTemp".into(), "cpuTemp", "CPU".into(), t, true));
    }
    if let Some(t) = s.gpus.iter().filter_map(|g| g.temp_c).reduce(f32::max) {
        v.push(("gpuTemp".into(), "gpuTemp", "GPU".into(), t, true));
    }
    let ssd = s.sensors.iter().filter(|x| x.kind == SensorKind::Ssd).map(|x| x.value_c).chain(s.disks.iter().filter_map(|d| d.temp_c)).reduce(f32::max);
    if let Some(t) = ssd {
        v.push(("ssdTemp".into(), "ssdTemp", "SSD".into(), t, true));
    }
    if s.memory.total > 0 {
        v.push(("ram".into(), "ram", "Mémoire".into(), s.memory.used as f32 / s.memory.total as f32 * 100.0, false));
    }
    for d in &s.disks {
        for m in &d.mounts {
            if m.total == 0 || m.fstype == "vfat" {
                continue; // partition EFI : pleine par nature, sans intérêt
            }
            let target = m.targets.iter().find(|t| *t == "/home").or(m.targets.first()).cloned().unwrap_or_default();
            v.push((format!("disk:{target}"), "disk", format!("Disque {target}"), m.used as f32 / m.total as f32 * 100.0, false));
        }
    }
    v
}

/// Notification de bureau (serveur de notifications de la session, D-Bus local).
pub fn notify(e: &AlertEvent) {
    let (title, urgency) = match e.level {
        Level::Crit => ("SysWatch · Critique", 2u8),
        _ => ("SysWatch · Attention", 1u8),
    };
    let body = e.text.clone();
    std::thread::spawn(move || {
        let r = (|| -> zbus::Result<()> {
            let conn = zbus::blocking::Connection::session()?;
            let p = zbus::blocking::Proxy::new(&conn, "org.freedesktop.Notifications", "/org/freedesktop/Notifications", "org.freedesktop.Notifications")?;
            let mut hints: HashMap<&str, zbus::zvariant::Value> = HashMap::new();
            hints.insert("urgency", urgency.into());
            hints.insert("desktop-entry", "syswatch".into());
            let actions: Vec<&str> = Vec::new();
            p.call::<_, _, u32>("Notify", &("SysWatch", 0u32, "dialog-warning", title, body.as_str(), actions, hints, -1i32))?;
            Ok(())
        })();
        if let Err(err) = r {
            log::warn!("notification impossible : {err}");
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{CpuSnapshot, MemorySnapshot};

    fn snap(cpu_t: f32, ram_pct: f32) -> Snapshot {
        Snapshot { cpu: CpuSnapshot { temp_c: Some(cpu_t), ..Default::default() }, memory: MemorySnapshot { total: 1000, used: (ram_pct * 10.0) as u64, ..Default::default() }, ..Default::default() }
    }

    #[test]
    fn debounce_hysteresis_and_escalation() {
        let cfg = AlertSettings::default();
        let mut e = AlertEngine::new();
        // Pic bref au-dessus de 90 °C : pas d'alerte avant 5 s.
        assert!(e.evaluate(&snap(95.0, 10.0), &cfg, false).is_empty());
        e.tracks.get_mut("cpuTemp").unwrap().pending.as_mut().unwrap().1 -= Duration::from_secs(6);
        let a = e.evaluate(&snap(95.0, 10.0), &cfg, false);
        assert_eq!(a.len(), 1);
        assert_eq!(a[0].text, "CPU à 95\u{a0}°C");
        assert_eq!(a[0].level, Level::Crit);
        // Reste critique dans la marge (88 °C ≥ 90 − 3), pas de nouvelle alerte.
        assert!(e.evaluate(&snap(88.0, 10.0), &cfg, false).is_empty());
        assert_eq!(e.tracks["cpuTemp"].level, Level::Crit);
        // Redescend nettement : niveau Attention puis Normal, sans alerte.
        e.evaluate(&snap(85.0, 10.0), &cfg, false);
        assert_eq!(e.tracks["cpuTemp"].level, Level::Warn);
        e.evaluate(&snap(60.0, 10.0), &cfg, false);
        assert_eq!(e.tracks["cpuTemp"].level, Level::Ok);
        assert_eq!(e.unread, 1);
    }

    #[test]
    fn disk_alert_is_immediate_and_rules_can_be_disabled() {
        let mut cfg = AlertSettings::default();
        let mut e = AlertEngine::new();
        let mut s = snap(40.0, 10.0);
        s.disks.push(crate::model::DiskSnapshot {
            id: "nvme0n1".into(), model: None, size: 0, kind: crate::model::DiskKind::Nvme, removable: false, read_bps: 0.0, write_bps: 0.0, read_total: 0, write_total: 0, temp_c: None,
            mounts: vec![crate::model::MountSnapshot { device: "p2".into(), fstype: "btrfs".into(), targets: vec!["/".into(), "/home".into()], total: 100, used: 91, available: 9 }],
        });
        let a = e.evaluate(&s, &cfg, false);
        assert_eq!(a[0].text, "Disque /home à 91\u{a0}%");
        cfg.rules.iter_mut().for_each(|r| r.enabled = false);
        assert!(e.evaluate(&s, &cfg, false).is_empty());
    }

    #[test]
    fn sanitizes() {
        let s = AlertSettings { rules: vec![AlertRule { id: "ram".into(), enabled: true, warn: 95.0, crit: 50.0 }], ..Default::default() }.sanitized();
        assert_eq!(s.rules.len(), 5);
        let ram = s.rules.iter().find(|r| r.id == "ram").unwrap();
        assert_eq!((ram.warn, ram.crit), (95.0, 95.0));
    }
}
