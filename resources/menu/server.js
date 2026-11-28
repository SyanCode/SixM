// Menu principal de SixM (touche M dans la fenêtre, F7 dans le jeu).
// Exemple complet pour écrire ses menus : sixm.addMenu, sixm.openMenu, sixm.onMenu, sixm.notify (docs/MENUS.md).
//
// Tout ce qui est ici fonctionne sans le jeu : messages, signalements, heure et météo partagées,
// administration. « Mon jeu » et la téléportation agissent sur le jeu par sixm.game, là où le profil
// local de chaque joueur le permet. Appliquer l'heure et la météo dans le jeu revient au portage.

const RED = '#e5484d', GREEN = '#30a46c', BLUE = '#3e63dd', VIOLET = '#8e4ec6', GOLD = '#f5a524';

const EMOTES = [
  ['salue', 'Saluer'], ['danse', 'Danser'], ['applaudit', 'Applaudir'], ['rit', 'Rire'],
  ['fait un clin d\'œil', 'Clin d\'œil'], ['hausse les épaules', 'Hausser les épaules'],
  ['s\'assoit', 'S\'asseoir'], ['fait signe de venir', 'Faire signe de venir'], ['pointe du doigt', 'Pointer'],
  ['se facepalme', 'Facepalm'], ['fait un pouce levé', 'Pouce levé'], ['s\'étire', 'S\'étirer'],
];
const WEATHERS = [['clear', 'Ensoleillé'], ['clouds', 'Nuageux'], ['rain', 'Pluie'], ['thunder', 'Orage'], ['fog', 'Brouillard'], ['snow', 'Neige']];
const REASONS = ['Triche', 'Insultes', 'Anti-jeu', 'Pseudo inapproprié', 'Autre'];
const ANNONCES = ['Redémarrage dans 5 minutes', 'Événement sur la plage dans 10 minutes', 'Bienvenue aux nouveaux joueurs !'];

const joined = new Map(); // id joueur -> date d'arrivée
const prefs = new Map(); // id joueur -> { noms, sons }
const reports = []; // { id, from, target, uid, reason, at }
let nextReport = 1;

sixm.on('playerConnected', (p) => joined.set(p.id, Date.now()));
sixm.on('playerDropped', (p) => { joined.delete(p.id); prefs.delete(p.id); });
for (const p of sixm.getPlayers()) joined.set(p.id, Date.now()); // ressource redémarrée en cours de partie

const prefsOf = (id) => {
  if (!prefs.has(id)) prefs.set(id, { noms: true, sons: true });
  return prefs.get(id);
};
const clock = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const weatherName = (w) => (WEATHERS.find(([id]) => id === w) ?? WEATHERS[0])[1];
const since = (id) => {
  const min = Math.floor((Date.now() - (joined.get(id) ?? Date.now())) / 60000);
  return min < 1 ? 'à l\'instant' : min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60}`;
};
const others = (viewer) => sixm.getPlayers().filter((p) => p.id !== viewer.id);
const admin = (player) => sixm.isAdmin(player.id);

// --- Joueurs en ligne ------------------------------------------------------------------------------

const playerMenu = (viewer, p) => ({
  id: 'joueur', title: p.name, subtitle: p.admin ? 'Administrateur' : 'Joueur', color: BLUE,
  items: [
    { id: `info:${p.id}`, label: 'En ligne depuis', right: since(p.id), icon: 'clock', disabled: true },
    { id: `msg:${p.id}`, type: 'input', label: 'Message privé', icon: 'chat', placeholder: `Écrire à ${p.name}…`, maxLength: 160 },
    { id: `wave:${p.id}`, label: 'Saluer', icon: 'smiley', description: `Tout le monde verra que vous saluez ${p.name}.` },
    {
      id: `report:${p.id}`, type: 'submenu', label: 'Signaler', icon: 'flag', description: 'Prévenir les administrateurs.',
      menu: {
        id: 'signaler', title: 'Signaler', subtitle: p.name, color: RED,
        items: REASONS.map((r, i) => ({ id: `${p.id}:${i}`, label: r, confirm: true, description: 'Les administrateurs connectés sont prévenus.' })),
      },
    },
  ],
});

sixm.addMenu({
  id: 'joueurs', label: 'Joueurs en ligne', icon: 'users', description: 'Messages privés, saluer, signaler.',
  open: (viewer) => {
    const list = others(viewer);
    return {
      id: 'joueurs', title: 'Joueurs', subtitle: `${list.length + 1} en ligne`, color: BLUE,
      items: list.length
        ? list.map((p) => ({
          id: String(p.id), type: 'submenu', label: p.name, icon: p.admin ? 'crown' : 'user',
          badge: p.admin ? 'ADMIN' : '', badgeColor: RED, right: `#${p.id}`, menu: playerMenu(viewer, p),
        }))
        : [{ id: 'seul', label: 'Vous êtes seul pour l\'instant', icon: 'user', disabled: true }],
    };
  },
});

