//! Apparence : fond sombre, accent orange, coins nets, police Inter embarquée.

use eframe::egui::{
    self, epaint::Mesh, pos2, vec2, Align2, Color32, CornerRadius, FontData, FontDefinitions, FontFamily, FontId,
    IconData, Pos2, Rect, Response, Sense, Shape, Stroke, StrokeKind, Ui, Vec2,
};
pub use egui_phosphor::regular as ic;

pub const BG: Color32 = Color32::from_rgb(10, 11, 14);
pub const BAR: Color32 = Color32::from_rgb(14, 15, 19);
pub const PANEL: Color32 = Color32::from_rgb(19, 21, 26);
pub const CARD: Color32 = Color32::from_rgb(24, 26, 32);
pub const CARD_HI: Color32 = Color32::from_rgb(32, 35, 43);
pub const LINE: Color32 = Color32::from_rgb(38, 41, 50);
pub const TEXT: Color32 = Color32::from_rgb(236, 238, 242);
pub const MUTED: Color32 = Color32::from_rgb(140, 146, 158);
pub const DIM: Color32 = Color32::from_rgb(92, 98, 110);
pub const ACCENT: Color32 = Color32::from_rgb(247, 130, 30);
pub const ACCENT_HI: Color32 = Color32::from_rgb(255, 152, 62);
pub const GREEN: Color32 = Color32::from_rgb(62, 207, 110);
pub const RED: Color32 = Color32::from_rgb(240, 82, 74);
pub const YELLOW: Color32 = Color32::from_rgb(242, 193, 78);

pub fn semibold() -> FontFamily {
    FontFamily::Name("semibold".into())
}
pub fn bold() -> FontFamily {
    FontFamily::Name("bold".into())
}
pub fn fill_icons() -> FontFamily {
    FontFamily::Name("icons-fill".into())
}
pub fn f(size: f32) -> FontId {
    FontId::new(size, FontFamily::Proportional)
}
pub fn fs(size: f32) -> FontId {
    FontId::new(size, semibold())
}
pub fn fb(size: f32) -> FontId {
    FontId::new(size, bold())
}
pub fn mono(size: f32) -> FontId {
    FontId::new(size, FontFamily::Monospace)
}

