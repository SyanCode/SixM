import dgram from 'node:dgram';

export const LAN_PORT = 30199;
const LAN_MS = 5000;
const DIRECTORY_MS = 60000;

/**
 * Serveur public : se signale sur le réseau local (diffusion UDP, reçue par les SixM voisins) et
 * s'inscrit auprès des annuaires de `directories`, qui vérifient sa fiche avant de le lister.
 * Un serveur privé ne fait ni l'un ni l'autre : on le rejoint seulement par son adresse.
 */
export function startAnnounce({ config, port }) {
  if (config.visibility !== 'public') return { stop() {} };
  const timers = [];
  let sock = null;
  try {
    sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    sock.on('error', () => {});
    sock.bind(() => {
      try { sock.setBroadcast(true); } catch { /* pas de diffusion possible */ }
      const shout = () => {
        const msg = Buffer.from(JSON.stringify({ sixm: 1, port, name: config.name }));
        sock.send(msg, LAN_PORT, '255.255.255.255', () => {});
      };
      shout();
      timers.push(setInterval(shout, LAN_MS));
    });
  } catch { /* pas de réseau local */ }

  const register = () => {
    for (const base of config.directories) {
      fetch(new URL('/announce', base), {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ port }), signal: AbortSignal.timeout(5000),
      }).then((r) => { if (!r.ok) console.error(`[annuaire] ${base} : refus ${r.status}`); })
        .catch((e) => console.error(`[annuaire] ${base} : ${e.message}`));
    }
  };
  if (config.directories.length) {
    register();
    timers.push(setInterval(register, DIRECTORY_MS));
  }
  for (const t of timers) t.unref?.();
  return {
    stop() {
      for (const t of timers) clearInterval(t);
      try { sock?.close(); } catch { /* déjà fermée */ }
    },
  };
}
