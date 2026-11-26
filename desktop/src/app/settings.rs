//! Réglages : profil, mises à jour, jeux, VIctory.

use super::host::underline_tab;
use super::{page, Job, SettingsTab, SixmApp};
use crate::api::Game;
use crate::theme::{self, ic, Kind, LINE, MUTED, RED};
use eframe::egui::{self, vec2, Align, Layout, RichText, Sense, Ui};
use serde_json::json;

#[derive(Clone)]
pub struct SettingsForm {
    pub name: String,
    pub auto_update: bool,
    pub victory: String,
    pub games: Vec<Game>,
    pub directories: String,
}

fn unquote(p: &str) -> String {
    p.trim().trim_matches('"').to_string()
}

/// Bouton Parcourir : boîte de dialogue native de Windows.
fn browse(ui: &mut Ui, value: &mut String, folder: bool) {
    #[cfg(windows)]
    if theme::button(ui, Kind::Normal, ic::FOLDER_OPEN, "Parcourir").clicked() {
        let d = rfd::FileDialog::new();
        let picked = if folder { d.set_title("Choisir le dossier du jeu extrait de votre disque").pick_folder() } else { d.set_title("Choisir victory.exe").add_filter("Programme", &["exe"]).pick_file() };
        if let Some(p) = picked {
            *value = p.display().to_string();
        }
    }
    #[cfg(not(windows))]
    let _ = (ui, value, folder);
}

fn section(ui: &mut Ui, title: &str, text: &str, add: impl FnOnce(&mut Ui)) {
    theme::card().inner_margin(22).show(ui, |ui| {
        ui.set_width(ui.available_width());
        ui.label(theme::title(title, 17.0));
        if !text.is_empty() {
            ui.add(egui::Label::new(theme::muted(text)).wrap());
        }
        ui.add_space(8.0);
        add(ui);
    });
    ui.add_space(14.0);
}

impl SixmApp {
    pub fn settings(&mut self, ui: &mut Ui) {
        if self.settings_form.is_none() {
            let s = &self.st.settings;
            self.settings_form = Some(SettingsForm {
                name: s.name.clone(),
                auto_update: s.auto_update,
                victory: s.victory.clone(),
                games: s.games.clone(),
                directories: s.directories.join("\n"),
            });
        }
        page(ui, "settings", 900.0, |ui| {
            ui.label(theme::title("Réglages", 28.0));
            ui.add_space(8.0);
            ui.horizontal(|ui| {
                ui.spacing_mut().item_spacing.x = 2.0;
                let mut tabs = vec![(SettingsTab::General, ic::USER_CIRCLE, "Général"), (SettingsTab::Games, ic::GAME_CONTROLLER, "Jeux")];
                if self.st.victory.supported {
                    tabs.push((SettingsTab::Victory, ic::WRENCH, "VIctory"));
                }
                for (tab, icon, label) in tabs {
                    if underline_tab(ui, icon, label, self.settings_tab == tab).clicked() {
                        self.settings_tab = tab;
                    }
                }
            });
            let (r, _) = ui.allocate_exact_size(vec2(ui.available_width(), 1.0), Sense::hover());
            ui.painter().rect_filled(r, 0, LINE);
            ui.add_space(18.0);
            match self.settings_tab {
                SettingsTab::General => self.general(ui),
                SettingsTab::Games => self.games(ui),
                SettingsTab::Victory => self.victory_panel(ui, false),
            }
        });
    }