pub fn install(ctx: &egui::Context) {
    let mut fonts = FontDefinitions::default();
    let font = |b: &'static [u8]| std::sync::Arc::new(FontData::from_static(b));
    fonts.font_data.insert("inter".into(), font(include_bytes!("../assets/Inter-Regular.otf")));
    fonts.font_data.insert("inter-semibold".into(), font(include_bytes!("../assets/Inter-SemiBold.otf")));
    fonts.font_data.insert("inter-bold".into(), font(include_bytes!("../assets/Inter-Bold.otf")));
    fonts.font_data.insert("phosphor".into(), font(egui_phosphor::Variant::Regular.font_bytes()));
    fonts.font_data.insert("phosphor-fill".into(), font(egui_phosphor::Variant::Fill.font_bytes()));
    // Repli : les polices d'egui (emoji, symboles) après Inter et les icônes.
    let fallback = fonts.families.get(&FontFamily::Proportional).cloned().unwrap_or_default();
    let family = |first: &str, icons: &str| {
        let mut v = vec![first.to_string(), icons.to_string()];
        v.extend(fallback.iter().cloned());
        v
    };
    fonts.families.insert(FontFamily::Proportional, family("inter", "phosphor"));
    fonts.families.insert(semibold(), family("inter-semibold", "phosphor"));
    fonts.families.insert(bold(), family("inter-bold", "phosphor"));
    fonts.families.insert(fill_icons(), family("inter-semibold", "phosphor-fill"));
    if let Some(m) = fonts.families.get_mut(&FontFamily::Monospace) {
        m.push("phosphor".into());
    }
    ctx.set_fonts(fonts);

    ctx.set_visuals(egui::Visuals::dark());
    ctx.all_styles_mut(|style| {
        use egui::TextStyle::*;
        style.text_styles = [
            (Heading, fb(22.0)),
            (Body, f(14.0)),
            (Button, fs(14.0)),
            (Small, f(12.0)),
            (Monospace, mono(12.5)),
        ]
        .into();
        style.spacing.item_spacing = vec2(8.0, 8.0);
        style.spacing.button_padding = vec2(14.0, 8.0);
        style.spacing.interact_size.y = 34.0;
        style.spacing.scroll.bar_width = 6.0;
        style.spacing.scroll.floating = true;
        let v = &mut style.visuals;
        v.dark_mode = true;
        v.panel_fill = BG;
        v.window_fill = PANEL;
        v.extreme_bg_color = Color32::from_rgb(13, 14, 18);
        v.faint_bg_color = CARD;
        v.override_text_color = Some(TEXT);
        v.hyperlink_color = ACCENT;
        v.selection.bg_fill = ACCENT.gamma_multiply(0.45);
        v.selection.stroke = Stroke::new(1.0, ACCENT);
        v.text_cursor.stroke = Stroke::new(2.0, ACCENT);
        v.window_corner_radius = CornerRadius::same(10);
        v.window_stroke = Stroke::new(1.0, LINE);
        v.menu_corner_radius = CornerRadius::same(8);
        let r = CornerRadius::same(6);
        for w in [&mut v.widgets.noninteractive, &mut v.widgets.inactive, &mut v.widgets.hovered, &mut v.widgets.active, &mut v.widgets.open] {
            w.corner_radius = r;
        }
        v.widgets.noninteractive.bg_stroke = Stroke::new(1.0, LINE);
        v.widgets.noninteractive.fg_stroke = Stroke::new(1.0, MUTED);
        v.widgets.inactive.bg_fill = CARD;
        v.widgets.inactive.weak_bg_fill = CARD;
        v.widgets.inactive.bg_stroke = Stroke::new(1.0, LINE);
        v.widgets.inactive.fg_stroke = Stroke::new(1.0, TEXT);
        v.widgets.hovered.bg_fill = CARD_HI;
        v.widgets.hovered.weak_bg_fill = CARD_HI;
        v.widgets.hovered.bg_stroke = Stroke::new(1.0, Color32::from_rgb(60, 64, 76));
        v.widgets.hovered.fg_stroke = Stroke::new(1.0, TEXT);
        v.widgets.active.bg_fill = CARD_HI;
        v.widgets.active.weak_bg_fill = CARD_HI;
        v.widgets.active.bg_stroke = Stroke::new(1.0, ACCENT);
        v.widgets.active.fg_stroke = Stroke::new(1.0, TEXT);
        v.widgets.open.weak_bg_fill = CARD_HI;
    });
}

/// Icône de la fenêtre : l'hexagone de SixM.
pub fn window_icon() -> IconData {
    let n = 64usize;
    let mut rgba = vec![0u8; n * n * 4];
    let c = n as f32 / 2.0;
    for y in 0..n {
        for x in 0..n {
            let (dx, dy) = ((x as f32 + 0.5 - c).abs(), (y as f32 + 0.5 - c).abs());
            // Hexagone à pointe en haut : |dx| <= r*cos30, |dy| + |dx|*tan30 <= r
            let r = c - 2.0;
            let outer = dx <= r * 0.866 && dy + dx * 0.577 <= r;
            let inner = dx <= r * 0.48 && dy + dx * 0.577 <= r * 0.55;
            let i = (y * n + x) * 4;
            if outer && !inner {
                rgba[i..i + 4].copy_from_slice(&[ACCENT.r(), ACCENT.g(), ACCENT.b(), 255]);
            }
        }
    }
    IconData { rgba, width: n as u32, height: n as u32 }
}

