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
    form.append(h('h2', {}, title), ...body, h('div', { class: 'row' },
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

async function refresh() {
  try {
    state = await (await request('/api/state')).json();
  } catch (e) {
    if (screen.key !== 'offline') show('offline', () => ({
      el: h('div', { class: 'center' }, h('h1', {}, e.offline ? 'SixM est fermé' : 'Session expirée'), h('p', { class: 'muted' }, e.message)),
    }));
    return;
  }
  render();
}

const modeName = (m) => (m === 'victory' ? 'VIctory' : 'Démo, sans jeu');

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
  $('#foot-name').textContent = settings.name;
  $('#foot-mode').textContent = modeName(settings.adapter);
  const live = hosts.some((x) => x.status === 'running');
  $('#nav-host').hidden = !live;
  $('#nav-host').classList.toggle('on', live);
  for (const b of document.querySelectorAll('nav button'))
    b.dataset.view === view ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current');

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

// --- Jouer ------------------------------------------------------------------------------------

async function join(address, retry = false) {
  let password;
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
  await Promise.all([...new Set([...favorites.map((f) => f.address), ...recents])].map(async (address) => {
    const info = await post('/api/query', { address }).catch(() => null);
    if (info) statuses.set(address, info);
  }));
  render();
}

function serverRow(address, label) {
  const dot = h('span', { class: 'dot' });
  const title = h('div', { class: 'title' });
  const sub = h('div', { class: 'sub num' });
  const star = h('button', { class: 'star', type: 'button', onclick: () => act(() => post('/api/favorite', { address, label: statuses.get(address)?.name ?? label })) });
  const el = h('div', { class: 'item' }, dot, h('div', { class: 'grow' }, title, sub), star, btn('Rejoindre', () => join(address)));
  return {
    el,
    update() {
      const i = statuses.get(address);
      dot.className = `dot ${i?.online ? 'on' : ''}`;
      title.textContent = i?.name ?? (label || address);
      sub.textContent = !i ? address
        : !i.online ? `${address} · hors ligne`
          : `${address} · ${i.players}/${i.maxPlayers} joueurs · ${i.ping} ms${i.password ? ' · mot de passe' : ''}`;
      const fav = state.settings.favorites.some((f) => f.address === address);
      star.textContent = fav ? '★' : '☆';
      star.setAttribute('aria-pressed', fav);
      star.title = fav ? 'Retirer des favoris' : 'Ajouter aux favoris';
      star.setAttribute('aria-label', star.title);
    },
  };
}

function playScreen() {
  const input = h('input', { placeholder: 'Adresse du serveur, par exemple 203.0.113.7', 'aria-label': 'Adresse du serveur', autocomplete: 'off', spellcheck: false, required: true });
  const error = h('p', { class: 'note error', hidden: true });
  const lists = h('div');
  const submit = async (e) => {
    e.preventDefault();
    const address = input.value.trim();
    if (!address) return;
    // La fiche dit si un mot de passe est nécessaire.
    const info = await post('/api/query', { address }).catch(() => null);
    if (info) statuses.set(address, info);
    join(address);
  };
  const el = h('div', {},
    h('div', { class: 'head' }, h('div', {}, h('h1', {}, 'Rejoindre un serveur'), h('p', { class: 'muted' }, 'Collez l\'adresse donnée par l\'hébergeur.'))),
    h('form', { class: 'join', onsubmit: submit }, input, h('button', { class: 'btn primary' }, 'Rejoindre')),
    h('div', {}, error), lists);
  let shape = '', rows = [];
  return {
    el,
    update() {
      const { settings, session } = state;
      error.hidden = !session.error;
      error.textContent = cap(session.error ?? '');
      error.style.marginTop = '12px';
      if (session.error === 'mot de passe incorrect' && session.attempt !== promptedAttempt) {
        promptedAttempt = session.attempt;
        join(session.address, true);
      }
      const favs = settings.favorites, recents = settings.recents.filter((a) => !favs.some((f) => f.address === a));
      const next = JSON.stringify([favs, recents]);
      if (next !== shape) {
        shape = next;
        rows = [];
        const section = (title, items) => {
          if (!items.length) return [];
          const r = items.map(([a, l]) => serverRow(a, l));
          rows.push(...r);
          return [h('h2', {}, title), h('div', { class: 'list' }, r.map((x) => x.el))];
        };
        const all = [...section('Favoris', favs.map((f) => [f.address, f.label])), ...section('Récents', recents.map((a) => [a, '']))];
        lists.replaceChildren(...(all.length ? all : [
          h('h2', {}, 'Pas encore de serveur'),
          h('p', { class: 'muted' }, 'Ceux que vous rejoignez apparaîtront ici.'),
          h('div', { class: 'gap' }, btn('Héberger mon serveur', () => { view = 'host'; render(); })),
        ]));
        queryAll();
      }
      for (const r of rows) r.update();
    },
  };
}

function connectingScreen() {
  const text = h('p', { class: 'muted' });
  return {
    el: h('div', { class: 'center' }, h('div', { class: 'spin' }), h('h1', {}, 'Connexion…'), text, btn('Annuler', () => act(() => post('/api/disconnect')))),
    update() {
      text.textContent = state.session.adapter === 'victory' ? 'En attente de VIctory, puis du serveur.' : state.session.address ?? '';
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
  for (const r of [0.3, 0.6, 0.9]) { g.beginPath(); g.arc(c, c, c * r, 0, 7); g.stroke(); }
  const me = local ?? { x: 0, y: 0 };
  const others = players.filter((p) => p.id !== id);
  const range = Math.max(50, ...others.map((p) => Math.hypot(p.pos.x - me.x, p.pos.y - me.y)));
  const plot = (x, y, fill) => { g.fillStyle = fill; g.beginPath(); g.arc(x, y, 5 * devicePixelRatio, 0, 7); g.fill(); };
  for (const p of others) plot(c + ((p.pos.x - me.x) / range) * c * 0.9, c - ((p.pos.y - me.y) / range) * c * 0.9, color('--text'));
  if (local) plot(c, c, color('--accent'));
}

function sessionScreen() {
  const title = h('h1'), sub = h('p', { class: 'muted' });
  const log = h('div', { class: 'chat-log', role: 'log', 'aria-live': 'polite' });
  const input = h('input', { placeholder: 'Écrire un message', 'aria-label': 'Message', maxLength: 200, autocomplete: 'off' });
  const players = h('div', { class: 'list' }), count = h('h2');
  const radar = h('canvas', { class: 'radar', role: 'img', 'aria-label': 'Position des autres joueurs autour de vous' });
  const send = (e) => {
    e.preventDefault();
    const text = input.value.trim();
    input.value = '';
    if (text) act(() => post('/api/chat', { text }));
  };
  let seen = -1, names = '';
  return {
    el: h('div', {},
      h('div', { class: 'head' }, h('div', { class: 'grow' }, title, sub), btn('Quitter le serveur', () => act(() => post('/api/disconnect')), 'danger')),
      h('div', { class: 'session' },
        h('div', { class: 'card chat' }, log, h('form', { onsubmit: send }, input, h('button', { class: 'btn primary' }, 'Envoyer'))),
        h('div', {}, radar, count, players))),
    update() {
      const { session: s, settings } = state;
      title.textContent = s.serverName || s.address;
      sub.textContent = `${s.address} · ${modeName(s.adapter)}`;
      const end = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
      for (const l of s.log) if (l.seq > seen) { log.append(h('div', {}, l.text)); seen = l.seq; }
      while (log.childElementCount > 200) log.firstChild.remove();
      if (end) log.scrollTop = log.scrollHeight;
      const list = [{ id: s.id, name: settings.name, me: true }, ...s.players.filter((p) => p.id !== s.id)];
      const next = list.map((p) => `${p.id}:${p.name}`).join();
      if (next !== names) {
        names = next;
        count.textContent = `Joueurs visibles (${list.length})`;
        players.replaceChildren(...list.map((p) => h('div', { class: 'item' }, h('span', { class: `dot ${p.me ? 'on' : ''}` }), h('span', { class: 'title' }, p.name), p.me && h('span', { class: 'tag' }, 'vous'))));
      }
      drawRadar(radar, s);
    },
  };
}

// --- Héberger ---------------------------------------------------------------------------------

const STATUS = { stopped: 'Arrêté', starting: 'Démarrage…', running: 'En ligne', stopping: 'Arrêt…', failed: 'En erreur' };
const statusDot = (s) => `dot ${s === 'running' ? 'on' : s === 'failed' ? 'bad' : ''}`;

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
  return {
    el: h('div', {},
      h('div', { class: 'head' }, h('div', {}, h('h1', {}, 'Héberger un serveur'), h('p', { class: 'muted' }, 'Sur ce PC pour jouer tout de suite, ou ailleurs pour qu\'il reste allumé.'))),
      list,
      h('div', { class: 'choices' },
        h('div', { class: 'card' }, h('h2', {}, 'Sur ce PC'), h('p', { class: 'muted' }, 'Le serveur tourne tant que SixM est ouvert.'), btn('Créer un serveur', createHost, 'primary')),
        h('div', { class: 'card' }, h('h2', {}, 'Sur un hébergement'), h('p', { class: 'muted' }, 'Un zip à déposer sur un VPS, un autre PC ou Docker. Il faut seulement Node.js.'), btn('Télécharger le serveur', () => download(undefined, 'SixM-Server.zip'))))),
    update() {
      const next = JSON.stringify(state.hosts.map(({ id, name, status, port, mods }) => [id, name, status, port, mods]));
      if (next === shape) return;
      shape = next;
      list.replaceChildren(...(state.hosts.length ? [h('div', { class: 'list' }, state.hosts.map((x) => h('div', { class: 'item' },
        h('span', { class: statusDot(x.status) }),
        h('div', { class: 'grow' }, h('div', { class: 'title' }, x.name), h('div', { class: 'sub' }, x.broken ? 'server.json invalide' : `${STATUS[x.status]} · port ${x.port} · ${x.mods.filter((m) => m.enabled).length} mod(s)`)),
        btn('Gérer', () => { hostId = x.id; hostTab = x.status === 'running' ? 'console' : 'mods'; render(); })))), h('div', { class: 'gap' })] : []));
    },
  };
}

function hostScreen() {
  const id = hostId;
  const get = () => state.hosts.find((x) => x.id === id);
  const dot = h('span', { class: 'dot' }), title = h('span'), sub = h('p', { class: 'muted' });
  const power = btn('', () => act(() => post(`/api/hosts/${['running', 'starting'].includes(get().status) ? 'stop' : 'start'}`, { id })), 'primary');
  const playHere = btn('Jouer dessus', () => { view = 'play'; act(() => post('/api/hosts/play', { id })); });
  const stale = h('p', { class: 'note', hidden: true }, 'Réglages modifiés : arrêtez puis démarrez le serveur pour les appliquer.');
  const tabs = [['console', 'Console'], ['mods', 'Mods'], ['settings', 'Réglages'], ['share', 'Partager']];
  const body = { console: consoleTab, mods: modsTab, settings: hostSettingsTab, share: shareTab }[hostTab](id, get);
  const broken = get().broken;
  return {
    el: h('div', {},
      btn('← Mes serveurs', () => { hostId = null; render(); }, 'quiet back'),
      h('div', { class: 'head' }, h('div', { class: 'grow' }, h('h1', {}, dot, ' ', title), sub), h('div', { class: 'row' }, playHere, power)),
      stale,
      broken ? h('p', { class: 'note error' }, broken) : [
        h('div', { class: 'tabs', role: 'tablist' }, tabs.map(([k, t]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(k === hostTab), onclick: () => { hostTab = k; render(); } }, t))),
        body.el]),
    update() {
      const x = get();
      dot.className = statusDot(x.status);
      title.textContent = x.name;
      sub.textContent = `${STATUS[x.status]}${x.port ? ` · port ${x.port}` : ''}`;
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
  }, h('p', {}, 'Déposez ici le zip d\'un mod'), h('p', { class: 'small muted' }, 'Les joueurs le reçoivent automatiquement en se connectant.'),
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
      class: 'form', onsubmit: async (e) => {
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
    el: h('div', {},
      h('div', { class: 'list' }, row('Sur ce PC', `localhost:${port}`), state.lan && row('Sur votre réseau local', `${state.lan}:${port}`)),
      h('h2', {}, 'Par Internet'),
      h('p', { class: 'muted' }, `Ouvrez le port TCP ${port} dans le pare-feu et sur votre box, puis donnez votre IP publique. La connexion n'est pas chiffrée, mot de passe compris.`),
      h('h2', {}, 'Déplacer sur un hébergement'),
      h('p', { class: 'muted' }, 'Le zip contient ce serveur, ses réglages (mot de passe compris) et ses mods. Sur la machine : start.bat, start.sh ou Docker.'),
      h('div', { class: 'row gap' }, btn('Télécharger ce serveur', () => download(id, `${id}.zip`), 'primary'))),
  };
}

// --- Réglages ---------------------------------------------------------------------------------

function settingsScreen() {
  const { settings } = state;
  const name = h('input', { value: settings.name, maxLength: 24, required: true, autocomplete: 'off' });
  const radio = (value, title, text) => h('label', { class: 'item' },
    h('input', { type: 'radio', name: 'adapter', value, checked: settings.adapter === value, class: 'radio' }),
    h('div', { class: 'grow' }, h('div', { class: 'title' }, title), h('div', { class: 'small muted' }, text)));
  return {
    el: h('div', {},
      h('div', { class: 'head' }, h('h1', {}, 'Réglages')),
      h('form', {
        class: 'form', onsubmit: async (e) => {
          e.preventDefault();
          const adapter = new FormData(e.target).get('adapter');
          if (await act(() => post('/api/settings', { name: name.value, adapter }))) toast('Réglages enregistrés');
        },
      },
      field('Pseudo', name),
      h('div', {}, h('h2', {}, 'Mode de jeu'), h('div', { class: 'list' },
        radio('mock', 'Démo, sans jeu', 'Chat, joueurs et radar dans cette fenêtre. Fonctionne partout.'),
        radio('victory', 'VIctory', 'Relie SixM au jeu. Demande un bridge dans VIctory, qui n\'existe pas encore.'))),
      h('div', {}, h('button', { class: 'btn primary' }, 'Enregistrer'))),
      h('h2', {}, 'Fermer SixM'),
      h('p', { class: 'muted' }, 'Quitte le serveur en cours et arrête ceux hébergés sur ce PC.'),
      h('div', { class: 'row gap' }, btn('Fermer SixM', () => act(() => post('/api/quit')), 'danger'))),
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
