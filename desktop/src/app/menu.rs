//! Menus des mods : le serveur décrit le menu, SixM le dessine, gère la navigation et renvoie les choix.
//!
//! La position dans les sous-menus et la ligne choisie survivent aux rafraîchissements envoyés par le
//! serveur après une action. Saisie de texte dans la ligne, confirmation des actions sensibles,
//! recherche (Ctrl+F), molette et souris.

use super::SixmApp;
use crate::api::{Menu, MenuItem, Notice};
use crate::theme::{self, ic, ACCENT, DIM, GREEN, MUTED, RED, TEXT};
use eframe::egui::{self, pos2, vec2, Align2, Color32, CornerRadius, Event, Key, Pos2, Rect, Sense, Shape, Stroke, StrokeKind};
use serde_json::{json, Value};

const WIDTH: f32 = 440.0;
const HEADER: f32 = 112.0;
const BAR: f32 = 34.0;
const ROW: f32 = 42.0;
const VISIBLE: usize = 9;
const CONFIRM_SECONDS: f64 = 4.0;

/// État local du menu ouvert.
pub struct MenuView {
    pub seq: i64,
    stack: Vec<Level>,
    /// Ligne qui attend une seconde validation, et depuis quand.
    armed: Option<(String, f64)>,
    /// Texte en cours de saisie dans une ligne « input ».
    editing: Option<String>,
    /// Filtre de la page courante (Ctrl+F).
    search: Option<String>,
    opened: f64,
}

struct Level {
    menu: Menu,
    sel: usize,
    top: usize,
    /// Ligne de la page précédente qui a ouvert celle-ci.
    via: Option<String>,
}

enum Action {
    Up,
    Down,
    Left,
    Right,
    Enter,
    Back,
    Pick(usize),
    Hover(usize),
}

fn color(hex: Option<&str>, default: Color32) -> Color32 {
    hex.and_then(|c| {
        let v = u32::from_str_radix(c.strip_prefix('#')?, 16).ok()?;
        Some(Color32::from_rgb((v >> 16) as u8, (v >> 8) as u8, v as u8))
    })
    .unwrap_or(default)
}

/// Icône Phosphor pour un nom donné par le mod (docs/MENUS.md).
pub fn icon(name: &str) -> &'static str {
    match name {
        "user" => ic::USER,
        "users" => ic::USERS,
        "user-plus" => ic::USER_PLUS,
        "smiley" => ic::SMILEY,
        "shield" => ic::SHIELD_CHECK,
        "megaphone" => ic::MEGAPHONE,
        "sign-out" => ic::SIGN_OUT,
        "prohibit" => ic::PROHIBIT,
        "crown" => ic::CROWN,
        "car" => ic::CAR,
        "gear" => ic::GEAR_SIX,
        "star" => ic::STAR,
        "map" | "map-pin" => ic::MAP_PIN,
        "money" => ic::MONEY,
        "heart" => ic::HEART,
        "wrench" => ic::WRENCH,
        "lightning" => ic::LIGHTNING,
        "music" => ic::MUSIC_NOTES,
        "gift" => ic::GIFT,
        "house" => ic::HOUSE,
        "crosshair" => ic::CROSSHAIR,
        "clock" => ic::CLOCK,
        "weather" | "cloud" => ic::CLOUD_SUN,
        "palette" => ic::PALETTE,
        "gun" | "target" => ic::TARGET,
        "phone" => ic::DEVICE_MOBILE,
        "briefcase" => ic::BRIEFCASE,
        "game" => ic::GAME_CONTROLLER,
        "chat" => ic::CHAT_CIRCLE_TEXT,
        "flag" => ic::FLAG,
        "check" => ic::CHECK_CIRCLE,
        "bell" => ic::BELL_RINGING,
        _ => "",
    }
}

/// Icône de la météo du serveur.
pub fn weather_icon(w: &str) -> &'static str {
    match w {
        "clouds" => ic::CLOUD,
        "rain" => ic::CLOUD_RAIN,
        "thunder" => ic::CLOUD_LIGHTNING,
        "fog" => ic::CLOUD_FOG,
        "snow" => ic::SNOWFLAKE,
        _ => ic::SUN,
    }
}

pub fn weather_name(w: &str) -> &'static str {
    match w {
        "clouds" => "Nuageux",
        "rain" => "Pluie",
        "thunder" => "Orage",
        "fog" => "Brouillard",
        "snow" => "Neige",
        _ => "Ensoleillé",
    }
}

fn selectable(it: &MenuItem) -> bool {
    it.kind != "separator"
}

impl Level {
    fn new(menu: Menu, via: Option<String>) -> Level {
        let sel = menu.items.iter().position(selectable).unwrap_or(0);
        Level { menu, sel, top: 0, via }
    }
}

impl MenuView {
    pub fn new(seq: i64, menu: Menu, now: f64) -> MenuView {
        let open = menu.open.clone();
        let mut v = MenuView { seq, stack: vec![Level::new(menu, None)], armed: None, editing: None, search: None, opened: now };
        v.follow(&open);
        v
    }