/// Couleur stable pour un nom.
pub fn name_color(name: &str) -> Color32 {
    let mut hash: u32 = 0;
    for c in name.chars() {
        hash = hash.wrapping_mul(31).wrapping_add(c as u32);
    }
    let hue = (hash % 360) as f32 / 360.0;
    egui::ecolor::Hsva::new(hue, 0.55, 0.62, 1.0).into()
}

pub fn initials(name: &str) -> String {
    let s: String = name.chars().map(|c| if c.is_alphanumeric() { c } else { ' ' }).collect();
    let i: String = s.split_whitespace().take(2).filter_map(|w| w.chars().next()).collect();
    if i.is_empty() { "?".into() } else { i.to_uppercase() }
}

pub fn hex_points(center: Pos2, r: f32) -> Vec<Pos2> {
    (0..6)
        .map(|k| {
            let a = std::f32::consts::FRAC_PI_3 * k as f32;
            pos2(center.x + r * a.sin(), center.y - r * a.cos())
        })
        .collect()
}

/// Hexagone aux initiales.
pub fn paint_hex(ui: &Ui, center: Pos2, r: f32, name: &str, color: Color32) {
    let p = ui.painter();
    p.add(Shape::convex_polygon(hex_points(center, r), color, Stroke::NONE));
    p.text(center, Align2::CENTER_CENTER, initials(name), fb(r * 0.62), Color32::WHITE);
}

pub fn hex_avatar(ui: &mut Ui, size: f32, name: &str, mine: bool) -> Response {
    let (rect, resp) = ui.allocate_exact_size(Vec2::splat(size), Sense::hover());
    let color = if mine { ACCENT } else { name_color(name) };
    paint_hex(ui, rect.center(), size / 2.0, name, color);
    resp
}

/// Logo : hexagone creux orange.
pub fn paint_logo(ui: &Ui, center: Pos2, r: f32) {
    let p = ui.painter();
    p.add(Shape::convex_polygon(hex_points(center, r), ACCENT, Stroke::NONE));
    p.add(Shape::convex_polygon(hex_points(center, r * 0.5), BAR, Stroke::NONE));
}

/// Dégradé vertical.
pub fn gradient(ui: &Ui, rect: Rect, top: Color32, bottom: Color32) {
    let mut mesh = Mesh::default();
    mesh.colored_vertex(rect.left_top(), top);
    mesh.colored_vertex(rect.right_top(), top);
    mesh.colored_vertex(rect.left_bottom(), bottom);
    mesh.colored_vertex(rect.right_bottom(), bottom);
    mesh.add_triangle(0, 1, 2);
    mesh.add_triangle(1, 2, 3);
    ui.painter().add(Shape::mesh(mesh));
}

/// Dégradé horizontal.
pub fn hgradient(ui: &Ui, rect: Rect, left: Color32, right: Color32) {
    let mut mesh = Mesh::default();
    mesh.colored_vertex(rect.left_top(), left);
    mesh.colored_vertex(rect.right_top(), right);
    mesh.colored_vertex(rect.left_bottom(), left);
    mesh.colored_vertex(rect.right_bottom(), right);
    mesh.add_triangle(0, 1, 2);
    mesh.add_triangle(1, 2, 3);
    ui.painter().add(Shape::mesh(mesh));
}

#[derive(Clone, Copy, PartialEq)]
pub enum Kind {
    Primary,
    Normal,
    Ghost,
    Danger,
}

