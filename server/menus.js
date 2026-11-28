// Menus des mods : décrits par le serveur, dessinés par le client (fenêtre SixM, surcouche du jeu).
// Un menu est du JSON simple ; tout est vérifié et borné ici, côté serveur comme côté client.

export const MENU_TYPES = ['button', 'checkbox', 'list', 'slider', 'input', 'separator', 'submenu'];
const COLOR = /^#[0-9a-f]{6}$/i;
const MAX_ITEMS = 100;
const MAX_DEPTH = 4;

const str = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').slice(0, max);
const num = (v, d) => (Number.isFinite(v) ? v : d);

/** Copie propre d'un menu, ou exception si sa forme est invalide. */
export function cleanMenu(m, depth = 0) {
  if (!m || typeof m !== 'object' || depth > MAX_DEPTH) throw new Error('menu invalide');
  const id = str(m.id, 48);
  if (!id || !Array.isArray(m.items)) throw new Error('menu invalide : id et items requis');
  const menu = {
    id, title: str(m.title ?? id, 48), subtitle: str(m.subtitle ?? '', 64),
    color: COLOR.test(m.color) ? m.color : null,
    items: [],
  };
  // Chemin de sous-menus à ouvrir d'emblée (ids des lignes), depuis la racine.
  if (depth === 0 && Array.isArray(m.open)) menu.open = m.open.slice(0, MAX_DEPTH).map((id) => str(id, 48));
  for (const it of m.items.slice(0, MAX_ITEMS)) {
    if (!it || typeof it !== 'object') continue;
    const type = MENU_TYPES.includes(it.type) ? it.type : 'button';
    const item = {
      id: str(it.id ?? '', 48), type, label: str(it.label ?? '', 64), description: str(it.description ?? '', 200),
      right: str(it.right ?? '', 24), icon: str(it.icon ?? '', 24), disabled: it.disabled === true,
      // Pastille à côté du libellé (« NOUVEAU », « ADMIN ») ; confirm : il faut valider deux fois.
      badge: str(it.badge ?? '', 12), badgeColor: COLOR.test(it.badgeColor) ? it.badgeColor : null, confirm: it.confirm === true,
    };
    if (type === 'checkbox') item.value = it.value === true;
    if (type === 'list') {
      item.options = (Array.isArray(it.options) ? it.options : []).slice(0, 50).map((o) => str(o, 32));
      item.value = Math.min(Math.max(0, Math.trunc(num(it.value, 0))), Math.max(0, item.options.length - 1));
    }
    if (type === 'slider') {
      item.min = num(it.min, 0);
      item.max = Math.max(item.min, num(it.max, 100));
      item.step = Math.max(Number.EPSILON, num(it.step, 1));
      item.value = Math.min(item.max, Math.max(item.min, num(it.value, item.min)));
    }
    if (type === 'input') {
      item.value = str(it.value ?? '', 200);
      item.placeholder = str(it.placeholder ?? '', 64);
      item.maxLength = Math.min(200, Math.max(1, Math.trunc(num(it.maxLength, 100))));
    }
    if (type === 'submenu') item.menu = cleanMenu(it.menu, depth + 1);
    menu.items.push(item);
  }
  return menu;
}

/** Valeur d'un choix envoyée par un client : booléen, nombre fini, texte court, ou null. */
export function cleanValue(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') return v.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim().slice(0, 200);
  return null;
}

/** Notification d'un mod : titre, texte, icône, couleur, durée (s). */
export function cleanNotice(n) {
  if (typeof n === 'string') n = { text: n };
  if (!n || typeof n !== 'object') throw new Error('notification invalide');
  const notice = {
    title: str(n.title ?? '', 48), text: str(n.text ?? '', 200), icon: str(n.icon ?? '', 24),
    color: COLOR.test(n.color) ? n.color : null, seconds: Math.min(15, Math.max(2, num(n.seconds, 5))),
  };
  if (!notice.title && !notice.text) throw new Error('notification vide');
  return notice;
}

export const WEATHERS = ['clear', 'clouds', 'rain', 'thunder', 'fog', 'snow'];