sixm.onMenu('joueur', (player, item, value) => {
  const [action, id] = item.split(':');
  const target = sixm.getPlayer(Number(id));
  if (!target) return sixm.notify(player.id, { title: 'Joueur parti', text: 'Ce joueur s\'est déconnecté.', icon: 'user', color: RED });
  if (action === 'msg' && typeof value === 'string' && value) {
    sixm.notify(target.id, { title: `Message de ${player.name}`, text: value, icon: 'chat', color: BLUE, seconds: 8 });
    sixm.notify(player.id, { title: 'Message envoyé', text: `à ${target.name}`, icon: 'check', color: GREEN });
  }
  if (action === 'wave') sixm.chat(null, `* ${player.name} salue ${target.name}`);
});

sixm.onMenu('signaler', (player, item) => {
  const [id, i] = item.split(':').map(Number);
  const target = sixm.getPlayer(id);
  if (!target || !REASONS[i] || target.id === player.id) return;
  if (reports.filter((r) => r.from === player.name && Date.now() - r.at < 60000).length >= 3)
    return sixm.notify(player.id, { title: 'Doucement', text: 'Trois signalements par minute au plus.', icon: 'clock', color: GOLD });
  reports.unshift({ id: nextReport++, from: player.name, target: target.name, uid: target.uid, reason: REASONS[i], at: Date.now() });
  reports.length = Math.min(reports.length, 100);
  sixm.notify(player.id, { title: 'Signalement envoyé', text: `${target.name} : ${REASONS[i]}`, icon: 'flag', color: GREEN });
  for (const a of sixm.getPlayers().filter((p) => p.admin && p.id !== player.id))
    sixm.notify(a.id, { title: 'Nouveau signalement', text: `${player.name} signale ${target.name} : ${REASONS[i]}`, icon: 'flag', color: RED, seconds: 10 });
});

// --- Emotes ----------------------------------------------------------------------------------------

sixm.addMenu({
  id: 'emotes', label: 'Emotes', icon: 'smiley', description: 'Montrez votre humeur aux autres joueurs.',
  open: () => ({
    id: 'emotes', title: 'Emotes', subtitle: 'Visibles par tous', color: VIOLET,
    items: EMOTES.map(([, label], i) => ({ id: String(i), label, icon: 'smiley' })),
  }),
});
sixm.onMenu('emotes', (player, item) => {
  const e = EMOTES[Number(item)];
  if (e) sixm.chat(null, `* ${player.name} ${e[0]}`);
});

// --- Heure et météo ---------------------------------------------------------------------------------