/// Bouton maison : rectangle plein, icône + texte.
pub fn button_sized(ui: &mut Ui, kind: Kind, icon: &str, text: &str, size: Vec2, enabled: bool) -> Response {
    let font = fs(if size.y >= 44.0 { 16.0 } else { 14.0 });
    let label = match (icon.is_empty(), text.is_empty()) {
        (true, _) => text.to_string(),
        (false, true) => icon.to_string(),
        (false, false) => format!("{icon}  {text}"),
    };
    let galley = ui.painter().layout_no_wrap(label, font, Color32::PLACEHOLDER);
    let w = size.x.max(galley.size().x + if text.is_empty() { 20.0 } else { 34.0 });
    let (rect, resp) = ui.allocate_exact_size(vec2(w, size.y), if enabled { Sense::click() } else { Sense::hover() });
    if ui.is_rect_visible(rect) {
        let t = ui.ctx().animate_bool_with_time(resp.id, enabled && resp.hovered(), 0.1);
        let down = enabled && resp.is_pointer_button_down_on();
        let (bg, bg_hi, fg, stroke) = match kind {
            Kind::Primary => (ACCENT, ACCENT_HI, Color32::from_rgb(20, 12, 4), Color32::TRANSPARENT),
            Kind::Normal => (CARD_HI, Color32::from_rgb(44, 48, 58), TEXT, LINE),
            Kind::Ghost => (Color32::TRANSPARENT, CARD_HI, MUTED, Color32::TRANSPARENT),
            Kind::Danger => (Color32::from_rgb(58, 24, 26), Color32::from_rgb(82, 30, 32), Color32::from_rgb(255, 140, 132), Color32::TRANSPARENT),
        };
        let mut fill = bg.lerp_to_gamma(bg_hi, t);
        if down {
            fill = fill.gamma_multiply(0.85);
        }
        let mut fg = if kind == Kind::Ghost { MUTED.lerp_to_gamma(TEXT, t) } else { fg };
        if !enabled {
            fill = if kind == Kind::Ghost { Color32::TRANSPARENT } else { CARD_HI.gamma_multiply(0.7) };
            fg = DIM;
        }
        let p = ui.painter();
        p.rect_filled(rect, CornerRadius::same(6), fill);
        if stroke != Color32::TRANSPARENT {
            p.rect_stroke(rect, CornerRadius::same(6), Stroke::new(1.0, stroke), StrokeKind::Inside);
        }
        p.galley(rect.center() - galley.size() / 2.0, galley, fg);
    }
    if enabled {
        resp.on_hover_cursor(egui::CursorIcon::PointingHand)
    } else {
        resp
    }
}

pub fn button(ui: &mut Ui, kind: Kind, icon: &str, text: &str) -> Response {
    button_sized(ui, kind, icon, text, vec2(0.0, 34.0), true)
}

pub fn button_if(ui: &mut Ui, kind: Kind, icon: &str, text: &str, enabled: bool) -> Response {
    button_sized(ui, kind, icon, text, vec2(0.0, 34.0), enabled)
}

/// Petit bouton icône rond.
pub fn icon_button(ui: &mut Ui, icon: &str, active: bool, tip: &str) -> Response {
    let (rect, resp) = ui.allocate_exact_size(Vec2::splat(30.0), Sense::click());
    let t = ui.ctx().animate_bool_with_time(resp.id, resp.hovered(), 0.1);
    if t > 0.0 {
        ui.painter().rect_filled(rect, CornerRadius::same(6), CARD_HI.gamma_multiply(t));
    }
    let (font, color) = if active { (FontId::new(17.0, fill_icons()), YELLOW) } else { (f(17.0), MUTED.lerp_to_gamma(TEXT, t)) };
    ui.painter().text(rect.center(), Align2::CENTER_CENTER, icon, font, color);
    resp.on_hover_cursor(egui::CursorIcon::PointingHand).on_hover_text(tip)
}

/// Interrupteur.
pub fn switch(ui: &mut Ui, on: &mut bool) -> Response {
    let (rect, mut resp) = ui.allocate_exact_size(vec2(38.0, 22.0), Sense::click());
    if resp.clicked() {
        *on = !*on;
        resp.mark_changed();
    }
    let t = ui.ctx().animate_bool_with_time(resp.id, *on, 0.12);
    let p = ui.painter();
    p.rect_filled(rect, CornerRadius::same(11), LINE.lerp_to_gamma(ACCENT, t));
    let x = egui::lerp(rect.left() + 11.0..=rect.right() - 11.0, t);
    p.circle_filled(pos2(x, rect.center().y), 8.0, Color32::WHITE);
    resp.on_hover_cursor(egui::CursorIcon::PointingHand)
}