    /// Ouvre les sous-menus dont les lignes sont nommées, dans l'ordre.
    fn follow(&mut self, path: &[String]) {
        for id in path {
            let l = self.level();
            let Some(i) = l.menu.items.iter().position(|it| it.kind == "submenu" && &it.id == id) else { break };
            l.sel = i;
            let Some(m) = l.menu.items[i].menu.clone() else { break };
            self.stack.push(Level::new(*m, Some(id.clone())));
        }
    }

    /// Menu renvoyé par le serveur : même page, même ligne, si elles existent encore.
    fn rebuilt(seq: i64, menu: Menu, old: &MenuView) -> MenuView {
        if menu.id != old.stack[0].menu.id {
            return MenuView::new(seq, menu, old.opened);
        }
        let open = menu.open.clone();
        let mut v = MenuView { seq, stack: vec![Level::new(menu, None)], armed: None, editing: None, search: None, opened: old.opened };
        for (i, was) in old.stack.iter().enumerate() {
            let cur = v.stack.last_mut().expect("menu vide");
            let id = was.menu.items.get(was.sel).map(|it| it.id.clone());
            cur.sel = cur
                .menu
                .items
                .iter()
                .position(|it| selectable(it) && Some(&it.id) == id.as_ref())
                .unwrap_or_else(|| was.sel.min(cur.menu.items.len().saturating_sub(1)));
            cur.top = was.top;
            let Some(next) = old.stack.get(i + 1) else { break };
            let found = cur.menu.items.iter().find(|it| it.kind == "submenu" && Some(&it.id) == next.via.as_ref()).and_then(|it| it.menu.clone());
            match found {
                Some(m) => v.stack.push(Level::new(*m, next.via.clone())),
                None => break,
            }
        }
        // Le joueur était à la racine : le serveur peut l'emmener plus loin (entrée du menu principal choisie).
        if v.stack.len() == 1 {
            v.follow(&open);
        }
        v
    }

    fn level(&mut self) -> &mut Level {
        self.stack.last_mut().expect("menu vide")
    }

    /// Lignes affichées (toutes, ou celles qui correspondent à la recherche).
    fn shown(&self) -> Vec<usize> {
        let l = self.stack.last().expect("menu vide");
        match &self.search {
            Some(q) if !q.is_empty() => {
                let q = q.to_lowercase();
                (0..l.menu.items.len()).filter(|&i| selectable(&l.menu.items[i]) && l.menu.items[i].label.to_lowercase().contains(&q)).collect()
            }
            _ => (0..l.menu.items.len()).collect(),
        }
    }

    fn step(&mut self, down: bool) {
        let shown = self.shown();
        let l = self.level();
        let pos = shown.iter().position(|&i| i == l.sel);
        let n = shown.len();
        if n == 0 {
            return;
        }
        let mut k = pos.unwrap_or(0);
        for _ in 0..n {
            k = if down { (k + 1) % n } else { (k + n - 1) % n };
            if selectable(&l.menu.items[shown[k]]) {
                break;
            }
        }
        l.sel = shown[k];
    }

    /// Après un changement de recherche : la ligne choisie reste parmi les lignes affichées.
    fn refilter(&mut self) {
        let shown = self.shown();
        let l = self.level();
        if !shown.contains(&l.sel) {
            if let Some(&first) = shown.first() {
                l.sel = first;
            }
        }
        l.top = 0;
    }
}

impl SixmApp {
    /// Garde la vue du menu en phase avec celui du serveur.
    pub fn sync_menu(&mut self) {
        let now = self.ctx.input(|i| i.time);
        let s = &self.st.session;
        match (&s.menu, &self.menu) {
            (None, Some(_)) => self.menu = None,
            (Some(m), None) => {
                self.menu = Some(MenuView::new(s.menu_seq, m.clone(), now));
                self.view = super::View::Session;
            }
            (Some(m), Some(v)) if v.seq != s.menu_seq => {
                self.menu = Some(MenuView::rebuilt(s.menu_seq, m.clone(), v));
                self.view = super::View::Session;
            }
            _ => {}
        }
    }

    fn menu_send(&self, menu: &str, item: &str, value: Value) {
        self.post("/api/menu/select", json!({ "menu": menu, "item": item, "value": value }));
    }

    fn menu_close(&mut self) {
        self.menu = None;
        self.post("/api/menu/close", json!({}));
    }

