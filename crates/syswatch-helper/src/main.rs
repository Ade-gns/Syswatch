//! syswatch-helper — service privilégié minimal de SysWatch.
//!
//! - Lancé à la demande par D-Bus (service systemd `syswatch-helper`), jamais l'application.
//! - Une seule fonction : piloter les ventilateurs hwmon. Pas de shell, pas de chemin reçu
//!   du client : il n'accepte qu'un identifiant de canal qu'il a découvert lui-même.
//! - Chaque écriture est autorisée par polkit (action `dev.syswatch.fan-control`).
//! - Garde-fous : vitesse plancher, pleine vitesse au-delà de 90 °C ou si la température
//!   devient illisible, et retour au firmware à l'arrêt (SIGTERM, inactivité, erreur).
//! - Reste actif tant qu'un mode non automatique est appliqué (la courbe continue de
//!   tourner quand l'application est fermée), puis s'arrête après 60 s d'inactivité.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use syswatch_fans::{self as fans, Control, FanChannel, Mode};
use zbus::zvariant::Value;
use zbus::{fdo, interface, message::Header};

const BUS_NAME: &str = "dev.syswatch.Helper1";
const OBJECT: &str = "/dev/syswatch/Helper1";
const ACTION: &str = "dev.syswatch.fan-control";
const TICK: Duration = Duration::from_secs(2);
const IDLE_EXIT: Duration = Duration::from_secs(60);

static STOP: AtomicBool = AtomicBool::new(false);

extern "C" fn on_signal(_: libc::c_int) {
    STOP.store(true, Ordering::SeqCst);
}

struct Shared {
    channels: Vec<FanChannel>,
    modes: HashMap<String, Mode>,
    cpu_temp: Option<PathBuf>,
    last_activity: Instant,
}

impl Shared {
    fn channel(&self, id: &str) -> Option<&FanChannel> {
        self.channels.iter().find(|c| c.id == id)
    }

    fn busy(&self) -> bool {
        self.modes.values().any(|m| *m != Mode::Auto)
    }
}

fn write(p: &Path, v: impl ToString) -> std::io::Result<()> {
    fs::write(p, v.to_string())
}

/// Rend un canal au firmware : valeur d'enable d'origine, ou 2 (automatique) à défaut.
fn restore(c: &FanChannel) {
    let v = match c.original_enable {
        Some(v) if v >= 2 => v,
        _ => 2,
    };
    if let Err(e) = write(&c.enable, v) {
        eprintln!("{} : retour au mode automatique impossible ({e})", c.id);
    }
}

fn apply_pct(c: &FanChannel, pct: u8) -> std::io::Result<()> {
    let pwm = c.pwm.as_ref().ok_or_else(|| std::io::Error::other("canal sans consigne pwm"))?;
    if c.enable_value() != Some(1) {
        write(&c.enable, 1)?;
    }
    write(pwm, fans::pct_to_pwm(pct))
}

/// Applique immédiatement un mode (les modes manuel et courbe sont ensuite entretenus par la boucle).
fn apply(c: &FanChannel, mode: &Mode, temp: Option<f32>) -> Result<(), String> {
    let r = match mode {
        Mode::Auto => {
            restore(c);
            Ok(())
        }
        Mode::Max => write(&c.enable, 0).or_else(|e| if c.control == Control::Full { apply_pct(c, 100) } else { Err(e) }),
        Mode::Manual { pct } => apply_pct(c, fans::safe_pct(*pct as f32, temp)),
        Mode::Curve { curve } => apply_pct(c, fans::safe_pct(curve.at(temp.unwrap_or(fans::SAFETY_C)), temp)),
    };
    r.map_err(|e| format!("Écriture refusée par le pilote {} : {e}", c.chip))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ChannelState<'a> {
    #[serde(flatten)]
    channel: &'a FanChannel,
    mode: &'a Mode,
    rpm: Option<u32>,
    pct: Option<f32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct State<'a> {
    version: &'static str,
    channels: Vec<ChannelState<'a>>,
    cpu_temp_c: Option<f32>,
}

struct Helper {
    shared: Arc<Mutex<Shared>>,
}

