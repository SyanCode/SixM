//! Accueil et liste des serveurs.

use super::{page, Dialog, Entry, Kindof, ListTab, SixmApp, View};
use crate::api::ServerInfo;
use crate::theme::{self, ic, Kind, ACCENT, BG, CARD, CARD_HI, DIM, GREEN, LINE, MUTED, PANEL, RED, TEXT, YELLOW};
use eframe::egui::{self, pos2, vec2, Align, Align2, Color32, CornerRadius, Id, Layout, Margin, Rect, RichText, Sense, Shape, Stroke, StrokeKind, Ui, UiBuilder};
use serde_json::json;

/// Ressemble à une adresse : hôte[:port], sans espace.
fn looks_like_address(s: &str) -> bool {
    let s = s.trim();
    !s.is_empty() && !s.contains(char::is_whitespace) && (s.contains(':') || s.contains('.') || s == "localhost")
}

impl SixmApp {
    // --- Accueil ----------------------------------------------------------------------------

    pub fn home(&mut self, ui: &mut Ui) {
        page(ui, "home", 1180.0, |ui| {
            self.hero(ui);
            ui.add_space(22.0);

            let v = &self.st.victory;
            if v.supported && (v.status == "running" || (!v.valid && !self.later_victory)) {
                self.victory_panel(ui, true);
                ui.add_space(16.0);
            }
            self.game_bar(ui);
            self.session_error(ui);

            let w = ui.available_width();
            let col = (w - 16.0) / 2.0;
            ui.horizontal_top(|ui| {
                ui.vertical(|ui| {
                    ui.set_width(col);
                    self.resume_card(ui);
                });
                ui.add_space(8.0);
                ui.vertical(|ui| {
                    ui.set_width(col);
                    self.direct_card(ui);
                });
            });

            ui.add_space(26.0);
            theme::caption(ui, "Raccourcis");
            ui.add_space(4.0);
            ui.horizontal(|ui| {
                let tw = (w - 32.0) / 3.0;
                if self.tile(ui, tw, ic::LIST_BULLETS, "Parcourir les serveurs", "Vos serveurs, favoris et parties récentes.") {
                    self.view = View::Servers;
                }
                ui.add_space(8.0);
                if self.tile(ui, tw, ic::HARD_DRIVES, "Héberger un serveur", "Prêt en deux clics, avec vos mods.") {
                    self.view = View::Host;
                    self.host_id = None;
                }
                ui.add_space(8.0);
                if self.can_solo() {
                    let busy = self.st.game.status == "running";
                    let sub = if busy { "Le jeu est déjà lancé.".to_string() } else { format!("{}, sans serveur.", self.target_name()) };
                    if self.tile(ui, tw, ic::PLAY, "Jouer en solo", &sub) && !busy {
                        self.post("/api/game/launch", json!({}));
                    }
                } else if self.tile(ui, tw, ic::GAME_CONTROLLER, "Ajouter un jeu", "Le dossier extrait de votre propre disque.") {
                    self.view = View::Settings;
                    self.settings_tab = super::SettingsTab::Games;
                }
            });

            let favs: Vec<Entry> = self.entries().into_iter().filter(|e| e.kind != Kindof::Recent).collect();
            if !favs.is_empty() {
                ui.add_space(26.0);
                theme::caption(ui, "Vos serveurs et favoris");
                ui.add_space(4.0);
                let n = ((w + 12.0) / 290.0).floor().max(1.0);
                let tw = ((w - (n - 1.0) * 12.0) / n).floor() - 1.0;
                ui.horizontal_wrapped(|ui| {
                    ui.spacing_mut().item_spacing = vec2(12.0, 12.0);
                    for e in favs {
                        self.server_tile(ui, tw, &e);
                    }
                });
            }
        });
    }