    fn menu_act(&mut self, action: Action) {
        let now = self.ctx.input(|i| i.time);
        let Some(view) = self.menu.as_mut() else { return };
        if !matches!(action, Action::Enter | Action::Hover(_) | Action::Pick(_)) {
            view.armed = None;
        }
        match action {
            Action::Up => view.step(false),
            Action::Down => view.step(true),
            Action::Hover(i) => {
                if view.level().sel != i {
                    view.armed = None;
                    view.editing = None;
                }
                view.level().sel = i;
            }
            Action::Back => {
                if view.editing.take().is_some() {
                    return;
                }
                if view.search.take().is_some() {
                    view.refilter();
                    return;
                }
                if view.stack.len() > 1 {
                    view.stack.pop();
                } else {
                    self.menu_close();
                }
            }
            Action::Pick(i) => {
                if view.level().sel != i {
                    view.armed = None;
                    view.editing = None;
                }
                view.level().sel = i;
                self.menu_act(Action::Enter);
            }
            Action::Left | Action::Right | Action::Enter => {
                let right = !matches!(action, Action::Left);
                let enter = matches!(action, Action::Enter);
                let editing = view.editing.clone();
                let armed = view.armed.clone();
                let l = view.level();
                let menu_id = l.menu.id.clone();
                let Some(it) = l.menu.items.get_mut(l.sel) else { return };
                if it.disabled || !selectable(it) {
                    return;
                }
                let mut send: Option<(String, Value)> = None;
                let mut push = None;
                let mut arm = None;
                let mut edit = editing.clone();
                match it.kind.as_str() {
                    "checkbox" => {
                        let v = !it.value.as_bool().unwrap_or(false);
                        it.value = json!(v);
                        send = Some((it.id.clone(), json!(v)));
                    }
                    "list" if !it.options.is_empty() => {
                        let n = it.options.len() as i64;
                        let cur = it.value.as_i64().unwrap_or(0);
                        let v = if enter { cur } else { (cur + if right { 1 } else { -1 }).rem_euclid(n) };
                        it.value = json!(v);
                        send = Some((it.id.clone(), json!(v)));
                    }
                    "slider" if !enter => {
                        let cur = it.value.as_f64().unwrap_or(it.min);
                        let v = ((cur + if right { it.step } else { -it.step }) / it.step).round() * it.step;
                        let v = v.clamp(it.min, it.max);
                        it.value = json!(v);
                        send = Some((it.id.clone(), json!(v)));
                    }
                    "input" if enter => match editing {
                        // Deuxième Entrée : le texte part, la ligne se vide.
                        Some(text) => {
                            let text = text.trim().to_string();
                            edit = None;
                            if !text.is_empty() {
                                send = Some((it.id.clone(), json!(text)));
                            }
                        }
                        None => edit = Some(it.value.as_str().unwrap_or("").to_string()),
                    },
                    "submenu" if enter => {
                        if let Some(m) = it.menu.clone() {
                            push = Some((*m, it.id.clone()));
                        }
                    }
                    "button" if enter => {
                        let ok = !it.confirm || armed.as_ref().is_some_and(|(id, t)| id == &it.id && now - t < CONFIRM_SECONDS);
                        if ok {
                            send = Some((it.id.clone(), Value::Null));
                        } else {
                            arm = Some((it.id.clone(), now));
                        }
                    }
                    _ => {}
                }
                view.editing = edit;
                view.armed = arm;
                if let Some((m, via)) = push {
                    view.search = None;
                    view.stack.push(Level::new(m, Some(via)));
                }
                if let Some((item, value)) = send {
                    self.menu_send(&menu_id, &item, value);
                }
            }
        }
    }

    /// Clavier : M ouvre ou ferme, flèches, Entrée, Retour arrière, Échap, Ctrl+F, texte saisi.
    pub fn menu_keys(&mut self, ctx: &egui::Context) {
        if self.st.session.status != "connected" || ctx.egui_wants_keyboard_input() || self.dialog.is_some() {
            return;
        }
        let typing = self.menu.as_ref().is_some_and(|v| v.editing.is_some() || v.search.is_some());
        let pressed = |k: Key| ctx.input_mut(|i| i.consume_key(egui::Modifiers::NONE, k));
        if typing {
            // Saisie : les lettres vont au texte, pas aux raccourcis.
            let texts: Vec<String> = ctx.input(|i| i.events.iter().filter_map(|e| if let Event::Text(t) = e { Some(t.clone()) } else { None }).collect());
            let view = self.menu.as_mut().expect("menu");
            let max = {
                let l = view.stack.last().expect("menu");
                l.menu.items.get(l.sel).map(|it| it.max_length.max(1) as usize).unwrap_or(100)
            };
            let backspace = pressed(Key::Backspace);
            if let Some(text) = view.editing.as_mut() {
                for t in &texts {
                    for c in t.chars().filter(|c| !c.is_control()) {
                        if text.chars().count() < max {
                            text.push(c);
                        }
                    }
                }
                if backspace {
                    text.pop();
                }
            } else if let Some(q) = view.search.as_mut() {
                for t in &texts {
                    q.push_str(&t.chars().filter(|c| !c.is_control()).take(32).collect::<String>());
                }
                let leave = backspace && q.is_empty();
                if backspace {
                    q.pop();
                }
                if leave {
                    view.search = None;
                }
                view.refilter();
            }
            for (k, a) in [(Key::ArrowUp, Action::Up), (Key::ArrowDown, Action::Down), (Key::Enter, Action::Enter), (Key::Escape, Action::Back)] {
                if pressed(k) {
                    self.menu_act(a);
                }
            }
            return;
        }
        if pressed(Key::M) {
            if self.menu.is_some() {
                self.menu_close();
            } else {
                self.post("/api/menu/open", json!({}));
            }
            return;
        }
        if self.menu.is_none() {
            return;
        }
        if ctx.input_mut(|i| i.consume_key(egui::Modifiers::COMMAND, Key::F)) {
            let view = self.menu.as_mut().expect("menu");
            view.search = Some(String::new());
            view.editing = None;
            return;
        }
        for (k, a) in [
            (Key::ArrowUp, Action::Up),
            (Key::ArrowDown, Action::Down),
            (Key::ArrowLeft, Action::Left),
            (Key::ArrowRight, Action::Right),
            (Key::Enter, Action::Enter),
            (Key::Backspace, Action::Back),
            (Key::Escape, Action::Back),
        ] {
            if pressed(k) {
                self.menu_act(a);
            }
        }
    }

