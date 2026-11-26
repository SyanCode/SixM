//! Partie en cours : chat, joueurs et radar.

use super::SixmApp;
use crate::theme::{self, ic, Kind, ACCENT, BG, CARD, DIM, GREEN, LINE, MUTED, PANEL, TEXT, YELLOW};
use eframe::egui::{self, pos2, vec2, Align, Align2, Layout, Margin, Rect, RichText, Sense, Shape, Stroke, Ui};
use serde_json::json;

impl SixmApp {
    pub fn session(&mut self, ui: &mut Ui) {
        let s = self.st.session.clone();
        let me = self.st.settings.name.clone();
        let server = s.server_name.clone().filter(|n| !n.is_empty()).or(s.address.clone()).unwrap_or_default();

        egui::Panel::right("side")
            .exact_size(340.0)
            .resizable(false)
            .show_separator_line(false)
            .frame(egui::Frame::new().fill(PANEL).stroke(Stroke::new(1.0, LINE)).inner_margin(20))
            .show(ui, |ui| {
                theme::caption(ui, "Radar");
                let side = ui.available_width();
                let (rect, _) = ui.allocate_exact_size(vec2(side, side), Sense::hover());
                self.radar(ui, rect);
                ui.add_space(14.0);
                let mut list = vec![(s.id.clone(), me.clone(), true)];
                list.extend(s.roster.iter().filter(|p| p.id != s.id).map(|p| (p.id.clone(), p.name.clone(), false)));
                theme::caption(ui, &format!("Joueurs ({})", list.len()));
                egui::ScrollArea::vertical().id_salt("players").auto_shrink([false, false]).show(ui, |ui| {
                    for (_, name, mine) in list {
                        ui.horizontal(|ui| {
                            theme::hex_avatar(ui, 28.0, &name, mine);
                            ui.label(theme::strong(&name, 14.0));
                            if mine {
                                ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                                    theme::tag(ui, "VOUS");
                                });
                            }
                        });
                    }
                });
            });

        egui::CentralPanel::default().frame(egui::Frame::new().fill(BG).inner_margin(Margin { left: 28, right: 24, top: 22, bottom: 22 })).show(ui, |ui| {
            // Menu des mods, en haut à gauche, par-dessus le chat.
            let anchor = ui.max_rect().min + vec2(18.0, 118.0);
            let ctx = ui.ctx().clone();
            self.menu_ui(&ctx, anchor);
            // En-tête : serveur et bouton Quitter.
            theme::card().inner_margin(16).show(ui, |ui| {
                ui.set_width(ui.available_width());
                ui.horizontal(|ui| {
                    theme::hex_avatar(ui, 50.0, &server, false);
                    ui.vertical(|ui| {
                        ui.label(theme::title(&server, 20.0));
                        ui.horizontal(|ui| {
                            theme::pill(ui, "Connecté", GREEN);
                            let mode = if s.adapter.as_deref() == Some("victory") { "VIctory" } else { "Démo, sans jeu" };
                            ui.label(theme::muted(format!("{}  ·  {}", s.address.clone().unwrap_or_default(), mode)));
                        });
                    });
                    ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                        if theme::button_sized(ui, Kind::Danger, ic::SIGN_OUT, "Quitter", vec2(0.0, 40.0), true).clicked() {
                            self.post("/api/disconnect", json!({}));
                        }
                        let open = self.menu.is_some();
                        let label = if open { "Fermer le menu" } else { "Menu" };
                        if theme::button_sized(ui, if open { Kind::Normal } else { Kind::Primary }, ic::LIST, label, vec2(0.0, 40.0), true)
                            .on_hover_text("Touche M")
                            .clicked()
                        {
                            if open {
                                self.menu = None;
                                self.post("/api/menu/close", json!({}));
                            } else {
                                self.post("/api/menu/open", json!({}));
                            }
                        }
                        if s.admin {
                            theme::pill(ui, "Admin", ACCENT);
                        }
                    });
                });
            });
            ui.add_space(12.0);

            if s.adapter.as_deref() == Some("victory") {
                let m = s.module.clone().unwrap_or_default();
                let truthy = |v: &serde_json::Value| !(v.is_null() || v == &json!(false) || v == &json!(""));
                let why = if s.local.is_some() {
                    "Votre position est partagée : les noms des autres joueurs s'affichent dans le jeu.".to_string()
                } else if !m.connected {
                    "Le module multijoueur ne répond pas encore : chat et liste des joueurs seulement.".into()
                } else if let Some(e) = &m.error {
                    format!("Profil du jeu refusé : {e}")
                } else if !truthy(&m.build) {
                    "En attente du jeu.".into()
                } else if truthy(&m.profile) {
                    "Profil trouvé, position pas encore lisible.".into()
                } else {
                    format!("Aucun profil pour cette version du jeu ({}) : chat et liste des joueurs seulement.", m.build.as_str().unwrap_or(&m.build.to_string()))
                };
                egui::Frame::new().fill(YELLOW.gamma_multiply(0.08)).corner_radius(8).inner_margin(12).show(ui, |ui| {
                    ui.set_width(ui.available_width());
                    ui.horizontal(|ui| {
                        ui.label(RichText::new(ic::INFO).size(18.0).color(YELLOW));
                        ui.add(egui::Label::new(RichText::new(format!("Dans le jeu : F7 menu, F8 écrire, F9 masquer. {why}")).color(TEXT)).wrap());
                        let show = truthy(&m.build) && !(truthy(&m.profile) && m.error.is_none());
                        if show {
                            ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                                if theme::button(ui, Kind::Normal, ic::FOLDER_OPEN, "Ouvrir les profils").clicked() {
                                    self.post("/api/profiles", json!({}));
                                }
                            });
                        }
                    });
                });
                ui.add_space(12.0);
            }
            self.game_bar(ui);

            // Chat.
            let rest = ui.available_height();
            egui::Frame::new().fill(CARD).stroke(Stroke::new(1.0, LINE)).corner_radius(8).inner_margin(16).show(ui, |ui| {
                ui.set_width(ui.available_width());
                ui.set_height(rest - 34.0);
                theme::caption(ui, "Chat");
                let h = ui.available_height() - 52.0;
                egui::ScrollArea::vertical().id_salt("chat").stick_to_bottom(true).auto_shrink([false, false]).max_height(h).min_scrolled_height(h).show(ui, |ui| {
                    let roster: Vec<&str> = s.roster.iter().map(|p| p.name.as_str()).collect();
                    let start = s.log.len().saturating_sub(200);
                    for l in &s.log[start..] {
                        chat_line(ui, &l.text, &me, &roster);
                    }
                    if s.log.is_empty() {
                        ui.label(RichText::new("Aucun message pour l'instant.").color(DIM));
                    }
                });
                ui.add_space(8.0);
                ui.horizontal(|ui| {
                    let w = ui.available_width() - 52.0;
                    let r = theme::input(ui, &mut self.chat, "Écrire un message", ic::CHAT_CIRCLE_TEXT, w);
                    let enter = r.lost_focus() && ui.input(|i| i.key_pressed(egui::Key::Enter));
                    if self.chat.chars().count() > 200 {
                        self.chat = self.chat.chars().take(200).collect();
                    }
                    if theme::button_sized(ui, Kind::Primary, ic::PAPER_PLANE_RIGHT, "", vec2(44.0, 38.0), true).clicked() || enter {
                        let text = self.chat.trim().to_string();
                        self.chat.clear();
                        if !text.is_empty() {
                            self.post("/api/chat", json!({ "text": text }));
                        }
                        r.request_focus();
                    }
                });
            });
        });
    }

    /// Les autres joueurs autour de vous.
    fn radar(&self, ui: &mut Ui, rect: Rect) {
        let s = &self.st.session;
        let p = ui.painter().with_clip_rect(rect);
        let c = rect.center();
        let half = rect.width() / 2.0;
        p.rect_filled(rect, 10, egui::Color32::from_rgb(12, 13, 17));
        for r in [0.3, 0.6, 0.9] {
            p.add(Shape::closed_line(theme::hex_points(c, half * r), Stroke::new(1.0, LINE)));
        }
        p.line_segment([pos2(c.x, rect.top() + 8.0), pos2(c.x, rect.bottom() - 8.0)], Stroke::new(1.0, LINE.gamma_multiply(0.6)));
        p.line_segment([pos2(rect.left() + 8.0, c.y), pos2(rect.right() - 8.0, c.y)], Stroke::new(1.0, LINE.gamma_multiply(0.6)));
        // Balayage.
        let t = ui.input(|i| i.time) as f32;
        let a = t * 1.2;
        p.line_segment([c, c + vec2(a.sin(), -a.cos()) * half * 0.9], Stroke::new(1.5, ACCENT.gamma_multiply(0.25)));
        ui.ctx().request_repaint_after(std::time::Duration::from_millis(33));

        let me = s.local.clone().unwrap_or_default();
        let others: Vec<_> = s.players.iter().filter(|p| p.id != s.id).collect();
        let range = others.iter().map(|o| ((o.pos.x - me.x).hypot(o.pos.y - me.y)) as f32).fold(50.0_f32, f32::max);
        for o in others {
            let x = c.x + ((o.pos.x - me.x) as f32 / range) * half * 0.78;
            let y = c.y - ((o.pos.y - me.y) as f32 / range) * half * 0.78;
            p.circle_filled(pos2(x, y), 5.0, TEXT);
            p.text(pos2(x, y - 11.0), Align2::CENTER_BOTTOM, &o.name, theme::f(11.0), MUTED);
        }
        if s.local.is_some() {
            p.circle_filled(c, 6.0, ACCENT);
            p.circle_stroke(c, 10.0, Stroke::new(1.5, ACCENT.gamma_multiply(0.4)));
        } else {
            p.text(pos2(c.x, rect.bottom() - 16.0), Align2::CENTER_CENTER, "Position inconnue", theme::f(11.5), DIM);
        }
    }
}

/// « Nom: texte » d'un joueur présent devient un message signé ; le reste vient du serveur.
fn chat_line(ui: &mut Ui, text: &str, me: &str, roster: &[&str]) {
    let who = text.find(": ").filter(|&i| i > 0).map(|i| (&text[..i], &text[i + 2..]));
    match who {
        Some((name, msg)) if name == me || roster.contains(&name) => {
            ui.horizontal_top(|ui| {
                theme::hex_avatar(ui, 26.0, name, name == me);
                ui.vertical(|ui| {
                    ui.spacing_mut().item_spacing.y = 2.0;
                    ui.label(RichText::new(name).font(theme::fs(13.0)).color(if name == me { ACCENT } else { theme::name_color(name) }));
                    ui.add(egui::Label::new(RichText::new(msg).color(TEXT)).wrap());
                });
            });
        }
        _ => {
            ui.add(egui::Label::new(RichText::new(format!("{}  {}", ic::INFO, text)).color(MUTED).italics()).wrap());
        }
    }
}