/// Vérifie auprès de polkit que l'appelant peut piloter les ventilateurs.
async fn authorize(conn: &zbus::Connection, hdr: &Header<'_>) -> fdo::Result<()> {
    let sender = hdr.sender().ok_or_else(|| fdo::Error::AccessDenied("Appelant inconnu".into()))?.to_string();
    let proxy = zbus::Proxy::new(conn, "org.freedesktop.PolicyKit1", "/org/freedesktop/PolicyKit1/Authority", "org.freedesktop.PolicyKit1.Authority")
        .await
        .map_err(|e| fdo::Error::Failed(format!("polkit indisponible : {e}")))?;
    let subject = ("system-bus-name", HashMap::from([("name", Value::from(sender.as_str()))]));
    let details: HashMap<&str, &str> = HashMap::new();
    // Drapeau 1 = AllowUserInteraction : polkit peut demander le mot de passe si la règle l'exige.
    let (ok, _challenge, _): (bool, bool, HashMap<String, String>) = proxy
        .call("CheckAuthorization", &(subject, ACTION, details, 1u32, ""))
        .await
        .map_err(|e| fdo::Error::Failed(format!("Vérification polkit impossible : {e}")))?;
    if ok { Ok(()) } else { Err(fdo::Error::AccessDenied("Pilotage des ventilateurs non autorisé par polkit".into())) }
}

#[interface(name = "dev.syswatch.Helper1")]
impl Helper {
    #[zbus(property)]
    fn version(&self) -> String {
        env!("CARGO_PKG_VERSION").into()
    }

    /// État des canaux (lecture seule, sans autorisation), en JSON.
    fn get_state(&self) -> String {
        let mut s = self.shared.lock().unwrap();
        s.last_activity = Instant::now();
        let temp = s.cpu_temp.as_deref().and_then(fans::read_temp);
        let auto = Mode::Auto;
        let state = State {
            version: env!("CARGO_PKG_VERSION"),
            channels: s.channels.iter().map(|c| ChannelState { channel: c, mode: s.modes.get(&c.id).unwrap_or(&auto), rpm: c.rpm(), pct: c.pct() }).collect(),
            cpu_temp_c: temp,
        };
        serde_json::to_string(&state).unwrap_or_else(|_| "{}".into())
    }

    /// Applique un mode (JSON de `syswatch_fans::Mode`) au canal `id`.
    async fn set_fan_mode(&self, #[zbus(header)] hdr: Header<'_>, #[zbus(connection)] conn: &zbus::Connection, id: String, mode: String) -> fdo::Result<()> {
        authorize(conn, &hdr).await?;
        let mode: Mode = serde_json::from_str(&mode).map_err(|e| fdo::Error::InvalidArgs(format!("Mode invalide : {e}")))?;
        let mut s = self.shared.lock().unwrap();
        s.last_activity = Instant::now();
        let c = s.channel(&id).ok_or_else(|| fdo::Error::InvalidArgs(format!("Canal inconnu : {id}")))?.clone();
        match &mode {
            Mode::Manual { .. } | Mode::Curve { .. } if c.control != Control::Full => {
                return Err(fdo::Error::NotSupported(format!("Le pilote {} ne permet que les modes automatique et pleine vitesse", c.chip)));
            }
            Mode::Curve { curve } => curve.validate().map_err(fdo::Error::InvalidArgs)?,
            _ => {}
        }
        let temp = s.cpu_temp.as_deref().and_then(fans::read_temp);
        apply(&c, &mode, temp).map_err(fdo::Error::Failed)?;
        eprintln!("{id} : mode {mode:?}");
        s.modes.insert(id, mode);
        Ok(())
    }

    /// Rend tous les canaux au firmware.
    async fn reset(&self, #[zbus(header)] hdr: Header<'_>, #[zbus(connection)] conn: &zbus::Connection) -> fdo::Result<()> {
        authorize(conn, &hdr).await?;
        let mut s = self.shared.lock().unwrap();
        s.channels.iter().for_each(restore);
        s.modes.clear();
        s.last_activity = Instant::now();
        Ok(())
    }
}

/// Entretient les modes manuel et courbe (garde-fou de température compris).
fn control_loop(shared: Arc<Mutex<Shared>>) {
    while !STOP.load(Ordering::SeqCst) {
        {
            let s = shared.lock().unwrap();
            let temp = s.cpu_temp.as_deref().and_then(fans::read_temp);
            for c in &s.channels {
                let target = match s.modes.get(&c.id) {
                    Some(Mode::Manual { pct }) => fans::safe_pct(*pct as f32, temp),
                    Some(Mode::Curve { curve }) => fans::safe_pct(curve.at(temp.unwrap_or(fans::SAFETY_C)), temp),
                    _ => continue,
                };
                if let Err(e) = apply_pct(c, target) {
                    eprintln!("{} : consigne {target} % refusée ({e})", c.id);
                }
            }
        }
        thread::sleep(TICK);
    }
}

