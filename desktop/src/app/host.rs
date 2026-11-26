//! Serveurs hébergés sur ce PC.

use super::victory::log_box;
use super::{page, Dialog, HostTab, Job, SixmApp};
use crate::api::Host;
use crate::theme::{self, ic, Kind, ACCENT, CARD, CARD_HI, DIM, GREEN, LINE, MUTED, RED, TEXT, YELLOW};
use eframe::egui::{self, pos2, vec2, Align, Align2, Color32, Layout, Rect, RichText, Sense, Stroke, StrokeKind, Ui};
use serde_json::{json, Value};
use std::path::PathBuf;

pub struct HostForm {
    pub name: String,
    pub description: String,
    pub max_players: String,
    pub port: String,
    pub password: String,
    pub remove_password: bool,
    pub has_password: bool,
    pub public: bool,
    pub whitelist: bool,
    pub tags: String,
    pub motd: String,
    pub directories: String,
}

impl HostForm {
    pub fn new(port: u32) -> HostForm {
        HostForm {
            name: String::new(),
            description: String::new(),
            max_players: "32".into(),
            port: port.to_string(),
            password: String::new(),
            remove_password: false,
            has_password: false,
            public: true,
            whitelist: false,
            tags: String::new(),
            motd: String::new(),
            directories: String::new(),
        }
    }

    pub fn from_host(h: &Host) -> HostForm {
        HostForm {
            name: h.name.clone(),
            description: h.description.clone(),
            max_players: h.max_players.to_string(),
            port: h.port.to_string(),
            password: String::new(),
            remove_password: false,
            has_password: h.has_password,
            public: h.visibility != "private",
            whitelist: h.whitelist,
            tags: h.tags.join(", "),
            motd: h.motd.clone(),
            directories: h.directories.join("\n"),
        }
    }

    pub fn ui(&mut self, ui: &mut Ui, full: bool) {
        theme::field(ui, "Nom", |ui| theme::text_edit(ui, &mut self.name, "Mon serveur"));
        if full {
            theme::field(ui, "Description", |ui| theme::text_edit(ui, &mut self.description, "Visible dans la liste des serveurs"));
        }
        ui.columns(if full { 3 } else { 2 }, |c| {
            theme::field(&mut c[0], "Places", |ui| theme::text_edit(ui, &mut self.max_players, "32"));
            theme::field(&mut c[1], "Port", |ui| theme::text_edit(ui, &mut self.port, "30120"));
            if full {
                let hint = if self.has_password { "inchangé" } else { "aucun" };
                theme::field(&mut c[2], "Nouveau mot de passe", |ui| theme::password_edit(ui, &mut self.password, hint));
            }
        });
        if !full {
            theme::field(ui, "Mot de passe (facultatif)", |ui| theme::password_edit(ui, &mut self.password, "aucun"));
        }
        if full && self.has_password {
            ui.horizontal(|ui| {
                theme::switch(ui, &mut self.remove_password);
                ui.label("Retirer le mot de passe");
            });
        }
        ui.add_space(4.0);
        theme::field(ui, "Visibilité", |ui| {
            ui.horizontal(|ui| {
                if choice_chip(ui, ic::GLOBE, "Public", "Annoncé sur votre réseau local et dans les annuaires.", self.public).clicked() {
                    self.public = true;
                }
                if choice_chip(ui, ic::EYE_SLASH, "Privé", "Seulement avec l'adresse. La liste des joueurs reste cachée.", !self.public).clicked() {
                    self.public = false;
                }
            });
        });
        ui.horizontal(|ui| {
            theme::switch(ui, &mut self.whitelist);
            ui.vertical(|ui| {
                ui.spacing_mut().item_spacing.y = 2.0;
                ui.label(theme::strong("Liste blanche", 14.0));
                ui.label(theme::muted("Seuls les joueurs que vous acceptez peuvent entrer. Les autres envoient une demande."));
            });
        });
        if full {
            ui.add_space(4.0);
            theme::field(ui, "Tags (séparés par des virgules)", |ui| theme::text_edit(ui, &mut self.tags, "RP, FR, Course"));
            theme::field(ui, "Message d'accueil", |ui| theme::text_edit(ui, &mut self.motd, "Affiché aux joueurs à leur arrivée"));
            if self.public {
                theme::field(ui, "Annuaires où s'inscrire (un par ligne)", |ui| {
                    ui.add(egui::TextEdit::multiline(&mut self.directories).hint_text("http://annuaire.exemple.net:30100").desired_rows(2).desired_width(f32::INFINITY))
                });
            }
            self.motd.truncate(256);
        }
        self.name.truncate(64);
        self.description.truncate(256);
        self.password.truncate(128);
    }

