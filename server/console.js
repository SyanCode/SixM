import readline from 'node:readline';

const HELP = `commandes :
  players                  joueurs connectés
  kick <id> [raison]       expulser
  ban <id> [raison]        bannir l'IP du joueur
  bans | unban <ip|id>     lister / lever les bannissements
  whitelist                liste blanche et demandes
  whitelist add|remove <id> accepter / retirer un joueur (identifiant sixm:…)
  admin <id joueur> [off]  donner ou retirer les droits d'admin
  access reload            relire access.json
  say <message>            message à tous
  resources                ressources disponibles et démarrées
  start|stop|restart <res> gérer une ressource
  info                     état du serveur
  quit                     arrêter`;

/** Exécute une ligne de console. `out` reçoit le texte à afficher. */
export function runCommand(srv, line, out = console.log) {
  const [cmd, arg, ...rest] = line.trim().split(/\s+/);
  const reason = rest.join(' ') || undefined;
  const player = () => {
    const p = srv.world.players.get(Number(arg));
    if (!p) throw new Error(`joueur inconnu : ${arg ?? ''}`);
    return p;
  };
  switch (cmd) {
    case '': return;
    case 'start': case 'restart':
      if (!arg) throw new Error('nom de ressource attendu');
      return void srv.resources[cmd](arg);
    case 'stop':
      if (!srv.resources.stop(arg)) throw new Error(`ressource non démarrée : ${arg ?? ''}`);
      return;
    case 'resources':
      for (const r of srv.resources.list()) out(`${srv.resources.running.has(r) ? '●' : '○'} ${r}`);
      return;
    case 'players':
      for (const p of srv.world.players.values()) out(`#${p.id} ${p.name} (${p.ip}) ${p.uid ?? 'sans identité'}${srv.access.isAdmin(p.uid) ? ' admin' : ''}`);
      return out(`${srv.world.players.size}/${srv.config.maxPlayers}`);
    case 'kick': return srv.net.kick(player().id, reason);
    case 'ban': {
      const { name, ip } = player();
      srv.net.ban(Number(arg), reason);
      return out(`banni : ${name} (${ip})`);
    }
    case 'unban': {
      const ban = srv.bans.list().find((b) => b.ip === arg || b.uid === arg);
      if (!ban || !srv.bans.remove(ban.ip)) throw new Error(`non banni : ${arg ?? ''}`);
      return out(`débanni : ${arg}`);
    }
    case 'whitelist': {
      const uid = rest[0];
      if (arg === 'add') { srv.access.add(uid); return out(`accepté : ${uid}`); }
      if (arg === 'remove') { srv.access.remove(uid); return out(`retiré : ${uid}`); }
      out(`liste blanche ${srv.config.whitelist ? 'active' : 'inactive'}`);
      for (const e of srv.access.data.whitelist) out(`✓ ${e.uid} ${e.name}`);
      for (const e of srv.access.data.requests) out(`? ${e.uid} ${e.name} (demande)`);
      return;
    }
    case 'admin': {
      const p = player();
      if (!p.uid) throw new Error('joueur sans identité');
      const on = rest[0] !== 'off';
      srv.access.setAdmin(p.uid, p.name, on);
      srv.net.sendRoster();
      return out(`${p.name} ${on ? 'est admin' : 'n\'est plus admin'}`);
    }
    case 'access':
      if (arg !== 'reload') throw new Error('access reload');
      srv.access.reload();
      return srv.net.sendRoster();
    case 'bans':
      for (const b of srv.bans.list()) out(`${b.ip}${b.uid ? ` ${b.uid}` : ''} ${b.name} – ${b.reason} (${b.at})`);
      return;
    case 'say':
      return srv.net.broadcast({ t: 'event', name: 'chat', args: [`[Serveur] ${line.trim().slice(4).trim()}`] });
    case 'info': return out(JSON.stringify(srv.net.info(), null, 2));
    case 'quit': return void srv.shutdown();
    default: return out(HELP);
  }
}

export function startConsole(srv) {
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    try { runCommand(srv, line); } catch (e) { console.error(e.message); }
  });
  // Lancé par l'interface : ne pas lui survivre. Sans console (Docker), on continue.
  if (process.env.SIXM_PARENT) rl.on('close', () => srv.shutdown());
}
