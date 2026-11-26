// Interface SixM. Tout texte passe par textContent : rien de reçu d'un serveur n'est interprété en HTML.

const $ = (sel) => document.querySelector(sel);
const main = $('#main');

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v);
  }
  el.append(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
  return el;
}
const btn = (text, onclick, cls = '', props = {}) => h('button', { type: 'button', class: `btn ${cls}`, onclick, ...props }, text);
const ICONS = {
  star: ['M12 3.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8-5.3-2.7-5.3 2.7 1-5.8-4.2-4.1 5.9-.9z'],
  lock: ['M6 11h12v9H6z', 'M8.5 11V8a3.5 3.5 0 017 0v3'],
  link: ['M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1', 'M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1'],
  pad: ['M7 8h10a4 4 0 014 4l.6 4.2a2.3 2.3 0 01-4 1.8L15.5 16h-7l-2.1 2a2.3 2.3 0 01-4-1.8L3 12a4 4 0 014-4z', 'M8 10.5v3M6.5 12h3M16 11v.01M17.5 13v.01'],
  globe: ['M12 3a9 9 0 100 18 9 9 0 000-18z', 'M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18'],
  pc: ['M4 5h16v11H4z', 'M9 20h6M12 16v4'],
  down: ['M12 4v11M7.5 10.5L12 15l4.5-4.5M5 20h14'],
  box: ['M12 3l8 4.5v9L12 21l-8-4.5v-9z', 'M4 7.5l8 4.5 8-4.5M12 12v9'],
  back: ['M14 6l-6 6 6 6'],
  build: ['M14.5 5.5a4.2 4.2 0 00-5.4 5.4L3.5 16.5a2.1 2.1 0 003 3l5.6-5.6a4.2 4.2 0 005.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z'],
  send: ['M4 12l16-7-5 15-3.5-6z'],
};
function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'i');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of ICONS[name]) {
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  return svg;
}
/** Hexagone aux initiales, couleur stable par nom. */
function avatar(name, cls = '') {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/);
  const el = h('span', { class: `hex ${cls}`, 'aria-hidden': 'true' }, words.map((w) => [...w][0] ?? '').slice(0, 2).join('').toUpperCase() || '?');
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.codePointAt(0)) >>> 0;
  if (!cls.includes('mine')) el.style.background = `hsl(${hash % 360} var(--sat) var(--lum))`;
  return el;
}
const iconBtn = (name, text, onclick, cls = '') => { const b = btn('', onclick, cls); b.append(icon(name), text); return b; };
const field = (label, input) => h('label', { class: 'field' }, label, input);

// --- Échanges avec l'application -------------------------------------------------------------

let token = location.hash.slice(1);
try {
  if (token) sessionStorage.setItem('sixm', token); else token = sessionStorage.getItem('sixm') ?? '';
} catch { /* stockage indisponible : le jeton reste en mémoire */ }
history.replaceState(null, '', '/');

async function request(path, options = {}) {
  let res;
  try { res = await fetch(path, { ...options, headers: { 'x-sixm-token': token, ...options.headers } }); }
  catch { throw Object.assign(new Error('SixM est fermé. Relancez-le pour continuer.'), { offline: true }); }
  if (res.ok) return res;
  const { error } = await res.json().catch(() => ({}));
  throw Object.assign(new Error(error ?? `erreur ${res.status}`), { status: res.status });
}
const post = async (path, body = {}) => (await request(path, { method: 'POST', body: JSON.stringify(body) })).json();

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function toast(text, error = false) {
  const el = h('div', { class: `toast ${error ? 'error' : ''}` }, cap(text));
  $('#toasts').append(el);
  setTimeout(() => el.remove(), error ? 7000 : 3500);
}
/** Lance une action, affiche son erreur, puis rafraîchit. Renvoie true si elle a réussi. */
async function act(fn) {
  try { await fn(); await refresh(); return true; } catch (e) { toast(e.message, true); return false; }
}

function ask(title, build) {
  const dialog = $('#dialog');
  return new Promise((resolve) => {
    let result = null;
    const form = h('form', { method: 'dialog' });
    const { body, submit, value } = build(form);
    form.append(h('h2', {}, title), ...body, h('div', { class: 'actions' },
      btn('Annuler', () => dialog.close(), 'quiet'), h('button', { class: 'btn primary' }, submit)));
    form.addEventListener('submit', (e) => { e.preventDefault(); result = value(); dialog.close(); });
    dialog.replaceChildren(form);
    dialog.addEventListener('close', () => resolve(result), { once: true });
    dialog.showModal();
  });
}

// --- État -------------------------------------------------------------------------------------

let state = null;
let view = 'play';
let hostId = null; // serveur hébergé ouvert
let hostTab = 'console';
let screen = { key: null, update: () => {} };
let promptedAttempt = 0; // dernier échec pour lequel le mot de passe a été redemandé
const statuses = new Map(); // adresse -> fiche
let laterVictory = false; // carte « Installer VIctory » repoussée pour cette fois
let lastBuild = null;
let chosen = null; // destination : { solo: true } ou { address }

let restarting = false; // mise à jour : cette fenêtre laisse la place à la suivante
async function refresh() {
  try {
    state = await (await request('/api/state')).json();
  } catch (e) {
    $('#dock').hidden = true;
    if (restarting) window.close();
    if (screen.key !== 'offline') show('offline', () => ({
      el: h('div', { class: 'center' }, h('h1', {}, restarting ? 'SixM se met à jour' : e.offline ? 'SixM est fermé' : 'Session expirée'), h('p', { class: 'muted' }, restarting ? 'Une nouvelle fenêtre va s\'ouvrir.' : e.message)),
    }));
    return;
  }
  render();
}

const targetName = () => {
  const { target, games } = state.settings;
  return target === 'demo' ? 'Démo, sans jeu' : target === 'attach' ? 'VIctory déjà ouvert' : games.find((g) => g.id === target)?.name ?? '';
};

