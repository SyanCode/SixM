//! Réglages : projet de portage (VIctory, ses forks, un dépôt au choix) et options de lancement.

use super::SixmApp;
use crate::api::Port;
use crate::theme::{self, ic, Kind, ACCENT, CARD, CARD_HI, DIM, GREEN, LINE, MUTED, TEXT};
use eframe::egui::{self, pos2, vec2, Align, Align2, Layout, Rect, RichText, Sense, Stroke, StrokeKind, Ui};
use serde_json::{json, Map, Value};

fn short(sha: &str) -> &str {
    &sha[..sha.len().min(10)]
}

/// Carte d'un portage ; renvoie true si on l'a choisie.
fn port_card(ui: &mut Ui, p: &Port, selected: bool) -> bool {
    let w = ui.available_width();
    let desc = ui.painter().layout(p.description.clone(), theme::f(13.0), MUTED, w - 120.0);
    let h = 62.0 + desc.size().y;
    let (rect, resp) = ui.allocate_exact_size(vec2(w, h), Sense::click());
    let t = ui.ctx().animate_bool_with_time(resp.id, resp.hovered() || selected, 0.12);
    let painter = ui.painter();
    painter.rect_filled(rect, 10, CARD.lerp_to_gamma(CARD_HI, t * 0.6));
    painter.rect_stroke(rect, 10, Stroke::new(if selected { 1.5 } else { 1.0 }, if selected { ACCENT } else { LINE }), StrokeKind::Inside);
    // Bouton radio.
    let c = pos2(rect.left() + 26.0, rect.top() + 28.0);
    painter.circle_stroke(c, 9.0, Stroke::new(1.5, if selected { ACCENT } else { DIM }));
    if selected {
        painter.circle_filled(c, 5.0, ACCENT);
    }
    let x = rect.left() + 50.0;
    let title = painter.layout_no_wrap(p.name.clone(), theme::fs(16.0), TEXT);
    let tw = title.size().x;
    painter.galley(pos2(x, rect.top() + 18.0), title, TEXT);
    let mut tx = x + tw + 10.0;
    if !p.author.is_empty() {
        let g = painter.layout_no_wrap(format!("par {}", p.author), theme::f(12.5), MUTED);
        let gw = g.size().x;
        painter.galley(pos2(tx, rect.top() + 21.0), g, MUTED);
        tx += gw + 10.0;
    }
    for tag in &p.tags {
        let g = painter.layout_no_wrap(tag.clone(), theme::fs(10.5), ACCENT);
        let r = Rect::from_min_size(pos2(tx, rect.top() + 19.0), g.size() + vec2(12.0, 6.0));
        painter.rect_filled(r, 9, ACCENT.gamma_multiply(0.14));
        painter.galley(r.min + vec2(6.0, 3.0), g, ACCENT);
        tx = r.right() + 6.0;
    }
    painter.galley(pos2(x, rect.top() + 44.0), desc, MUTED);
    // État à droite.
    let (text, color) = match (&p.installed, p.status.as_str()) {
        (_, "running") => ("Installation…".to_string(), ACCENT),
        (Some(i), _) => (format!("Installé · {}", short(&i.commit)), GREEN),
        (None, _) if p.custom && p.repo.is_empty() => ("À configurer".to_string(), DIM),
        (None, _) => ("Non installé".to_string(), DIM),
    };
    painter.text(pos2(rect.right() - 18.0, rect.top() + 28.0), Align2::RIGHT_CENTER, text, theme::fs(12.5), color);
    resp.on_hover_cursor(egui::CursorIcon::PointingHand).clicked() && !selected
}

impl SixmApp {
    pub fn ports_tab(&mut self, ui: &mut Ui) {
        let ports = self.st.ports.clone();
        let selected = self.st.settings.port.clone();
        ui.label(theme::title("Projet de portage", 17.0));
        ui.add(egui::Label::new(theme::muted("Le programme qui fait tourner le jeu sur PC. SixM télécharge son code public, le compile sur ce PC et y ajoute son module multijoueur. Chaque portage a sa propre installation.")).wrap());
        ui.add_space(10.0);
        for p in &ports {
            if port_card(ui, p, p.id == selected) {
                self.post("/api/ports/select", json!({ "id": p.id }));
                self.port_form = None;
            }
            ui.add_space(8.0);
        }
        let Some(port) = ports.iter().find(|p| p.id == selected).cloned() else { return };

        if port.custom {
            self.custom_form(ui);
        }
        if !port.options.is_empty() {
            self.port_options(ui, &port);
        }
        if !port.custom || !port.repo.is_empty() {
            ui.add_space(6.0);
            self.victory_panel(ui, false);
        }
        if !port.url.is_empty() {
            ui.add_space(8.0);
            ui.horizontal(|ui| {
                ui.label(theme::muted(format!("{}  Code source :", ic::GITHUB_LOGO)));
                ui.hyperlink_to(port.url.trim_start_matches("https://"), &port.url);
            });
        }
    }