const worldMenu = (player) => {
  const w = sixm.getWorld();
  const can = admin(player);
  const hint = can ? '' : 'Réservé aux administrateurs.';
  return {
    id: 'monde', title: 'Heure et météo', subtitle: `${clock(w.minutes)} · ${weatherName(w.weather)}`, color: GOLD,
    items: [
      { id: 'heure', type: 'slider', label: 'Heure', icon: 'clock', min: 0, max: 23, step: 1, value: Math.floor(w.minutes / 60), disabled: !can, description: hint || 'Pour tous les joueurs du serveur.' },
      { id: 'meteo', type: 'list', label: 'Météo', icon: 'weather', options: WEATHERS.map(([, n]) => n), value: Math.max(0, WEATHERS.findIndex(([id]) => id === w.weather)), disabled: !can, description: hint },
      { id: 'figer', type: 'checkbox', label: 'Figer l\'heure', icon: 'clock', value: w.frozen, disabled: !can, description: hint || 'Sinon une journée dure 48 minutes.' },
      { type: 'separator', label: 'Raccourcis' },
      { id: 'matin', label: 'Matin', right: '08:00', disabled: !can },
      { id: 'midi', label: 'Midi', right: '12:00', disabled: !can },
      { id: 'soir', label: 'Coucher du soleil', right: '19:30', disabled: !can },
      { id: 'nuit', label: 'Nuit', right: '23:00', disabled: !can },
    ],
  };
};
sixm.addMenu({ id: 'monde', label: 'Heure et météo', icon: 'weather', description: 'Partagées par tous les joueurs du serveur.', open: worldMenu });
sixm.onMenu('monde', (player, item, value) => {
  if (!admin(player)) return;
  const w = sixm.getWorld();
  const at = { matin: 480, midi: 720, soir: 1170, nuit: 1380 };
  if (item === 'heure' && typeof value === 'number') sixm.setWorld({ minutes: value * 60 + (w.minutes % 60) });
  else if (item === 'meteo' && typeof value === 'number' && WEATHERS[value]) sixm.setWorld({ weather: WEATHERS[value][0] });
  else if (item === 'figer' && typeof value === 'boolean') sixm.setWorld({ frozen: value });
  else if (at[item] !== undefined) sixm.setWorld({ minutes: at[item] });
  else return;
  const now = sixm.getWorld();
  sixm.notify(null, { title: 'Monde', text: `${clock(now.minutes)} · ${weatherName(now.weather)}${now.frozen ? ' · heure figée' : ''}`, icon: 'weather', color: GOLD, seconds: 3 });
  sixm.openMenu(player.id, worldMenu(player));
});

// --- Profil -----------------------------------------------------------------------------------------

const profileMenu = (player) => {
  const me = sixm.getPlayer(player.id);
  const p = prefsOf(player.id);
  return {
    id: 'profil', title: 'Profil', subtitle: me.name, color: GREEN,
    items: [
      { id: 'uid', label: 'Identifiant', icon: 'user', right: me.uid ? `${me.uid.slice(0, 13)}…` : 'aucun', disabled: true, description: 'À donner à l\'hôte pour entrer sur un serveur à liste blanche.' },
      { id: 'role', label: 'Rôle', icon: me.admin ? 'crown' : 'user', right: me.admin ? 'Administrateur' : 'Joueur', disabled: true },
      { id: 'temps', label: 'En ligne depuis', icon: 'clock', right: since(player.id), disabled: true },
      { type: 'separator', label: 'Préférences' },
      { id: 'noms', type: 'checkbox', label: 'Afficher les noms', value: p.noms, description: 'Noms des joueurs au-dessus de leur tête.' },
      { id: 'sons', type: 'checkbox', label: 'Sons des notifications', value: p.sons },
    ],
  };
};
sixm.addMenu({ id: 'profil', label: 'Mon profil', icon: 'user', description: 'Votre identifiant et vos préférences.', open: profileMenu });
sixm.onMenu('profil', (player, item, value) => {
  const p = prefsOf(player.id);
  if (item === 'noms' && typeof value === 'boolean') p.noms = value;
  if (item === 'sons' && typeof value === 'boolean') p.sons = value;
});

// --- Mon jeu (admins) : ce que le profil local de chacun permet (no clip, téléportation…) --------------
// Le jeu n'est touché que par le module SixM dans VIctory, et seulement là où le profil du joueur l'autorise.

const VALUE_LABELS = {
  noclip: ['No clip', 'Traverser les murs et voler.'], invincible: ['Invincible', 'Aucun dégât.'], god: ['Invincible', 'Aucun dégât.'],
  speed: ['Vitesse', 'Multiplicateur de vitesse.'], gravity: ['Gravité', ''], wanted: ['Niveau de recherche', ''], money: ['Argent', ''],
};
const label = (name) => VALUE_LABELS[name] ?? [name.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()), ''];
const gameState = new Map(); // id joueur -> Map(nom -> valeur posée)
sixm.on('playerDropped', (p) => gameState.delete(p.id));
/** Un peu à côté d'une position, pour ne pas arriver dans quelqu'un. */
const near = (pos) => ({ x: pos.x + 1.5, y: pos.y + 1.5, z: pos.z + 0.5, h: pos.h });