/** Affiche un écran ; il n'est reconstruit que si sa clé change, sinon seulement mis à jour. */
function show(key, build) {
  if (screen.key !== key) {
    const s = build();
    screen = { key, update: s.update ?? (() => {}) };
    main.replaceChildren(h('div', { class: 'page' }, s.el));
    main.scrollTop = 0;
  }
  screen.update();
}

function render() {
  const { session, settings, hosts } = state;
  if (state.update.status === 'restarting') restarting = true;
  if ($('#me').dataset.name !== settings.name) {
    $('#me').dataset.name = settings.name;
    $('#me').replaceChildren(h('span', {}, settings.name), avatar(settings.name, 'mine'));
  }
  const live = hosts.some((x) => x.status === 'running');
  $('#nav-host').hidden = !live;
  for (const b of document.querySelectorAll('nav button'))
    b.dataset.view === view ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current');

  const { status, task } = state.victory;
  if (lastBuild === 'running' && status === 'done') toast(['install', 'update', 'rebuild'].includes(task) ? 'VIctory est installé' : 'Installation terminée');
  lastBuild = status;
  const idle = view === 'play' && session.status === 'idle';
  $('#dock').hidden = !idle;
  if (idle) updateDock();
  if (view === 'settings') return show('settings', settingsScreen);
  if (view === 'host') {
    const host = hosts.find((x) => x.id === hostId);
    if (host) return show(`host:${hostId}:${hostTab}:${!!host.broken}`, hostScreen);
    hostId = null;
    return show('host', hostsScreen);
  }
  if (session.status === 'connected') return show('session', sessionScreen);
  if (session.status === 'connecting') return show('connecting', connectingScreen);
  show('play', playScreen);
}

for (const b of document.querySelectorAll('nav button')) {
  b.addEventListener('click', () => { view = b.dataset.view; hostId = null; render(); });
}

$('#me').addEventListener('click', () => { view = 'settings'; render(); });

// --- Jouer ------------------------------------------------------------------------------------

const ownHost = (address) => state.hosts.find((x) => x.status === 'running' && address === `localhost:${x.port}`);

async function join(address, retry = false) {
  let password;
  const own = ownHost(address);
  if (own) return act(() => post('/api/hosts/play', { id: own.id })); // son propre serveur : sans mot de passe
  const info = statuses.get(address);
  if (retry || info?.password) {
    const input = h('input', { type: 'password', required: true, autocomplete: 'off', autofocus: true });
    password = await ask('Mot de passe du serveur', () => ({
      body: [h('div', { class: 'form' }, retry && h('p', { class: 'muted' }, 'Mot de passe incorrect, réessayez.'), input)],
      submit: 'Rejoindre', value: () => input.value,
    }));
    if (password === null) return;
  }
  await act(() => post('/api/connect', { address, password }));
}

async function queryAll() {
  if (!state || view !== 'play' || document.hidden || state.session.status !== 'idle') return;
  const { favorites, recents } = state.settings;
  const mine = state.hosts.filter((x) => x.status === 'running').map((x) => `localhost:${x.port}`);
  await Promise.all([...new Set([...favorites.map((f) => f.address), ...recents, ...mine])].map(async (address) => {
    const info = await post('/api/query', { address }).catch(() => null);
    if (info) statuses.set(address, info);
  }));
  render();
}

/** Carte d'une destination. */
function serverCard(address, label) {
  const name = h('button', { type: 'button', class: 'hit', onclick: () => { chosen = { address }; render(); }, ondblclick: () => go() });
  const sub = h('div', { class: 'sub' });
  const star = h('button', { class: 'star', type: 'button', onclick: () => act(() => post('/api/favorite', { address, label: statuses.get(address)?.name ?? label })) }, icon('star'));
  const face = h('span'), bar = h('i'), meter = h('div', { class: 'meter' }, bar), count = h('span', { class: 'num' }), extra = h('span', { class: 'num' }), lock = h('span', { title: 'Mot de passe' }, icon('lock'));
  const el = h('article', { class: 'card srv' }, h('div', { class: 'srv-top' }, face, h('div', { class: 'grow' }, name, sub), star), h('div', { class: 'srv-foot' }, meter, count, extra, lock));
  let shown = null;
  return {
    el,
    update() {
      const i = statuses.get(address), title = i?.name ?? (label || ownHost(address)?.name || address);
      if (title !== shown) { shown = title; face.replaceChildren(avatar(title, 'big')); name.textContent = title; }
      sub.textContent = address;
      el.classList.toggle('chosen', chosen?.address === address);
      el.classList.toggle('off', i?.online === false);
      name.setAttribute('aria-pressed', chosen?.address === address);
      meter.hidden = lock.hidden = !i?.online;
      if (i?.online) {
        bar.style.width = `${Math.min(100, (i.players / Math.max(1, i.maxPlayers)) * 100)}%`;
        count.textContent = `${i.players}/${i.maxPlayers}`;
        extra.textContent = `${i.ping} ms`;
        lock.hidden = !i.password;
      } else {
        count.textContent = i ? 'Hors ligne' : 'Recherche…';
        extra.textContent = '';
      }
      const fav = state.settings.favorites.some((f) => f.address === address);
      star.setAttribute('aria-pressed', fav);
      star.title = fav ? 'Retirer des favoris' : 'Ajouter aux favoris';
      star.setAttribute('aria-label', star.title);
    },
  };
}

/** Barre de lancement : un jeu, une destination, un bouton. */
const dock = (() => {
  const game = h('div', { class: 'v' }), place = h('div', { class: 'v' });
  const select = h('select', {
    'aria-label': 'Jeu',
    onchange: () => {
      if (select.value === 'add') { view = 'settings'; render(); return; }
      act(() => post('/api/settings', { target: select.value }));
    },
  });
  const play = h('button', { type: 'button', class: 'play-btn', onclick: () => go() });
  $('#dock').append(h('div', { class: 'dock' },
    h('div', { class: 'slot pick' }, icon('pad'), h('div', { class: 'grow' }, h('div', { class: 'k' }, 'Jeu'), game), select),
    h('div', { class: 'slot' }, icon('globe'), h('div', { class: 'grow' }, h('div', { class: 'k' }, 'Destination'), place)), play));
  return { game, place, select, play, shape: null };
})();

