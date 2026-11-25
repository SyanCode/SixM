import readline from 'node:readline';

const HELP = `commandes :
  players                  joueurs connectés
  kick <id> [raison]       expulser
  ban <id> [raison]        bannir l'IP du joueur
  bans | unban <ip>        lister / lever les bannissements
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
      for (const p of srv.world.players.values()) out(`#${p.id} ${p.name} (${p.ip})`);
      return out(`${srv.world.players.size}/${srv.config.maxPlayers}`);
    case 'kick': return srv.net.kick(player().id, reason);
    case 'ban': {
      const { name, ip } = player();
      srv.net.ban(Number(arg), reason);
      return out(`banni : ${name} (${ip})`);
    }
    case 'unban':
      if (!srv.bans.remove(arg)) throw new Error(`IP non bannie : ${arg ?? ''}`);
      return out(`débanni : ${arg}`);
    case 'bans':
      for (const b of srv.bans.list()) out(`${b.ip} ${b.name} – ${b.reason} (${b.at})`);
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