    fn custom_form(&mut self, ui: &mut Ui) {
        if self.custom_form.is_none() {
            let c = &self.st.settings.custom_port;
            self.custom_form = Some((c.repo.clone(), c.commit.clone()));
        }
        let mut save = false;
        theme::card().show(ui, |ui| {
            ui.set_width(ui.available_width());
            ui.label(theme::title("Dépôt du portage", 16.0));
            ui.add(egui::Label::new(theme::muted("Un fork de VIctory sur GitHub, de la même structure (apps/victory). Son code est compilé sur ce PC avec vos droits : ne choisissez qu'un dépôt de confiance.")).wrap());
            ui.add_space(6.0);
            let (repo, commit) = self.custom_form.as_mut().expect("formulaire");
            theme::field(ui, "Adresse", |ui| theme::text_edit(ui, repo, "https://github.com/propriétaire/dépôt"));
            theme::field(ui, "Commit (facultatif)", |ui| theme::text_edit(ui, commit, "vide : le dernier publié"));
            ui.add_space(4.0);
            save = theme::button(ui, Kind::Primary, ic::FLOPPY_DISK, "Enregistrer").clicked();
        });
        if save {
            let (repo, commit) = self.custom_form.clone().expect("formulaire");
            self.act(move |api| {
                api.post("/api/ports/custom", json!({ "repo": repo.trim(), "commit": commit.trim() }))?;
                Ok(Some(Box::new(|app: &mut SixmApp| {
                    app.custom_form = None;
                    app.toast("Dépôt enregistré", false);
                }) as super::Job))
            });
        }
        ui.add_space(8.0);
    }

    fn port_options(&mut self, ui: &mut Ui, port: &Port) {
        if self.port_form.as_ref().is_none_or(|(id, _)| id != &port.id) {
            self.port_form = Some((port.id.clone(), port.values.clone()));
        }
        let mut save = false;
        theme::card().show(ui, |ui| {
            ui.set_width(ui.available_width());
            ui.label(theme::title("Options de lancement", 16.0));
            ui.add(egui::Label::new(theme::muted(format!("Appliquées au prochain lancement de {}.", port.name))).wrap());
            ui.add_space(6.0);
            let (_, values) = self.port_form.as_mut().expect("formulaire");
            for o in &port.options {
                ui.add_space(4.0);
                match o.kind.as_str() {
                    "bool" => {
                        let mut on = values.get(&o.id).and_then(Value::as_bool).unwrap_or(false);
                        ui.horizontal(|ui| {
                            if theme::switch(ui, &mut on).changed() {
                                values.insert(o.id.clone(), json!(on));
                            }
                            ui.vertical(|ui| {
                                ui.spacing_mut().item_spacing.y = 2.0;
                                ui.label(theme::strong(&o.label, 14.0));
                                ui.add(egui::Label::new(theme::muted(&o.description)).wrap());
                            });
                        });
                    }
                    "choice" => {
                        let mut cur = values.get(&o.id).and_then(Value::as_str).unwrap_or("").to_string();
                        theme::field(ui, &o.label, |ui| {
                            let shown = o.choices.iter().find(|(v, _)| v == &cur).map(|(_, l)| l.clone()).unwrap_or_default();
                            egui::ComboBox::from_id_salt(("port-opt", &o.id)).selected_text(shown).width(260.0).show_ui(ui, |ui| {
                                for (v, l) in &o.choices {
                                    ui.selectable_value(&mut cur, v.clone(), l);
                                }
                            });
                            ui.add(egui::Label::new(theme::muted(&o.description)).wrap());
                        });
                        values.insert(o.id.clone(), json!(cur));
                    }
                    "path" => {
                        let mut text = values.get(&o.id).and_then(Value::as_str).unwrap_or("").to_string();
                        theme::field(ui, &o.label, |ui| {
                            ui.horizontal(|ui| {
                                let w = ui.available_width() - if cfg!(windows) { 130.0 } else { 0.0 };
                                ui.add_sized(vec2(w, 38.0), egui::TextEdit::singleline(&mut text).hint_text("C:\\…").margin(vec2(10.0, 0.0)).align(egui::Align2::LEFT_CENTER));
                                #[cfg(windows)]
                                if theme::button(ui, Kind::Normal, ic::FOLDER_OPEN, "Parcourir").clicked() {
                                    if let Some(p) = rfd::FileDialog::new().set_title(&o.label).pick_folder() {
                                        text = p.display().to_string();
                                    }
                                }
                            });
                            ui.add(egui::Label::new(theme::muted(&o.description)).wrap());
                        });
                        values.insert(o.id.clone(), json!(text));
                    }
                    _ => {}
                }
            }
            ui.add_space(8.0);
            let dirty = values != &port.values;
            ui.with_layout(Layout::left_to_right(Align::Center), |ui| {
                save = theme::button_if(ui, Kind::Primary, ic::FLOPPY_DISK, "Enregistrer", dirty).clicked();
                if dirty {
                    ui.label(RichText::new("Modifications non enregistrées").color(theme::YELLOW).size(13.0));
                }
            });
        });
        if save {
            let (id, values): (String, Map<String, Value>) = self.port_form.clone().expect("formulaire");
            self.act(move |api| {
                api.post("/api/ports/options", json!({ "id": id, "values": values }))?;
                Ok(Some(Box::new(|app: &mut SixmApp| {
                    app.port_form = None;
                    app.toast("Options enregistrées", false);
                }) as super::Job))
            });
        }
        ui.add_space(8.0);
    }
}