/// Pastille d'état.
pub fn pill(ui: &mut Ui, text: &str, color: Color32) -> Response {
    let galley = ui.painter().layout_no_wrap(text.to_string(), fs(11.5), color);
    let size = vec2(galley.size().x + 26.0, 22.0);
    let (rect, resp) = ui.allocate_exact_size(size, Sense::hover());
    let p = ui.painter();
    p.rect_filled(rect, CornerRadius::same(11), color.gamma_multiply(0.14));
    p.circle_filled(pos2(rect.left() + 11.0, rect.center().y), 3.5, color);
    p.galley(pos2(rect.left() + 19.0, rect.center().y - galley.size().y / 2.0), galley, color);
    resp
}

/// Étiquette discrète (ressources d'un serveur, tag d'un mod).
pub fn tag(ui: &mut Ui, text: &str) -> Response {
    let galley = ui.painter().layout_no_wrap(text.to_string(), fs(11.0), MUTED);
    let (rect, resp) = ui.allocate_exact_size(galley.size() + vec2(14.0, 8.0), Sense::hover());
    ui.painter().rect_filled(rect, CornerRadius::same(4), CARD_HI);
    ui.painter().galley(rect.center() - galley.size() / 2.0, galley, MUTED);
    resp
}

/// Barre de remplissage.
pub fn meter(ui: &Ui, rect: Rect, frac: f32, color: Color32) {
    let p = ui.painter();
    p.rect_filled(rect, CornerRadius::same(2), LINE);
    let mut fill = rect;
    fill.set_width(rect.width() * frac.clamp(0.0, 1.0));
    if fill.width() > 0.5 {
        p.rect_filled(fill, CornerRadius::same(2), color);
    }
}

/// Indicateur de latence façon barres de réseau.
pub fn paint_ping(ui: &Ui, rect: Rect, ping: Option<u32>) {
    let (level, color) = match ping {
        None => (0, DIM),
        Some(p) if p < 60 => (4, GREEN),
        Some(p) if p < 120 => (3, GREEN),
        Some(p) if p < 200 => (2, YELLOW),
        Some(_) => (1, RED),
    };
    let w = 3.0;
    for i in 0..4 {
        let h = 4.0 + i as f32 * 3.0;
        let x = rect.left() + i as f32 * (w + 2.0);
        let r = Rect::from_min_max(pos2(x, rect.bottom() - h), pos2(x + w, rect.bottom()));
        ui.painter().rect_filled(r, CornerRadius::same(1), if i < level { color } else { LINE });
    }
}

/// Hexagone qui tourne (chargement).
pub fn spinner(ui: &mut Ui, size: f32) {
    let (rect, _) = ui.allocate_exact_size(Vec2::splat(size), Sense::hover());
    let time = ui.input(|i| i.time) as f32;
    let pts = hex_points(rect.center(), size * 0.4);
    let p = ui.painter();
    p.add(Shape::closed_line(pts.clone(), Stroke::new(1.5, LINE)));
    let head = (time * 6.0) as usize % 6;
    for (k, pt) in pts.iter().enumerate() {
        let age = (head + 6 - k) % 6;
        let a = 1.0 - age as f32 * 0.16;
        p.circle_filled(*pt, size * 0.085, ACCENT.gamma_multiply(a.max(0.1)));
    }
    ui.ctx().request_repaint();
}

/// Titre de section en petites capitales.
pub fn caption(ui: &mut Ui, text: &str) {
    ui.label(egui::RichText::new(text.to_uppercase()).font(fs(11.5)).color(DIM).extra_letter_spacing(1.2));
}

