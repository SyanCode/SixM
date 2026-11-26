//! SixM : interface native. Elle remplace la fenêtre du navigateur et pilote l'application locale
//! (Node.js, app/server.js) par son API : la logique de jeu, d'hébergement et d'installation reste là-bas.
#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

mod api;
mod app;
mod backend;
mod theme;

fn main() -> eframe::Result {
    let icon = theme::window_icon();
    let options = eframe::NativeOptions {
        viewport: eframe::egui::ViewportBuilder::default()
            .with_title("SixM")
            .with_app_id("sixm")
            .with_inner_size([1280.0, 800.0])
            .with_min_inner_size([960.0, 620.0])
            .with_icon(icon),
        ..Default::default()
    };
    eframe::run_native("SixM", options, Box::new(|cc| Ok(Box::new(app::SixmApp::new(cc)))))
}