fn main() {
    // SAFETY: getuid n'a pas d'effet de bord.
    if unsafe { libc::getuid() } != 0 {
        eprintln!("syswatch-helper doit être lancé par systemd en root (voir packaging/).");
        std::process::exit(1);
    }
    // SAFETY: le gestionnaire ne fait qu'écrire un booléen atomique.
    unsafe {
        libc::signal(libc::SIGTERM, on_signal as extern "C" fn(libc::c_int) as libc::sighandler_t);
        libc::signal(libc::SIGINT, on_signal as extern "C" fn(libc::c_int) as libc::sighandler_t);
    }
    let root = Path::new(fans::HWMON);
    let shared = Arc::new(Mutex::new(Shared { channels: fans::discover(root), modes: HashMap::new(), cpu_temp: fans::cpu_temp_path(root), last_activity: Instant::now() }));
    {
        let s = shared.lock().unwrap();
        eprintln!("syswatch-helper {} : {} canal(aux) pilotable(s), sonde CPU {:?}", env!("CARGO_PKG_VERSION"), s.channels.len(), s.cpu_temp);
    }

    let _conn = match zbus::blocking::connection::Builder::system()
        .and_then(|b| b.name(BUS_NAME))
        .and_then(|b| b.serve_at(OBJECT, Helper { shared: Arc::clone(&shared) }))
        .and_then(|b| b.build())
    {
        Ok(c) => c,
        Err(e) => {
            eprintln!("Connexion au bus système impossible : {e}");
            std::process::exit(1);
        }
    };

    let loop_shared = Arc::clone(&shared);
    thread::spawn(move || control_loop(loop_shared));

    loop {
        thread::sleep(Duration::from_secs(1));
        let s = shared.lock().unwrap();
        if STOP.load(Ordering::SeqCst) || (!s.busy() && s.last_activity.elapsed() > IDLE_EXIT) {
            break;
        }
    }
    STOP.store(true, Ordering::SeqCst);
    let s = shared.lock().unwrap();
    s.channels.iter().filter(|c| s.modes.get(&c.id).is_some_and(|m| *m != Mode::Auto)).for_each(restore);
    eprintln!("syswatch-helper : arrêt, ventilateurs rendus au firmware");
}

#[cfg(test)]
mod tests {
    use super::*;
    use syswatch_fans::Curve;

    fn fake(dir: &Path, with_pwm: bool) -> FanChannel {
        fs::create_dir_all(dir).unwrap();
        fs::write(dir.join("name"), "test").unwrap();
        fs::write(dir.join("pwm1_enable"), "5").unwrap();
        if with_pwm {
            fs::write(dir.join("pwm1"), "128").unwrap();
        }
        fans::discover(dir.parent().unwrap()).remove(0)
    }

    fn read(p: &Path) -> String {
        fs::read_to_string(p).unwrap().trim().to_owned()
    }

    #[test]
    fn modes_write_expected_values_and_restore() {
        let root = std::env::temp_dir().join(format!("swhelper-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let c = fake(&root.join("a/hwmon0"), true);
        let pwm = c.pwm.clone().unwrap();

        apply(&c, &Mode::Manual { pct: 35 }, Some(50.0)).unwrap();
        assert_eq!((read(&c.enable).as_str(), read(&pwm).as_str()), ("1", "89"));

        // Plancher de sécurité, puis pleine vitesse au-delà de 90 °C ou sans température.
        apply(&c, &Mode::Manual { pct: 5 }, Some(50.0)).unwrap();
        assert_eq!(read(&pwm), fans::pct_to_pwm(fans::MIN_PCT).to_string());
        apply(&c, &Mode::Curve { curve: Curve::preset("silencieux").unwrap() }, Some(95.0)).unwrap();
        assert_eq!(read(&pwm), "255");
        apply(&c, &Mode::Curve { curve: Curve::preset("jeu").unwrap() }, None).unwrap();
        assert_eq!(read(&pwm), "255");

        apply(&c, &Mode::Max, Some(50.0)).unwrap();
        assert_eq!(read(&c.enable), "0");
        apply(&c, &Mode::Auto, Some(50.0)).unwrap();
        assert_eq!(read(&c.enable), "5", "valeur d'origine restaurée");

        let e = fake(&root.join("b/hwmon0"), false);
        assert_eq!(e.control, Control::EnableOnly);
        assert!(apply_pct(&e, 50).is_err(), "pas de consigne sans pwm");
        fs::remove_dir_all(&root).unwrap();
    }
}