    pub fn value(&self) -> Result<Value, String> {
        let name = self.name.trim();
        if name.is_empty() {
            return Err("donnez un nom au serveur".into());
        }
        let max: u32 = self.max_players.trim().parse().ok().filter(|n| (1..=1024).contains(n)).ok_or("places : entre 1 et 1024")?;
        let port: u32 = self.port.trim().parse().ok().filter(|n| (1..=65535).contains(n)).ok_or("port : entre 1 et 65535")?;
        let tags: Vec<String> = self.tags.split(',').map(|t| t.trim().chars().take(24).collect::<String>()).filter(|t| !t.is_empty()).take(8).collect();
        let directories: Vec<String> = self.directories.lines().map(|l| l.trim().trim_end_matches('/').to_string()).filter(|l| !l.is_empty()).collect();
        if directories.len() > 4 || directories.iter().any(|d| !(d.starts_with("http://") || d.starts_with("https://")) || d.split("://").nth(1).is_none_or(|h| h.is_empty() || h.contains('/'))) {
            return Err("annuaires : jusqu'à 4 adresses http://hôte:port".into());
        }
        let mut v = json!({
            "name": name, "description": self.description.trim(), "maxPlayers": max, "port": port,
            "visibility": if self.public { "public" } else { "private" }, "whitelist": self.whitelist,
            "tags": tags, "motd": self.motd.trim(), "directories": directories,
        });
        if !self.password.is_empty() {
            v["password"] = json!(self.password);
        } else if self.remove_password {
            v["password"] = json!("");
        }
        Ok(v)
    }
}

const STATUS: [(&str, &str); 5] = [("stopped", "Arrêté"), ("starting", "Démarrage…"), ("running", "En ligne"), ("stopping", "Arrêt…"), ("failed", "En erreur")];

fn status(h: &Host) -> (&'static str, Color32) {
    let word = STATUS.iter().find(|s| s.0 == h.status).map(|s| s.1).unwrap_or("Arrêté");
    let color = match h.status.as_str() {
        "running" => GREEN,
        "failed" => RED,
        "starting" | "stopping" => YELLOW,
        _ => MUTED,
    };
    (word, color)
}

/// Enregistre un fichier téléchargé : boîte de dialogue sous Windows, sinon le dossier Téléchargements.
fn save_file(name: &str, data: &[u8]) -> Result<Option<String>, String> {
    #[cfg(windows)]
    let target: Option<PathBuf> = rfd::FileDialog::new().set_file_name(name).add_filter("Zip", &["zip"]).save_file();
    #[cfg(not(windows))]
    let target: Option<PathBuf> = {
        let home = PathBuf::from(std::env::var_os("HOME").unwrap_or_default());
        let dir = if home.join("Downloads").is_dir() { home.join("Downloads") } else { home };
        Some(dir.join(name))
    };
    let Some(path) = target else { return Ok(None) };
    std::fs::write(&path, data).map_err(|e| format!("écriture impossible : {e}"))?;
    Ok(Some(path.display().to_string()))
}

impl SixmApp {
    pub fn create_host(&mut self) {
        let used: Vec<u32> = self.st.hosts.iter().map(|h| h.port).collect();
        let mut port = 30120;
        while used.contains(&port) {
            port += 1;
        }
        self.dialog = Some(Dialog::CreateHost(HostForm::new(port)));
    }

    fn download(&self, id: Option<String>, name: String) {
        self.act(move |api| {
            let data = api.post_bytes("/api/pack", id.map(|i| json!({ "id": i })).unwrap_or(json!({})))?;
            let saved = save_file(&name, &data)?;
            Ok(Some(Box::new(move |app: &mut SixmApp| {
                if let Some(p) = saved {
                    app.toast(&format!("Enregistré : {p}"), false);
                }
            }) as Job))
        });
    }

    fn import_mod(&self, id: String, path: PathBuf) {
        self.act(move |api| {
            let file = path.file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_default();
            if !file.to_lowercase().ends_with(".zip") {
                return Err("choisissez un fichier .zip".into());
            }
            let data = std::fs::read(&path).map_err(|e| format!("lecture impossible : {e}"))?;
            let res = api.import_mod(&id, &file, data)?;
            let name = res.get("name").and_then(|n| n.as_str()).unwrap_or(&file).to_string();
            Ok(Some(Box::new(move |app: &mut SixmApp| app.toast(&format!("Mod « {name} » installé. Activez-le pour l'utiliser."), false)) as Job))
        });
    }

