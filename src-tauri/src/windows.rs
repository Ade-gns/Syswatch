//! Fenêtres secondaires : widget compact et overlay du mode jeu (maquette CompactOverlay).
//! Fond translucide, jamais de focus volé, clic traversant, hors barre des tâches.
//!
//! Placement dans un coin de l'écran :
//! - Wayland : protocole layer-shell (KWin, wlroots…) — l'overlay sur la couche « overlay »,
//!   au-dessus des jeux en plein écran ; le widget sur la couche « top » ;
//! - X11 (ou compositeur sans layer-shell) : position calculée sur le moniteur courant.
//! Les fenêtres se dimensionnent elles-mêmes d'après leur contenu (côté interface).

use tauri::{AppHandle, Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::config::Settings;

pub const WIDGET: &str = "widget";
pub const OVERLAY: &str = "overlay";
/// Écart au bord : la marge intérieure de la page (20 px, place de l'ombre) suffit.
const MARGIN: i32 = 0;

/// Crée, déplace ou ferme le widget et l'overlay selon les réglages.
pub fn apply(app: &AppHandle, s: &Settings, overlay_shown: bool) {
    sync(app, WIDGET, s.widget.enabled, &s.widget.corner, false, s.widget.on_top);
    sync(app, OVERLAY, s.overlay.enabled && overlay_shown, &s.overlay.corner, true, true);
}

fn sync(app: &AppHandle, label: &str, want: bool, corner: &str, overlay: bool, on_top: bool) {
    match (app.get_webview_window(label), want) {
        (Some(w), false) => {
            let _ = w.destroy();
        }
        (None, true) => {
            if let Err(e) = create(app, label, corner, overlay, on_top) {
                log::warn!("fenêtre {label} : {e}");
            }
        }
        (Some(w), true) => {
            let _ = w.set_always_on_top(on_top);
            place(&w, corner, overlay);
        }
        (None, false) => {}
    }
}

fn create(app: &AppHandle, label: &str, corner: &str, overlay: bool, on_top: bool) -> tauri::Result<()> {
    let w = WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html".into()))
        .title(if overlay { "SysWatch — overlay" } else { "SysWatch — widget" })
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .skip_taskbar(true)
        .always_on_top(on_top)
        .focusable(false)
        .focused(false)
        .visible(false)
        .inner_size(320.0, 60.0)
        .build()?;
    #[cfg(target_os = "linux")]
    let layered = layer_shell(&w, overlay);
    #[cfg(not(target_os = "linux"))]
    let layered = false;
    place_with(&w, corner, overlay, layered);
    w.show()?;
    // Clic traversant : la fenêtre n'intercepte ni souris ni clavier.
    w.set_ignore_cursor_events(true)?;
    Ok(())
}

#[cfg(target_os = "linux")]
fn layer_shell(w: &WebviewWindow, overlay: bool) -> bool {
    use gtk::prelude::*;
    use gtk_layer_shell::{KeyboardMode, Layer, LayerShell};
    if !gtk_layer_shell::is_supported() {
        return false;
    }
    let Ok(gw) = w.gtk_window() else { return false };
    // Le protocole doit être activé avant que la surface n'existe.
    if gw.is_realized() {
        gw.unrealize();
    }
    gw.init_layer_shell();
    gw.set_layer(if overlay { Layer::Overlay } else { Layer::Top });
    gw.set_namespace(if overlay { "syswatch-overlay" } else { "syswatch-widget" });
    gw.set_keyboard_mode(KeyboardMode::None);
    let ok = gw.is_layer_window();
    if !ok {
        log::warn!("layer-shell indisponible pour la fenêtre {}", w.label());
    }
    ok
}

fn is_layer(w: &WebviewWindow) -> bool {
    #[cfg(target_os = "linux")]
    {
        {
            use gtk_layer_shell::LayerShell;
            w.gtk_window().is_ok_and(|g| g.is_layer_window())
        }
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = w;
        false
    }
}

fn place(w: &WebviewWindow, corner: &str, overlay: bool) {
    place_with(w, corner, overlay, is_layer(w));
}

fn place_with(w: &WebviewWindow, corner: &str, _overlay: bool, layered: bool) {
    let top = corner.starts_with('h');
    let left = corner.ends_with('g');
    #[cfg(target_os = "linux")]
    if layered {
        use gtk_layer_shell::{Edge, LayerShell};
        if let Ok(gw) = w.gtk_window() {
            for (edge, on) in [(Edge::Top, top), (Edge::Bottom, !top), (Edge::Left, left), (Edge::Right, !left)] {
                gw.set_anchor(edge, on);
                gw.set_layer_shell_margin(edge, if on { MARGIN } else { 0 });
            }
        }
        return;
    }
    let _ = layered;
    // X11 : coin du moniteur courant, recalculé quand la fenêtre change de taille.
    let (Ok(Some(m)), Ok(size)) = (w.current_monitor(), w.outer_size()) else { return };
    let (mp, ms) = (m.position(), m.size());
    let x = if left { mp.x + MARGIN } else { mp.x + ms.width as i32 - size.width as i32 - MARGIN };
    let y = if top { mp.y + MARGIN } else { mp.y + ms.height as i32 - size.height as i32 - MARGIN };
    let _ = w.set_position(PhysicalPosition::new(x, y));
}

/// Appelé par l'interface après redimensionnement : replace la fenêtre dans son coin (X11).
pub fn replace(app: &AppHandle, label: &str, s: &Settings) {
    if let Some(w) = app.get_webview_window(label) {
        let (corner, overlay) = if label == OVERLAY { (&s.overlay.corner, true) } else { (&s.widget.corner, false) };
        place(&w, corner, overlay);
    }
}