/// Cadre de carte.
pub fn card() -> egui::Frame {
    egui::Frame::new().fill(CARD).corner_radius(CornerRadius::same(8)).stroke(Stroke::new(1.0, LINE)).inner_margin(18)
}

/// Champ texte avec une icône devant.
pub fn input(ui: &mut Ui, value: &mut String, hint: &str, icon: &str, width: f32) -> Response {
    let frame = egui::Frame::new()
        .fill(Color32::from_rgb(13, 14, 18))
        .corner_radius(CornerRadius::same(6))
        .stroke(Stroke::new(1.0, LINE))
        .inner_margin(egui::Margin { left: 12, right: 8, top: 0, bottom: 0 });
    let inner = frame.show(ui, |ui| {
        ui.set_width(width - 20.0);
        ui.allocate_ui_with_layout(vec2(width - 20.0, 38.0), egui::Layout::left_to_right(egui::Align::Center), |ui| {
            ui.set_height(38.0);
            ui.spacing_mut().item_spacing.x = 4.0;
            if !icon.is_empty() {
                ui.label(egui::RichText::new(icon).color(DIM).size(16.0));
            }
            ui.add(
                egui::TextEdit::singleline(value)
                    .hint_text(egui::RichText::new(hint).color(DIM))
                    .frame(egui::Frame::NONE)
                    .margin(vec2(4.0, 0.0))
                    .min_size(vec2(0.0, 38.0))
                    .align(egui::Align2::LEFT_CENTER)
                    .desired_width(f32::INFINITY)
                    .font(f(14.0)),
            )
        })
        .inner
    });
    // Contour orange quand le champ a le focus.
    if inner.inner.has_focus() {
        ui.painter().rect_stroke(inner.response.rect, CornerRadius::same(6), Stroke::new(1.0, ACCENT.gamma_multiply(0.8)), StrokeKind::Inside);
    }
    inner.inner
}

/// Champ de formulaire : libellé au-dessus.
pub fn field<R>(ui: &mut Ui, label: &str, add: impl FnOnce(&mut Ui) -> R) -> R {
    ui.vertical(|ui| {
        ui.spacing_mut().item_spacing.y = 6.0;
        ui.label(egui::RichText::new(label).font(fs(12.5)).color(MUTED));
        add(ui)
    })
    .inner
}

pub fn text_edit(ui: &mut Ui, value: &mut String, hint: &str) -> Response {
    ui.add(
        egui::TextEdit::singleline(value)
            .hint_text(egui::RichText::new(hint).color(DIM))
            .desired_width(f32::INFINITY)
            .margin(vec2(10.0, 0.0))
            .min_size(vec2(0.0, 38.0))
            .align(egui::Align2::LEFT_CENTER)
            .font(f(14.0)),
    )
}

pub fn password_edit(ui: &mut Ui, value: &mut String, hint: &str) -> Response {
    ui.add(
        egui::TextEdit::singleline(value)
            .password(true)
            .hint_text(egui::RichText::new(hint).color(DIM))
            .desired_width(f32::INFINITY)
            .margin(vec2(10.0, 0.0))
            .min_size(vec2(0.0, 38.0))
            .align(egui::Align2::LEFT_CENTER)
            .font(f(14.0)),
    )
}

pub fn muted(text: impl Into<String>) -> egui::RichText {
    egui::RichText::new(text.into()).color(MUTED)
}

pub fn strong(text: impl Into<String>, size: f32) -> egui::RichText {
    egui::RichText::new(text.into()).font(fs(size)).color(TEXT)
}

pub fn title(text: impl Into<String>, size: f32) -> egui::RichText {
    egui::RichText::new(text.into()).font(fb(size)).color(TEXT)
}

pub fn cap(s: &str) -> String {
    let mut c = s.chars();
    match c.next() {
        Some(f) => f.to_uppercase().chain(c).collect(),
        None => String::new(),
    }
}
