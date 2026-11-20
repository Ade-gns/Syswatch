//! Échantillonneur adaptatif : un thread qui collecte et émet un `snapshot` à chaque tick.
//! Fenêtre, widget ou overlay visible : intervalle choisi par l'utilisateur. Sinon (fenêtre
//! masquée dans la zone de notification ou réduite) : au moins 5 s, pour rester discret ;
//! les alertes continuent d'être évaluées à chaque mesure (`hook`).

use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::thread;
use std::time::{Duration, Instant};

use syswatch_core::model::Snapshot;
use syswatch_core::Collector;
use tauri::{AppHandle, Emitter, Manager};

const HIDDEN_MIN: Duration = Duration::from_secs(5);

pub enum Ctl {
    Interval(Duration),
    /// Visibilité signalée par l'interface (document.visibilityState).
    Visible(bool),
}

#[derive(Clone)]
pub struct SamplerHandle(Sender<Ctl>);

impl SamplerHandle {
    pub fn send(&self, c: Ctl) {
        let _ = self.0.send(c);
    }
}

/// Traitement appelé après chaque mesure (alertes, info-bulle de l'icône).
pub type Hook = Box<dyn FnMut(&AppHandle, &Snapshot) + Send>;

pub fn spawn(app: AppHandle, mut collector: Collector, interval: Duration, mut hook: Hook) -> SamplerHandle {
    let (tx, rx) = mpsc::channel::<Ctl>();
    thread::Builder::new()
        .name("syswatch-sampler".into())
        .spawn(move || {
            let mut interval = interval;
            let mut doc_visible = true;
            loop {
                let snap = collector.sample();
                if app.emit("snapshot", &snap).is_err() {
                    break; // application en cours de fermeture
                }
                hook(&app, &snap);
                let visible = (doc_visible && window_shown(&app)) || app.get_webview_window(crate::windows::WIDGET).is_some() || app.get_webview_window(crate::windows::OVERLAY).is_some();
                let wait = if visible { interval } else { HIDDEN_MIN.max(interval * 5) };
                let deadline = Instant::now() + wait;
                // Attente interruptible : un changement de réglage ou un retour au premier plan
                // déclenche une mesure immédiate.
                loop {
                    let left = deadline.saturating_duration_since(Instant::now());
                    match rx.recv_timeout(left) {
                        Ok(Ctl::Interval(d)) => {
                            interval = d;
                            break;
                        }
                        Ok(Ctl::Visible(v)) => {
                            let woke = v && !doc_visible;
                            doc_visible = v;
                            if woke {
                                break;
                            }
                        }
                        Err(RecvTimeoutError::Timeout) => break,
                        Err(RecvTimeoutError::Disconnected) => return,
                    }
                }
            }
        })
        .expect("thread d'échantillonnage");
    SamplerHandle(tx)
}

fn window_shown(app: &AppHandle) -> bool {
    app.get_webview_window("main")
        .map(|w| w.is_visible().unwrap_or(true) && !w.is_minimized().unwrap_or(false))
        .unwrap_or(false)
}
