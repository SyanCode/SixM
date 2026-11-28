/** hôte[:port], [ipv6]:port ou ws(s)://… -> URL WebSocket. */
export function serverUrl(address, defaultPort = 30120) {
  const text = String(address).trim();
  if (/^wss?:\/\//i.test(text)) return text;
  let url;
  try { url = new URL(`ws://${text}`); } catch { throw new Error('adresse invalide'); }
  if (!url.hostname || url.username || url.pathname !== '/' || url.search || url.hash) throw new Error('adresse invalide');
  // `URL` efface le port 80, qui est le port par défaut de ws://.
  if (!url.port) return `ws://${url.hostname}:${/:80$/.test(text) ? 80 : defaultPort}/`;
  return url.href;
}

/**
 * Adresses WebSocket à essayer. Un nom de domaine sans port peut être un serveur maison (port 30120)
 * ou un serveur derrière un reverse proxy en HTTPS (Mas, nginx : wss://nom/) : les deux.
 */
export function serverUrls(address, defaultPort = 30120) {
  const url = serverUrl(address, defaultPort);
  const text = String(address).trim();
  if (/^wss?:\/\//i.test(text) || /:\d+$/.test(text)) return [url];
  const host = new URL(url).hostname;
  const ip = /^[\d.]+$/.test(host) || host.startsWith('[');
  const local = !host.includes('.') || /\.(local|lan|home|internal|localdomain|home\.arpa)$/i.test(host);
  return ip || local ? [url] : [url, `wss://${host}/`];
}

const resolved = new Map(); // adresse -> { url, at }

/** L'adresse WebSocket qui répond parmi `serverUrls` (gardée 10 min), sinon la première. */
export async function resolveServer(address, { timeoutMs = 4000 } = {}) {
  const urls = serverUrls(address);
  if (urls.length === 1) return urls[0];
  const hit = resolved.get(address);
  if (hit && Date.now() - hit.at < 600000) return hit.url;
  const probe = async (u) => {
    const res = await fetch(new URL('/info.json', u.replace(/^ws/i, 'http')), { signal: AbortSignal.timeout(timeoutMs), redirect: 'error' });
    await res.body?.cancel();
    if (!res.ok) throw new Error(String(res.status));
    return u;
  };
  try {
    const url = await Promise.any(urls.map(probe));
    resolved.set(address, { url, at: Date.now() });
    return url;
  } catch {
    return urls[0];
  }
}

/** Fiche publique d'un serveur, validée : { name, description, players, maxPlayers, password, resources, ping }. */
export async function queryServer(address, { timeoutMs = 3000 } = {}) {
  const urls = serverUrls(address);
  if (urls.length > 1) {
    // La première adresse qui répond ; son temps de réponse est mesuré à part.
    const url = await resolveServer(address, { timeoutMs });
    return queryOne(url, timeoutMs);
  }
  return queryOne(urls[0], timeoutMs);
}

async function queryOne(wsUrl, timeoutMs) {
  const url = new URL('/info.json', wsUrl.replace(/^ws/i, 'http'));
  const start = performance.now();
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'error' });
  const ping = Math.round(performance.now() - start);
  if (!res.ok) throw new Error(`réponse ${res.status} de ${url.host}`);
  let text = '';
  for await (const chunk of res.body.pipeThrough(new TextDecoderStream())) {
    text += chunk;
    if (text.length > 65536) throw new Error('réponse trop longue');
  }
  const m = JSON.parse(text);
  const str = (v, max) => (typeof v === 'string' ? v : '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').slice(0, max);
  const num = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);
  if (!m || typeof m !== 'object') throw new Error('réponse invalide');
  return {
    name: str(m.name, 64) || 'Serveur SixM', description: str(m.description, 256),
    players: num(m.players), maxPlayers: num(m.maxPlayers), password: m.password === true,
    resources: Array.isArray(m.resources) ? m.resources.slice(0, 64).map((r) => str(r, 32)) : [], ping,
    tags: Array.isArray(m.tags) ? m.tags.slice(0, 8).map((t) => str(t, 24)).filter(Boolean) : [],
    visibility: m.visibility === 'private' ? 'private' : 'public', whitelist: m.whitelist === true,
  };
}
