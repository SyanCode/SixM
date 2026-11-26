//! Application : barre du haut, vues, dialogues et notifications.

mod host;
mod play;
mod session;
mod settings;
mod victory;

use crate::api::{self, Api, Hub, ServerInfo, State};
use crate::backend;
use crate::theme::{self, ic, Kind, ACCENT, BAR, DIM, GREEN, LINE, MUTED, RED, TEXT};
use eframe::egui::{self, pos2, vec2, Align, Align2, Color32, CornerRadius, Id, Layout, Rect, RichText, Sense, Stroke, Ui};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

pub type Job = Box<dyn FnOnce(&mut SixmApp) + Send>;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum View {
    Home,
    Servers,
    Session,
    Host,
    Settings,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum HostTab {
    Console,
    Mods,
    Settings,
    Share,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum ListTab {
    All,
    Favorites,
    Recents,
    Mine,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum SettingsTab {
    General,
    Games,
    Victory,
}

pub enum Dialog {
    Password { address: String, retry: bool, value: String },
    CreateHost(host::HostForm),
    Confirm { title: String, text: String, button: String, action: Option<Job> },
}

struct Toast {
    text: String,
    error: bool,
    born: Instant,
}

#[derive(Default)]
struct Boot {
    step: String,
    error: Option<String>,
}

#[derive(Clone, PartialEq)]
pub enum Kindof {
    Mine,
    Favorite,
    Recent,
    Typed,
}

/// Une ligne de la liste des serveurs.
#[derive(Clone)]
pub struct Entry {
    pub address: String,
    pub label: String,
    pub kind: Kindof,
}

pub struct SixmApp {
    pub ctx: egui::Context,
    pub hub: Hub,
    inbox: Arc<Mutex<Vec<Job>>>,
    boot: Arc<Mutex<Boot>>,
    pub st: State,
    have_state: bool,
    offline: Option<String>,
    pub infos: HashMap<String, ServerInfo>,
    pub view: View,
    pub host_id: Option<String>,
    pub host_tab: HostTab,
    pub list_tab: ListTab,
    pub search: String,
    pub selected: Option<String>,
    pub quick: String,
    pub dialog: Option<Dialog>,
    toasts: Vec<Toast>,
    prompted_attempt: i64,
    pub later_victory: bool,
    last_build: String,
    last_session: String,
    restarting: bool,
    pub chat: String,
    pub command: String,
    pub settings_form: Option<settings::SettingsForm>,
    pub settings_tab: SettingsTab,
    pub host_form: Option<(String, host::HostForm)>,
    wanted: Vec<String>,
}

impl SixmApp {
    pub fn new(cc: &eframe::CreationContext<'_>) -> Self {
        theme::install(&cc.egui_ctx);
        let hub: Hub = Arc::new(Mutex::new(api::Shared::default()));
        let boot = Arc::new(Mutex::new(Boot { step: "Connexion à SixM…".into(), error: None }));
        // SIXM_URL : adresse transmise par SixM ; lue ici, avant tout autre fil.
        let url = std::env::var("SIXM_URL").ok();
        std::env::remove_var("SIXM_URL");
        {
            let (hub, boot, ctx) = (hub.clone(), boot.clone(), cc.egui_ctx.clone());
            std::thread::spawn(move || {
                let step = {
                    let (boot, ctx) = (boot.clone(), ctx.clone());
                    move |s: &str| {
                        boot.lock().unwrap().step = s.to_string();
                        ctx.request_repaint();
                    }
                };
                match backend::connect(url, step) {
                    Ok(api) => {
                        hub.lock().unwrap().api = Some(api);
                        let c = ctx.clone();
                        api::spawn_poller(hub, move || c.request_repaint());
                    }
                    Err(e) => boot.lock().unwrap().error = Some(e),
                }
                ctx.request_repaint();
            });
        }
        SixmApp {
            ctx: cc.egui_ctx.clone(),
            hub,
            inbox: Arc::default(),
            boot,
            st: State::default(),
            have_state: false,
            offline: None,
            infos: HashMap::new(),
            // Vue de départ (captures d'écran) : servers, host, settings.
            view: match std::env::var("SIXM_UI_VIEW").as_deref() {
                Ok("servers") => View::Servers,
                Ok(v) if v.starts_with("host") => View::Host,
                Ok("settings") => View::Settings,
                _ => View::Home,
            },
            host_id: std::env::var("SIXM_UI_VIEW").ok().and_then(|v| v.strip_prefix("host:").map(String::from)),
            host_tab: HostTab::Console,
            list_tab: ListTab::All,
            search: String::new(),
            selected: None,
            quick: String::new(),
            dialog: None,
            toasts: Vec::new(),
            prompted_attempt: 0,
            later_victory: false,
            last_build: String::new(),
            last_session: String::new(),
            restarting: false,
            chat: String::new(),
            command: String::new(),
            settings_form: None,
            settings_tab: SettingsTab::General,
            host_form: None,
            wanted: Vec::new(),
        }
    }

    // --- Actions ---------------------------------------------------------------------------

    /// Lance `f` sur un fil à part ; son erreur devient une notification, puis l'état est relu.
    pub fn act<F>(&self, f: F)
    where
        F: FnOnce(&Api) -> Result<Option<Job>, String> + Send + 'static,
    {
        let (hub, inbox, ctx) = (self.hub.clone(), self.inbox.clone(), self.ctx.clone());
        let Some(api) = hub.lock().unwrap().api.clone() else { return };
        std::thread::spawn(move || {
            match f(&api) {
                Ok(job) => {
                    if let Ok(s) = api.state() {
                        hub.lock().unwrap().state = Some(s);
                    }
                    if let Some(j) = job {
                        inbox.lock().unwrap().push(j);
                    }
                }
                Err(e) => hub.lock().unwrap().toasts.push((e, true)),
            }
            ctx.request_repaint();
        });
    }

    pub fn post(&self, path: &'static str, body: Value) {
        self.act(move |api| api.post(path, body).map(|_| None));
    }

    pub fn toast(&mut self, text: &str, error: bool) {
        self.toasts.push(Toast { text: theme::cap(text), error, born: Instant::now() });
        self.ctx.request_repaint();
    }

    pub fn confirm(&mut self, title: &str, text: &str, button: &str, action: Job) {
        self.dialog = Some(Dialog::Confirm { title: title.into(), text: text.into(), button: button.into(), action: Some(action) });
    }

    // --- Serveurs ---------------------------------------------------------------------------

    pub fn own_host(&self, address: &str) -> Option<&api::Host> {
        self.st.hosts.iter().find(|h| h.status == "running" && address == format!("localhost:{}", h.port))
    }

    /// Nom à afficher pour une adresse.
    pub fn display_name(&self, address: &str, label: &str) -> String {
        if let Some(i) = self.infos.get(address).filter(|i| i.online) {
            return i.name.clone();
        }
        if !label.is_empty() {
            return label.to_string();
        }
        self.own_host(address).map(|h| h.name.clone()).unwrap_or_else(|| address.to_string())
    }

    pub fn is_favorite(&self, address: &str) -> bool {
        self.st.settings.favorites.iter().any(|f| f.address == address)
    }

    pub fn toggle_favorite(&self, address: &str) {
        let label = self.infos.get(address).filter(|i| i.online).map(|i| i.name.clone()).unwrap_or_default();
        self.post("/api/favorite", json!({ "address": address, "label": label }));
    }

    /// Vos serveurs, puis favoris, puis récents, sans doublon.
    pub fn entries(&self) -> Vec<Entry> {
        let mut seen = HashSet::new();
        let mut out = Vec::new();
        for h in self.st.hosts.iter().filter(|h| h.status == "running") {
            let address = format!("localhost:{}", h.port);
            if seen.insert(address.clone()) {
                out.push(Entry { address, label: h.name.clone(), kind: Kindof::Mine });
            }
        }
        for f in &self.st.settings.favorites {
            if seen.insert(f.address.clone()) {
                out.push(Entry { address: f.address.clone(), label: f.label.clone(), kind: Kindof::Favorite });
            }
        }
        for a in &self.st.settings.recents {
            if seen.insert(a.clone()) {
                out.push(Entry { address: a.clone(), label: String::new(), kind: Kindof::Recent });
            }
        }
        out
    }

    pub fn session_idle(&self) -> bool {
        self.st.session.status == "idle" || self.st.session.status.is_empty()
    }

    /// Rejoindre : un mot de passe est demandé si la fiche du serveur l'exige.
    pub fn join(&mut self, address: String) {
        let address = address.trim().to_string();
        if address.is_empty() {
            return;
        }
        if !self.session_idle() {
            return self.toast("déjà connecté à un serveur", true);
        }
        if let Some(own) = self.own_host(&address) {
            // Son propre serveur : sans mot de passe.
            return self.post("/api/hosts/play", json!({ "id": own.id }));
        }
        if self.infos.contains_key(&address) {
            return self.join_known(address, false);
        }
        let hub = self.hub.clone();
        self.act(move |api| {
            let info = api.query(&address);
            if let Some(i) = info {
                hub.lock().unwrap().infos.insert(address.clone(), i);
            }
            Ok(Some(Box::new(move |app: &mut SixmApp| {
                app.sync_infos();
                app.join_known(address, false)
            }) as Job))
        });
    }

    fn join_known(&mut self, address: String, retry: bool) {
        if retry || self.infos.get(&address).is_some_and(|i| i.password) {
            self.dialog = Some(Dialog::Password { address, retry, value: String::new() });
        } else {
            self.post("/api/connect", json!({ "address": address }));
        }
    }

    pub fn can_solo(&self) -> bool {
        self.st.settings.games.iter().any(|g| g.id == self.st.settings.target)
    }

    pub fn target_name(&self) -> String {
        let s = &self.st.settings;
        match s.target.as_str() {
            "demo" | "" => "Démo, sans jeu".into(),
            "attach" => "VIctory déjà ouvert".into(),
            t => s.games.iter().find(|g| g.id == t).map(|g| g.name.clone()).unwrap_or_default(),
        }
    }

    fn sync_infos(&mut self) {
        let h = self.hub.lock().unwrap();
        self.infos.clone_from(&h.infos);
    }

    // --- Boucle -----------------------------------------------------------------------------

    fn pump(&mut self) {
        let jobs: Vec<Job> = std::mem::take(&mut *self.inbox.lock().unwrap());
        {
            let mut h = self.hub.lock().unwrap();
            if let Some(s) = h.state.take() {
                self.st = s;
                self.have_state = true;
            }
            self.offline = h.error.clone();
            if h.infos.len() != self.infos.len() || h.infos.iter().any(|(k, v)| self.infos.get(k).map(|x| (x.online, x.players, x.ping, &x.name)) != Some((v.online, v.players, v.ping, &v.name))) {
                self.infos.clone_from(&h.infos);
            }
            for (t, e) in std::mem::take(&mut h.toasts) {
                self.toasts.push(Toast { text: theme::cap(&t), error: e, born: Instant::now() });
            }
            h.hidden = self.ctx.input(|i| i.viewport().minimized.unwrap_or(false));
        }
        for j in jobs {
            j(self);
        }
        if !self.have_state {
            return;
        }

        if self.st.update.status == "restarting" {
            self.restarting = true;
        }
        // Mise à jour : la nouvelle version ouvre sa propre fenêtre.
        if self.restarting && self.offline.is_some() {
            self.ctx.send_viewport_cmd(egui::ViewportCommand::Close);
        }

        let v = &self.st.victory;
        if self.last_build == "running" && v.status == "done" {
            let t = v.task.clone().unwrap_or_default();
            let msg = if ["install", "update", "rebuild"].contains(&t.as_str()) { "VIctory est installé" } else { "Installation terminée" };
            self.toast(msg, false);
        }
        self.last_build = self.st.victory.status.clone();

        let status = self.st.session.status.clone();
        if status != self.last_session {
            if status == "connected" {
                self.view = View::Session;
            } else if self.last_session == "connected" && self.view == View::Session {
                self.view = View::Servers;
            }
            self.last_session = status;
        }
        if self.view == View::Session && self.st.session.status != "connected" {
            self.view = View::Servers;
        }

        let s = &self.st.session;
        if s.error.as_deref() == Some("mot de passe incorrect") && s.attempt != self.prompted_attempt {
            self.prompted_attempt = s.attempt;
            if let Some(a) = s.address.clone() {
                self.join_known(a, true);
            }
        }

        // Fiches à rafraîchir : seulement sur les vues qui les affichent.
        let mut wanted: Vec<String> = if matches!(self.view, View::Home | View::Servers) && self.session_idle() {
            self.entries().into_iter().map(|e| e.address).collect()
        } else {
            Vec::new()
        };
        if let Some(sel) = &self.selected {
            if !wanted.contains(sel) && matches!(self.view, View::Servers) {
                wanted.push(sel.clone());
            }
        }
        if wanted != self.wanted {
            let mut h = self.hub.lock().unwrap();
            h.query_now = wanted.iter().any(|a| !self.wanted.contains(a));
            h.wanted = wanted.clone();
            self.wanted = wanted;
        }
    }

    // --- Dessin -----------------------------------------------------------------------------

    fn top_bar(&mut self, ui: &mut Ui) {
        let rect = ui.max_rect();
        theme::gradient(ui, rect, Color32::from_rgb(17, 18, 23), BAR);
        ui.painter().line_segment([rect.left_bottom(), rect.right_bottom()], Stroke::new(1.0, LINE));
        ui.horizontal_centered(|ui| {
            ui.add_space(20.0);
            let (r, logo) = ui.allocate_exact_size(vec2(30.0, 30.0), Sense::click());
            theme::paint_logo(ui, r.center(), 14.0);
            if logo.on_hover_cursor(egui::CursorIcon::PointingHand).clicked() {
                self.view = View::Home;
            }
            ui.add_space(4.0);
            ui.label(RichText::new("SixM").font(theme::fb(19.0)).color(TEXT));
            ui.add_space(36.0);

            let live = self.st.hosts.iter().any(|h| h.status == "running");
            let connected = self.st.session.status == "connected";
            let mut tabs = vec![(View::Home, ic::HOUSE, "Accueil", None), (View::Servers, ic::LIST_BULLETS, "Serveurs", None)];
            if connected {
                tabs.push((View::Session, ic::GAME_CONTROLLER, "En partie", Some(GREEN)));
            }
            tabs.push((View::Host, ic::HARD_DRIVES, "Héberger", live.then_some(GREEN)));
            tabs.push((View::Settings, ic::GEAR_SIX, "Réglages", None));
            for (view, icon, label, dot) in tabs {
                if self.nav_tab(ui, icon, label, self.view == view, dot).clicked() {
                    self.view = view;
                    if view == View::Host {
                        self.host_id = None;
                    }
                }
            }

            ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                ui.add_space(20.0);
                self.profile_chip(ui);
                ui.add_space(10.0);
                self.game_picker(ui);
            });
        });
    }

    fn nav_tab(&self, ui: &mut Ui, icon: &str, label: &str, active: bool, dot: Option<Color32>) -> egui::Response {
        let text = format!("{icon}  {label}");
        let galley = ui.painter().layout_no_wrap(text, theme::fs(14.5), Color32::PLACEHOLDER);
        let h = ui.available_height();
        let (rect, resp) = ui.allocate_exact_size(vec2(galley.size().x + 28.0, h), Sense::click());
        let t = ui.ctx().animate_bool_with_time(resp.id, resp.hovered() || active, 0.12);
        let color = MUTED.lerp_to_gamma(TEXT, t);
        let p = ui.painter();
        if active {
            let bar = Rect::from_min_max(pos2(rect.left() + 10.0, rect.bottom() - 3.0), pos2(rect.right() - 10.0, rect.bottom()));
            p.rect_filled(bar, CornerRadius { nw: 2, ne: 2, sw: 0, se: 0 }, ACCENT);
            theme::gradient(ui, Rect::from_min_max(pos2(rect.left(), rect.top() + rect.height() * 0.4), rect.max), Color32::TRANSPARENT, ACCENT.gamma_multiply(0.07));
        }
        let pos = rect.center() - galley.size() / 2.0;
        ui.painter().galley(pos, galley.clone(), color);
        if let Some(c) = dot {
            ui.painter().circle_filled(pos2(rect.right() - 9.0, rect.center().y - 7.0), 3.5, c);
        }
        resp.on_hover_cursor(egui::CursorIcon::PointingHand)
    }

    fn profile_chip(&mut self, ui: &mut Ui) {
        let name = self.st.settings.name.clone();
        let galley = ui.painter().layout_no_wrap(name.clone(), theme::fs(14.0), TEXT);
        let (rect, resp) = ui.allocate_exact_size(vec2(galley.size().x + 56.0, 40.0), Sense::click());
        let t = ui.ctx().animate_bool_with_time(resp.id, resp.hovered(), 0.1);
        ui.painter().rect_filled(rect, CornerRadius::same(20), theme::CARD.lerp_to_gamma(theme::CARD_HI, t));
        ui.painter().galley(pos2(rect.left() + 14.0, rect.center().y - galley.size().y / 2.0), galley, TEXT);
        theme::paint_hex(ui, pos2(rect.right() - 21.0, rect.center().y), 15.0, &name, ACCENT);
        if resp.on_hover_cursor(egui::CursorIcon::PointingHand).on_hover_text("Profil et réglages").clicked() {
            self.view = View::Settings;
            self.settings_tab = SettingsTab::General;
        }
    }

    /// Choix du jeu : démo, une installation, ou VIctory ouvert à côté.
    fn game_picker(&mut self, ui: &mut Ui) {
        let s = &self.st.settings;
        let mut options: Vec<(String, String)> = vec![("demo".into(), "Démo, sans jeu".into())];
        options.extend(s.games.iter().map(|g| (g.id.clone(), g.name.clone())));
        if self.st.link_supported {
            options.push(("attach".into(), "VIctory déjà ouvert".into()));
        }
        let current = s.target.clone();
        let mut chosen = current.clone();
        let enabled = self.session_idle();
        ui.add_enabled_ui(enabled, |ui| {
            egui::ComboBox::from_id_salt("game")
                .selected_text(RichText::new(format!("{}  {}", ic::GAME_CONTROLLER, self.target_name())).font(theme::fs(13.5)))
                .width(210.0)
                .height(320.0)
                .show_ui(ui, |ui| {
                    for (id, name) in &options {
                        ui.selectable_value(&mut chosen, id.clone(), name);
                    }
                    ui.separator();
                    ui.selectable_value(&mut chosen, "add".to_string(), format!("{}  Ajouter un jeu…", ic::PLUS));
                })
                .response
                .on_hover_text("Jeu lancé en rejoignant un serveur");
        });
        if chosen == "add" {
            self.view = View::Settings;
            self.settings_tab = SettingsTab::Games;
        } else if chosen != current {
            self.post("/api/settings", json!({ "target": chosen }));
        }
    }

    fn toasts_ui(&mut self, ctx: &egui::Context) {
        self.toasts.retain(|t| t.born.elapsed() < Duration::from_secs(if t.error { 7 } else { 4 }));
        if self.toasts.is_empty() {
            return;
        }
        egui::Area::new(Id::unique("toasts"))
            .anchor(Align2::RIGHT_BOTTOM, vec2(-20.0, -20.0))
            .order(egui::Order::Tooltip)
            .interactable(false)
            .show(ctx, |ui| {
                ui.with_layout(Layout::bottom_up(Align::Max), |ui| {
                    for t in self.toasts.iter().rev() {
                        let age = t.born.elapsed().as_secs_f32();
                        let a = (age * 6.0).min(1.0);
                        egui::Frame::new()
                            .fill(theme::PANEL.gamma_multiply(a))
                            .stroke(Stroke::new(1.0, LINE.gamma_multiply(a)))
                            .corner_radius(CornerRadius::same(8))
                            .inner_margin(egui::Margin::symmetric(16, 12))
                            .show(ui, |ui| {
                                ui.set_max_width(380.0);
                                ui.horizontal(|ui| {
                                    let (icon, c) = if t.error { (ic::WARNING_CIRCLE, RED) } else { (ic::CHECK_CIRCLE, GREEN) };
                                    ui.label(RichText::new(icon).size(18.0).color(c.gamma_multiply(a)));
                                    ui.add(egui::Label::new(RichText::new(&t.text).color(TEXT.gamma_multiply(a))).wrap());
                                });
                            });
                    }
                });
            });
        ctx.request_repaint_after(Duration::from_millis(250));
    }

    fn dialogs(&mut self, ctx: &egui::Context) {
        let Some(mut dialog) = self.dialog.take() else { return };
        let mut close = false;
        let frame = egui::Frame::new().fill(theme::PANEL).stroke(Stroke::new(1.0, LINE)).corner_radius(CornerRadius::same(12)).inner_margin(26);
        let modal = egui::Modal::new(Id::unique("dialog")).frame(frame).backdrop_color(Color32::from_black_alpha(170)).show(ctx, |ui| {
            ui.set_width(420.0);
            match &mut dialog {
                Dialog::Password { address, retry, value } => {
                    ui.label(theme::title("Mot de passe du serveur", 20.0));
                    ui.label(theme::muted(address.as_str()));
                    if *retry {
                        ui.label(RichText::new("Mot de passe incorrect, réessayez.").color(RED));
                    }
                    ui.add_space(6.0);
                    let r = theme::password_edit(ui, value, "Mot de passe");
                    r.request_focus();
                    let enter = r.lost_focus() && ui.input(|i| i.key_pressed(egui::Key::Enter));
                    ui.add_space(10.0);
                    let go = dialog_actions(ui, "Rejoindre", &mut close);
                    if (go || enter) && !value.is_empty() {
                        self.post("/api/connect", json!({ "address": address, "password": value }));
                        close = true;
                    }
                }
                Dialog::CreateHost(form) => {
                    ui.label(theme::title("Créer un serveur", 20.0));
                    ui.label(theme::muted("Il tourne sur ce PC tant que SixM est ouvert."));
                    ui.add_space(8.0);
                    form.ui(ui, false);
                    ui.add_space(10.0);
                    if dialog_actions(ui, "Créer et démarrer", &mut close) {
                        match form.value() {
                            Ok(body) => {
                                self.act(move |api| {
                                    let id = api.post("/api/hosts", body)?.get("id").and_then(|v| v.as_str()).unwrap_or_default().to_string();
                                    api.post("/api/hosts/start", json!({ "id": id }))?;
                                    Ok(Some(Box::new(move |app: &mut SixmApp| {
                                        app.view = View::Host;
                                        app.host_id = Some(id);
                                        app.host_tab = HostTab::Console;
                                    }) as Job))
                                });
                                close = true;
                            }
                            Err(e) => self.toast(&e, true),
                        }
                    }
                }
                Dialog::Confirm { title, text, button, action } => {
                    ui.label(theme::title(title.as_str(), 20.0));
                    ui.add_space(4.0);
                    ui.label(theme::muted(text.as_str()));
                    ui.add_space(12.0);
                    if dialog_actions(ui, button, &mut close) {
                        if let Some(a) = action.take() {
                            a(self);
                        }
                        close = true;
                    }
                }
            }
        });
        if modal.should_close() {
            close = true;
        }
        if !close && self.dialog.is_none() {
            self.dialog = Some(dialog);
        }
    }

    fn boot_screen(&self, ui: &mut Ui) {
        let boot = self.boot.lock().unwrap();
        center(ui, |ui| {
            if let Some(e) = &boot.error {
                ui.label(RichText::new(ic::PLUGS).size(44.0).color(RED));
                ui.label(theme::title("SixM ne démarre pas", 24.0));
                ui.add(egui::Label::new(theme::muted(e.as_str())).wrap());
            } else {
                theme::spinner(ui, 56.0);
                ui.label(theme::title(boot.step.as_str(), 20.0));
            }
        });
    }

    fn offline_screen(&self, ui: &mut Ui) {
        center(ui, |ui| {
            if self.restarting {
                theme::spinner(ui, 56.0);
                ui.label(theme::title("SixM se met à jour", 24.0));
                ui.label(theme::muted("Une nouvelle fenêtre va s'ouvrir."));
            } else {
                ui.label(RichText::new(ic::PLUGS).size(44.0).color(DIM));
                ui.label(theme::title("SixM est fermé", 24.0));
                ui.label(theme::muted(self.offline.clone().unwrap_or_default()));
            }
        });
    }

    fn connecting_overlay(&mut self, ctx: &egui::Context) {
        if self.st.session.status != "connecting" {
            return;
        }
        let frame = egui::Frame::new().fill(theme::PANEL).stroke(Stroke::new(1.0, LINE)).corner_radius(CornerRadius::same(12)).inner_margin(32);
        egui::Modal::new(Id::unique("connecting")).frame(frame).backdrop_color(Color32::from_black_alpha(190)).show(ctx, |ui| {
            ui.set_width(380.0);
            ui.vertical_centered(|ui| {
                theme::spinner(ui, 64.0);
                ui.add_space(6.0);
                ui.label(theme::title("Connexion…", 22.0));
                let a = self.st.session.address.clone().unwrap_or_default();
                ui.label(theme::muted(self.display_name(&a, "")));
                ui.add_space(14.0);
                if theme::button(ui, Kind::Normal, ic::X, "Annuler").clicked() {
                    self.post("/api/disconnect", json!({}));
                }
            });
        });
    }
}

/// Boutons Annuler / Valider d'un dialogue. Renvoie true si validé.
fn dialog_actions(ui: &mut Ui, submit: &str, close: &mut bool) -> bool {
    let mut go = false;
    ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
        go = theme::button(ui, Kind::Primary, "", submit).clicked();
        if theme::button(ui, Kind::Ghost, "", "Annuler").clicked() {
            *close = true;
        }
    });
    go
}