const canSolo = () => state.settings.games.some((g) => g.id === state.settings.target);

function updateDock() {
  const { settings: s, game } = state;
  const shape = JSON.stringify(s.games.map((g) => [g.id, g.name]));
  if (shape !== dock.shape) {
    dock.shape = shape;
    dock.select.replaceChildren(h('option', { value: 'demo' }, 'Démo, sans jeu'), ...s.games.map((g) => h('option', { value: g.id }, g.name)),
      ...(state.linkSupported ? [h('option', { value: 'attach' }, 'VIctory déjà ouvert')] : []), h('option', { value: 'add' }, 'Ajouter un jeu…'));
  }
  if (document.activeElement !== dock.select || dock.select.value === 'add') dock.select.value = s.target;
  dock.game.textContent = targetName();
  if (chosen?.solo && !canSolo()) chosen = null;
  const address = chosen?.address;
  dock.place.textContent = chosen?.solo ? 'Solo, sans serveur' : address ? statuses.get(address)?.name ?? ownHost(address)?.name ?? address : 'Choisissez un serveur';
  const busy = chosen?.solo && game.status === 'running';
  dock.play.disabled = !chosen || busy;
  dock.play.textContent = busy ? 'En cours' : 'Jouer';
}

async function go() {
  if (!chosen) return;
  if (chosen.solo) { act(() => post('/api/game/launch')); return; }
  const { address } = chosen;
  if (!ownHost(address) && !statuses.get(address)) {
    // La fiche dit si un mot de passe est nécessaire.
    const info = await post('/api/query', { address }).catch(() => null);
    if (info) statuses.set(address, info);
  }
  join(address);
}

/** Bandeau du jeu lancé par SixM. */
function gameBar() {
  const text = h('div', { class: 'grow' });
  const stop = btn('Arrêter le jeu', async () => {
    const ok = await ask('Arrêter le jeu ?', () => ({ body: [h('p', {}, 'La progression non sauvegardée sera perdue.')], submit: 'Arrêter', value: () => true }));
    if (ok) act(() => post('/api/game/stop'));
  }, 'danger');
  const log = h('div', { class: 'console short' });
  const details = h('details', {}, h('summary', { class: 'small muted' }, 'Journal de VIctory'), log);
  const el = h('div', { class: 'card', hidden: true }, h('div', { class: 'row' }, text, stop), details);
  return {
    el,
    update() {
      const { game } = state;
      el.hidden = game.status === 'stopped';
      text.textContent = game.status === 'running' ? `${game.name} est lancé` : game.error ?? '';
      text.style.color = game.status === 'failed' ? 'var(--danger)' : '';
      stop.hidden = game.status !== 'running';
      const lines = game.log.join('\n');
      if (log.textContent !== lines) { log.textContent = lines; log.scrollTop = log.scrollHeight; }
      details.hidden = !lines;
    },
  };
}

const TOOLS = {
  git: ['Installer Git ?', 'Git télécharge le code de VIctory. Installation avec winget, environ 350 Mo.'],
  rust: ['Installer Rust ?', 'Rust compile VIctory. Installation avec winget, environ 1 Go.'],
  msvc: ['Installer les outils C++ de Microsoft ?', 'Visual Studio Build Tools 2022, plusieurs Go. Windows demandera une autorisation d\'administrateur, et l\'installation vaut acceptation de la licence Microsoft.'],
};
const short = (sha) => sha.slice(0, 10);

/** Installation de VIctory : prérequis, progression, journal. */
function victoryPanel({ onLater } = {}) {
  const head = h('div'), list = h('div', { class: 'needs' }), actions = h('div', { class: 'row' });
  const step = h('div', { class: 'grow' }), pct = h('span', { class: 'num muted' }), fill = h('i'), meter = h('div', { class: 'meter big' }, fill);
  const work = h('div', { class: 'form', hidden: true }, h('div', { class: 'row' }, step, pct, btn('Annuler', () => act(() => post('/api/victory/cancel')), 'danger')), meter);
  const error = h('p', { class: 'note error', hidden: true });
  const log = h('div', { class: 'console short', role: 'log' }), details = h('details', {}, h('summary', { class: 'small muted' }, 'Journal'), log);
  const el = h('section', { class: 'card victory' }, head, list, work, error, details, actions);

  const install = async (id) => {
    const [title, text] = TOOLS[id];
    if (await ask(title, () => ({ body: [h('p', { class: 'muted' }, text)], submit: 'Installer', value: () => true }))) act(() => post('/api/victory/tool', { id }));
  };
  const update = () => act(async () => {
    const { commit } = await post('/api/victory/latest');
    const { installed } = state.victory;
    if (installed?.commit === commit) return toast('VIctory est à jour');
    const ok = await ask('Mettre à jour VIctory ?', () => ({
      body: [h('p', { class: 'muted' }, `Nouvelle version : ${short(commit)}${installed ? `, à la place de ${short(installed.commit)}` : ''}. La compilation prend plusieurs minutes. La version actuelle reste en place si elle échoue.`)],
      submit: 'Compiler', value: () => true,
    }));
    if (ok) await post('/api/victory/update');
  });

  let shape = null;
  return {
    el,
    update() {
      const { victory: v } = state, running = v.status === 'running';
      const next = JSON.stringify([v.valid, v.moduleStale, v.status, v.task, v.checks, v.installed?.commit, v.error]);
      if (next !== shape) {
        shape = next;
        const ready = v.checks?.every((c) => c.ok);
        head.replaceChildren(h('div', { class: 'srv-top' }, h('div', { class: 'ico' }, icon('build')), h('div', { class: 'grow' },
          h('h2', {}, v.installed ? 'VIctory' : 'Installer VIctory'),
          h('p', { class: 'muted small' }, v.installed ? `Version ${short(v.installed.commit)}, compilée le ${new Date(v.installed.builtAt).toLocaleDateString('fr-FR')}. ${v.moduleStale ? 'Le module multijoueur a changé : recompilez pour l\'avoir.' : 'Module multijoueur inclus.'}`
            : `SixM télécharge le code public de VIctory (GPL-3, version ${short(v.pinned)}) et le compile sur ce PC. Aucun fichier de jeu n'est fourni.`))));
        list.hidden = running || (v.valid && ready !== false) || !v.checks;
        list.replaceChildren(...(v.checks ?? []).map((c) => h('div', { class: 'need' }, h('span', { class: `dot ${c.ok ? 'on' : 'bad'}` }),
          h('div', { class: 'grow' }, h('strong', {}, c.name), h('span', { class: 'muted small' }, c.detail)),
          c.ok ? null : c.id === 'disk' ? btn('Libérer de l\'espace', () => act(() => post('/api/victory/storage'))) : btn('Installer', () => install(c.id)))));
        work.hidden = !running;
        error.hidden = v.status !== 'failed';
        error.textContent = cap(v.error ?? '');
        actions.hidden = running;
        const again = ['failed', 'cancelled'].includes(v.status) && ['install', 'update', 'rebuild'].includes(v.task);
        actions.replaceChildren(
          ...(v.installed && v.moduleStale ? [btn('Recompiler', () => act(() => post('/api/victory/rebuild')), 'primary', { disabled: ready === false })] : []),
          ...(v.installed ? [btn('Mettre à jour', update)] : [btn(again ? 'Réessayer' : 'Installer VIctory', () => act(() => post('/api/victory/install')), 'primary', { disabled: !ready })]),
          btn('Revérifier', () => act(() => post('/api/victory/check')), 'quiet'),
          ...(onLater ? [btn('Plus tard', onLater, 'quiet')] : []));
        if (running) details.open = true;
      }
      step.textContent = v.step;
      pct.textContent = v.progress === null ? '' : `${Math.round(v.progress * 100)} %`;
      fill.style.width = v.progress === null ? '100%' : `${v.progress * 100}%`;
      meter.classList.toggle('wait', v.progress === null);
      const lines = v.log.join('\n');
      details.hidden = !lines;
      if (log.textContent !== lines) {
        const end = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
        log.textContent = lines;
        if (end) log.scrollTop = log.scrollHeight;
      }
    },
  };
}

