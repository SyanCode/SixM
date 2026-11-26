//! Installation du portage choisi (VIctory ou un fork) et jeu lancé par SixM.

use super::{Job, SixmApp};
use crate::theme::{self, ic, Kind, ACCENT, GREEN, MUTED, RED, TEXT};
use eframe::egui::{self, vec2, Align, Layout, RichText, Ui};
use serde_json::json;

const TOOLS: [(&str, &str, &str); 3] = [
    ("git", "Installer Git ?", "Git télécharge le code du portage. Installation avec winget, environ 350 Mo."),
    ("rust", "Installer Rust ?", "Rust compile le portage. Installation avec winget, environ 1 Go."),
    (
        "msvc",
        "Installer les outils C++ de Microsoft ?",
        "Visual Studio Build Tools 2022, plusieurs Go. Windows demandera une autorisation d'administrateur, et l'installation vaut acceptation de la licence Microsoft.",
    ),
];

fn short(sha: &str) -> &str {
    &sha[..sha.len().min(10)]
}

/// Journal en police fixe, collé en bas.
pub fn log_box(ui: &mut Ui, id: &str, lines: &[String], height: f32) {
    egui::Frame::new()
        .fill(egui::Color32::from_rgb(9, 10, 13))
        .stroke(egui::Stroke::new(1.0, theme::LINE))
        .corner_radius(6)
        .inner_margin(12)
        .show(ui, |ui| {
            egui::ScrollArea::vertical().id_salt(id).max_height(height).min_scrolled_height(height).stick_to_bottom(true).auto_shrink([false, false]).show(ui, |ui| {
                if lines.is_empty() {
                    ui.label(RichText::new("…").font(theme::mono(12.5)).color(theme::DIM));
                }
                for l in lines {
                    ui.add(egui::Label::new(RichText::new(l).font(theme::mono(12.5)).color(egui::Color32::from_rgb(190, 196, 206))).wrap());
                }
            });
        });
}