pub fn center(ui: &mut Ui, add: impl FnOnce(&mut Ui)) {
    let h = ui.available_height();
    ui.vertical_centered(|ui| {
        ui.add_space((h * 0.5 - 90.0).max(20.0));
        ui.set_max_width(520.0);
        add(ui);
    });
}

/// Colonne centrée de largeur limitée, avec défilement.
pub fn page(ui: &mut Ui, id: &str, max: f32, add: impl FnOnce(&mut Ui)) {
    egui::ScrollArea::vertical().id_salt(id).auto_shrink([false, false]).show(ui, |ui| {
        let w = ui.available_width();
        let side = ((w - max) / 2.0).max(28.0);
        ui.horizontal(|ui| {
            ui.add_space(side);
            ui.vertical(|ui| {
                ui.set_width(w - side * 2.0);
                ui.add_space(26.0);
                add(ui);
                ui.add_space(40.0);
            });
        });
    });
}

impl eframe::App for SixmApp {
    fn ui(&mut self, ui: &mut Ui, _frame: &mut eframe::Frame) {
        self.pump();
        let ctx = ui.ctx().clone();

        egui::Panel::top("top").exact_size(64.0).frame(egui::Frame::NONE).show(ui, |ui| {
            if self.have_state {
                self.top_bar(ui);
            } else {
                let rect = ui.max_rect();
                ui.painter().rect_filled(rect, 0, BAR);
                theme::paint_logo(ui, pos2(rect.left() + 35.0, rect.center().y), 14.0);
                ui.painter().text(pos2(rect.left() + 58.0, rect.center().y), Align2::LEFT_CENTER, "SixM", theme::fb(19.0), TEXT);
            }
        });
        egui::CentralPanel::default().frame(egui::Frame::new().fill(theme::BG)).show(ui, |ui| {
            if !self.have_state {
                return self.boot_screen(ui);
            }
            if self.offline.is_some() {
                return self.offline_screen(ui);
            }
            match self.view {
                View::Home => self.home(ui),
                View::Servers => self.servers(ui),
                View::Session => self.session(ui),
                View::Host => self.host(ui),
                View::Settings => self.settings(ui),
            }
        });
        self.connecting_overlay(&ctx);
        self.dialogs(&ctx);
        self.toasts_ui(&ctx);
    }

    fn clear_color(&self, _visuals: &egui::Visuals) -> [f32; 4] {
        theme::BG.to_normalized_gamma_f32()
    }
}