    /// Dessine le menu, son coin haut gauche en `at`.
    pub fn menu_ui(&mut self, ctx: &egui::Context, at: Pos2) {
        let now = ctx.input(|i| i.time);
        let Some(view) = self.menu.as_mut() else { return };
        let shown = view.shown();
        let path: Vec<String> = view.stack.iter().map(|l| l.menu.title.clone()).collect();
        let depth = path.len();
        let (search, editing, armed) = (view.search.clone(), view.editing.clone(), view.armed.clone());
        let opened = view.opened;
        let l = view.level();
        let pos = shown.iter().position(|&i| i == l.sel).unwrap_or(0);
        // La ligne choisie reste visible.
        if pos < l.top {
            l.top = pos;
        } else if pos >= l.top + VISIBLE {
            l.top = pos + 1 - VISIBLE;
        }
        l.top = l.top.min(shown.len().saturating_sub(VISIBLE));
        let menu = l.menu.clone();
        let (sel, top) = (l.sel, l.top);
        let accent = color(menu.color.as_deref(), ACCENT);
        let mut action = None;

        // Ouverture : glisse et apparaît en 0,18 s.
        let t = (((now - opened) / 0.18) as f32).clamp(0.0, 1.0);
        let ease = 1.0 - (1.0 - t).powi(3);
        if t < 1.0 {
            ctx.request_repaint();
        }

        egui::Area::new(egui::Id::unique("mod-menu")).fixed_pos(at + vec2(-24.0 * (1.0 - ease), 0.0)).order(egui::Order::Foreground).show(ctx, |ui| {
            ui.multiply_opacity(ease);
            let rows = shown.len().clamp(1, VISIBLE);
            let desc = menu.items.get(sel).filter(|_| shown.contains(&sel)).map(|i| i.description.clone()).unwrap_or_default();
            let desc_h = if desc.is_empty() { 0.0 } else { 56.0 };
            let total = HEADER + BAR + ROW * rows as f32 + 8.0 + desc_h + 32.0;
            let (rect, outer) = ui.allocate_exact_size(vec2(WIDTH, total), Sense::hover());
            let p = ui.painter().clone();

            // Molette : une ligne par cran.
            if outer.hovered() {
                let dy = ui.input(|i| i.smooth_scroll_delta.y);
                if dy.abs() > 18.0 {
                    action = Some(if dy > 0.0 { Action::Up } else { Action::Down });
                }
            }

            p.add(egui::epaint::Shadow { offset: [0, 14], blur: 36, spread: 2, color: Color32::from_black_alpha(150) }.as_shape(rect, CornerRadius::same(14)));
            p.rect_filled(rect, 14, Color32::from_rgba_unmultiplied(11, 12, 16, 238));

            // Bandeau : dégradé, bandes obliques, hexagones.
            let banner = Rect::from_min_size(rect.min, vec2(WIDTH, HEADER));
            let clip = p.with_clip_rect(banner);
            let mut mesh = egui::epaint::Mesh::default();
            let dark = accent.lerp_to_gamma(Color32::BLACK, 0.7);
            for (pt, c) in [(banner.left_top(), accent), (banner.right_top(), accent.lerp_to_gamma(Color32::BLACK, 0.45)), (banner.left_bottom(), accent.lerp_to_gamma(Color32::BLACK, 0.25)), (banner.right_bottom(), dark)] {
                mesh.colored_vertex(pt, c);
            }
            mesh.add_triangle(0, 1, 2);
            mesh.add_triangle(1, 2, 3);
            clip.add(Shape::mesh(mesh));
            for k in 0..9 {
                let x = banner.left() + 30.0 + k as f32 * 58.0;
                clip.line_segment([pos2(x, banner.bottom()), pos2(x + 74.0, banner.top())], Stroke::new(16.0, Color32::WHITE.gamma_multiply(0.03)));
            }
            let hx = pos2(banner.right() - 58.0, banner.center().y + 4.0);
            clip.add(Shape::closed_line(theme::hex_points(hx, 44.0), Stroke::new(2.0, Color32::WHITE.gamma_multiply(0.2))));
            clip.add(Shape::convex_polygon(theme::hex_points(hx, 24.0), Color32::WHITE.gamma_multiply(0.12), Stroke::NONE));
            clip.add(Shape::closed_line(theme::hex_points(hx + vec2(-70.0, 34.0), 16.0), Stroke::new(1.5, Color32::WHITE.gamma_multiply(0.12))));
            // Liseré lumineux en bas du bandeau.
            theme::hgradient(ui, Rect::from_min_size(pos2(banner.left(), banner.bottom() - 2.0), vec2(WIDTH, 2.0)), Color32::WHITE.gamma_multiply(0.5), Color32::TRANSPARENT);

            let title = menu.title.to_uppercase();
            let size = if title.chars().count() > 16 { 24.0 } else { 31.0 };
            let g = p.layout_no_wrap(title, theme::fb(size), Color32::WHITE);
            let tpos = pos2(banner.left() + 24.0, if depth > 1 { banner.top() + 26.0 } else { banner.center().y - g.size().y / 2.0 });
            for (offset, c) in [(vec2(2.0, 3.0), Color32::from_black_alpha(110)), (vec2(0.0, 0.0), Color32::WHITE)] {
                let mut shape = egui::epaint::TextShape::new(tpos + offset, g.clone(), c);
                shape.override_text_color = Some(c);
                shape.angle = -0.035;
                p.add(shape);
            }
            // À la racine, le sous-titre est dans la barre du dessous.
            if depth > 1 && !menu.subtitle.is_empty() {
                p.text(pos2(banner.left() + 26.0, banner.bottom() - 22.0), Align2::LEFT_CENTER, &menu.subtitle, theme::fs(12.5), Color32::WHITE.gamma_multiply(0.8));
            }

            // Fil d'Ariane, ou recherche, et compteur.
            let bar = Rect::from_min_size(pos2(rect.left(), banner.bottom()), vec2(WIDTH, BAR));
            p.rect_filled(bar, 0, Color32::from_rgba_unmultiplied(6, 7, 10, 250));
            let count = shown.iter().filter(|&&i| selectable(&menu.items[i])).count();
            let index = shown.iter().take(pos + 1).filter(|&&i| selectable(&menu.items[i])).count();
            p.text(pos2(bar.right() - 16.0, bar.center().y), Align2::RIGHT_CENTER, format!("{index} / {count}"), theme::fs(12.0), MUTED);
            match &search {
                Some(q) => {
                    let blink = if (now * 2.0) as i64 % 2 == 0 { "|" } else { " " };
                    let text = if q.is_empty() { format!("Rechercher…{blink}") } else { format!("{q}{blink}") };
                    p.text(pos2(bar.left() + 16.0, bar.center().y), Align2::LEFT_CENTER, ic::MAGNIFYING_GLASS, theme::f(14.0), accent);
                    p.text(pos2(bar.left() + 38.0, bar.center().y), Align2::LEFT_CENTER, text, theme::fs(12.5), if q.is_empty() { DIM } else { TEXT });
                    ctx.request_repaint_after(std::time::Duration::from_millis(250));
                }
                None => {
                    // Racine : son sous-titre ; plus loin : le chemin depuis la racine.
                    p.text(pos2(bar.left() + 16.0, bar.center().y), Align2::LEFT_CENTER, ic::HOUSE, theme::f(13.0), if path.len() == 1 { accent } else { MUTED });
                    let mut x = bar.left() + 36.0;
                    let path: Vec<String> = if path.len() == 1 {
                        vec![if menu.subtitle.is_empty() { "Menu".to_string() } else { menu.subtitle.clone() }]
                    } else {
                        path[1..].to_vec()
                    };
                    let n = path.len();
                    // Les niveaux les plus anciens cèdent la place en premier.
                    let skip = n.saturating_sub(3);
                    if skip > 0 {
                        let g = p.layout_no_wrap("…  ›  ".into(), theme::fs(11.5), DIM);
                        let w = g.size().x;
                        p.galley(pos2(x, bar.center().y - g.size().y / 2.0), g, DIM);
                        x += w;
                    }
                    for (i, title) in path.iter().enumerate().skip(skip) {
                        let last = i + 1 == n;
                        let c = if last { accent.lerp_to_gamma(Color32::WHITE, 0.3) } else { MUTED };
                        let g = p.layout_no_wrap(title.to_uppercase(), theme::fs(11.5), c);
                        let w = g.size().x.min(bar.right() - 70.0 - x);
                        p.with_clip_rect(Rect::from_min_max(pos2(x, bar.top()), pos2(x + w, bar.bottom()))).galley(pos2(x, bar.center().y - g.size().y / 2.0), g, c);
                        x += w;
                        if !last {
                            let g = p.layout_no_wrap("  ›  ".into(), theme::fs(11.5), DIM);
                            x += g.size().x;
                            p.galley(pos2(x - g.size().x, bar.center().y - g.size().y / 2.0), g, DIM);
                        }
                    }
                }
            }

            // Lignes.
            let body = Rect::from_min_size(pos2(rect.left(), bar.bottom() + 4.0), vec2(WIDTH, ROW * rows as f32));
            if shown.is_empty() {
                p.text(body.center(), Align2::CENTER_CENTER, "Aucun résultat", theme::f(14.0), DIM);
            }
            // Surbrillance qui glisse d'une ligne à l'autre.
            let target = shown.iter().skip(top).position(|&i| i == sel).map(|k| k as f32 * ROW);
            if let Some(target) = target {
                let y = ui.ctx().animate_value_with_time(egui::Id::unique(("menu-sel", &menu.id)), target, 0.08);
                let hl = Rect::from_min_size(pos2(body.left() + 6.0, body.top() + y + 2.0), vec2(WIDTH - 12.0, ROW - 4.0));
                let is_armed = armed.as_ref().is_some_and(|(id, t)| menu.items.get(sel).is_some_and(|it| &it.id == id) && now - t < CONFIRM_SECONDS);
                let base = if is_armed { RED } else { accent };
                theme::hgradient(ui, hl, base.gamma_multiply(0.9), base.gamma_multiply(0.15));
                p.rect_filled(Rect::from_min_size(hl.min, vec2(3.0, hl.height())), 2, Color32::WHITE);
                p.rect_stroke(hl, 6, Stroke::new(1.0, Color32::WHITE.gamma_multiply(0.12)), StrokeKind::Inside);
            }
            for (n, &i) in shown.iter().skip(top).take(rows).enumerate() {
                let it = &menu.items[i];
                let r = Rect::from_min_size(pos2(rect.left(), body.top() + n as f32 * ROW), vec2(WIDTH, ROW));
                let cy = r.center().y;
                if it.kind == "separator" {
                    let g = p.layout_no_wrap(it.label.to_uppercase(), theme::fs(10.5), DIM);
                    let w = g.size().x;
                    p.line_segment([pos2(r.left() + 20.0, cy), pos2(r.center().x - w / 2.0 - 10.0, cy)], Stroke::new(1.0, theme::LINE));
                    p.line_segment([pos2(r.center().x + w / 2.0 + 10.0, cy), pos2(r.right() - 20.0, cy)], Stroke::new(1.0, theme::LINE));
                    p.galley(pos2(r.center().x - w / 2.0, cy - g.size().y / 2.0), g, DIM);
                    continue;
                }
                let resp = ui.interact(r, egui::Id::unique(("menu-row", &menu.id, i)), Sense::click());
                let on = i == sel;
                if !on && resp.hovered() {
                    p.rect_filled(r.shrink2(vec2(6.0, 2.0)), 6, Color32::WHITE.gamma_multiply(0.04));
                }
                let fg = if it.disabled { DIM } else if on { Color32::WHITE } else { TEXT };
                let mut x = r.left() + 22.0;
                let glyph = icon(&it.icon);
                if !glyph.is_empty() {
                    p.text(pos2(x, cy), Align2::LEFT_CENTER, glyph, theme::f(17.0), if on { Color32::WHITE } else if it.disabled { DIM } else { accent.lerp_to_gamma(TEXT, 0.35) });
                    x += 28.0;
                }
                let label = p.layout_no_wrap(it.label.clone(), if on { theme::fs(15.0) } else { theme::f(15.0) }, fg);
                let lw = label.size().x.min(WIDTH - 200.0);
                p.with_clip_rect(Rect::from_min_max(pos2(x, r.top()), pos2(x + lw, r.bottom()))).galley(pos2(x, cy - label.size().y / 2.0), label, fg);
                x += lw + 8.0;
                if !it.badge.is_empty() {
                    let bc = color(it.badge_color.as_deref(), accent);
                    let g = p.layout_no_wrap(it.badge.clone(), theme::fb(10.0), Color32::WHITE);
                    let br = Rect::from_min_size(pos2(x, cy - 9.0), g.size() + vec2(12.0, 6.0));
                    p.rect_filled(br, 9, if on { Color32::WHITE.gamma_multiply(0.25) } else { bc });
                    p.galley(br.min + vec2(6.0, 3.0), g, Color32::WHITE);
                }
                let rx = r.right() - 22.0;
                let is_armed = on && armed.as_ref().is_some_and(|(id, t)| id == &it.id && now - t < CONFIRM_SECONDS);
                if is_armed {
                    let g = p.layout_no_wrap("Valider encore pour confirmer".into(), theme::fs(12.0), Color32::WHITE);
                    p.galley(pos2(rx - g.size().x, cy - g.size().y / 2.0), g, Color32::WHITE);
                    ctx.request_repaint_after(std::time::Duration::from_millis(200));
                } else {
                    match it.kind.as_str() {
                        "checkbox" => {
                            let b = Rect::from_center_size(pos2(rx - 18.0, cy), vec2(36.0, 20.0));
                            let v = it.value.as_bool().unwrap_or(false);
                            let k = ui.ctx().animate_bool_with_time(egui::Id::unique(("menu-check", &menu.id, &it.id)), v, 0.12);
                            p.rect_filled(b, 10, Color32::WHITE.gamma_multiply(0.15).lerp_to_gamma(if on { Color32::WHITE } else { GREEN }, k));
                            p.circle_filled(pos2(egui::lerp(b.left() + 10.0..=b.right() - 10.0, k), cy), 7.0, if on && v { accent } else { Color32::WHITE });
                        }
                        "list" => {
                            let v = it.value.as_i64().unwrap_or(0) as usize;
                            let text = it.options.get(v).cloned().unwrap_or_default();
                            let g = p.layout_no_wrap(text, theme::fs(14.0), fg);
                            let w = g.size().x;
                            p.galley(pos2(rx - 20.0 - w, cy - g.size().y / 2.0), g, fg);
                            let arrows = if on { Color32::WHITE } else { DIM };
                            p.text(pos2(rx, cy), Align2::RIGHT_CENTER, ic::CARET_RIGHT, theme::f(15.0), arrows);
                            p.text(pos2(rx - 26.0 - w, cy), Align2::RIGHT_CENTER, ic::CARET_LEFT, theme::f(15.0), arrows);
                            // Points de position dans la liste.
                            if on && it.options.len() <= 12 {
                                let n = it.options.len() as f32;
                                for k in 0..it.options.len() {
                                    let dx = (k as f32 - (n - 1.0) / 2.0) * 7.0;
                                    p.circle_filled(pos2(rx - 13.0 - w / 2.0 + dx, cy + 13.0), 2.0, if k == v { Color32::WHITE } else { Color32::WHITE.gamma_multiply(0.3) });
                                }
                            }
                        }
                        "slider" => {
                            let v = it.value.as_f64().unwrap_or(it.min);
                            let frac = if it.max > it.min { ((v - it.min) / (it.max - it.min)) as f32 } else { 0.0 };
                            let track = Rect::from_min_size(pos2(rx - 160.0, cy - 2.5), vec2(116.0, 5.0));
                            p.rect_filled(track, 3, Color32::WHITE.gamma_multiply(0.15));
                            let mut fill = track;
                            fill.set_width(track.width() * frac.clamp(0.0, 1.0));
                            p.rect_filled(fill, 3, if on { Color32::WHITE } else { accent });
                            p.circle_filled(pos2(fill.right(), cy), 7.0, Color32::WHITE);
                            let label = if it.step.fract() == 0.0 { format!("{}", v.round() as i64) } else { format!("{v:.1}") };
                            p.text(pos2(rx, cy), Align2::RIGHT_CENTER, label, theme::fs(13.0), fg);
                        }
                        "input" => {
                            let field = Rect::from_min_max(pos2(r.right() - 220.0, cy - 13.0), pos2(rx + 6.0, cy + 13.0));
                            let typing = on && editing.is_some();
                            p.rect_filled(field, 6, Color32::from_black_alpha(if typing { 200 } else { 90 }));
                            if typing {
                                p.rect_stroke(field, 6, Stroke::new(1.5, Color32::WHITE), StrokeKind::Inside);
                            }
                            let current = if typing { editing.clone().unwrap_or_default() } else { it.value.as_str().unwrap_or("").to_string() };
                            let (text, c) = if current.is_empty() && !typing {
                                (if it.placeholder.is_empty() { "Écrire…".to_string() } else { it.placeholder.clone() }, Color32::WHITE.gamma_multiply(0.45))
                            } else {
                                (current, Color32::WHITE)
                            };
                            let g = p.layout_no_wrap(text, theme::f(13.0), c);
                            // Texte trop long : on montre sa fin, là où l'on écrit.
                            let w = g.size().x;
                            let inner = field.shrink2(vec2(8.0, 0.0));
                            let x0 = if w > inner.width() - 8.0 { inner.right() - 8.0 - w } else { inner.left() };
                            p.with_clip_rect(inner).galley(pos2(x0, cy - g.size().y / 2.0), g, c);
                            if typing {
                                if (now * 2.0) as i64 % 2 == 0 {
                                    let cx = (x0 + w + 1.0).min(inner.right() - 6.0);
                                    p.line_segment([pos2(cx, cy - 8.0), pos2(cx, cy + 8.0)], Stroke::new(1.5, Color32::WHITE));
                                }
                                ctx.request_repaint_after(std::time::Duration::from_millis(250));
                            } else if on {
                                p.text(pos2(field.left() - 8.0, cy), Align2::RIGHT_CENTER, ic::PENCIL_SIMPLE, theme::f(14.0), Color32::WHITE);
                            }
                        }
                        "submenu" => {
                            if !it.right.is_empty() {
                                p.text(pos2(rx - 22.0, cy), Align2::RIGHT_CENTER, &it.right, theme::fs(13.0), if on { Color32::WHITE } else { MUTED });
                            }
                            p.text(pos2(rx, cy), Align2::RIGHT_CENTER, ic::CARET_RIGHT, theme::f(16.0), fg);
                        }
                        _ => {
                            if !it.right.is_empty() {
                                p.text(pos2(rx, cy), Align2::RIGHT_CENTER, &it.right, theme::fs(13.0), if on { Color32::WHITE } else { MUTED });
                            } else if it.confirm && on {
                                p.text(pos2(rx, cy), Align2::RIGHT_CENTER, ic::WARNING, theme::f(15.0), Color32::WHITE);
                            }
                        }
                    }
                }
                if resp.clicked() {
                    action = Some(Action::Pick(i));
                }
                if action.is_none() && resp.hovered() && !on && ui.input(|i| i.pointer.delta() != egui::Vec2::ZERO) {
                    action = Some(Action::Hover(i));
                }
            }
            // Barre de défilement.
            if shown.len() > VISIBLE {
                let track = Rect::from_min_size(pos2(body.right() - 4.0, body.top() + 4.0), vec2(2.0, body.height() - 8.0));
                p.rect_filled(track, 1, Color32::WHITE.gamma_multiply(0.08));
                let h = track.height() * VISIBLE as f32 / shown.len() as f32;
                let y = track.top() + (track.height() - h) * top as f32 / (shown.len() - VISIBLE) as f32;
                p.rect_filled(Rect::from_min_size(pos2(track.left(), y), vec2(2.0, h)), 1, accent);
            }

            // Description de la ligne choisie.
            let mut y = body.bottom() + 8.0;
            if !desc.is_empty() {
                let d = Rect::from_min_size(pos2(rect.left() + 10.0, y), vec2(WIDTH - 20.0, desc_h - 8.0));
                p.rect_filled(d, 8, Color32::WHITE.gamma_multiply(0.04));
                p.rect_filled(Rect::from_min_size(d.min, vec2(3.0, d.height())), 2, accent);
                p.text(pos2(d.left() + 20.0, d.center().y), Align2::CENTER_CENTER, ic::INFO, theme::f(16.0), accent);
                let g = p.layout(desc.clone(), theme::f(13.0), TEXT, d.width() - 52.0);
                p.galley(pos2(d.left() + 38.0, d.center().y - g.size().y / 2.0), g, TEXT);
                y = d.bottom() + 8.0;
            }
            // Touches utiles maintenant.
            let help = Rect::from_min_max(pos2(rect.left(), y), pos2(rect.right(), rect.bottom()));
            let hint = if editing.is_some() {
                format!("{}  Envoyer      Échap  Annuler", ic::KEY_RETURN)
            } else if search.is_some() {
                format!("Tapez pour filtrer      {}{}  Choisir      Échap  Fin de la recherche", ic::ARROW_UP, ic::ARROW_DOWN)
            } else {
                format!("{}{}  Naviguer    {}  Valider    {}  Retour    Ctrl+F  Chercher    M  Fermer", ic::ARROW_UP, ic::ARROW_DOWN, ic::KEY_RETURN, ic::BACKSPACE)
            };
            p.text(help.center() - vec2(0.0, 2.0), Align2::CENTER_CENTER, hint, theme::f(11.0), DIM);
        });

        if let Some(a) = action {
            self.menu_act(a);
        }
    }

