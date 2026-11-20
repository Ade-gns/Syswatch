//! Journal minimal sur la sortie d'erreur (visible dans le terminal de `npm run tauri dev`
//! ou dans le journal systemd de la session). Niveau via SYSWATCH_LOG (warn par défaut).

use log::{Level, LevelFilter, Log, Metadata, Record};

struct Stderr;

impl Log for Stderr {
    fn enabled(&self, m: &Metadata) -> bool {
        m.level() <= log::max_level() && m.target().starts_with("sys")
    }
    fn log(&self, r: &Record) {
        if self.enabled(r.metadata()) {
            let lvl = match r.level() {
                Level::Error => "erreur",
                Level::Warn => "attention",
                Level::Info => "info",
                _ => "détail",
            };
            eprintln!("[syswatch {lvl}] {}", r.args());
        }
    }
    fn flush(&self) {}
}

pub fn init() {
    let level = match std::env::var("SYSWATCH_LOG").as_deref() {
        Ok("info") => LevelFilter::Info,
        Ok("debug") => LevelFilter::Debug,
        _ => LevelFilter::Warn,
    };
    if log::set_logger(&Stderr).is_ok() {
        log::set_max_level(level);
    }
}