    pub fn host(&mut self, ui: &mut Ui) {
        let host = self.host_id.as_ref().and_then(|id| self.st.hosts.iter().find(|h| &h.id == id)).cloned();
        match host {
            Some(h) => self.host_detail(ui, h),
            None => {
                self.host_id = None;
                self.hosts_list(ui);
            }
        }
    }

    fn hosts_list(&mut self, ui: &mut Ui) {
        page(ui, "hosts", 1180.0, |ui| {
            ui.label(theme::title("Hébergez votre serveur", 28.0));
            ui.label(RichText::new("Vos règles, vos mods, vos joueurs.").font(theme::f(15.0)).color(MUTED));
            ui.add_space(20.0);
            let w = ui.available_width();
            if !self.st.hosts.is_empty() {
                theme::caption(ui, "Vos serveurs");
                ui.add_space(4.0);
                let n = ((w + 12.0) / 300.0).floor().max(1.0);
                let tw = ((w - (n - 1.0) * 12.0) / n).floor() - 1.0;
                let hosts = self.st.hosts.clone();
                ui.horizontal_wrapped(|ui| {
                    ui.spacing_mut().item_spacing = vec2(12.0, 12.0);
                    for h in &hosts {
                        if host_card(ui, tw, h) {
                            self.host_id = Some(h.id.clone());
                            self.host_tab = if !h.access.requests.is_empty() || h.status == "running" { HostTab::Players } else { HostTab::Settings };
                            self.host_form = None;
                        }
                    }
                });
                ui.add_space(26.0);
                theme::caption(ui, "Nouveau serveur");
                ui.add_space(4.0);
            }
            ui.horizontal_top(|ui| {
                let cw = (w - 12.0) / 2.0;
                ui.vertical(|ui| {
                    ui.set_width(cw);
                    choice(ui, ic::DESKTOP_TOWER, "Sur ce PC", "Prêt en deux clics. Il tourne tant que SixM est ouvert.", |ui| {
                        if theme::button(ui, Kind::Primary, ic::PLUS, "Créer un serveur").clicked() {
                            self.create_host();
                        }
                    });
                });
                ui.add_space(4.0);
                ui.vertical(|ui| {
                    ui.set_width(cw);
                    choice(ui, ic::CLOUD_ARROW_UP, "Sur un hébergement", "Un zip pour un VPS, un autre PC ou Docker. Il faut seulement Node.js.", |ui| {
                        if theme::button(ui, Kind::Normal, ic::DOWNLOAD_SIMPLE, "Télécharger le serveur").clicked() {
                            self.download(None, "SixM-Server.zip".into());
                        }
                    });
                });
            });
        });
    }