    /// Notifications des mods, en haut à droite de la fenêtre.
    pub fn notices_ui(&mut self, ctx: &egui::Context) {
        let now = ctx.input(|i| i.time);
        let fresh: Vec<Notice> = self.st.session.notices.iter().filter(|n| n.seq > self.notice_seen).cloned().collect();
        if let Some(last) = fresh.last() {
            self.notice_seen = last.seq;
        }
        // Au premier état reçu, les anciennes notifications ne ressortent pas.
        if !self.notices_ready {
            self.notices_ready = true;
            return;
        }
        for n in fresh {
            self.notices.push((n, now));
        }
        self.notices.retain(|(n, at)| now - at < f64::from(n.seconds.max(2.0)));
        if self.notices.len() > 5 {
            self.notices.drain(..self.notices.len() - 5);
        }
        if self.notices.is_empty() {
            return;
        }
        let screen = ctx.content_rect();
        egui::Area::new(egui::Id::unique("notices")).fixed_pos(pos2(screen.right() - 380.0, 76.0)).order(egui::Order::Tooltip).interactable(false).show(ctx, |ui| {
            for (n, at) in &self.notices {
                let age = (now - at) as f32;
                let life = n.seconds.max(2.0);
                let fade = (age / 0.2).min(1.0).min((life - age) / 0.35).clamp(0.0, 1.0);
                let c = color(n.color.as_deref(), ACCENT);
                let g = ui.painter().layout(n.text.clone(), theme::f(13.0), TEXT, 280.0);
                let h = (if n.title.is_empty() { 0.0 } else { 20.0 }) + g.size().y + 26.0;
                let (r, _) = ui.allocate_exact_size(vec2(360.0, h.max(56.0)), Sense::hover());
                let r = r.translate(vec2(30.0 * (1.0 - fade), 0.0));
                let p = ui.painter().clone();
                let a = |col: Color32| col.gamma_multiply(fade);
                p.add(egui::epaint::Shadow { offset: [0, 6], blur: 18, spread: 0, color: Color32::from_black_alpha((110.0 * fade) as u8) }.as_shape(r, CornerRadius::same(10)));
                p.rect_filled(r, 10, a(Color32::from_rgb(17, 18, 23)));
                p.rect_filled(Rect::from_min_size(r.min, vec2(4.0, r.height())), CornerRadius { nw: 10, sw: 10, ne: 0, se: 0 }, a(c));
                let ic_c = pos2(r.left() + 30.0, r.top() + 28.0);
                p.circle_filled(ic_c, 15.0, a(c.gamma_multiply(0.2)));
                let glyph = icon(&n.icon);
                p.text(ic_c, Align2::CENTER_CENTER, if glyph.is_empty() { ic::BELL_RINGING } else { glyph }, theme::f(16.0), a(c));
                let mut y = r.top() + 13.0;
                if !n.title.is_empty() {
                    p.text(pos2(r.left() + 56.0, y), Align2::LEFT_TOP, &n.title, theme::fs(14.0), a(Color32::WHITE));
                    y += 20.0;
                }
                p.galley(pos2(r.left() + 56.0, y), g, a(TEXT));
                // Temps restant.
                let left = (1.0 - age / life).clamp(0.0, 1.0);
                p.rect_filled(Rect::from_min_size(pos2(r.left() + 4.0, r.bottom() - 2.0), vec2((r.width() - 4.0) * left, 2.0)), 0, a(c.gamma_multiply(0.7)));
                ui.add_space(4.0);
            }
        });
        ctx.request_repaint_after(std::time::Duration::from_millis(33));
    }

    /// Heure et météo du serveur, pour l'en-tête de la partie.
    pub fn world_label(&self) -> Option<(String, &'static str)> {
        let w = self.st.session.world.as_ref()?;
        let text = format!("{:02}:{:02}  ·  {}{}", w.minutes / 60, w.minutes % 60, weather_name(&w.weather), if w.frozen { "  ·  figée" } else { "" });
        Some((text, weather_icon(&w.weather)))
    }
}