function playScreen() {
  const setup = victoryPanel({ onLater: () => { laterVictory = true; render(); } });
  const bar = gameBar(), error = h('p', { class: 'note error', hidden: true }), lists = h('div');
  const input = h('input', {
    placeholder: 'Adresse d\'un serveur', 'aria-label': 'Adresse d\'un serveur', autocomplete: 'off', spellcheck: false,
    oninput: () => { const address = input.value.trim(); chosen = address ? { address } : null; render(); },
  });
  const el = h('div', {},
    h('div', { class: 'head' }, h('h1', {}, 'Où voulez-vous jouer ?'),
      h('form', { class: 'address', onsubmit: (e) => { e.preventDefault(); go(); } }, icon('link'), input)),
    error, setup.el, bar.el, lists);
  let shape = '', cards = [], solo = null;
  return {
    el,
    update() {
      const { settings, session, hosts, victory } = state;
      setup.el.hidden = !victory.supported || (victory.status !== 'running' && (victory.valid || laterVictory));
      if (!setup.el.hidden) setup.update();
      bar.update();
      error.hidden = !session.error;
      error.textContent = cap(session.error ?? '');
      if (session.error === 'mot de passe incorrect' && session.attempt !== promptedAttempt) {
        promptedAttempt = session.attempt;
        join(session.address, true);
      }
      const own = hosts.filter((x) => x.status === 'running').map((x) => [`localhost:${x.port}`, x.name]);
      const known = new Set(own.map(([a]) => a));
      const favs = settings.favorites.filter((f) => !known.has(f.address)).map((f) => [f.address, f.label]);
      for (const [a] of favs) known.add(a);
      const recents = settings.recents.filter((a) => !known.has(a)).map((a) => [a, '']);
      const next = JSON.stringify([own, favs, recents, canSolo() && settings.target]);
      if (next !== shape) {
        shape = next;
        cards = [];
        solo = null;
        const section = (title, items, before) => {
          if (!items.length && !before) return [];
          const c = items.map(([a, l]) => serverCard(a, l));
          cards.push(...c);
          return [h('div', { class: 'section' }, h('h2', {}, title)), h('div', { class: 'grid' }, before, c.map((x) => x.el))];
        };
        if (canSolo()) {
          const hit = h('button', { type: 'button', class: 'hit', onclick: () => { chosen = { solo: true }; input.value = ''; render(); }, ondblclick: () => go() }, 'Solo');
          solo = h('article', { class: 'card srv' }, h('div', { class: 'srv-top' }, avatar('1', 'big mine'), h('div', { class: 'grow' }, hit, h('div', { class: 'sub' }, 'Le jeu, sans serveur'))),
            h('div', { class: 'srv-foot' }, settings.games.find((g) => g.id === settings.target)?.name));
        }
        const all = [...section('Vos serveurs', own), ...section('Favoris', favs), ...section('Récents', recents), ...(solo ? section('Sans serveur', [], solo) : [])];
        lists.replaceChildren(...(cards.length || solo ? all : [h('div', { class: 'empty' },
          h('h2', {}, 'Aucun serveur pour l\'instant'), h('p', { class: 'muted' }, 'Collez l\'adresse d\'un ami en haut, ou créez le vôtre.'),
          h('div', { class: 'row' }, btn('Créer un serveur', () => { view = 'host'; render(); createHost(); }, 'primary')))]));
        if (!chosen && cards.length) chosen = { address: [...own, ...favs, ...recents][0][0] };
        updateDock();
        queryAll();
      }
      for (const c of cards) c.update();
      solo?.classList.toggle('chosen', !!chosen?.solo);
    },
  };
}

function hexSpinner() {
  const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'spin');
  svg.setAttribute('viewBox', '0 0 32 32');
  const ring = document.createElementNS(ns, 'path');
  ring.setAttribute('d', 'M16 5l9.5 5.5v11L16 27l-9.5-5.5v-11z');
  svg.append(ring);
  [[16, 5], [25.5, 10.5], [25.5, 21.5], [16, 27], [6.5, 21.5], [6.5, 10.5]].forEach(([x, y], i) => {
    const c = document.createElementNS(ns, 'circle');
    for (const [k, v] of [['cx', x], ['cy', y], ['r', 3], ['opacity', 1 - i * 0.14]]) c.setAttribute(k, v);
    svg.append(c);
  });
  return svg;
}