/** État du monde partagé par tous les joueurs : heure (minutes depuis minuit), météo, heure figée. */
export function cleanWorld(w, base = { minutes: 12 * 60, weather: 'clear', frozen: false }) {
  const out = { ...base };
  if (Number.isFinite(w?.minutes)) out.minutes = ((Math.round(w.minutes) % 1440) + 1440) % 1440;
  if (WEATHERS.includes(w?.weather)) out.weather = w.weather;
  if (typeof w?.frozen === 'boolean') out.frozen = w.frozen;
  return out;
}

/**
 * Menu principal : chaque ressource y ajoute ses entrées (sixm.addMenu). Le joueur l'ouvre avec la touche
 * Menu ; une entrée choisie ouvre le menu que la ressource construit pour ce joueur.
 */
export class MenuHub {
  constructor({ net, events, config }) {
    Object.assign(this, { net, events, config });
    this.entries = new Map(); // id -> { owner, label, description, icon, visible, open }
    this.opened = new Map(); // id joueur -> { entry, menu } : entrée du menu principal ouverte
  }

  add(owner, entry) {
    const id = str(entry?.id, 48);
    if (!id || typeof entry.open !== 'function') throw new Error('addMenu : id et open(player) requis');
    this.entries.set(id, {
      owner, label: str(entry.label ?? id, 64), description: str(entry.description ?? '', 200), icon: str(entry.icon ?? '', 24),
      badge: str(entry.badge ?? '', 12), badgeColor: COLOR.test(entry.badgeColor) ? entry.badgeColor : null,
      visible: typeof entry.visible === 'function' ? entry.visible : () => true, open: entry.open,
    });
  }

  removeOwner(owner) {
    for (const [id, e] of this.entries) if (e.owner === owner) this.entries.delete(id);
  }

  /**
   * Ouvre un menu. Celui d'une entrée du menu principal y reste rangé : Retour ramène au menu principal,
   * y compris quand la ressource le rouvre après une action.
   */
  open(player, menu) {
    const clean = cleanMenu(menu);
    const o = this.opened.get(player.id);
    if (o && o.menu === clean.id) {
      const main = this.#main(player);
      const at = main.items.findIndex((i) => i.id === o.entry);
      if (at >= 0) {
        main.items[at] = { ...main.items[at], type: 'submenu', menu: clean };
        return this.net.sendToPlayer(player.id, { t: 'menu', menu: cleanMenu({ ...main, open: [o.entry, ...(clean.open ?? [])] }) });
      }
    }
    this.opened.delete(player.id);
    this.net.sendToPlayer(player.id, { t: 'menu', menu: clean });
  }

  close(player) {
    this.opened.delete(player.id);
    this.net.sendToPlayer(player.id, { t: 'menuClose' });
  }

  #main(player) {
    const items = [];
    for (const [id, e] of this.entries) {
      let shown = false;
      try { shown = e.visible(player); } catch (err) { console.error(`[menus] ${id} :`, err.message); }
      if (shown) items.push({ id, type: 'button', label: e.label, description: e.description, icon: e.icon, badge: e.badge, badgeColor: e.badgeColor });
    }
    return { id: 'sixm:main', title: this.config.name, subtitle: 'Menu principal', items };
  }

  /** Touche Menu du joueur. */
  main(player) {
    const main = this.#main(player);
    if (!main.items.length) return this.net.sendToPlayer(player.id, { t: 'event', name: 'chat', args: ['Aucun menu sur ce serveur.'] });
    this.opened.delete(player.id);
    this.net.sendToPlayer(player.id, { t: 'menu', menu: cleanMenu(main) });
  }

  forget(player) { this.opened.delete(player.id); }

  select(player, menuId, itemId, value) {
    if (menuId === 'sixm:main') {
      const e = this.entries.get(itemId);
      if (!e || !e.visible(player)) return;
      try {
        const menu = e.open(player);
        if (!menu) return;
        this.opened.set(player.id, { entry: itemId, menu: cleanMenu(menu).id });
        this.open(player, menu);
      } catch (err) {
        console.error(`[menus] ${itemId} :`, err.message);
      }
      return;
    }
    this.events.emit(`menu:${menuId}`, player, itemId, value);
  }
}