const gameMenu = (viewer) => {
  const me = sixm.getPlayer(viewer.id), can = me.game, set = gameState.get(viewer.id) ?? new Map();
  const targets = others(viewer).filter((p) => p.located);
  const items = can.values.map((v) => {
    const [text, description] = label(v.name);
    return v.type === 'u8'
      ? { id: `v:${v.name}`, type: 'checkbox', label: text, value: set.get(v.name) === 1, description: description || `Valeur « ${v.name} » de votre profil.` }
      : { id: `v:${v.name}`, type: 'input', label: text, right: set.has(v.name) ? String(set.get(v.name)) : '', placeholder: v.type === 'f32' ? '1.0' : '0', maxLength: 16, description: description || `Valeur « ${v.name} » (${v.type}) de votre profil.` };
  });
  if (can.teleport) {
    items.push({ type: 'separator', label: 'Téléportation' }, {
      id: 'tp', type: 'submenu', label: 'Aller vers un joueur', icon: 'map', right: String(targets.length),
      menu: {
        id: 'jeu:tp', title: 'Aller vers un joueur', color: VIOLET,
        items: targets.length ? targets.map((p) => ({ id: String(p.id), label: p.name, icon: 'user' })) : [{ id: 'vide', label: 'Aucune position connue', disabled: true }],
      },
    });
  }
  if (!items.length) {
    items.push({
      id: 'rien', label: 'Votre jeu ne permet rien pour l\'instant', icon: 'gear', disabled: true,
      description: 'Ajoutez « teleport = on » ou des lignes « value.nom = u8, … » à votre profil local (integrations/victory/PROTOCOL.md).',
    });
  }
  return { id: 'jeu', title: 'Mon jeu', subtitle: 'Ce que votre profil local permet', color: VIOLET, items };
};

sixm.addMenu({
  id: 'jeu', label: 'Mon jeu', icon: 'game', description: 'No clip, téléportation… selon votre profil local.',
  badge: 'ADMIN', visible: admin, open: gameMenu,
});

sixm.onMenu('jeu', (player, item, value) => {
  if (!admin(player) || !item.startsWith('v:')) return;
  const name = item.slice(2), v = sixm.getPlayer(player.id).game.values.find((x) => x.name === name);
  if (!v) return;
  const n = typeof value === 'boolean' ? Number(value) : Number(String(value ?? '').replace(',', '.'));
  if (!Number.isFinite(n) || String(value ?? '').trim() === '') return;
  // Une case reste posée (le jeu la remettrait sinon) ; décochée, le jeu reprend la main.
  const done = v.type === 'u8' && n === 0 ? sixm.game.set(player.id, name, 0) && sixm.game.release(player.id, name)
    : sixm.game.set(player.id, name, n, { hold: v.type === 'u8' });
  if (!done) return sixm.notify(player.id, { title: 'Impossible', text: 'votre jeu ne le permet plus', icon: 'prohibit', color: RED });
  if (!gameState.has(player.id)) gameState.set(player.id, new Map());
  gameState.get(player.id).set(name, n);
  sixm.openMenu(player.id, gameMenu(player));
});

sixm.onMenu('jeu:tp', (player, item) => {
  if (!admin(player)) return;
  const target = sixm.getPlayer(Number(item));
  if (!target?.located || !sixm.game.teleport(player.id, near(target.pos))) {
    sixm.notify(player.id, { title: 'Impossible', text: target ? 'téléportation refusée' : 'ce joueur est parti', icon: 'prohibit', color: RED });
  }
});

// Le jeu dit si l'action a marché : seuls les échecs sont signalés.
sixm.on('gameResult', (player, r) => {
  if (!r.ok) sixm.notify(player.id, { title: 'Le jeu a refusé', text: `${r.what} : ${r.error ?? 'erreur'}`, icon: 'prohibit', color: RED });
});

// --- Administration (admins seulement) ------------------------------------------------------------