function connectingScreen() {
  const text = h('p', { class: 'muted' });
  return {
    el: h('div', { class: 'center' }, hexSpinner(), h('h1', {}, 'Connexion…'), text, btn('Annuler', () => act(() => post('/api/disconnect')))),
    update() {
      text.textContent = state.session.address ?? '';
    },
  };
}

function drawRadar(canvas, { local, players, id }) {
  const size = canvas.clientWidth * devicePixelRatio;
  if (canvas.width !== size) canvas.width = canvas.height = size;
  const g = canvas.getContext('2d'), css = getComputedStyle(document.documentElement);
  const c = size / 2, color = (n) => css.getPropertyValue(n);
  g.clearRect(0, 0, size, size);
  g.strokeStyle = color('--line');
  g.lineWidth = devicePixelRatio;
  for (const r of [0.3, 0.6, 0.9]) {
    g.beginPath();
    for (let k = 0; k < 6; k++) g.lineTo(c + c * r * Math.sin(k * Math.PI / 3), c - c * r * Math.cos(k * Math.PI / 3));
    g.closePath();
    g.stroke();
  }
  const me = local ?? { x: 0, y: 0 };
  const others = players.filter((p) => p.id !== id);
  const range = Math.max(50, ...others.map((p) => Math.hypot(p.pos.x - me.x, p.pos.y - me.y)));
  const plot = (x, y, fill) => { g.fillStyle = fill; g.beginPath(); g.arc(x, y, 5 * devicePixelRatio, 0, 7); g.fill(); };
  g.font = `${11 * devicePixelRatio}px "Segoe UI", sans-serif`;
  g.textAlign = 'center';
  for (const p of others) {
    const x = c + ((p.pos.x - me.x) / range) * c * 0.78, y = c - ((p.pos.y - me.y) / range) * c * 0.78;
    plot(x, y, color('--text'));
    g.fillStyle = color('--muted');
    g.fillText(p.name, x, y - 9 * devicePixelRatio);
  }
  if (local) plot(c, c, color('--accent'));
}

function sessionScreen() {
  const title = h('h1'), sub = h('p', { class: 'muted' }), face = h('span');
  const log = h('div', { class: 'chat-log', role: 'log', 'aria-live': 'polite' });
  const input = h('input', { placeholder: 'Écrire un message', 'aria-label': 'Message', maxLength: 200, autocomplete: 'off' });
  const players = h('div', { class: 'list' }), count = h('h2'), bar = gameBar();
  const hintText = h('div', { class: 'grow' }), profiles = btn('Ouvrir les profils', () => act(() => post('/api/profiles')));
  const hint = h('div', { class: 'note row', hidden: true }, hintText, profiles);
  const radar = h('canvas', { class: 'radar', role: 'img', 'aria-label': 'Position des autres joueurs autour de vous' });
  /** « Nom: texte » d'un joueur présent devient une bulle ; le reste est un message du serveur. */
  const line = (text) => {
    const at = text.indexOf(': '), who = at > 0 ? text.slice(0, at) : '';
    const me = state.settings.name;
    if (!who || (who !== me && !state.session.roster.some((p) => p.name === who))) return h('div', { class: 'msg sys' }, text);
    return h('div', { class: 'msg' }, avatar(who, who === me ? 'small mine' : 'small'), h('div', { class: 'grow' }, h('b', {}, who), text.slice(at + 2)));
  };
  const send = (e) => {
    e.preventDefault();
    const text = input.value.trim();
    input.value = '';
    if (text) act(() => post('/api/chat', { text }));
  };
  let seen = -1, names = '';
  return {
    el: h('div', {},
      h('div', { class: 'head' }, h('div', { class: 'srv-top grow' }, face, h('div', { class: 'grow' }, title, sub)), btn('Quitter', () => act(() => post('/api/disconnect')), 'danger')),
      hint, bar.el,
      h('div', { class: 'session gap' },
        h('div', { class: 'card chat' }, log, h('form', { onsubmit: send }, input, h('button', { class: 'btn primary icon', 'aria-label': 'Envoyer' }, icon('send')))),
        h('div', { class: 'stack' }, radar, count, players))),
    update() {
      const { session: s, settings } = state;
      bar.update();
      hint.hidden = s.adapter !== 'victory';
      const m = s.module;
      const why = s.local ? 'Votre position est partagée : les noms des autres joueurs s\'affichent dans le jeu.'
        : !m?.connected ? 'Le module multijoueur ne répond pas encore : chat et liste des joueurs seulement.'
          : m.error ? `Profil du jeu refusé : ${m.error}`
            : !m.build ? 'En attente du jeu.'
              : m.profile ? 'Profil trouvé, position pas encore lisible.'
                : `Aucun profil pour cette version du jeu (${m.build}) : chat et liste des joueurs seulement.`;
      hintText.textContent = `Dans le jeu : F7 menu, F8 écrire, F9 masquer. ${why}`;
      profiles.hidden = !m?.build || (m.profile && !m.error);
      const server = s.serverName || s.address;
      if (title.textContent !== server) { title.textContent = server; face.replaceChildren(avatar(server, 'big')); }
      sub.textContent = `${s.address} · ${s.adapter === 'victory' ? 'VIctory' : 'Démo, sans jeu'}`;
      const end = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
      for (const l of s.log) if (l.seq > seen) { log.append(line(l.text)); seen = l.seq; }
      while (log.childElementCount > 200) log.firstChild.remove();
      if (end) log.scrollTop = log.scrollHeight;
      const list = [{ id: s.id, name: settings.name, me: true }, ...s.roster.filter((p) => p.id !== s.id)];
      const next = list.map((p) => `${p.id}:${p.name}`).join();
      if (next !== names) {
        names = next;
        count.textContent = `Joueurs (${list.length})`;
        players.replaceChildren(...list.map((p) => h('div', { class: 'item' }, avatar(p.name, p.me ? 'small mine' : 'small'), h('span', { class: 'title grow' }, p.name), p.me && h('span', { class: 'tag' }, 'vous'))));
      }
      drawRadar(radar, s);
    },
  };
}