    fn host_detail(&mut self, ui: &mut Ui, h: Host) {
        let id = h.id.clone();
        page(ui, "host", 1180.0, |ui| {
            if theme::button(ui, Kind::Ghost, ic::ARROW_LEFT, "Mes serveurs").clicked() {
                self.host_id = None;
                self.host_form = None;
                return;
            }
            ui.add_space(6.0);
            theme::card().show(ui, |ui| {
                ui.set_width(ui.available_width());
                ui.horizontal(|ui| {
                    theme::hex_avatar(ui, 58.0, &h.name, false);
                    ui.add_space(4.0);
                    ui.vertical(|ui| {
                        ui.label(theme::title(&h.name, 24.0));
                        ui.horizontal(|ui| {
                            let (word, color) = status(&h);
                            theme::pill(ui, word, color);
                            if h.port > 0 {
                                ui.label(theme::muted(format!("Port {}", h.port)));
                            }
                            let on = h.mods.iter().filter(|m| m.enabled).count();
                            ui.label(theme::muted(format!("·  {on} mod(s) actif(s)")));
                            if h.visibility == "private" {
                                theme::pill(ui, "Privé", MUTED);
                            } else {
                                theme::pill(ui, "Public", ACCENT);
                            }
                            if h.whitelist {
                                theme::pill(ui, "Liste blanche", YELLOW);
                            }
                        });
                    });
                    ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                        let on = ["running", "starting"].contains(&h.status.as_str());
                        let enabled = h.status != "stopping" && h.broken.is_none();
                        let (kind, icon, text) = if on { (Kind::Danger, ic::STOP, "Arrêter") } else { (Kind::Primary, ic::POWER, "Démarrer") };
                        if theme::button_sized(ui, kind, icon, text, vec2(130.0, 42.0), enabled).clicked() {
                            self.post(if on { "/api/hosts/stop" } else { "/api/hosts/start" }, json!({ "id": id }));
                        }
                        if h.status == "running" && self.session_idle() && theme::button_sized(ui, Kind::Normal, ic::PLAY, "Jouer dessus", vec2(0.0, 42.0), true).clicked() {
                            self.post("/api/hosts/play", json!({ "id": id }));
                        }
                    });
                });
            });
            if h.stale && h.status == "running" {
                ui.add_space(10.0);
                note(ui, YELLOW, ic::INFO, "Réglages modifiés : arrêtez puis démarrez le serveur pour les appliquer.");
            }
            if let Some(b) = &h.broken {
                ui.add_space(10.0);
                note(ui, RED, ic::WARNING_CIRCLE, b);
                return;
            }
            ui.add_space(16.0);
            ui.horizontal(|ui| {
                ui.spacing_mut().item_spacing.x = 2.0;
                let waiting = h.access.requests.len();
                let players_label = if waiting > 0 { format!("Joueurs ({waiting} demande{})", if waiting > 1 { "s" } else { "" }) } else { format!("Joueurs ({})", h.players.len()) };
                for (tab, icon, label) in [
                    (HostTab::Players, ic::USERS, players_label.as_str()),
                    (HostTab::Console, ic::TERMINAL_WINDOW, "Console"),
                    (HostTab::Mods, ic::PUZZLE_PIECE, "Mods"),
                    (HostTab::Settings, ic::SLIDERS_HORIZONTAL, "Réglages"),
                    (HostTab::Share, ic::SHARE_NETWORK, "Partager"),
                ] {
                    if underline_tab(ui, icon, label, self.host_tab == tab).clicked() {
                        self.host_tab = tab;
                    }
                }
            });
            let (r, _) = ui.allocate_exact_size(vec2(ui.available_width(), 1.0), Sense::hover());
            ui.painter().rect_filled(r, 0, LINE);
            ui.add_space(16.0);
            match self.host_tab {
                HostTab::Players => self.players_tab(ui, &h),
                HostTab::Console => self.console_tab(ui, &h),
                HostTab::Mods => self.mods_tab(ui, &h),
                HostTab::Settings => self.host_settings_tab(ui, &h),
                HostTab::Share => self.share_tab(ui, &h),
            }
        });
    }

    fn players_tab(&mut self, ui: &mut Ui, h: &Host) {
        let id = h.id.clone();
        let access = |app: &SixmApp, action: &str, uid: &str, name: &str| {
            app.post("/api/hosts/access", json!({ "id": id, "action": action, "uid": uid, "name": name }));
        };

        // Demandes d'accès d'abord : c'est ce qui attend l'hôte.
        if h.whitelist || !h.access.requests.is_empty() {
            theme::caption(ui, &format!("Demandes d'accès ({})", h.access.requests.len()));
            if h.access.requests.is_empty() {
                ui.label(theme::muted("Aucune demande. Un joueur refusé par la liste blanche apparaît ici."));
            }
            for r in &h.access.requests {
                person_row(ui, &r.name, &r.uid, &format!("le {}", short_date(&r.at)), |ui| {
                    if theme::button(ui, Kind::Ghost, ic::X, "Refuser").clicked() {
                        access(self, "deny", &r.uid, &r.name);
                    }
                    if theme::button(ui, Kind::Primary, ic::CHECK, "Accepter").clicked() {
                        access(self, "approve", &r.uid, &r.name);
                    }
                });
            }
            ui.add_space(14.0);
        }

        theme::caption(ui, &format!("Connectés ({})", h.players.len()));
        if h.status != "running" {
            ui.label(theme::muted("Démarrez le serveur pour voir les joueurs."));
        } else if h.players.is_empty() {
            ui.label(theme::muted("Personne pour l'instant."));
        }
        for p in &h.players {
            let uid = p.uid.clone().unwrap_or_default();
            let sub = if uid.is_empty() { format!("#{}  ·  sans identité", p.id) } else { format!("#{}  ·  {uid}", p.id) };
            person_row(ui, &p.name, &sub, if p.admin { "Admin" } else { "" }, |ui| {
                let act = |app: &SixmApp, action: &str| app.post("/api/hosts/player", json!({ "id": h.id, "player": p.id, "action": action }));
                if theme::button(ui, Kind::Danger, ic::PROHIBIT, "Bannir").clicked() {
                    let (hid, pid, name) = (h.id.clone(), p.id, p.name.clone());
                    self.confirm(
                        &format!("Bannir {name} ?"),
                        "Par son adresse IP et son identifiant. Levez le bannissement depuis la console (bans, unban).",
                        "Bannir",
                        Box::new(move |app: &mut SixmApp| app.post("/api/hosts/player", json!({ "id": hid, "player": pid, "action": "ban" }))),
                    );
                }
                if theme::button(ui, Kind::Normal, ic::SIGN_OUT, "Expulser").clicked() {
                    act(self, "kick");
                }
                if !uid.is_empty() {
                    let (icon, text, action) = if p.admin { (ic::CROWN, "Retirer admin", "unadmin") } else { (ic::CROWN, "Nommer admin", "admin") };
                    if theme::button(ui, Kind::Ghost, icon, text).clicked() {
                        act(self, action);
                    }
                }
            });
        }
        ui.add_space(14.0);

        theme::caption(ui, &format!("Liste blanche ({})", h.access.whitelist.len()));
        if !h.whitelist {
            ui.label(theme::muted("Désactivée : tout le monde peut entrer. Activez-la dans Réglages."));
        }
        for e in &h.access.whitelist {
            person_row(ui, &e.name, &e.uid, "", |ui| {
                if theme::button(ui, Kind::Ghost, ic::TRASH, "Retirer").clicked() {
                    access(self, "remove", &e.uid, &e.name);
                }
            });
        }
        ui.horizontal(|ui| {
            let w = ui.available_width() - 130.0;
            theme::input(ui, &mut self.host_uid, "Ajouter un identifiant : sixm:…", ic::IDENTIFICATION_CARD, w);
            let uid = self.host_uid.trim().to_string();
            if theme::button_sized(ui, Kind::Normal, ic::PLUS, "Ajouter", vec2(120.0, 38.0), uid.starts_with("sixm:")).clicked() {
                access(self, "approve", &uid, "");
                self.host_uid.clear();
            }
        });
        ui.add_space(14.0);

        theme::caption(ui, &format!("Administrateurs ({})", h.access.admins.len()));
        ui.label(theme::muted("Ils voient le menu Administration en jeu (touche M) et passent la liste blanche."));
        for e in &h.access.admins {
            person_row(ui, &e.name, &e.uid, "Admin", |ui| {
                if theme::button(ui, Kind::Ghost, ic::TRASH, "Retirer").clicked() {
                    access(self, "unadmin", &e.uid, &e.name);
                }
            });
        }
    }

    fn console_tab(&mut self, ui: &mut Ui, h: &Host) {
        let lines = if h.log.is_empty() { vec!["Démarrez le serveur pour voir son activité.".to_string()] } else { h.log.clone() };
        log_box(ui, "console", &lines, 380.0);
        ui.add_space(8.0);
        ui.add_enabled_ui(h.status == "running", |ui| {
            ui.horizontal(|ui| {
                let w = ui.available_width() - 120.0;
                let r = theme::input(ui, &mut self.command, "Commande : help, players, say bonjour…", ic::CARET_RIGHT, w);
                let enter = r.lost_focus() && ui.input(|i| i.key_pressed(egui::Key::Enter));
                if theme::button_sized(ui, Kind::Normal, "", "Envoyer", vec2(110.0, 38.0), h.status == "running").clicked() || enter {
                    let line = self.command.trim().to_string();
                    self.command.clear();
                    if !line.is_empty() {
                        self.post("/api/hosts/command", json!({ "id": h.id, "line": line }));
                    }
                    r.request_focus();
                }
            });
        });
    }

    fn mods_tab(&mut self, ui: &mut Ui, h: &Host) {
        for m in &h.mods {
            egui::Frame::new().fill(CARD).stroke(Stroke::new(1.0, LINE)).corner_radius(8).inner_margin(14).show(ui, |ui| {
                ui.set_width(ui.available_width());
                ui.horizontal(|ui| {
                    ui.label(RichText::new(ic::PUZZLE_PIECE).size(20.0).color(if m.enabled { ACCENT } else { DIM }));
                    ui.vertical(|ui| {
                        ui.spacing_mut().item_spacing.y = 2.0;
                        ui.label(theme::strong(&m.name, 14.5));
                        if let Some(b) = &m.broken {
                            ui.label(RichText::new(b).color(RED));
                        } else if !m.description.is_empty() {
                            ui.label(theme::muted(&m.description));
                        }
                    });
                    ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                        let mut on = m.enabled;
                        ui.add_enabled_ui(m.broken.is_none(), |ui| {
                            if theme::switch(ui, &mut on).changed() {
                                self.post("/api/hosts/mod", json!({ "id": h.id, "name": m.name, "enabled": on }));
                            }
                        });
                        if m.client {
                            theme::tag(ui, "client");
                        }
                        if m.server {
                            theme::tag(ui, "serveur");
                        }
                    });
                });
            });
            ui.add_space(6.0);
        }
        ui.add_space(6.0);

        // Zone de dépôt.
        let hovering = ui.input(|i| !i.raw.hovered_files.is_empty());
        let (rect, _) = ui.allocate_exact_size(vec2(ui.available_width(), 190.0), Sense::hover());
        let p = ui.painter();
        p.rect_filled(rect, 10, if hovering { ACCENT.gamma_multiply(0.08) } else { CARD.gamma_multiply(0.6) });
        let color = if hovering { ACCENT } else { LINE.lerp_to_gamma(DIM, 0.4) };
        dashed_rect(ui, rect.shrink(1.0), color);
        p.text(rect.center() - vec2(0.0, 52.0), Align2::CENTER_CENTER, ic::PACKAGE, theme::f(34.0), if hovering { ACCENT } else { MUTED });
        p.text(rect.center() - vec2(0.0, 16.0), Align2::CENTER_CENTER, "Déposez un mod ici", theme::fs(17.0), TEXT);
        p.text(rect.center() + vec2(0.0, 8.0), Align2::CENTER_CENTER, "Un fichier .zip. Les joueurs le reçoivent en se connectant.", theme::f(13.0), MUTED);
        let row = Rect::from_center_size(rect.center() + vec2(0.0, 52.0), vec2(rect.width(), 36.0));
        ui.scope_builder(egui::UiBuilder::new().max_rect(row).layout(Layout::left_to_right(Align::Center)), |ui| {
            let w = if cfg!(windows) { 380.0 } else { 240.0 };
            ui.add_space((row.width() - w) / 2.0);
            #[cfg(windows)]
            if theme::button(ui, Kind::Normal, ic::FILE_ZIP, "Choisir un zip").clicked() {
                if let Some(path) = rfd::FileDialog::new().add_filter("Zip", &["zip"]).pick_file() {
                    self.import_mod(h.id.clone(), path);
                }
            }
            if theme::button(ui, Kind::Ghost, ic::FOLDER_OPEN, "Ouvrir le dossier des mods").clicked() {
                self.post("/api/hosts/open", json!({ "id": h.id }));
            }
        });
        let dropped: Vec<PathBuf> = ui.input(|i| i.raw.dropped_files.iter().map(|f| f.path().to_path_buf()).filter(|p| !p.as_os_str().is_empty()).collect());
        for path in dropped {
            self.import_mod(h.id.clone(), path);
        }
        ui.add_space(8.0);
        ui.label(RichText::new(format!("{}  Les scripts serveur d'un mod ont accès à votre PC : n'activez que des mods de confiance.", ic::SHIELD_WARNING)).color(MUTED).size(12.5));
    }

    fn host_settings_tab(&mut self, ui: &mut Ui, h: &Host) {
        if self.host_form.as_ref().is_none_or(|(id, _)| id != &h.id) {
            self.host_form = Some((h.id.clone(), HostForm::from_host(h)));
        }
        let mut save = None;
        theme::card().show(ui, |ui| {
            ui.set_width(ui.available_width().min(760.0));
            let (_, form) = self.host_form.as_mut().unwrap();
            form.ui(ui, true);
            ui.add_space(8.0);
            if theme::button(ui, Kind::Primary, ic::FLOPPY_DISK, "Enregistrer").clicked() {
                save = Some(form.value());
            }
        });
        match save {
            Some(Ok(mut body)) => {
                body["id"] = json!(h.id);
                self.act(move |api| {
                    api.post("/api/hosts/update", body)?;
                    Ok(Some(Box::new(|app: &mut SixmApp| {
                        app.host_form = None; // relu depuis les valeurs enregistrées
                        app.toast("Réglages enregistrés", false);
                    }) as Job))
                });
            }
            Some(Err(e)) => self.toast(&e, true),
            None => {}
        }
    }

    fn share_tab(&mut self, ui: &mut Ui, h: &Host) {
        let mut rows = vec![("Sur ce PC", format!("localhost:{}", h.port))];
        if let Some(lan) = &self.st.lan {
            rows.push(("Sur votre réseau local", format!("{lan}:{}", h.port)));
        }
        for (label, address) in rows {
            egui::Frame::new().fill(CARD).stroke(Stroke::new(1.0, LINE)).corner_radius(8).inner_margin(14).show(ui, |ui| {
                ui.set_width(ui.available_width());
                ui.horizontal(|ui| {
                    ui.vertical(|ui| {
                        ui.spacing_mut().item_spacing.y = 2.0;
                        ui.label(RichText::new(&address).font(theme::mono(15.0)).color(TEXT));
                        ui.label(theme::muted(label));
                    });
                    ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                        if theme::button(ui, Kind::Normal, ic::COPY, "Copier").clicked() {
                            ui.ctx().copy_text(address.clone());
                            self.toast("Adresse copiée", false);
                        }
                    });
                });
            });
            ui.add_space(6.0);
        }
        ui.add_space(8.0);
        ui.horizontal_top(|ui| {
            let cw = (ui.available_width() - 12.0) / 2.0;
            ui.vertical(|ui| {
                ui.set_width(cw);
                choice(
                    ui,
                    ic::GLOBE,
                    "Par Internet",
                    &format!("Ouvrez le port TCP {} dans le pare-feu et sur votre box, puis donnez votre IP publique. La connexion n'est pas chiffrée, mot de passe compris.", h.port),
                    |_| {},
                );
            });
            ui.add_space(4.0);
            ui.vertical(|ui| {
                ui.set_width(cw);
                choice(ui, ic::CLOUD_ARROW_UP, "Déplacer sur un hébergement", "Le zip contient ce serveur, ses réglages (mot de passe compris) et ses mods. Sur la machine : start.bat, start.sh ou Docker.", |ui| {
                    if theme::button(ui, Kind::Primary, ic::DOWNLOAD_SIMPLE, "Télécharger ce serveur").clicked() {
                        self.download(Some(h.id.clone()), format!("{}.zip", h.id));
                    }
                });
            });
        });
    }
}