const adminMenu = (viewer) => {
  const players = others(viewer), me = sixm.getPlayer(viewer.id);
  const requests = sixm.whitelist.requests();
  const res = sixm.resources.list();
  return {
    id: 'admin', title: 'Administration', subtitle: `${sixm.getPlayers().length} joueur(s) connecté(s)`, color: RED,
    items: [
      {
        id: 'joueurs', type: 'submenu', label: 'Joueurs', icon: 'users', right: String(players.length),
        menu: {
          id: 'admin:joueurs', title: 'Joueurs', subtitle: 'Choisissez un joueur', color: RED,
          items: players.length ? players.map((p) => ({
            id: String(p.id), type: 'submenu', label: p.name, icon: p.admin ? 'crown' : 'user', badge: p.admin ? 'ADMIN' : '', badgeColor: RED, right: `#${p.id}`,
            menu: {
              id: 'admin:joueur', title: p.name, subtitle: p.uid ?? 'sans identité', color: RED,
              items: [
                { id: `warn:${p.id}`, type: 'input', label: 'Avertir', icon: 'megaphone', placeholder: 'Motif de l\'avertissement', maxLength: 120 },
                { id: `kick:${p.id}`, label: 'Expulser', icon: 'sign-out', confirm: true },
                { id: `ban:${p.id}`, label: 'Bannir', icon: 'prohibit', confirm: true, description: 'Par adresse IP et par identifiant.' },
                { id: `admin:${p.id}`, label: p.admin ? 'Retirer les droits d\'admin' : 'Nommer admin', icon: 'crown', confirm: true, disabled: !p.uid },
                { type: 'separator', label: 'Dans le jeu' },
                {
                  id: `goto:${p.id}`, label: 'Aller vers lui', icon: 'map', disabled: !me.game.teleport || !p.located,
                  description: !me.game.teleport ? 'Votre jeu ne permet pas la téléportation (profil local).' : !p.located ? 'Sa position est inconnue.' : '',
                },
                {
                  id: `bring:${p.id}`, label: 'L\'amener ici', icon: 'target', disabled: !p.game.teleport || !me.located,
                  description: !p.game.teleport ? 'Son jeu ne permet pas la téléportation.' : !me.located ? 'Votre position est inconnue.' : '',
                },
              ],
            },
          })) : [{ id: 'vide', label: 'Personne d\'autre pour l\'instant', disabled: true }],
        },
      },
      {
        id: 'signalements', type: 'submenu', label: 'Signalements', icon: 'flag', right: String(reports.length),
        badge: reports.length ? String(reports.length) : '', badgeColor: RED,
        menu: {
          id: 'admin:signalements', title: 'Signalements', subtitle: 'Valider pour classer', color: RED,
          items: reports.length ? reports.map((r) => ({
            id: String(r.id), label: `${r.target} : ${r.reason}`, right: new Date(r.at).toTimeString().slice(0, 5), confirm: true,
            description: `Par ${r.from}${r.uid ? ` · ${r.uid}` : ''}. Valider le classe.`,
          })) : [{ id: 'vide', label: 'Aucun signalement', disabled: true }],
        },
      },
      {
        id: 'demandes', type: 'submenu', label: 'Demandes d\'accès', icon: 'user-plus', right: String(requests.length),
        badge: requests.length ? String(requests.length) : '', badgeColor: GOLD, disabled: !sixm.whitelist.enabled(),
        description: sixm.whitelist.enabled() ? 'Joueurs refusés par la liste blanche.' : 'La liste blanche est désactivée.',
        menu: {
          id: 'admin:demandes', title: 'Demandes d\'accès', subtitle: 'Valider pour accepter', color: RED,
          items: requests.length ? requests.map((r) => ({ id: r.uid, label: r.name || r.uid, right: 'Accepter', description: r.uid }))
            : [{ id: 'vide', label: 'Aucune demande', disabled: true }],
        },
      },
      {
        id: 'annonces', type: 'submenu', label: 'Annonce', icon: 'megaphone',
        menu: {
          id: 'admin:annonces', title: 'Annonce', subtitle: 'À tous les joueurs', color: RED,
          items: [
            { id: 'libre', type: 'input', label: 'Écrire une annonce', icon: 'megaphone', placeholder: 'Texte de l\'annonce', maxLength: 160 },
            { type: 'separator', label: 'Toutes prêtes' },
            ...ANNONCES.map((a, i) => ({ id: String(i), label: a })),
          ],
        },
      },
      {
        id: 'ressources', type: 'submenu', label: 'Ressources', icon: 'gear', right: `${res.filter((r) => r.running).length}/${res.length}`,
        menu: {
          id: 'admin:ressources', title: 'Ressources', subtitle: 'Démarrer, arrêter, redémarrer', color: RED,
          items: res.map((r) => ({
            id: r.name, type: 'submenu', label: r.name, icon: 'gear', badge: r.running ? 'ACTIVE' : '', badgeColor: GREEN,
            menu: {
              id: 'admin:ressource', title: r.name, subtitle: r.running ? 'Active' : 'Arrêtée', color: RED,
              items: r.name === 'menu' ? [{ id: 'self', label: 'Ce menu ne peut pas s\'arrêter lui-même', disabled: true }] : r.running
                ? [{ id: `restart:${r.name}`, label: 'Redémarrer', icon: 'lightning', confirm: true }, { id: `stop:${r.name}`, label: 'Arrêter', icon: 'prohibit', confirm: true }]
                : [{ id: `start:${r.name}`, label: 'Démarrer', icon: 'lightning' }],
            },
          })),
        },
      },
    ],
  };
};