// --- Héberger ---------------------------------------------------------------------------------

const STATUS = { stopped: 'Arrêté', starting: 'Démarrage…', running: 'En ligne', stopping: 'Arrêt…', failed: 'En erreur' };
const statusClass = (s) => (s === 'running' ? 'on' : s === 'failed' ? 'bad' : '');

async function download(id, name) {
  await act(async () => {
    const blob = await (await request('/api/pack', { method: 'POST', body: JSON.stringify({ id }) })).blob();
    const a = h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    toast(`${name} téléchargé`);
  });
}

function configInputs(c = {}) {
  const i = {
    name: h('input', { value: c.name ?? '', maxLength: 64, required: true, placeholder: 'Mon serveur', autocomplete: 'off' }),
    description: h('input', { value: c.description ?? '', maxLength: 256, autocomplete: 'off' }),
    maxPlayers: h('input', { type: 'number', min: 1, max: 1024, value: c.maxPlayers ?? 32, required: true }),
    port: h('input', { type: 'number', min: 1, max: 65535, value: c.port ?? 30120, required: true }),
    password: h('input', { type: 'password', maxLength: 128, autocomplete: 'new-password', placeholder: c.hasPassword ? 'inchangé' : 'aucun' }),
  };
  return {
    i,
    value: () => ({
      name: i.name.value.trim(), description: i.description.value.trim(),
      maxPlayers: Number(i.maxPlayers.value), port: Number(i.port.value),
      // Vide : on garde le mot de passe existant.
      ...(i.password.value && { password: i.password.value }),
    }),
  };
}

async function createHost() {
  const used = new Set(state.hosts.map((x) => x.port));
  let port = 30120;
  while (used.has(port)) port++;
  const { i, value } = configInputs({ port });
  const data = await ask('Créer un serveur', () => ({
    body: [h('div', { class: 'form' }, field('Nom', i.name), h('div', { class: 'cols' }, field('Places', i.maxPlayers), field('Port', i.port)), field('Mot de passe (facultatif)', i.password))],
    submit: 'Créer et démarrer', value,
  }));
  if (!data) return;
  await act(async () => {
    const { id } = await post('/api/hosts', data);
    hostId = id;
    hostTab = 'console';
    await post('/api/hosts/start', { id });
  });
}

function hostsScreen() {
  const list = h('div');
  let shape = '';
  const choice = (name, title, text, button) => h('div', { class: 'card choice' }, h('div', { class: 'ico' }, icon(name)), h('h2', {}, title), h('p', { class: 'muted' }, text), button);
  return {
    el: h('div', {},
      h('div', { class: 'head' }, h('div', {}, h('h1', {}, 'Hébergez votre serveur'), h('p', { class: 'muted' }, 'Vos règles, vos mods, vos joueurs.'))),
      list,
      h('div', { class: 'choices' },
        choice('pc', 'Sur ce PC', 'Prêt en deux clics. Il tourne tant que SixM est ouvert.', btn('Créer un serveur', createHost, 'primary')),
        choice('box', 'Sur un hébergement', 'Un zip pour un VPS, un autre PC ou Docker. Il faut seulement Node.js.', iconBtn('down', 'Télécharger le serveur', () => download(undefined, 'SixM-Server.zip'))))),
    update() {
      const next = JSON.stringify(state.hosts.map(({ id, name, status, port, mods }) => [id, name, status, port, mods]));
      if (next === shape) return;
      shape = next;
      const open = (x) => { hostId = x.id; hostTab = x.status === 'running' ? 'console' : 'mods'; render(); };
      list.replaceChildren(...(state.hosts.length ? [h('div', { class: 'grid' }, state.hosts.map((x) => h('article', { class: 'card srv' },
        h('div', { class: 'srv-top' }, avatar(x.name, 'big'), h('div', { class: 'grow' }, h('button', { type: 'button', class: 'hit', onclick: () => open(x) }, x.name),
          h('div', { class: 'sub' }, x.broken ? 'server.json invalide' : `Port ${x.port} · ${x.mods.filter((m) => m.enabled).length} mod(s)`))),
        h('div', { class: 'srv-foot' }, h('span', { class: `pill ${statusClass(x.status)}` }, h('span', { class: `dot ${statusClass(x.status)}` }), STATUS[x.status]))))), h('div', { class: 'section' }, h('h2', {}, 'Nouveau serveur'))] : []));
    },
  };
}

function hostScreen() {
  const id = hostId;
  const get = () => state.hosts.find((x) => x.id === id);
  const dot = h('span'), title = h('h1'), sub = h('p', { class: 'muted row' }), face = h('span'), word = h('span'), pill = h('span', { class: 'pill' }, dot, word), port = h('span');
  sub.append(pill, port);
  const power = btn('', () => act(() => post(`/api/hosts/${['running', 'starting'].includes(get().status) ? 'stop' : 'start'}`, { id })), 'primary');
  const playHere = btn('Jouer dessus', () => { view = 'play'; act(() => post('/api/hosts/play', { id })); });
  const stale = h('p', { class: 'note', hidden: true }, 'Réglages modifiés : arrêtez puis démarrez le serveur pour les appliquer.');
  const tabs = [['console', 'Console'], ['mods', 'Mods'], ['settings', 'Réglages'], ['share', 'Partager']];
  const body = { console: consoleTab, mods: modsTab, settings: hostSettingsTab, share: shareTab }[hostTab](id, get);
  const broken = get().broken;
  return {
    el: h('div', {},
      iconBtn('back', 'Mes serveurs', () => { hostId = null; render(); }, 'quiet'),
      h('div', { class: 'head gap' }, h('div', { class: 'srv-top grow' }, face, h('div', { class: 'grow' }, title, sub)), h('div', { class: 'row' }, playHere, power)),
      stale,
      broken ? h('p', { class: 'note error' }, broken) : [
        h('div', { class: 'tabs', role: 'tablist' }, tabs.map(([k, t]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(k === hostTab), onclick: () => { hostTab = k; render(); } }, t))),
        body.el]),
    update() {
      const x = get();
      dot.className = `dot ${statusClass(x.status)}`;
      pill.className = `pill ${statusClass(x.status)}`;
      word.textContent = STATUS[x.status];
      if (title.textContent !== x.name) { title.textContent = x.name; face.replaceChildren(avatar(x.name, 'big')); }
      port.textContent = x.port ? `Port ${x.port}` : '';
      const on = ['running', 'starting'].includes(x.status);
      power.textContent = on ? 'Arrêter' : 'Démarrer';
      power.className = `btn ${on ? 'danger' : 'primary'}`;
      power.disabled = x.status === 'stopping' || !!x.broken;
      playHere.hidden = x.status !== 'running' || state.session.status !== 'idle';
      stale.hidden = !(x.stale && x.status === 'running');
      if (!broken) body.update?.(x);
    },
  };
}