    fn hero(&mut self, ui: &mut Ui) {
        let rect = Rect::from_min_size(ui.cursor().min, vec2(ui.available_width(), 236.0));
        let p = ui.painter().with_clip_rect(rect);
        p.rect_filled(rect, 12, PANEL);
        let inner = rect.shrink(1.0);
        theme::hgradient(ui, inner, Color32::from_rgb(52, 26, 6), Color32::from_rgb(16, 17, 22));
        // Motif d'hexagones à droite.
        let time = ui.input(|i| i.time) as f32;
        for (i, (dx, dy, r)) in [(-120.0, 40.0, 120.0), (-300.0, 190.0, 80.0), (-40.0, 210.0, 60.0), (-230.0, -10.0, 46.0)].into_iter().enumerate() {
            let c = pos2(rect.right() + dx, rect.top() + dy + (time * 0.4 + i as f32).sin() * 4.0);
            p.add(Shape::closed_line(theme::hex_points(c, r), Stroke::new(1.5, ACCENT.gamma_multiply(0.18 + i as f32 * 0.04))));
        }
        p.add(Shape::convex_polygon(theme::hex_points(pos2(rect.right() - 120.0, rect.top() + 40.0), 70.0), ACCENT.gamma_multiply(0.10), Stroke::NONE));
        p.rect_stroke(rect, 12, Stroke::new(1.0, LINE), StrokeKind::Inside);
        ui.ctx().request_repaint_after(std::time::Duration::from_millis(50));

        let body = Rect::from_min_max(rect.min + vec2(36.0, 34.0), rect.max - vec2(36.0, 30.0));
        ui.scope_builder(UiBuilder::new().max_rect(body), |ui| {
            ui.label(RichText::new("SIXM · MULTIJOUEUR").font(theme::fs(12.0)).color(ACCENT).extra_letter_spacing(2.0));
            ui.add_space(2.0);
            ui.label(theme::title(format!("Bienvenue, {}", self.st.settings.name), 34.0));
            ui.label(RichText::new("Rejoignez un serveur, hébergez le vôtre et ajoutez vos mods.").font(theme::f(15.5)).color(MUTED));
            ui.add_space(18.0);
            ui.horizontal(|ui| {
                if theme::button_sized(ui, Kind::Primary, ic::PLAY, "Jouer", vec2(170.0, 46.0), true).clicked() {
                    self.view = View::Servers;
                }
                ui.add_space(4.0);
                if theme::button_sized(ui, Kind::Normal, ic::PLUS, "Créer un serveur", vec2(0.0, 46.0), true).clicked() {
                    self.create_host();
                }
            });
        });
        ui.advance_cursor_after_rect(rect);
    }

