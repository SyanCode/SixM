//! Menus des mods : bandeau, sous-titre et compteur, lignes navigables au clavier comme à la souris.
//! Le serveur décrit le menu ; ici on le dessine, on gère la navigation et on lui renvoie les choix.

use super::SixmApp;
use crate::api::{Menu, MenuItem};
use crate::theme::{self, ic, ACCENT, DIM, MUTED, TEXT};
use eframe::egui::{self, pos2, vec2, Align2, Color32, CornerRadius, FontId, Key, Pos2, Rect, Sense, Shape, Stroke};
use serde_json::{json, Value};

const WIDTH: f32 = 430.0;
const ROW: f32 = 42.0;
const VISIBLE: usize = 10;

/// État local : pile des sous-menus, ligne choisie, valeurs modifiées.
pub struct MenuView {
    pub seq: i64,
    stack: Vec<Level>,
}

struct Level {
    menu: Menu,
    sel: usize,
    top: usize,
}

enum Action {
    Up,
    Down,
    Left,
    Right,
    Enter,
    Back,
    /// Clic : choisir puis valider.
    Pick(usize),
    /// Survol : la ligne suit la souris, sans valider.
    Hover(usize),
}

fn color_of(menu: &Menu) -> Color32 {
    menu.color
        .as_deref()
        .and_then(|c| {
            let h = c.strip_prefix('#')?;
            let v = u32::from_str_radix(h, 16).ok()?;
            Some(Color32::from_rgb((v >> 16) as u8, (v >> 8) as u8, v as u8))
        })
        .unwrap_or(ACCENT)
}

/// Icône Phosphor pour un nom donné par le mod.
fn icon(name: &str) -> &'static str {
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
        _ => "",
    }
}

fn selectable(it: &MenuItem) -> bool {
    it.kind != "separator"
}

impl MenuView {
    pub fn new(seq: i64, menu: Menu) -> MenuView {
        let mut v = MenuView { seq, stack: Vec::new() };
        v.push(menu);
        v
    }

    fn push(&mut self, menu: Menu) {
        let sel = menu.items.iter().position(selectable).unwrap_or(0);
        self.stack.push(Level { menu, sel, top: 0 });
    }

    fn level(&mut self) -> &mut Level {
        self.stack.last_mut().expect("menu vide")
    }

    fn step(&mut self, down: bool) {
        let l = self.level();
        let n = l.menu.items.len();
        if n == 0 {
            return;
        }
        let mut i = l.sel;
        for _ in 0..n {
            i = if down { (i + 1) % n } else { (i + n - 1) % n };
            if selectable(&l.menu.items[i]) {
                break;
            }
        }
        l.sel = i;
    }
}