/// Ligne d'une personne : avatar, nom, identifiant, actions à droite.
fn person_row(ui: &mut Ui, name: &str, sub: &str, badge: &str, actions: impl FnOnce(&mut Ui)) {
    egui::Frame::new().fill(CARD).stroke(Stroke::new(1.0, LINE)).corner_radius(8).inner_margin(egui::Margin::symmetric(14, 10)).show(ui, |ui| {
        ui.set_width(ui.available_width());
        ui.horizontal(|ui| {
            let shown = if name.is_empty() { "?" } else { name };
            theme::hex_avatar(ui, 32.0, shown, false);
            ui.vertical(|ui| {
                ui.spacing_mut().item_spacing.y = 1.0;
                ui.horizontal(|ui| {
                    ui.label(theme::strong(if name.is_empty() { "Sans nom" } else { name }, 14.5));
                    if !badge.is_empty() {
                        theme::tag(ui, badge);
                    }
                });
                ui.label(RichText::new(sub).font(theme::mono(11.5)).color(MUTED));
            });
            ui.with_layout(Layout::right_to_left(Align::Center), actions);
        });
    });
    ui.add_space(4.0);
}

fn short_date(iso: &str) -> String {
    // 2026-11-26T08:54:55Z -> 26/11 à 08:54
    let (d, t) = iso.split_once('T').unwrap_or((iso, ""));
    let parts: Vec<&str> = d.split('-').collect();
    if parts.len() == 3 && t.len() >= 5 { format!("{}/{} à {}", parts[2], parts[1], &t[..5]) } else { iso.to_string() }
}