function consoleTab(id) {
  const out = h('div', { class: 'console', role: 'log' });
  const input = h('input', { placeholder: 'Commande : help, players, say bonjour…', 'aria-label': 'Commande', autocomplete: 'off', spellcheck: false });
  let last = null;
  return {
    el: h('div', {}, out, h('form', {
      class: 'join', onsubmit: (e) => {
        e.preventDefault();
        const line = input.value.trim();
        input.value = '';
        if (line) act(() => post('/api/hosts/command', { id, line }));
      },
    }, input, h('button', { class: 'btn' }, 'Envoyer'))),
    update(x) {
      input.disabled = x.status !== 'running';
      const text = x.log.join('\n') || 'Démarrez le serveur pour voir son activité.';
      if (text === last) return;
      last = text;
      out.textContent = text;
      out.scrollTop = out.scrollHeight;
    },
  };
}

function modsTab(id) {
  const list = h('div', { class: 'list' });
  const file = h('input', { type: 'file', accept: '.zip', hidden: true, onchange: () => { install(file.files[0]); file.value = ''; } });
  async function install(f) {
    if (!f) return;
    if (!/\.zip$/i.test(f.name)) return toast('Choisissez un fichier .zip', true);
    await act(async () => {
      const q = new URLSearchParams({ id, file: f.name });
      const { name } = await (await request(`/api/hosts/import?${q}`, { method: 'POST', body: f })).json();
      toast(`Mod « ${name} » installé. Activez-le pour l'utiliser.`);
    });
  }
  const drop = h('div', {
    class: 'drop',
    ondragover: (e) => { e.preventDefault(); drop.classList.add('over'); },
    ondragleave: () => drop.classList.remove('over'),
    ondrop: (e) => { e.preventDefault(); drop.classList.remove('over'); install(e.dataTransfer.files[0]); },
  }, icon('box'), h('h2', {}, 'Déposez un mod ici'), h('p', { class: 'small muted' }, 'Un fichier .zip. Les joueurs le reçoivent en se connectant.'),
  h('div', { class: 'row' }, btn('Choisir un zip', () => file.click()), btn('Ouvrir le dossier des mods', () => act(() => post('/api/hosts/open', { id })), 'quiet')), file);
  let shape = null;
  return {
    el: h('div', {}, list, drop, h('p', { class: 'small muted gap' }, 'Les scripts serveur d\'un mod ont accès à votre PC : n\'activez que des mods de confiance.')),
    update(x) {
      const next = JSON.stringify(x.mods);
      if (next === shape) return;
      shape = next;
      list.hidden = !x.mods.length;
      list.replaceChildren(...x.mods.map((m) => {
        const toggle = h('input', {
          type: 'checkbox', class: 'switch', role: 'switch', checked: m.enabled, disabled: !!m.broken, 'aria-label': `Activer ${m.name}`,
          onchange: async () => { if (!await act(() => post('/api/hosts/mod', { id, name: m.name, enabled: toggle.checked }))) toggle.checked = m.enabled; },
        });
        return h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 'title' }, m.name), m.description && h('div', { class: 'sub' }, m.description)),
          m.server && h('span', { class: 'tag' }, 'serveur'), m.client && h('span', { class: 'tag' }, 'client'), toggle);
      }));
    },
  };
}

function hostSettingsTab(id, get) {
  const { i, value } = configInputs(get());
  const remove = h('input', { type: 'checkbox', class: 'switch', role: 'switch', 'aria-label': 'Retirer le mot de passe' });
  return {
    el: h('form', {
      class: 'card form', onsubmit: async (e) => {
        e.preventDefault();
        if (await act(() => post('/api/hosts/update', { id, ...value(), ...(remove.checked && { password: '' }) }))) {
          toast('Réglages enregistrés');
          screen.key = null; // reconstruit avec les valeurs enregistrées
          render();
        }
      },
    },
    field('Nom', i.name), field('Description', i.description),
    h('div', { class: 'cols' }, field('Places', i.maxPlayers), field('Port', i.port), field('Nouveau mot de passe', i.password)),
    get().hasPassword && h('label', { class: 'row' }, remove, 'Retirer le mot de passe'),
    h('div', {}, h('button', { class: 'btn primary' }, 'Enregistrer'))),
  };
}

function shareTab(id, get) {
  const { port } = get();
  const copy = (text) => act(async () => { await navigator.clipboard.writeText(text); toast('Adresse copiée'); });
  const row = (label, address) => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 'title' }, address), h('div', { class: 'sub' }, label)), btn('Copier', () => copy(address)));
  return {
    el: h('div', { class: 'stack' },
      h('div', { class: 'list' }, row('Sur ce PC', `localhost:${port}`), state.lan && row('Sur votre réseau local', `${state.lan}:${port}`)),
      h('div', { class: 'card form' }, h('h2', {}, 'Par Internet'),
      h('p', { class: 'muted' }, `Ouvrez le port TCP ${port} dans le pare-feu et sur votre box, puis donnez votre IP publique. La connexion n'est pas chiffrée, mot de passe compris.`)),
      h('div', { class: 'card form' }, h('h2', {}, 'Déplacer sur un hébergement'),
      h('p', { class: 'muted' }, 'Le zip contient ce serveur, ses réglages (mot de passe compris) et ses mods. Sur la machine : start.bat, start.sh ou Docker.'),
      h('div', {}, iconBtn('down', 'Télécharger ce serveur', () => download(id, `${id}.zip`), 'primary')))),
  };
}