impl SixmApp {
    /// Garde la vue du menu en phase avec celui du serveur.
    pub fn sync_menu(&mut self) {
        let s = &self.st.session;
        match (&s.menu, &self.menu) {
            (None, Some(_)) => self.menu = None,
            (Some(m), current) if current.as_ref().is_none_or(|v| v.seq != s.menu_seq) => {
                self.menu = Some(MenuView::new(s.menu_seq, m.clone()));
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
        let Some(view) = self.menu.as_mut() else { return };
        match action {
            Action::Up => view.step(false),
            Action::Down => view.step(true),
            Action::Back => {
                if view.stack.len() > 1 {
                    view.stack.pop();
                } else {
                    self.menu_close();
                }
            }
            Action::Hover(i) => view.level().sel = i,
            Action::Pick(i) => {
                view.level().sel = i;
                self.menu_act(Action::Enter);
            }
            Action::Left | Action::Right | Action::Enter => {
                let right = !matches!(action, Action::Left);
                let enter = matches!(action, Action::Enter);
                let l = view.level();
                let menu_id = l.menu.id.clone();
                let Some(it) = l.menu.items.get_mut(l.sel) else { return };
                if it.disabled || !selectable(it) {
                    return;
                }
                let send: Option<(String, Value)> = match it.kind.as_str() {
                    // Entrée, ← ou → : la case bascule.
                    "checkbox" => {
                        let v = !it.value.as_bool().unwrap_or(false);
                        it.value = json!(v);
                        Some((it.id.clone(), json!(v)))
                    }
                    "list" if !enter && !it.options.is_empty() => {
                        let n = it.options.len() as i64;
                        let cur = it.value.as_i64().unwrap_or(0);
                        let v = (cur + if right { 1 } else { -1 }).rem_euclid(n);
                        it.value = json!(v);
                        Some((it.id.clone(), json!(v)))
                    }
                    "list" => Some((it.id.clone(), it.value.clone())),
                    "slider" if !enter => {
                        let cur = it.value.as_f64().unwrap_or(it.min);
                        let v = (cur + if right { it.step } else { -it.step }).clamp(it.min, it.max);
                        let v = (v / it.step).round() * it.step;
                        it.value = json!(v);
                        Some((it.id.clone(), json!(v)))
                    }
                    "submenu" if enter => {
                        if let Some(m) = it.menu.clone() {
                            view.push(*m);
                        }
                        None
                    }
                    "button" if enter => Some((it.id.clone(), Value::Null)),
                    _ => None,
                };
                if let Some((item, value)) = send {
                    self.menu_send(&menu_id, &item, value);
                }
            }
        }
    }

    /// Clavier : M ouvre ou ferme, flèches, Entrée, Retour arrière ou Échap.
    pub fn menu_keys(&mut self, ctx: &egui::Context) {
        if self.st.session.status != "connected" || ctx.egui_wants_keyboard_input() || self.dialog.is_some() {
            return;
        }
        let pressed = |k: Key| ctx.input_mut(|i| i.consume_key(egui::Modifiers::NONE, k));
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

    /// Dessine le menu en haut à gauche de `area`.
    pub fn menu_ui(&mut self, ctx: &egui::Context, at: Pos2) {
        let Some(view) = self.menu.as_mut() else { return };
        let depth = view.stack.len();
        let l = view.level();
        // La ligne choisie reste visible.
        if l.sel < l.top {
            l.top = l.sel;
        } else if l.sel >= l.top + VISIBLE {
            l.top = l.sel + 1 - VISIBLE;
        }
        let menu = l.menu.clone();
        let (sel, top) = (l.sel, l.top);
        let accent = color_of(&menu);
        let mut action = None;

        egui::Area::new(egui::Id::unique("mod-menu")).fixed_pos(at).order(egui::Order::Foreground).show(ctx, |ui| {
            let shown = menu.items.len().min(VISIBLE);
            let desc = menu.items.get(sel).map(|i| i.description.clone()).unwrap_or_default();
            let total = 104.0 + 34.0 + ROW * shown as f32 + if desc.is_empty() { 0.0 } else { 58.0 } + 34.0;
            let (rect, _) = ui.allocate_exact_size(vec2(WIDTH, total), Sense::hover());
            let p = ui.painter().clone();

            // Ombre portée.
            p.add(egui::epaint::Shadow { offset: [0, 10], blur: 30, spread: 0, color: Color32::from_black_alpha(140) }.as_shape(rect, CornerRadius::same(12)));

            // Bandeau.
            let banner = Rect::from_min_size(rect.min, vec2(WIDTH, 104.0));
            let mut mesh = egui::epaint::Mesh::default();
            let (a, b) = (accent, accent.lerp_to_gamma(Color32::BLACK, 0.55));
            for (pt, c) in [(banner.left_top(), a), (banner.right_top(), b), (banner.left_bottom(), a.lerp_to_gamma(Color32::BLACK, 0.3)), (banner.right_bottom(), Color32::from_rgb(12, 12, 16))] {
                mesh.colored_vertex(pt, c);
            }
            mesh.add_triangle(0, 1, 2);
            mesh.add_triangle(1, 2, 3);
            p.with_clip_rect(banner).rect_filled(banner, CornerRadius { nw: 12, ne: 12, sw: 0, se: 0 }, Color32::TRANSPARENT);
            let clip = p.with_clip_rect(banner);
            clip.add(Shape::mesh(mesh));
            // Motif : bandes obliques et hexagones.
            for k in 0..8 {
                let x = banner.left() + 40.0 + k as f32 * 62.0;
                clip.line_segment([pos2(x, banner.bottom()), pos2(x + 70.0, banner.top())], Stroke::new(14.0, Color32::WHITE.gamma_multiply(0.035)));
            }
            clip.add(Shape::closed_line(theme::hex_points(pos2(banner.right() - 54.0, banner.center().y), 40.0), Stroke::new(2.0, Color32::WHITE.gamma_multiply(0.18))));
            clip.add(Shape::convex_polygon(theme::hex_points(pos2(banner.right() - 54.0, banner.center().y), 22.0), Color32::WHITE.gamma_multiply(0.12), Stroke::NONE));
            let title = menu.title.to_uppercase();
            let size = if title.chars().count() > 18 { 24.0 } else { 32.0 };
            let g = p.layout_no_wrap(title, theme::fb(size), Color32::WHITE);
            // Titre penché, avec une ombre.
            let pos = pos2(banner.left() + 24.0, banner.center().y - g.size().y / 2.0);
            let mut shadow = egui::epaint::TextShape::new(pos + vec2(2.0, 3.0), g.clone(), Color32::from_black_alpha(110));
            shadow.override_text_color = Some(Color32::from_black_alpha(110));
            shadow.angle = -0.03;
            p.add(shadow);
            let mut t = egui::epaint::TextShape::new(pos, g, Color32::WHITE);
            t.angle = -0.03;
            p.add(t);

            // Sous-titre et compteur.
            let bar = Rect::from_min_size(pos2(rect.left(), banner.bottom()), vec2(WIDTH, 34.0));
            p.rect_filled(bar, 0, Color32::from_rgba_unmultiplied(8, 9, 12, 245));
            let sub = if depth > 1 { format!("{}  {}", ic::CARET_LEFT, menu.subtitle.to_uppercase()) } else { menu.subtitle.to_uppercase() };
            p.text(pos2(bar.left() + 18.0, bar.center().y), Align2::LEFT_CENTER, sub, theme::fs(12.0), accent.lerp_to_gamma(Color32::WHITE, 0.25));
            let count = menu.items.iter().filter(|i| selectable(i)).count();
            let index = menu.items.iter().take(sel + 1).filter(|i| selectable(i)).count();
            p.text(pos2(bar.right() - 18.0, bar.center().y), Align2::RIGHT_CENTER, format!("{index} / {count}"), theme::fs(12.0), MUTED);

            // Lignes.
            let body = Rect::from_min_size(pos2(rect.left(), bar.bottom()), vec2(WIDTH, ROW * shown as f32));
            p.rect_filled(body, 0, Color32::from_rgba_unmultiplied(10, 11, 15, 228));
            for (n, i) in (top..(top + shown).min(menu.items.len())).enumerate() {
                let it = &menu.items[i];
                let r = Rect::from_min_size(pos2(rect.left(), body.top() + n as f32 * ROW), vec2(WIDTH, ROW));
                let resp = ui.interact(r, egui::Id::unique(("menu-row", &menu.id, i)), if selectable(it) { Sense::click() } else { Sense::hover() });
                if it.kind == "separator" {
                    let g = p.layout_no_wrap(it.label.to_uppercase(), theme::fs(10.5), DIM);
                    let w = g.size().x;
                    let cy = r.center().y;
                    p.line_segment([pos2(r.left() + 18.0, cy), pos2(r.center().x - w / 2.0 - 10.0, cy)], Stroke::new(1.0, theme::LINE));
                    p.line_segment([pos2(r.center().x + w / 2.0 + 10.0, cy), pos2(r.right() - 18.0, cy)], Stroke::new(1.0, theme::LINE));
                    p.galley(pos2(r.center().x - w / 2.0, cy - g.size().y / 2.0), g, DIM);
                    continue;
                }
                let on = i == sel;
                let hover = ui.ctx().animate_bool_with_time(resp.id, resp.hovered() || on, 0.08);
                if on {
                    let hl = r.shrink2(vec2(6.0, 3.0));
                    theme::hgradient(ui, hl, accent.gamma_multiply(0.85), accent.gamma_multiply(0.18));
                    p.rect_filled(Rect::from_min_size(hl.min, vec2(3.0, hl.height())), 1, Color32::WHITE);
                } else if hover > 0.0 {
                    p.rect_filled(r.shrink2(vec2(6.0, 3.0)), 4, Color32::WHITE.gamma_multiply(0.05 * hover));
                }
                let fg = if it.disabled { DIM } else if on { Color32::WHITE } else { TEXT };
                let mut x = r.left() + 20.0;
                let glyph = icon(&it.icon);
                if !glyph.is_empty() {
                    p.text(pos2(x, r.center().y), Align2::LEFT_CENTER, glyph, theme::f(17.0), if on { Color32::WHITE } else { accent.lerp_to_gamma(TEXT, 0.3) });
                    x += 28.0;
                }
                p.text(pos2(x, r.center().y), Align2::LEFT_CENTER, &it.label, if on { theme::fs(15.0) } else { theme::f(15.0) }, fg);
                let rx = r.right() - 20.0;
                let cy = r.center().y;
                match it.kind.as_str() {
                    "checkbox" => {
                        let b = Rect::from_center_size(pos2(rx - 9.0, cy), vec2(18.0, 18.0));
                        if it.value.as_bool().unwrap_or(false) {
                            p.rect_filled(b, 4, if on { Color32::WHITE } else { accent });
                            p.text(b.center(), Align2::CENTER_CENTER, ic::CHECK, FontId::new(13.0, theme::bold()), if on { accent } else { Color32::WHITE });
                        } else {
                            p.rect_stroke(b, 4, Stroke::new(1.5, fg.gamma_multiply(0.7)), egui::StrokeKind::Inside);
                        }
                    }
                    "list" => {
                        let v = it.value.as_i64().unwrap_or(0) as usize;
                        let text = it.options.get(v).cloned().unwrap_or_default();
                        let g = p.layout_no_wrap(text, theme::fs(14.0), fg);
                        let w = g.size().x;
                        p.galley(pos2(rx - 18.0 - w, cy - g.size().y / 2.0), g, fg);
                        if on {
                            p.text(pos2(rx, cy), Align2::RIGHT_CENTER, ic::CARET_RIGHT, theme::f(15.0), Color32::WHITE);
                            p.text(pos2(rx - 22.0 - w, cy), Align2::RIGHT_CENTER, ic::CARET_LEFT, theme::f(15.0), Color32::WHITE);
                        }
                    }
                    "slider" => {
                        let v = it.value.as_f64().unwrap_or(it.min);
                        let frac = if it.max > it.min { ((v - it.min) / (it.max - it.min)) as f32 } else { 0.0 };
                        let track = Rect::from_min_size(pos2(rx - 150.0, cy - 2.5), vec2(110.0, 5.0));
                        p.rect_filled(track, 3, Color32::WHITE.gamma_multiply(0.15));
                        let mut fill = track;
                        fill.set_width(track.width() * frac.clamp(0.0, 1.0));
                        p.rect_filled(fill, 3, if on { Color32::WHITE } else { accent });
                        p.circle_filled(pos2(fill.right(), cy), 6.0, Color32::WHITE);
                        let label = if it.step.fract() == 0.0 { format!("{}", v.round() as i64) } else { format!("{v:.1}") };
                        p.text(pos2(rx, cy), Align2::RIGHT_CENTER, label, theme::fs(13.0), fg);
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
            // Flèches de défilement.
            if menu.items.len() > VISIBLE {
                if top > 0 {
                    p.text(pos2(body.center().x, body.top() + 6.0), Align2::CENTER_CENTER, ic::CARET_UP, theme::f(12.0), MUTED);
                }
                if top + VISIBLE < menu.items.len() {
                    p.text(pos2(body.center().x, body.bottom() - 6.0), Align2::CENTER_CENTER, ic::CARET_DOWN, theme::f(12.0), MUTED);
                }
            }

            let mut y = body.bottom();
            if !desc.is_empty() {
                let d = Rect::from_min_size(pos2(rect.left(), y + 6.0), vec2(WIDTH, 52.0));
                p.rect_filled(d, 6, Color32::from_rgba_unmultiplied(10, 11, 15, 235));
                p.rect_filled(Rect::from_min_size(d.min, vec2(WIDTH, 2.0)), 0, accent);
                p.text(pos2(d.left() + 16.0, d.center().y), Align2::LEFT_CENTER, ic::INFO, theme::f(17.0), accent);
                let g = p.layout(desc.clone(), theme::f(13.0), TEXT, WIDTH - 60.0);
                p.galley(pos2(d.left() + 42.0, d.center().y - g.size().y / 2.0), g, TEXT);
                y = d.bottom();
            }
            // Aide.
            let help = Rect::from_min_size(pos2(rect.left(), y + 6.0), vec2(WIDTH, 28.0));
            p.rect_filled(help, CornerRadius { nw: 0, ne: 0, sw: 12, se: 12 }, Color32::from_rgba_unmultiplied(8, 9, 12, 220));
            let keys = format!("{}{}  Naviguer      {}  Valider      {}  Retour      M  Fermer", ic::ARROW_UP, ic::ARROW_DOWN, ic::KEY_RETURN, ic::BACKSPACE);
            p.text(help.center(), Align2::CENTER_CENTER, keys, theme::f(11.5), MUTED);
        });

        if let Some(a) = action {
            self.menu_act(a);
        }
    }
}