    pub fn session_error(&mut self, ui: &mut Ui) {
        let Some(e) = self.st.session.error.clone() else { return };
        egui::Frame::new().fill(RED.gamma_multiply(0.12)).corner_radius(8).inner_margin(14).show(ui, |ui| {
            ui.set_width(ui.available_width());
            ui.horizontal(|ui| {
                ui.label(RichText::new(ic::WARNING_CIRCLE).size(18.0).color(RED));
                ui.add(egui::Label::new(RichText::new(theme::cap(&e)).color(Color32::from_rgb(255, 170, 164))).wrap());
                // Refus par liste blanche : l'hôte a besoin de l'identifiant.
                if e.contains("liste blanche") {
                    ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                        if theme::button(ui, Kind::Normal, ic::COPY, "Copier mon identifiant").clicked() {
                            ui.ctx().copy_text(self.st.settings.uid.clone());
                            self.toast("Identifiant copié : envoyez-le à l'hôte du serveur", false);
                        }
                    });
                }
            });
        });
        ui.add_space(14.0);
    }

    /// Dernier serveur rejoint.
    fn resume_card(&mut self, ui: &mut Ui) {
        let last = self.st.settings.recents.first().cloned().or_else(|| self.entries().first().map(|e| e.address.clone()));
        theme::card().show(ui, |ui| {
            ui.set_width(ui.available_width());
            ui.set_min_height(86.0);
            theme::caption(ui, "Reprendre");
            match last {
                Some(a) => {
                    let name = self.display_name(&a, "");
                    let info = self.infos.get(&a).cloned();
                    ui.horizontal(|ui| {
                        theme::hex_avatar(ui, 48.0, &name, false);
                        ui.vertical(|ui| {
                            ui.label(theme::strong(&name, 16.0));
                            ui.label(RichText::new(status_line(info.as_ref())).color(MUTED));
                        });
                        ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                            if theme::button_if(ui, Kind::Primary, ic::PLAY, "Se connecter", self.session_idle()).clicked() {
                                self.join(a.clone());
                            }
                        });
                    });
                }
                None => {
                    ui.add_space(6.0);
                    ui.label(theme::muted("Aucune partie récente. Les serveurs rejoints apparaîtront ici."));
                }
            }
        });
    }

    /// Connexion directe par adresse.
    fn direct_card(&mut self, ui: &mut Ui) {
        theme::card().show(ui, |ui| {
            ui.set_width(ui.available_width());
            ui.set_min_height(86.0);
            theme::caption(ui, "Connexion directe");
            ui.horizontal(|ui| {
                let w = ui.available_width() - 150.0;
                let r = theme::input(ui, &mut self.quick, "Adresse d'un serveur (ip:port)", ic::LINK, w);
                let enter = r.lost_focus() && ui.input(|i| i.key_pressed(egui::Key::Enter));
                let ok = !self.quick.trim().is_empty() && self.session_idle();
                if (theme::button_sized(ui, Kind::Primary, "", "Se connecter", vec2(140.0, 38.0), ok).clicked() || enter) && ok {
                    let a = self.quick.trim().to_string();
                    self.join(a);
                }
            });
        });
    }

    fn tile(&self, ui: &mut Ui, w: f32, icon: &str, title: &str, sub: &str) -> bool {
        let (rect, resp) = ui.allocate_exact_size(vec2(w, 92.0), Sense::click());
        let t = ui.ctx().animate_bool_with_time(resp.id, resp.hovered(), 0.12);
        let p = ui.painter();
        p.rect_filled(rect, 10, CARD.lerp_to_gamma(CARD_HI, t));
        p.rect_stroke(rect, 10, Stroke::new(1.0, LINE.lerp_to_gamma(ACCENT.gamma_multiply(0.6), t)), StrokeKind::Inside);
        let ir = Rect::from_center_size(pos2(rect.left() + 42.0, rect.center().y), vec2(44.0, 44.0));
        p.rect_filled(ir, 10, ACCENT.gamma_multiply(0.12 + 0.1 * t));
        p.text(ir.center(), Align2::CENTER_CENTER, icon, theme::f(22.0), ACCENT);
        p.text(pos2(rect.left() + 78.0, rect.center().y - 10.0), Align2::LEFT_CENTER, title, theme::fs(15.5), TEXT);
        let g = p.layout(sub.to_string(), theme::f(13.0), MUTED, rect.width() - 100.0);
        p.galley(pos2(rect.left() + 78.0, rect.center().y + 2.0), g, MUTED);
        p.text(pos2(rect.right() - 20.0, rect.center().y), Align2::CENTER_CENTER, ic::CARET_RIGHT, theme::f(16.0), DIM.lerp_to_gamma(TEXT, t));
        resp.on_hover_cursor(egui::CursorIcon::PointingHand).clicked()
    }

    fn server_tile(&mut self, ui: &mut Ui, w: f32, e: &Entry) {
        let (rect, resp) = ui.allocate_exact_size(vec2(w, 112.0), Sense::click());
        let info = self.infos.get(&e.address).cloned();
        let name = self.display_name(&e.address, &e.label);
        let t = ui.ctx().animate_bool_with_time(resp.id, resp.hovered(), 0.12);
        let p = ui.painter().clone();
        p.rect_filled(rect, 10, CARD.lerp_to_gamma(CARD_HI, t));
        p.rect_stroke(rect, 10, Stroke::new(1.0, LINE), StrokeKind::Inside);
        let stripe = Rect::from_min_size(rect.min, vec2(rect.width(), 3.0));
        p.rect_filled(stripe, CornerRadius { nw: 10, ne: 10, sw: 0, se: 0 }, theme::name_color(&name).gamma_multiply(0.9));
        theme::paint_hex(ui, pos2(rect.left() + 36.0, rect.top() + 40.0), 20.0, &name, theme::name_color(&name));
        let tw = rect.width() - 110.0;
        let g = p.layout_no_wrap(name.clone(), theme::fs(15.0), TEXT);
        let g = if g.size().x > tw { p.layout(name.clone(), theme::fs(15.0), TEXT, tw) } else { g };
        p.galley_with_override_text_color(pos2(rect.left() + 66.0, rect.top() + 22.0), g, TEXT);
        p.text(pos2(rect.left() + 66.0, rect.top() + 52.0), Align2::LEFT_CENTER, &e.address, theme::f(12.5), MUTED);
        let foot = rect.bottom() - 24.0;
        let m = Rect::from_min_size(pos2(rect.left() + 16.0, foot - 2.0), vec2(rect.width() - 150.0, 4.0));
        match &info {
            Some(i) if i.online => {
                theme::meter(ui, m, i.players as f32 / i.max_players.max(1) as f32, GREEN);
                p.text(pos2(rect.right() - 126.0, foot), Align2::LEFT_CENTER, format!("{}/{}", i.players, i.max_players), theme::fs(12.5), TEXT);
                theme::paint_ping(ui, Rect::from_min_size(pos2(rect.right() - 74.0, foot - 7.0), vec2(20.0, 14.0)), Some(i.ping));
                p.text(pos2(rect.right() - 50.0, foot), Align2::LEFT_CENTER, format!("{} ms", i.ping), theme::f(12.0), MUTED);
            }
            Some(_) => {
                p.text(pos2(rect.left() + 16.0, foot), Align2::LEFT_CENTER, "Hors ligne", theme::fs(12.5), RED);
            }
            None => {
                p.text(pos2(rect.left() + 16.0, foot), Align2::LEFT_CENTER, "Recherche…", theme::f(12.5), DIM);
            }
        }
        if e.kind == Kindof::Mine {
            p.text(pos2(rect.right() - 16.0, rect.top() + 24.0), Align2::RIGHT_CENTER, "VOUS", theme::fs(10.5), ACCENT);
        } else if self.is_favorite(&e.address) {
            p.text(pos2(rect.right() - 16.0, rect.top() + 24.0), Align2::RIGHT_CENTER, ic::STAR, egui::FontId::new(15.0, theme::fill_icons()), YELLOW);
        }
        if resp.double_clicked() {
            self.join(e.address.clone());
        } else if resp.clicked() {
            self.selected = Some(e.address.clone());
            self.view = View::Servers;
        }
        resp.on_hover_cursor(egui::CursorIcon::PointingHand).on_hover_text("Double-clic pour rejoindre");
    }

    // --- Liste des serveurs -----------------------------------------------------------------

    pub fn servers(&mut self, ui: &mut Ui) {
        let all = self.entries();
        let q = self.search.trim().to_lowercase();
        let mut rows: Vec<Entry> = all
            .iter()
            .filter(|e| match self.list_tab {
                ListTab::All => true,
                ListTab::Favorites => self.is_favorite(&e.address),
                ListTab::Recents => self.st.settings.recents.contains(&e.address),
                ListTab::Lan => e.kind != Kindof::Mine && self.st.discovered.iter().any(|d| d.address == e.address),
                ListTab::Public => self.listed.iter().any(|l| l.address == e.address),
                ListTab::Mine => e.kind == Kindof::Mine,
            })
            .filter(|e| q.is_empty() || e.address.to_lowercase().contains(&q) || self.display_name(&e.address, &e.label).to_lowercase().contains(&q))
            .cloned()
            .collect();
        let typed = self.search.trim().to_string();
        if looks_like_address(&typed) && !all.iter().any(|e| e.address == typed) {
            rows.insert(0, Entry { address: typed.clone(), label: String::new(), kind: Kindof::Typed });
        }
        if self.selected.as_ref().is_none_or(|s| !all.iter().any(|e| &e.address == s) && *s != typed) {
            self.selected = rows.first().map(|e| e.address.clone());
        }

        egui::Panel::right("detail")
            .exact_size(380.0)
            .resizable(false)
            .show_separator_line(false)
            .frame(egui::Frame::new().fill(PANEL).stroke(Stroke::new(1.0, LINE)))
            .show(ui, |ui| match self.selected.clone() {
                Some(a) => {
                    let label = all.iter().find(|e| e.address == a).map(|e| e.label.clone()).unwrap_or_default();
                    self.detail(ui, &a, &label);
                }
                None => {
                    super::center(ui, |ui| {
                        ui.label(RichText::new(ic::CURSOR_CLICK).size(36.0).color(DIM));
                        ui.label(theme::muted("Choisissez un serveur"));
                    });
                }
            });

        egui::CentralPanel::default()
            .frame(egui::Frame::new().fill(BG).inner_margin(Margin { left: 28, right: 24, top: 24, bottom: 0 }))
            .show(ui, |ui| {
                ui.horizontal(|ui| {
                    ui.label(theme::title("Serveurs", 26.0));
                    ui.add_space(6.0);
                    ui.label(RichText::new(format!("{}", rows.iter().filter(|e| e.kind != Kindof::Typed).count())).font(theme::fs(14.0)).color(DIM));
                    ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                        if theme::icon_button(ui, ic::ARROWS_CLOCKWISE, false, "Actualiser").clicked() {
                            self.hub.lock().unwrap().query_now = true;
                        }
                        let w = (ui.available_width() - 20.0).min(360.0);
                        let r = theme::input(ui, &mut self.search, "Rechercher, ou coller une adresse", ic::MAGNIFYING_GLASS, w);
                        if r.lost_focus() && ui.input(|i| i.key_pressed(egui::Key::Enter)) && looks_like_address(&typed) {
                            self.join(typed.clone());
                        }
                    });
                });
                ui.add_space(14.0);

                let counts = [
                    (ListTab::All, "Tous", all.len()),
                    (ListTab::Favorites, "Favoris", self.st.settings.favorites.len()),
                    (ListTab::Recents, "Historique", self.st.settings.recents.len()),
                    (ListTab::Lan, "Réseau local", all.iter().filter(|e| e.kind != Kindof::Mine && self.st.discovered.iter().any(|d| d.address == e.address)).count()),
                    (ListTab::Public, "Publics", self.listed.len()),
                    (ListTab::Mine, "Vos serveurs", all.iter().filter(|e| e.kind == Kindof::Mine).count()),
                ];
                ui.horizontal_wrapped(|ui| {
                    ui.spacing_mut().item_spacing = vec2(4.0, 6.0);
                    for (tab, label, n) in counts {
                        if segment(ui, label, n, self.list_tab == tab).clicked() {
                            self.list_tab = tab;
                            if tab == ListTab::Public {
                                self.fetch_directories();
                            }
                        }
                    }
                });
                if self.list_tab == ListTab::Public && self.listed_at.is_none_or(|t| t.elapsed().as_secs() > 60) && !self.st.settings.directories.is_empty() {
                    self.fetch_directories();
                }
                ui.add_space(12.0);
                self.session_error(ui);

                // En-tête du tableau.
                let w = ui.available_width();
                let (head, _) = ui.allocate_exact_size(vec2(w, 30.0), Sense::hover());
                let p = ui.painter();
                let cols = Cols::new(head);
                for (x, text, align) in [(head.left() + 64.0, "NOM", Align2::LEFT_CENTER), (cols.players, "JOUEURS", Align2::LEFT_CENTER), (cols.ping, "PING", Align2::LEFT_CENTER)] {
                    p.text(pos2(x, head.center().y), align, text, theme::fs(11.0), DIM);
                }
                p.line_segment([head.left_bottom(), head.right_bottom()], Stroke::new(1.0, LINE));

                if rows.is_empty() && self.list_tab == ListTab::Public && self.st.settings.directories.is_empty() {
                    ui.add_space(50.0);
                    ui.vertical_centered(|ui| {
                        ui.label(RichText::new(ic::GLOBE).size(48.0).color(DIM));
                        ui.label(theme::title("Aucun annuaire", 20.0));
                        ui.label(theme::muted("Un annuaire liste les serveurs publics. Ajoutez son adresse dans les réglages."));
                        ui.add_space(10.0);
                        if theme::button(ui, Kind::Primary, ic::GEAR_SIX, "Ajouter un annuaire").clicked() {
                            self.view = View::Settings;
                            self.settings_tab = super::SettingsTab::General;
                        }
                    });
                    return;
                }
                if rows.is_empty() && self.list_tab == ListTab::Lan {
                    ui.add_space(50.0);
                    ui.vertical_centered(|ui| {
                        ui.label(RichText::new(ic::WIFI_HIGH).size(48.0).color(DIM));
                        ui.label(theme::title("Aucun serveur sur votre réseau", 20.0));
                        ui.label(theme::muted("Les serveurs publics de votre réseau local apparaissent ici tout seuls."));
                    });
                    return;
                }
                if rows.is_empty() {
                    ui.add_space(50.0);
                    ui.vertical_centered(|ui| {
                        ui.label(RichText::new(ic::GLOBE_HEMISPHERE_WEST).size(48.0).color(DIM));
                        ui.label(theme::title(if q.is_empty() { "Aucun serveur pour l'instant" } else { "Aucun résultat" }, 20.0));
                        ui.label(theme::muted("Collez l'adresse d'un ami dans la recherche, ou créez le vôtre."));
                        ui.add_space(10.0);
                        if theme::button(ui, Kind::Primary, ic::PLUS, "Créer un serveur").clicked() {
                            self.create_host();
                        }
                    });
                    return;
                }

                egui::ScrollArea::vertical().id_salt("rows").auto_shrink([false, false]).show(ui, |ui| {
                    ui.spacing_mut().item_spacing.y = 0.0;
                    for e in &rows {
                        self.server_row(ui, e);
                    }
                    ui.add_space(20.0);
                });
            });
    }

    fn server_row(&mut self, ui: &mut Ui, e: &Entry) {
        let w = ui.available_width();
        let (rect, resp) = ui.allocate_exact_size(vec2(w, 60.0), Sense::click());
        if !ui.is_rect_visible(rect) {
            return;
        }
        let selected = self.selected.as_deref() == Some(e.address.as_str());
        let info = self.infos.get(&e.address).cloned();
        let name = if e.kind == Kindof::Typed { format!("Se connecter à {}", e.address) } else { self.display_name(&e.address, &e.label) };
        let t = ui.ctx().animate_bool_with_time(resp.id, resp.hovered(), 0.1);
        let p = ui.painter().clone();
        let bg = if selected { CARD_HI } else { CARD.gamma_multiply(t) };
        p.rect_filled(rect.shrink2(vec2(0.0, 1.0)), 6, bg);
        if selected {
            p.rect_filled(Rect::from_min_size(rect.min + vec2(0.0, 8.0), vec2(3.0, rect.height() - 16.0)), 2, ACCENT);
        }
        let cy = rect.center().y;
        if e.kind == Kindof::Typed {
            let ir = Rect::from_center_size(pos2(rect.left() + 34.0, cy), vec2(36.0, 36.0));
            p.rect_filled(ir, 8, ACCENT.gamma_multiply(0.14));
            p.text(ir.center(), Align2::CENTER_CENTER, ic::LINK, theme::f(18.0), ACCENT);
        } else {
            theme::paint_hex(ui, pos2(rect.left() + 34.0, cy), 18.0, &name, theme::name_color(&name));
        }
        let cols = Cols::new(rect);
        let name_w = cols.players - rect.left() - 84.0;
        let g = p.layout_no_wrap(name.clone(), theme::fs(14.5), TEXT);
        let clip = Rect::from_min_max(pos2(rect.left() + 64.0, rect.top()), pos2(rect.left() + 64.0 + name_w, rect.bottom()));
        p.with_clip_rect(clip).galley(pos2(rect.left() + 64.0, cy - 17.0), g, TEXT);
        let mut sub = e.address.clone();
        if let Some(i) = info.as_ref().filter(|i| i.online && !i.description.is_empty()) {
            sub = format!("{}  ·  {}", e.address, i.description);
        }
        let mut x = rect.left() + 64.0;
        if e.kind == Kindof::Mine {
            let g = p.layout_no_wrap("VOUS".into(), theme::fs(10.0), ACCENT);
            let r = Rect::from_min_size(pos2(x, cy + 4.0), g.size() + vec2(10.0, 4.0));
            p.rect_filled(r, 3, ACCENT.gamma_multiply(0.15));
            p.galley(r.min + vec2(5.0, 2.0), g, ACCENT);
            x = r.right() + 8.0;
        }
        if info.as_ref().is_some_and(|i| i.password) {
            p.text(pos2(x, cy + 9.0), Align2::LEFT_CENTER, ic::LOCK_SIMPLE, theme::f(13.0), MUTED);
            x += 18.0;
        }
        if info.as_ref().is_some_and(|i| i.whitelist) {
            p.text(pos2(x, cy + 9.0), Align2::LEFT_CENTER, ic::SHIELD_CHECK, theme::f(13.0), YELLOW);
            x += 18.0;
        }
        let badge = match e.kind {
            Kindof::Lan => Some(("LAN", theme::GREEN)),
            Kindof::Public => Some(("PUBLIC", theme::ACCENT)),
            _ => None,
        };
        if let Some((text, color)) = badge {
            let g = p.layout_no_wrap(text.into(), theme::fs(10.0), color);
            let r = Rect::from_min_size(pos2(x, cy + 4.0), g.size() + vec2(10.0, 4.0));
            p.rect_filled(r, 3, color.gamma_multiply(0.15));
            p.galley(r.min + vec2(5.0, 2.0), g, color);
            x = r.right() + 8.0;
        }
        p.with_clip_rect(clip).text(pos2(x, cy + 9.0), Align2::LEFT_CENTER, sub, theme::f(12.5), MUTED);

        match &info {
            Some(i) if i.online => {
                p.text(pos2(cols.players, cy - 7.0), Align2::LEFT_CENTER, format!("{} / {}", i.players, i.max_players), theme::fs(13.5), TEXT);
                theme::meter(ui, Rect::from_min_size(pos2(cols.players, cy + 7.0), vec2(90.0, 4.0)), i.players as f32 / i.max_players.max(1) as f32, GREEN);
                theme::paint_ping(ui, Rect::from_min_size(pos2(cols.ping, cy - 7.0), vec2(20.0, 14.0)), Some(i.ping));
                p.text(pos2(cols.ping + 26.0, cy), Align2::LEFT_CENTER, format!("{} ms", i.ping), theme::f(13.0), MUTED);
            }
            Some(_) => {
                p.text(pos2(cols.players, cy), Align2::LEFT_CENTER, "Hors ligne", theme::fs(13.0), RED);
                theme::paint_ping(ui, Rect::from_min_size(pos2(cols.ping, cy - 7.0), vec2(20.0, 14.0)), None);
            }
            None => {
                p.text(pos2(cols.players, cy), Align2::LEFT_CENTER, if e.kind == Kindof::Typed { "" } else { "Recherche…" }, theme::f(13.0), DIM);
            }
        }

        let star_rect = Rect::from_center_size(pos2(rect.right() - 26.0, cy), vec2(30.0, 30.0));
        let fav = self.is_favorite(&e.address);
        let star = ui.interact(star_rect, Id::unique(("star", &e.address)), Sense::click());
        let st = ui.ctx().animate_bool_with_time(star.id, star.hovered(), 0.1);
        if fav {
            p.text(star_rect.center(), Align2::CENTER_CENTER, ic::STAR, egui::FontId::new(17.0, theme::fill_icons()), YELLOW);
        } else if t > 0.0 || selected {
            p.text(star_rect.center(), Align2::CENTER_CENTER, ic::STAR, theme::f(17.0), DIM.lerp_to_gamma(TEXT, st));
        }
        if star.on_hover_cursor(egui::CursorIcon::PointingHand).on_hover_text(if fav { "Retirer des favoris" } else { "Ajouter aux favoris" }).clicked() {
            self.toggle_favorite(&e.address);
        } else if resp.double_clicked() {
            self.join(e.address.clone());
        } else if resp.clicked() {
            self.selected = Some(e.address.clone());
        }
    }

    /// Panneau de droite : la fiche du serveur choisi.
    fn detail(&mut self, ui: &mut Ui, address: &str, label: &str) {
        let info = self.infos.get(address).cloned();
        let own = self.own_host(address).map(|h| h.id.clone());
        let name = self.display_name(address, label);
        let color = theme::name_color(&name);

        let full = ui.max_rect();
        let banner = Rect::from_min_size(full.min, vec2(full.width(), 150.0));
        theme::gradient(ui, banner, color.gamma_multiply(0.55), PANEL);
        let p = ui.painter().with_clip_rect(banner);
        for (k, r) in [(0.0, 90.0), (1.0, 54.0)] {
            p.add(Shape::closed_line(theme::hex_points(pos2(banner.right() - 70.0 - k * 90.0, banner.top() + 50.0 + k * 50.0), r), Stroke::new(1.5, Color32::WHITE.gamma_multiply(0.08))));
        }
        theme::paint_hex(ui, pos2(full.left() + 64.0, banner.bottom() - 4.0), 38.0, &name, color);
        ui.add_space(196.0);

        egui::ScrollArea::vertical().id_salt("detail").auto_shrink([false, false]).max_height(ui.available_height() - 150.0).show(ui, |ui| {
            ui.horizontal(|ui| {
                ui.add_space(26.0);
                ui.vertical(|ui| {
                    ui.set_width(full.width() - 52.0);
                    ui.add(egui::Label::new(theme::title(&name, 21.0)).wrap());
                    ui.horizontal(|ui| {
                        ui.label(theme::muted(address));
                        if theme::icon_button(ui, ic::COPY, false, "Copier l'adresse").clicked() {
                            ui.ctx().copy_text(address.to_string());
                            self.toast("Adresse copiée", false);
                        }
                    });
                    ui.add_space(4.0);
                    ui.horizontal(|ui| {
                        match &info {
                            Some(i) if i.online => theme::pill(ui, "En ligne", GREEN),
                            Some(_) => theme::pill(ui, "Hors ligne", RED),
                            None => theme::pill(ui, "Recherche…", MUTED),
                        };
                        if own.is_some() {
                            theme::pill(ui, "Votre serveur", ACCENT);
                        }
                        if info.as_ref().is_some_and(|i| i.password) {
                            theme::pill(ui, "Mot de passe", YELLOW);
                        }
                        if info.as_ref().is_some_and(|i| i.whitelist) {
                            theme::pill(ui, "Liste blanche", YELLOW);
                        }
                        if info.as_ref().is_some_and(|i| i.visibility == "private") {
                            theme::pill(ui, "Privé", MUTED);
                        }
                    });
                    if let Some(i) = info.as_ref().filter(|i| !i.tags.is_empty()) {
                        ui.horizontal_wrapped(|ui| {
                            ui.spacing_mut().item_spacing = vec2(6.0, 6.0);
                            for t in &i.tags {
                                theme::tag(ui, &format!("#{t}"));
                            }
                        });
                    }
                    ui.add_space(14.0);
                    if let Some(i) = info.as_ref().filter(|i| i.online) {
                        ui.horizontal(|ui| {
                            let w = (ui.available_width() - 8.0) / 2.0;
                            stat(ui, w, ic::USERS, "Joueurs", &format!("{} / {}", i.players, i.max_players));
                            stat(ui, w, ic::CELL_SIGNAL_HIGH, "Ping", &format!("{} ms", i.ping));
                        });
                        if !i.description.is_empty() {
                            ui.add_space(14.0);
                            theme::caption(ui, "Description");
                            ui.add(egui::Label::new(RichText::new(&i.description).color(TEXT)).wrap());
                        }
                        if !i.resources.is_empty() {
                            ui.add_space(14.0);
                            theme::caption(ui, &format!("Ressources ({})", i.resources.len()));
                            ui.horizontal_wrapped(|ui| {
                                ui.spacing_mut().item_spacing = vec2(6.0, 6.0);
                                for r in &i.resources {
                                    theme::tag(ui, r);
                                }
                            });
                        }
                    } else if info.is_some() {
                        ui.add(egui::Label::new(theme::muted("Ce serveur ne répond pas. Vérifiez l'adresse, ou qu'il est bien démarré.")).wrap());
                    }
                });
            });
        });

        // Actions, collées en bas.
        let bottom = Rect::from_min_max(pos2(full.left() + 26.0, full.bottom() - 134.0), pos2(full.right() - 26.0, full.bottom() - 24.0));
        ui.scope_builder(UiBuilder::new().max_rect(bottom), |ui| {
            let idle = self.session_idle();
            let label = if !idle { "Déjà en partie" } else { "Se connecter" };
            if theme::button_sized(ui, Kind::Primary, ic::PLAY, label, vec2(bottom.width(), 50.0), idle).clicked() {
                self.join(address.to_string());
            }
            ui.add_space(4.0);
            ui.horizontal(|ui| {
                let w = (bottom.width() - 8.0) / 2.0;
                let fav = self.is_favorite(address);
                if theme::button_sized(ui, Kind::Normal, ic::STAR, if fav { "Retirer" } else { "Favori" }, vec2(w, 38.0), true).clicked() {
                    self.toggle_favorite(address);
                }
                match own {
                    Some(id) => {
                        if theme::button_sized(ui, Kind::Normal, ic::SLIDERS_HORIZONTAL, "Gérer", vec2(w, 38.0), true).clicked() {
                            self.view = View::Host;
                            self.host_id = Some(id);
                        }
                    }
                    None => {
                        if theme::button_sized(ui, Kind::Normal, ic::KEY, "Mot de passe", vec2(w, 38.0), idle).on_hover_text("Rejoindre avec un mot de passe").clicked() {
                            self.dialog = Some(Dialog::Password { address: address.to_string(), retry: false, value: String::new() });
                        }
                    }
                }
            });
        });
    }
}