/// Carte de choix exclusive (Public / Privé).
fn choice_chip(ui: &mut Ui, icon: &str, title: &str, text: &str, on: bool) -> egui::Response {
    let w = ((ui.available_width() - 8.0) / 2.0).max(160.0);
    let (rect, resp) = ui.allocate_exact_size(vec2(w, 64.0), Sense::click());
    let t = ui.ctx().animate_bool_with_time(resp.id, on, 0.12);
    let p = ui.painter();
    p.rect_filled(rect, 8, CARD.lerp_to_gamma(ACCENT.gamma_multiply(0.14), t));
    p.rect_stroke(rect, 8, Stroke::new(1.0, LINE.lerp_to_gamma(ACCENT, t)), StrokeKind::Inside);
    p.text(pos2(rect.left() + 22.0, rect.center().y), Align2::CENTER_CENTER, icon, theme::f(20.0), if on { ACCENT } else { MUTED });
    p.text(pos2(rect.left() + 42.0, rect.top() + 20.0), Align2::LEFT_CENTER, title, theme::fs(14.0), TEXT);
    let g = p.layout(text.to_string(), theme::f(12.0), MUTED, rect.width() - 52.0);
    p.galley(pos2(rect.left() + 42.0, rect.top() + 32.0), g, MUTED);
    resp.on_hover_cursor(egui::CursorIcon::PointingHand)
}

