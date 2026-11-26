// Menu principal de SixM : chaque entrée ouvre un menu construit pour le joueur.
// Exemple pour écrire ses propres menus : sixm.addMenu, sixm.openMenu, sixm.onMenu.

const EMOTES = ['salue', 'danse', 'applaudit', 'rit', 'fait un clin d\'œil', 'hausse les épaules'];
const ANNONCES = ['Redémarrage dans 5 minutes', 'Événement sur la plage dans 10 minutes', 'Bienvenue aux nouveaux joueurs !'];
const prefs = new Map(); // id joueur -> { noms, son }

sixm.on('playerDropped', (p) => prefs.delete(p.id));
const prefsOf = (id) => {
  if (!prefs.has(id)) prefs.set(id, { noms: true, son: 70 });
  return prefs.get(id);
};

// --- Profil ---------------------------------------------------------------------------------------
sixm.addMenu({
  id: 'profil', label: 'Mon profil', icon: 'user', description: 'Votre identifiant et vos préférences.',
  open: (player) => {
    const me = sixm.getPlayer(player.id);
    const p = prefsOf(player.id);
    return {
      id: 'profil', title: 'Profil', subtitle: me.name,
      items: [
        { id: 'uid', label: 'Identifiant', right: me.uid ? me.uid.slice(0, 13) + '…' : 'aucun', description: 'À donner à l\'hôte pour entrer sur un serveur à liste blanche.', disabled: true },
        { id: 'role', label: 'Rôle', right: me.admin ? 'Admin' : 'Joueur', disabled: true },
        { type: 'separator', label: 'Préférences' },
        { id: 'noms', type: 'checkbox', label: 'Afficher les noms', value: p.noms, description: 'Noms des joueurs au-dessus de leur tête.' },
        { id: 'son', type: 'slider', label: 'Volume des notifications', min: 0, max: 100, step: 10, value: p.son },
      ],
    };
  },
});
sixm.onMenu('profil', (player, item, value) => {
  const p = prefsOf(player.id);
  if (item === 'noms' && typeof value === 'boolean') p.noms = value;
  if (item === 'son' && typeof value === 'number') p.son = value;
});

// --- Emotes ---------------------------------------------------------------------------------------
sixm.addMenu({
  id: 'emotes', label: 'Emotes', icon: 'smiley', description: 'Montrez votre humeur aux autres joueurs.',
  open: () => ({
    id: 'emotes', title: 'Emotes', subtitle: 'Choisissez une emote',
    items: EMOTES.map((e, i) => ({ id: String(i), label: e.charAt(0).toUpperCase() + e.slice(1) })),
  }),
});
sixm.onMenu('emotes', (player, item) => {
  const e = EMOTES[Number(item)];
  if (e) sixm.chat(null, `* ${player.name} ${e}`);
});

// --- Administration (admins seulement) ----------------------------------------------------------
const adminMenu = (viewer) => {
  const players = sixm.getPlayers().filter((p) => p.id !== viewer.id);
  const requests = sixm.whitelist.requests();
  return {
    id: 'admin', title: 'Administration', subtitle: `${sixm.getPlayers().length} joueur(s) connecté(s)`, color: '#d9343a',
    items: [
      {
        id: 'joueurs', type: 'submenu', label: 'Joueurs', right: String(players.length), icon: 'users',
        menu: {
          id: 'admin:joueurs', title: 'Joueurs', subtitle: 'Choisissez un joueur',
          items: players.length ? players.map((p) => ({
            id: String(p.id), type: 'submenu', label: p.name, right: p.admin ? 'Admin' : `#${p.id}`,
            menu: {
              id: 'admin:joueur', title: p.name, subtitle: p.uid ?? 'sans identité',
              items: [
                { id: `kick:${p.id}`, label: 'Expulser', icon: 'sign-out' },
                { id: `ban:${p.id}`, label: 'Bannir', icon: 'prohibit', description: 'Par adresse IP et par identifiant.' },
                { id: `admin:${p.id}`, label: p.admin ? 'Retirer les droits d\'admin' : 'Nommer admin', icon: 'crown', disabled: !p.uid },
              ],
            },
          })) : [{ id: 'vide', label: 'Personne d\'autre pour l\'instant', disabled: true }],
        },
      },
      {
        id: 'demandes', type: 'submenu', label: 'Demandes d\'accès', right: String(requests.length), icon: 'user-plus',
        disabled: !sixm.whitelist.enabled(),
        description: sixm.whitelist.enabled() ? 'Joueurs refusés par la liste blanche.' : 'La liste blanche est désactivée.',
        menu: {
          id: 'admin:demandes', title: 'Demandes d\'accès', subtitle: 'Valider pour accepter',
          items: requests.length ? requests.map((r) => ({ id: r.uid, label: r.name || r.uid, right: 'Accepter', description: r.uid }))
            : [{ id: 'vide', label: 'Aucune demande', disabled: true }],
        },
      },
      {
        id: 'annonces', type: 'submenu', label: 'Annonces', icon: 'megaphone',
        menu: { id: 'admin:annonces', title: 'Annonces', subtitle: 'Envoyée à tous les joueurs', items: ANNONCES.map((a, i) => ({ id: String(i), label: a })) },
      },
    ],
  };
};

sixm.addMenu({
  id: 'admin', label: 'Administration', icon: 'shield', description: 'Joueurs, demandes d\'accès, annonces.',
  visible: (player) => sixm.isAdmin(player.id),
  open: adminMenu,
});
sixm.onMenu('admin:joueur', (player, item) => {
  if (!sixm.isAdmin(player.id)) return;
  const [action, id] = item.split(':');
  const target = sixm.getPlayer(Number(id));
  if (!target) return;
  if (action === 'kick') sixm.kick(target.id, `expulsé par ${player.name}`);
  if (action === 'ban') sixm.ban(target.id, `banni par ${player.name}`);
  if (action === 'admin') sixm.setAdmin(target.id, !target.admin);
  sixm.openMenu(player.id, adminMenu(player));
});
sixm.onMenu('admin:demandes', (player, uid) => {
  if (!sixm.isAdmin(player.id)) return;
  const r = sixm.whitelist.requests().find((x) => x.uid === uid);
  if (!r) return;
  sixm.whitelist.add(r.uid, r.name);
  sixm.chat(player.id, `${r.name || r.uid} est accepté sur le serveur.`);
  sixm.openMenu(player.id, adminMenu(player));
});
sixm.onMenu('admin:annonces', (player, item) => {
  if (!sixm.isAdmin(player.id)) return;
  const a = ANNONCES[Number(item)];
  if (a) sixm.chat(null, `[Annonce] ${a}`);
});
