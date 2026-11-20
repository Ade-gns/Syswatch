//! Icône dans la zone de notification : ouvrir SysWatch, basculer le widget compact et
//! l'overlay du mode jeu, quitter. L'info-bulle résume CPU, température et mémoire.

use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Wry};

pub struct Tray {
    pub icon: TrayIcon<Wry>,
    widget: CheckMenuItem<Wry>,
    overlay: CheckMenuItem<Wry>,
}

impl Tray {
    pub fn update(&self, widget: bool, overlay: bool) {
        let _ = self.widget.set_checked(widget);
        let _ = self.overlay.set_checked(overlay);
    }
}

pub fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

pub fn build(app: &AppHandle, widget_on: bool, overlay_on: bool) -> tauri::Result<Tray> {
    let show = MenuItem::with_id(app, "show", "Afficher SysWatch", true, None::<&str>)?;
    let widget = CheckMenuItem::with_id(app, "widget", "Widget compact", true, widget_on, None::<&str>)?;
    let overlay = CheckMenuItem::with_id(app, "overlay", "Overlay du mode jeu", true, overlay_on, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quitter SysWatch", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &PredefinedMenuItem::separator(app)?, &widget, &overlay, &PredefinedMenuItem::separator(app)?, &quit])?;
    let mut b = TrayIconBuilder::with_id("main").tooltip("SysWatch").menu(&menu).show_menu_on_left_click(false);
    if let Some(i) = app.default_window_icon() {
        b = b.icon(i.clone());
    }
    let icon = b
        .on_menu_event(|app, e| match e.id().as_ref() {
            "show" => show_main(app),
            "widget" => crate::toggle_widget(app),
            "overlay" => crate::toggle_overlay(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|t, e| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                show_main(t.app_handle());
            }
        })
        .build(app)?;
    Ok(Tray { icon, widget, overlay })
}