    fn general(&mut self, ui: &mut Ui) {
        let form = self.settings_form.as_mut().unwrap();
        section(ui, "Profil", "Le pseudo que voient les autres joueurs.", |ui| {
            theme::field(ui, "Pseudo", |ui| theme::text_edit(ui, &mut form.name, "Joueur"));
            if form.name.chars().count() > 24 {
                form.name = form.name.chars().take(24).collect();
            }
        });
        let uid = self.st.settings.uid.clone();
        let mut copy = false;
        section(ui, "Votre identité", "Chaque serveur vous reconnaît à cet identifiant, même si vous changez de pseudo. Donnez-le à l'hôte d'un serveur à liste blanche pour qu'il vous accepte. La clé qui le prouve reste sur ce PC.", |ui| {
            ui.horizontal(|ui| {
                egui::Frame::new().fill(egui::Color32::from_rgb(13, 14, 18)).stroke(egui::Stroke::new(1.0, LINE)).corner_radius(6).inner_margin(egui::Margin::symmetric(12, 9)).show(ui, |ui| {
                    ui.label(RichText::new(format!("{}  {uid}", ic::IDENTIFICATION_CARD)).font(theme::mono(14.0)).color(theme::TEXT));
                });
                copy = theme::button(ui, Kind::Normal, ic::COPY, "Copier").clicked();
            });
        });
        if copy {
            ui.ctx().copy_text(uid);
            self.toast("Identifiant copié", false);
        }
        let form = self.settings_form.as_mut().unwrap();
        section(ui, "Annuaires de serveurs publics", "Un annuaire liste les serveurs publics d'Internet : ils apparaissent dans l'onglet Publics. Une adresse par ligne, jusqu'à 4. Pour en héberger un : sixm directory.", |ui| {
            ui.add(egui::TextEdit::multiline(&mut form.directories).hint_text("http://annuaire.exemple.net:30100").desired_rows(2).desired_width(f32::INFINITY));
        });
        let u = self.st.update.clone();
        let mut check = false;
        let mut apply = false;
        section(ui, "Mises à jour", "Au lancement, depuis GitHub. Jamais pendant une partie.", |ui| {
            ui.horizontal(|ui| {
                theme::switch(ui, &mut form.auto_update);
                ui.label("Mettre SixM à jour automatiquement");
            });
            let status = match u.status.as_str() {
                "current" => "À jour.".to_string(),
                "checking" => "Recherche…".into(),
                "downloading" => "Mise à jour en cours…".into(),
                "restarting" => "Redémarrage…".into(),
                "failed" => theme::cap(u.error.as_deref().unwrap_or("")),
                "available" if u.mode == "portable" => format!("La version {} est sur GitHub : remplacez votre dossier portable.", u.latest.clone().unwrap_or_default()),
                "available" => format!("Version {} disponible.", u.latest.clone().unwrap_or_default()),
                _ => String::new(),
            };
            ui.label(theme::muted(format!("Version {}. {status}", u.version)));
            ui.horizontal(|ui| {
                let busy = ["checking", "downloading", "restarting"].contains(&u.status.as_str());
                check = theme::button_if(ui, Kind::Normal, ic::ARROWS_CLOCKWISE, "Vérifier", !busy).clicked();
                if u.status == "available" && ["installed", "source"].contains(&u.mode.as_str()) {
                    apply = theme::button(ui, Kind::Primary, ic::DOWNLOAD_SIMPLE, "Installer et redémarrer").clicked();
                }
            });
        });
        if check {
            self.post("/api/update/check", json!({}));
        }
        if apply {
            self.post("/api/update/apply", json!({}));
        }
        self.save_bar(ui);
        ui.add_space(14.0);
        let mut quit = false;
        section(ui, "Fermer SixM", "Quitte le serveur en cours et arrête ceux hébergés sur ce PC. Le jeu reste ouvert.", |ui| {
            quit = theme::button(ui, Kind::Danger, ic::POWER, "Fermer SixM").clicked();
        });
        if quit {
            self.act(|api| {
                api.post("/api/quit", json!({}))?;
                Ok(Some(Box::new(|app: &mut SixmApp| app.ctx.send_viewport_cmd(egui::ViewportCommand::Close)) as Job))
            });
        }
    }