sixm.addMenu({
  id: 'admin', label: 'Administration', icon: 'shield', description: 'Joueurs, signalements, accès, annonces, ressources.',
  badge: 'ADMIN', visible: admin, open: adminMenu,
});

/** Action d'admin, puis le menu rafraîchi (le joueur reste où il était). */
const asAdmin = (fn) => (player, item, value) => {
  if (!admin(player)) return;
  try {
    fn(player, item, value);
  } catch (e) {
    sixm.notify(player.id, { title: 'Impossible', text: e.message, icon: 'prohibit', color: RED });
  }
  if (sixm.getPlayer(player.id)) sixm.openMenu(player.id, adminMenu(player));
};

sixm.onMenu('admin:joueur', asAdmin((player, item, value) => {
  const [action, id] = item.split(':');
  const target = sixm.getPlayer(Number(id));
  if (!target) throw new Error('ce joueur est parti');
  if (action === 'warn' && typeof value === 'string' && value) {
    sixm.notify(target.id, { title: 'Avertissement', text: value, icon: 'megaphone', color: RED, seconds: 10 });
    sixm.notify(player.id, { title: 'Avertissement envoyé', text: target.name, icon: 'check', color: GREEN });
  }
  if (action === 'goto' && !sixm.game.teleport(player.id, near(target.pos))) throw new Error('votre jeu ne permet pas la téléportation');
  if (action === 'bring') {
    const me = sixm.getPlayer(player.id);
    if (!sixm.game.teleport(target.id, near(me.pos))) throw new Error(`le jeu de ${target.name} ne permet pas la téléportation`);
    sixm.notify(target.id, { title: 'Téléporté', text: `par ${player.name}`, icon: 'map', color: BLUE });
  }
  if (action === 'kick') sixm.kick(target.id, `expulsé par ${player.name}`);
  if (action === 'ban') sixm.ban(target.id, `banni par ${player.name}`);
  if (action === 'admin') {
    sixm.setAdmin(target.id, !target.admin);
    sixm.notify(target.id, { title: target.admin ? 'Droits retirés' : 'Vous êtes admin', text: `par ${player.name}`, icon: 'crown', color: GOLD });
  }
}));
sixm.onMenu('admin:signalements', asAdmin((player, item) => {
  const i = reports.findIndex((r) => r.id === Number(item));
  if (i >= 0) reports.splice(i, 1);
}));
sixm.onMenu('admin:demandes', asAdmin((player, uid) => {
  const r = sixm.whitelist.requests().find((x) => x.uid === uid);
  if (!r) return;
  sixm.whitelist.add(r.uid, r.name);
  sixm.notify(player.id, { title: 'Accès accepté', text: r.name || r.uid, icon: 'check', color: GREEN });
}));
sixm.onMenu('admin:annonces', asAdmin((player, item, value) => {
  const text = item === 'libre' ? (typeof value === 'string' ? value : '') : ANNONCES[Number(item)];
  if (text) sixm.notify(null, { title: 'Annonce', text, icon: 'megaphone', color: RED, seconds: 10 });
}));
sixm.onMenu('admin:ressource', asAdmin((player, item) => {
  const [action, name] = item.split(':');
  if (!['start', 'stop', 'restart'].includes(action)) return;
  sixm.resources[action](name);
  sixm.notify(player.id, { title: 'Ressources', text: `${name} : ${{ start: 'démarrée', stop: 'arrêtée', restart: 'redémarrée' }[action]}`, icon: 'gear', color: GREEN });
}));