struct Cols {
    players: f32,
    ping: f32,
}

impl Cols {
    fn new(rect: Rect) -> Cols {
        Cols { players: rect.right() - 250.0, ping: rect.right() - 130.0 }
    }
}

fn status_line(info: Option<&ServerInfo>) -> String {
    match info {
        Some(i) if i.online => format!("{} / {} joueurs  ·  {} ms", i.players, i.max_players, i.ping),
        Some(_) => "Hors ligne".into(),
        None => "Recherche…".into(),
    }
}

fn stat(ui: &mut Ui, w: f32, icon: &str, label: &str, value: &str) {
    let (rect, _) = ui.allocate_exact_size(vec2(w, 58.0), Sense::hover());
    let p = ui.painter();
    p.rect_filled(rect, 8, CARD);
    p.text(pos2(rect.left() + 14.0, rect.top() + 18.0), Align2::LEFT_CENTER, format!("{icon}  {}", label.to_uppercase()), theme::fs(10.5), DIM);
    p.text(pos2(rect.left() + 14.0, rect.top() + 40.0), Align2::LEFT_CENTER, value, theme::fs(16.0), TEXT);
}

/// Onglet de filtre avec compteur.
fn segment(ui: &mut Ui, label: &str, n: usize, active: bool) -> egui::Response {
    let g = ui.painter().layout_no_wrap(label.to_string(), theme::fs(13.5), Color32::PLACEHOLDER);
    let ng = ui.painter().layout_no_wrap(n.to_string(), theme::fs(11.5), Color32::PLACEHOLDER);
    let (rect, resp) = ui.allocate_exact_size(vec2(g.size().x + ng.size().x + 40.0, 34.0), Sense::click());
    let t = ui.ctx().animate_bool_with_time(resp.id, resp.hovered(), 0.1);
    let p = ui.painter();
    let fill = if active { ACCENT.gamma_multiply(0.16) } else { CARD.gamma_multiply(0.6 + 0.4 * t) };
    p.rect_filled(rect, 17, fill);
    if active {
        p.rect_stroke(rect, 17, Stroke::new(1.0, ACCENT.gamma_multiply(0.7)), StrokeKind::Inside);
    }
    let c = if active { ACCENT } else { MUTED.lerp_to_gamma(TEXT, t) };
    p.galley(pos2(rect.left() + 14.0, rect.center().y - g.size().y / 2.0), g.clone(), c);
    let nr = Rect::from_center_size(pos2(rect.right() - 14.0 - ng.size().x / 2.0, rect.center().y), ng.size() + vec2(10.0, 4.0));
    p.rect_filled(nr, 8, if active { ACCENT.gamma_multiply(0.25) } else { CARD_HI });
    p.galley(nr.center() - ng.size() / 2.0, ng, if active { ACCENT } else { MUTED });
    resp.on_hover_cursor(egui::CursorIcon::PointingHand)
}