    fn games(&mut self, ui: &mut Ui) {
        let form = self.settings_form.as_mut().unwrap();
        let mut remove = None;
        section(ui, "Jeux", "Le dossier extrait de votre propre disque. SixM y trouve le programme du jeu et ne modifie rien.", |ui| {
            if form.games.is_empty() {
                ui.label(RichText::new("Aucun jeu. Sans jeu, SixM fonctionne en mode démo.").color(MUTED));
            }
            for (i, g) in form.games.iter_mut().enumerate() {
                egui::Frame::new().fill(theme::CARD_HI.gamma_multiply(0.5)).corner_radius(8).inner_margin(14).show(ui, |ui| {
                    ui.set_width(ui.available_width());
                    ui.columns(2, |c| {
                        theme::field(&mut c[0], "Nom", |ui| theme::text_edit(ui, &mut g.name, "Nom"));
                        theme::field(&mut c[1], "Version console", |ui| {
                            egui::ComboBox::from_id_salt(("console", i))
                                .selected_text(if g.console == "series-s" { "Series S" } else { "Series X" })
                                .width(ui.available_width())
                                .show_ui(ui, |ui| {
                                    ui.selectable_value(&mut g.console, "series-x".to_string(), "Series X");
                                    ui.selectable_value(&mut g.console, "series-s".to_string(), "Series S");
                                });
                        });
                    });
                    theme::field(ui, "Dossier du jeu", |ui| {
                        ui.horizontal(|ui| {
                            let w = ui.available_width() - if cfg!(windows) { 130.0 } else { 0.0 };
                            ui.add_sized(vec2(w, 36.0), egui::TextEdit::singleline(&mut g.path).hint_text("C:\\…\\dossier").margin(vec2(10.0, 0.0)).align(egui::Align2::LEFT_CENTER));
                            browse(ui, &mut g.path, true);
                        });
                    });
                    if theme::button(ui, Kind::Ghost, ic::TRASH, "Retirer").clicked() {
                        remove = Some(i);
                    }
                    g.name.truncate(40);
                });
                ui.add_space(6.0);
            }
            if theme::button(ui, Kind::Normal, ic::PLUS, "Ajouter un jeu").clicked() {
                form.games.push(Game { id: String::new(), name: String::new(), path: String::new(), console: "series-x".into() });
            }
        });
        if let Some(i) = remove {
            form.games.remove(i);
        }
        section(ui, "Emplacement de VIctory", "Rempli tout seul après l'installation. Vous pouvez aussi indiquer le vôtre.", |ui| {
            theme::field(ui, "victory.exe", |ui| {
                ui.horizontal(|ui| {
                    let w = ui.available_width() - if cfg!(windows) { 130.0 } else { 0.0 };
                    ui.add_sized(vec2(w, 36.0), egui::TextEdit::singleline(&mut form.victory).hint_text("C:\\…\\victory.exe").margin(vec2(10.0, 0.0)).align(egui::Align2::LEFT_CENTER));
                    browse(ui, &mut form.victory, false);
                });
            });
        });
        self.save_bar(ui);
    }

    fn save_bar(&mut self, ui: &mut Ui) {
        let original = &self.st.settings;
        let form = self.settings_form.clone().unwrap();
        let dirty = form.name != original.name
            || form.auto_update != original.auto_update
            || form.victory != original.victory
            || form.games != original.games
            || form.directories != original.directories.join("\n");
        ui.horizontal(|ui| {
            if theme::button_sized(ui, Kind::Primary, ic::FLOPPY_DISK, "Enregistrer", vec2(150.0, 40.0), dirty).clicked() {
                self.save_settings(form.clone());
            }
            if dirty {
                if theme::button(ui, Kind::Ghost, "", "Annuler les modifications").clicked() {
                    self.settings_form = None;
                }
                ui.with_layout(Layout::left_to_right(Align::Center), |ui| {
                    ui.label(RichText::new("Modifications non enregistrées").color(theme::YELLOW).size(13.0));
                });
            }
        });
        if form.name.trim().is_empty() {
            ui.label(RichText::new("Le pseudo ne peut pas être vide.").color(RED));
        }
    }

    fn save_settings(&self, form: SettingsForm) {
        let known: Vec<String> = self.st.settings.games.iter().map(|g| g.id.clone()).collect();
        let games: Vec<Game> = form.games.iter().map(|g| Game { path: unquote(&g.path), ..g.clone() }).collect();
        let directories: Vec<String> = form.directories.lines().map(|l| l.trim().trim_end_matches('/').to_string()).filter(|l| !l.is_empty()).take(4).collect();
        let body = json!({ "name": form.name, "autoUpdate": form.auto_update, "victory": unquote(&form.victory), "games": games, "directories": directories });
        self.act(move |api| {
            let saved = api.post("/api/settings", body)?;
            // Un jeu tout juste ajouté devient le jeu choisi.
            let list: Vec<Game> = serde_json::from_value(saved.get("games").cloned().unwrap_or_default()).unwrap_or_default();
            if let Some(added) = list.iter().find(|g| !known.contains(&g.id)) {
                api.post("/api/settings", json!({ "target": added.id }))?;
            }
            // Signale un dossier incomplet.
            let mut problems = Vec::new();
            for g in list.iter().filter(|g| !g.path.is_empty()) {
                if let Err(e) = api.post("/api/game/check", json!({ "path": g.path })) {
                    problems.push(format!("{} : {e}", g.name));
                }
            }
            Ok(Some(Box::new(move |app: &mut SixmApp| {
                app.settings_form = None;
                app.listed_at = None; // annuaires peut-être changés
                app.toast("Réglages enregistrés", false);
                for p in problems {
                    app.toast(&p, true);
                }
            }) as Job))
        });
    }
}