// --- Réglages ---------------------------------------------------------------------------------

function settingsScreen() {
  const { settings } = state;
  const name = h('input', { value: settings.name, maxLength: 24, required: true, autocomplete: 'off' });
  const pathRow = (label, value, title, folder = false) => {
    const input = h('input', { value, spellcheck: false, autocomplete: 'off', placeholder: folder ? 'C:\\…\\dossier' : 'C:\\…\\fichier.exe' });
    const browse = btn('Parcourir', () => act(async () => {
      browse.disabled = true;
      try { const { file } = await post('/api/pick', { title, folder }); if (file) input.value = file; } finally { browse.disabled = false; }
    }));
    browse.hidden = !state.linkSupported;
    return { input, el: field(label, h('div', { class: 'join' }, input, browse)) };
  };
  const build = victoryPanel();
  const auto = h('input', { type: 'checkbox', class: 'switch', role: 'switch', checked: settings.autoUpdate });
  const upText = h('p', { class: 'muted small' });
  const upCheck = btn('Vérifier', () => act(() => post('/api/update/check'))), upApply = btn('Installer et redémarrer', () => act(() => post('/api/update/apply')), 'primary');
  const updateInfo = () => {
    const { update: u } = state;
    const busy = ['checking', 'downloading', 'restarting'].includes(u.status);
    upText.textContent = `Version ${u.version}. ${{
      idle: '', current: 'À jour.', checking: 'Recherche…', downloading: 'Mise à jour en cours…', restarting: 'Redémarrage…', failed: cap(u.error ?? ''),
      available: u.mode === 'portable' ? `La version ${u.latest} est sur GitHub : remplacez votre dossier portable.` : `Version ${u.latest} disponible.`,
    }[u.status]}`;
    upCheck.disabled = busy;
    upApply.hidden = u.status !== 'available' || !['installed', 'source'].includes(u.mode);
  };
  const section = (title, text, ...body) => h('section', { class: 'card' }, h('header', {}, h('h2', {}, title), text && h('p', { class: 'muted small' }, text)), ...body);
  const victory = pathRow('victory.exe', settings.victory, 'Choisir victory.exe');
  const games = settings.games.map((g) => ({ ...g }));
  const rows = h('div', { class: 'form' });
  let inputs = [];
  const collect = () => inputs.map((r) => ({ id: r.id, name: r.name.value, path: r.path.input.value, console: r.console.value }));
  const draw = (list) => {
    inputs = list.map((g) => ({
      id: g.id,
      name: h('input', { value: g.name, maxLength: 40, placeholder: 'Nom', autocomplete: 'off' }),
      path: pathRow('Dossier du jeu', g.path, 'Choisir le dossier du jeu extrait de votre disque', true),
      console: h('select', {}, h('option', { value: 'series-x' }, 'Series X'), h('option', { value: 'series-s' }, 'Series S')),
    }));
    inputs.forEach((r, i) => { r.console.value = list[i].console ?? 'series-x'; });
    rows.replaceChildren(...inputs.map((r, i) => h('div', { class: 'game' },
      h('div', { class: 'cols' }, field('Nom', r.name), field('Version console', r.console)), r.path.el,
      h('div', {}, btn('Retirer', () => { const l = collect(); l.splice(i, 1); draw(l); }, 'quiet')))));
  };
  draw(games);
  return {
    el: h('div', { class: 'settings' },
      h('h1', {}, 'Réglages'),
      h('form', {
        class: 'form', onsubmit: async (e) => {
          e.preventDefault();
          const unquote = (p) => p.trim().replace(/^"|"$/g, '');
          const list = collect().map((g) => ({ ...g, path: unquote(g.path) }));
          const known = new Set(state.settings.games.map((g) => g.id));
          if (!await act(() => post('/api/settings', { name: name.value, autoUpdate: auto.checked, victory: unquote(victory.input.value), games: list }))) return;
          // Un jeu tout juste ajouté devient le jeu choisi.
          const added = state.settings.games.find((g) => !known.has(g.id));
          if (added) await act(() => post('/api/settings', { target: added.id }));
          toast('Réglages enregistrés');
          for (const g of list) if (g.path) await act(() => post('/api/game/check', { path: g.path })); // signale un dossier incomplet
          screen.key = null;
          render();
        },
      },
      section('Profil', null, field('Pseudo', name)),
      section('Mises à jour', 'Au lancement, depuis GitHub. Jamais pendant une partie.', h('label', { class: 'row' }, auto, 'Mettre SixM à jour automatiquement'), upText,
        h('div', { class: 'row' }, upCheck, upApply)),
      section('Jeux', 'Le dossier extrait de votre propre disque. SixM y trouve le programme du jeu et ne modifie rien.', rows,
        h('div', {}, btn('Ajouter un jeu', () => draw([...collect(), { name: '', path: '', console: 'series-x' }])))),
      section('Emplacement de VIctory', 'Rempli tout seul après l\'installation. Vous pouvez aussi indiquer le vôtre.', victory.el),
      h('div', { class: 'save' }, h('button', { class: 'btn primary' }, 'Enregistrer'))),
      state.victory.supported && build.el,
      section('Fermer SixM', 'Quitte le serveur en cours et arrête ceux hébergés sur ce PC. Le jeu reste ouvert.',
        h('div', {}, btn('Fermer SixM', () => act(() => post('/api/quit')), 'danger')))),
    update: () => { build.update(); updateInfo(); },
  };
}

// --- Boucle -----------------------------------------------------------------------------------

await refresh();
(async () => {
  for (;;) {
    await new Promise((r) => setTimeout(r, document.hidden ? 3000 : 600));
    await refresh();
  }
})();
setInterval(queryAll, 10000);