fn host_card(ui: &mut Ui, w: f32, h: &Host) -> bool {
    let (rect, resp) = ui.allocate_exact_size(vec2(w, 104.0), Sense::click());
    let t = ui.ctx().animate_bool_with_time(resp.id, resp.hovered(), 0.12);
    let p = ui.painter();
    p.rect_filled(rect, 10, CARD.lerp_to_gamma(CARD_HI, t));
    p.rect_stroke(rect, 10, Stroke::new(1.0, LINE.lerp_to_gamma(ACCENT.gamma_multiply(0.6), t)), StrokeKind::Inside);
    theme::paint_hex(ui, pos2(rect.left() + 38.0, rect.top() + 38.0), 21.0, &h.name, theme::name_color(&h.name));
    p.text(pos2(rect.left() + 70.0, rect.top() + 28.0), Align2::LEFT_CENTER, &h.name, theme::fs(15.5), TEXT);
    let sub = match &h.broken {
        Some(_) => "server.json invalide".to_string(),
        None => format!("Port {}  ·  {} mod(s)", h.port, h.mods.iter().filter(|m| m.enabled).count()),
    };
    p.text(pos2(rect.left() + 70.0, rect.top() + 50.0), Align2::LEFT_CENTER, sub, theme::f(12.5), MUTED);
    let (word, color) = status(h);
    let pr = Rect::from_min_size(pos2(rect.left() + 16.0, rect.bottom() - 32.0), vec2(rect.width() - 32.0, 22.0));
    let mut flags = vec![if h.visibility == "private" { "Privé" } else { "Public" }];
    if h.whitelist {
        flags.push("Liste blanche");
    }
    if !h.access.requests.is_empty() {
        flags.push("Demandes en attente");
    }
    p.text(pos2(pr.right() - 22.0, pr.center().y), Align2::RIGHT_CENTER, flags.join("  ·  "), theme::f(12.0), if h.access.requests.is_empty() { DIM } else { YELLOW });
    p.circle_filled(pos2(pr.left() + 4.0, pr.center().y), 4.0, color);
    p.text(pos2(pr.left() + 14.0, pr.center().y), Align2::LEFT_CENTER, word, theme::fs(12.5), color);
    p.text(pos2(pr.right(), pr.center().y), Align2::RIGHT_CENTER, ic::CARET_RIGHT, theme::f(15.0), DIM.lerp_to_gamma(TEXT, t));
    resp.on_hover_cursor(egui::CursorIcon::PointingHand).clicked()
}