impl SixmApp {
    pub fn victory_panel(&mut self, ui: &mut Ui, with_later: bool) {
        let v = self.st.victory.clone();
        let running = v.status == "running";
        let ready = v.checks.as_ref().map(|c| c.iter().all(|c| c.ok));
        theme::card().show(ui, |ui| {
            ui.set_width(ui.available_width());
            ui.horizontal(|ui| {
                let (r, _) = ui.allocate_exact_size(vec2(46.0, 46.0), egui::Sense::hover());
                ui.painter().rect_filled(r, 8, ACCENT.gamma_multiply(0.14));
                ui.painter().text(r.center(), egui::Align2::CENTER_CENTER, ic::WRENCH, theme::f(22.0), ACCENT);
                ui.add_space(6.0);
                ui.vertical(|ui| {
                    let name = if v.name.is_empty() { "VIctory".to_string() } else { v.name.clone() };
                    ui.label(theme::title(if v.installed.is_some() { name.clone() } else { format!("Installer {name}") }, 18.0));
                    let text = match &v.installed {
                        Some(i) => format!(
                            "Version {}. {}",
                            short(&i.commit),
                            if v.module_stale { "Le module multijoueur a changé : recompilez pour l'avoir." } else { "Module multijoueur inclus." }
                        ),
                        None => format!(
                            "SixM télécharge le code public de {name} ({}, {}) et le compile sur ce PC. Aucun fichier de jeu n'est fourni.",
                            v.repo.trim_start_matches("https://github.com/").trim_end_matches(".git"),
                            v.pinned.as_deref().map(|p| format!("version {}", short(p))).unwrap_or_else(|| "dernière version".into())
                        ),
                    };
                    ui.add(egui::Label::new(theme::muted(text)).wrap());
                });
            });

            let show_checks = !running && !(v.valid && ready != Some(false)) && v.checks.is_some();
            if show_checks {
                ui.add_space(8.0);
                for c in v.checks.clone().unwrap_or_default() {
                    ui.horizontal(|ui| {
                        ui.label(RichText::new(if c.ok { ic::CHECK_CIRCLE } else { ic::X_CIRCLE }).size(18.0).color(if c.ok { GREEN } else { RED }));
                        ui.label(theme::strong(&c.name, 14.0));
                        ui.label(theme::muted(&c.detail));
                        ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                            if !c.ok {
                                if c.id == "disk" {
                                    if theme::button(ui, Kind::Normal, "", "Libérer de l'espace").clicked() {
                                        self.post("/api/victory/storage", json!({}));
                                    }
                                } else if theme::button(ui, Kind::Normal, ic::DOWNLOAD_SIMPLE, "Installer").clicked() {
                                    if let Some((id, title, text)) = TOOLS.iter().find(|t| t.0 == c.id) {
                                        let id = id.to_string();
                                        self.confirm(title, text, "Installer", Box::new(move |app: &mut SixmApp| app.post("/api/victory/tool", json!({ "id": id }))));
                                    }
                                }
                            }
                        });
                    });
                }
            }

            if running {
                ui.add_space(10.0);
                ui.horizontal(|ui| {
                    ui.label(theme::strong(&v.step, 14.0));
                    ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                        if theme::button(ui, Kind::Danger, "", "Annuler").clicked() {
                            self.post("/api/victory/cancel", json!({}));
                        }
                        if let Some(p) = v.progress {
                            ui.label(theme::muted(format!("{} %", (p * 100.0).round())));
                        }
                    });
                });
                let (r, _) = ui.allocate_exact_size(vec2(ui.available_width(), 6.0), egui::Sense::hover());
                match v.progress {
                    Some(p) => theme::meter(ui, r, p as f32, ACCENT),
                    None => {
                        // Progression inconnue : bande qui glisse.
                        let t = (ui.input(|i| i.time) as f32 * 0.6).fract();
                        theme::meter(ui, r, 0.0, ACCENT);
                        let seg = egui::Rect::from_min_size(egui::pos2(r.left() + (r.width() * 1.3) * t - r.width() * 0.3, r.top()), vec2(r.width() * 0.3, r.height()));
                        ui.painter().with_clip_rect(r).rect_filled(seg, 2, ACCENT);
                        ui.ctx().request_repaint();
                    }
                }
            }
            if v.status == "failed" {
                ui.add_space(6.0);
                ui.label(RichText::new(theme::cap(v.error.as_deref().unwrap_or(""))).color(RED));
            }
            if !v.log.is_empty() {
                ui.add_space(6.0);
                egui::CollapsingHeader::new(theme::muted("Journal")).id_salt("victory-log").default_open(running).show(ui, |ui| {
                    log_box(ui, "victory-log-box", &v.log, 220.0);
                });
            }
            if !running {
                ui.add_space(8.0);
                ui.horizontal(|ui| {
                    let again = ["failed", "cancelled"].contains(&v.status.as_str()) && matches!(v.task.as_deref(), Some("install" | "update" | "rebuild"));
                    if v.installed.is_some() && v.module_stale && theme::button_if(ui, Kind::Primary, ic::HAMMER, "Recompiler", ready != Some(false)).clicked() {
                        self.post("/api/victory/rebuild", json!({}));
                    }
                    if v.installed.is_some() {
                        if theme::button(ui, Kind::Normal, ic::ARROWS_CLOCKWISE, "Mettre à jour").clicked() {
                            self.victory_update();
                        }
                    } else if theme::button_if(ui, Kind::Primary, ic::DOWNLOAD_SIMPLE, if again { "Réessayer" } else { "Installer" }, ready == Some(true)).clicked() {
                        self.post("/api/victory/install", json!({}));
                    }
                    if theme::button(ui, Kind::Ghost, "", "Revérifier").clicked() {
                        self.post("/api/victory/check", json!({}));
                    }
                    if with_later && theme::button(ui, Kind::Ghost, "", "Plus tard").clicked() {
                        self.later_victory = true;
                    }
                });
            }
        });
    }

    fn victory_update(&self) {
        let installed = self.st.victory.installed.as_ref().map(|i| i.commit.clone());
        self.act(move |api| {
            let commit = api.post("/api/victory/latest", json!({}))?.get("commit").and_then(|c| c.as_str()).unwrap_or_default().to_string();
            Ok(Some(Box::new(move |app: &mut SixmApp| {
                if installed.as_deref() == Some(commit.as_str()) {
                    return app.toast("VIctory est à jour", false);
                }
                let text = format!(
                    "Nouvelle version : {}{}. La compilation prend plusieurs minutes. La version actuelle reste en place si elle échoue.",
                    short(&commit),
                    installed.as_deref().map(|i| format!(", à la place de {}", short(i))).unwrap_or_default()
                );
                app.confirm("Mettre à jour VIctory ?", &text, "Compiler", Box::new(|app: &mut SixmApp| app.post("/api/victory/update", json!({}))));
            }) as Job))
        });
    }

    /// Bandeau du jeu lancé par SixM.
    pub fn game_bar(&mut self, ui: &mut Ui) {
        let g = self.st.game.clone();
        if g.status.is_empty() || g.status == "stopped" {
            return;
        }
        theme::card().show(ui, |ui| {
            ui.set_width(ui.available_width());
            ui.horizontal(|ui| {
                let (text, color) = if g.status == "running" {
                    (format!("{} est lancé", g.name.clone().unwrap_or_default()), TEXT)
                } else {
                    (theme::cap(g.error.as_deref().unwrap_or("")), if g.status == "failed" { RED } else { MUTED })
                };
                ui.label(RichText::new(ic::GAME_CONTROLLER).size(20.0).color(if g.status == "running" { GREEN } else { color }));
                ui.label(RichText::new(text).font(theme::fs(14.0)).color(color));
                ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                    if g.status == "running" && theme::button(ui, Kind::Danger, ic::STOP, "Arrêter le jeu").clicked() {
                        self.confirm(
                            "Arrêter le jeu ?",
                            "La progression non sauvegardée sera perdue.",
                            "Arrêter",
                            Box::new(|app: &mut SixmApp| app.post("/api/game/stop", json!({}))),
                        );
                    }
                });
            });
            if !g.log.is_empty() {
                egui::CollapsingHeader::new(theme::muted("Journal de VIctory")).id_salt("game-log").show(ui, |ui| {
                    log_box(ui, "game-log-box", &g.log, 160.0);
                });
            }
        });
        ui.add_space(12.0);
    }
}