fn choice(ui: &mut Ui, icon: &str, title: &str, text: &str, add: impl FnOnce(&mut Ui)) {
    theme::card().inner_margin(22).show(ui, |ui| {
        ui.set_width(ui.available_width());
        ui.set_min_height(170.0);
        let (r, _) = ui.allocate_exact_size(vec2(46.0, 46.0), Sense::hover());
        ui.painter().rect_filled(r, 10, ACCENT.gamma_multiply(0.14));
        ui.painter().text(r.center(), Align2::CENTER_CENTER, icon, theme::f(22.0), ACCENT);
        ui.add_space(4.0);
        ui.label(theme::title(title, 18.0));
        ui.add(egui::Label::new(theme::muted(text)).wrap());
        ui.add_space(6.0);
        add(ui);
    });
}

fn note(ui: &mut Ui, color: Color32, icon: &str, text: &str) {
    egui::Frame::new().fill(color.gamma_multiply(0.1)).corner_radius(8).inner_margin(12).show(ui, |ui| {
        ui.set_width(ui.available_width());
        ui.horizontal(|ui| {
            ui.label(RichText::new(icon).size(18.0).color(color));
            ui.add(egui::Label::new(RichText::new(text).color(TEXT)).wrap());
        });
    });
}

pub fn underline_tab(ui: &mut Ui, icon: &str, label: &str, active: bool) -> egui::Response {
    let g = ui.painter().layout_no_wrap(format!("{icon}  {label}"), theme::fs(14.0), Color32::PLACEHOLDER);
    let (rect, resp) = ui.allocate_exact_size(vec2(g.size().x + 30.0, 40.0), Sense::click());
    let t = ui.ctx().animate_bool_with_time(resp.id, resp.hovered() || active, 0.1);
    ui.painter().galley(rect.center() - g.size() / 2.0, g, MUTED.lerp_to_gamma(TEXT, t));
    if active {
        let bar = Rect::from_min_max(pos2(rect.left() + 8.0, rect.bottom() - 2.0), pos2(rect.right() - 8.0, rect.bottom()));
        ui.painter().rect_filled(bar, 1, ACCENT);
    }
    resp.on_hover_cursor(egui::CursorIcon::PointingHand)
}

fn dashed_rect(ui: &Ui, r: Rect, color: Color32) {
    let p = ui.painter();
    let stroke = Stroke::new(1.5, color);
    let pts = [r.left_top(), r.right_top(), r.right_bottom(), r.left_bottom(), r.left_top()];
    for w in pts.windows(2) {
        p.extend(egui::Shape::dashed_line(&[w[0], w[1]], stroke, 8.0, 6.0));
    }
}
