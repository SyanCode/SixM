import crypto from 'node:crypto';
import http from 'node:http';
import { WebSocketServer } from 'ws';

const PING_MS = 15000;
const MAX_BUFFERED = 1 << 20;
const MAX_PASSWORD_FAILURES = 5; // par IP et par minute
const FAILURE_WINDOW_MS = 60000;

const sha256 = (s) => crypto.createHash('sha256').update(s).digest();

/**
 * Protocole JSON sur WebSocket (voir docs/PROTOCOL.md).
 * client -> serveur : hello | pos | event
 * serveur -> client : welcome | roster | snapshot | event | kick
 * Le même port sert /info.json et /players.json en HTTP.
 */
export class Network {
  constructor({ port, world, events, config, resources, bans }) {
    Object.assign(this, { port, world, events, config, resources, bans });
    this.rate = new WeakMap();
    this.connections = new Map(); // ip -> nombre de connexions
    this.failures = new Map(); // ip -> { start, n }
  }

  start() {
    this.http = http.createServer((req, res) => this.#onRequest(req, res));
    this.wss = new WebSocketServer({ server: this.http, maxPayload: 64 * 1024 });
    this.wss.on('connection', (ws, req) => this.#onConnection(ws, this.#ipOf(req)));
    return new Promise((res, rej) => {
      // `ws` relaie les erreurs du serveur HTTP (port occupé, etc.).
      this.wss.once('error', rej);
      this.http.listen(this.port, this.config.host ?? undefined, () => {
        this.port = this.http.address().port;
        this.timer = setInterval(() => this.#tick(), 1000 / this.config.tickRate);
        this.pingTimer = setInterval(() => this.#ping(), PING_MS);
        res(this.port);
      });
    });
  }

  async stop() {
    clearInterval(this.timer);
    clearInterval(this.pingTimer);
    this.broadcast({ t: 'kick', reason: 'serveur arrêté' });
    for (const c of this.wss.clients) c.close(1001);
    const force = setTimeout(() => { for (const c of this.wss.clients) c.terminate(); }, 500);
    const closed = new Promise((res) => this.wss.close(res));
    this.http.close();
    this.http.closeIdleConnections();
    await closed;
    clearTimeout(force);
    this.http.closeAllConnections();
  }

  send(ws, msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }
  broadcast(msg) { for (const p of this.world.players.values()) this.send(p.socket, msg); }
  sendToPlayer(id, msg) { const p = this.world.players.get(id); if (p) this.send(p.socket, msg); }
  kick(id, reason = 'expulsé') {
    const p = this.world.players.get(id);
    if (p) this.#reject(p.socket, String(reason));
  }
  ban(id, reason = 'sans raison') {
    const p = this.world.players.get(id);
    if (!p) return;
    this.bans.add(p.ip, p.name, String(reason));
    for (const other of [...this.world.players.values()])
      if (other.ip === p.ip) this.kick(other.id, `banni : ${reason}`);
  }

  /** Fiche publique du serveur : ni mot de passe, ni IP. */
  info() {
    const { name, description, maxPlayers, password, tickRate, syncRadius } = this.config;
    return {
      name, description, maxPlayers, tickRate, syncRadius,
      players: this.world.players.size, password: password !== '',
      resources: [...this.resources.running.keys()],
    };
  }

  #onRequest(req, res) {
    let body = null;
    if (req.method === 'GET' && req.url === '/info.json') body = this.info();
    else if (req.method === 'GET' && req.url === '/players.json')
      body = [...this.world.players.values()].map(({ id, name }) => ({ id, name }));
    res.writeHead(body ? 200 : 404, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify(body ?? { error: 'introuvable' }));
  }

  #ipOf(req) {
    // Dernière entrée : celle ajoutée par notre proxy, les précédentes viennent du client.
    const forwarded = this.config.trustProxy && req.headers['x-forwarded-for']?.split(',').at(-1).trim();
    return (forwarded || req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  }

  #reject(ws, reason) {
    this.send(ws, { t: 'kick', reason });
    ws.close();
  }

  /** Raison du refus, ou null si le joueur peut entrer. */
  #refusal(m, ip) {
    const ban = this.bans.get(ip);
    if (ban) return `banni : ${ban.reason}`;
    if (this.config.password) {
      let f = this.failures.get(ip);
      if (f && Date.now() - f.start >= FAILURE_WINDOW_MS) f = undefined;
      if (f && f.n >= MAX_PASSWORD_FAILURES) return 'trop de tentatives, réessayez dans une minute';
      if (!crypto.timingSafeEqual(sha256(String(m.password ?? '')), sha256(this.config.password))) {
        this.failures.set(ip, { start: f?.start ?? Date.now(), n: (f?.n ?? 0) + 1 });
        return 'mot de passe incorrect';
      }
      this.failures.delete(ip);
    }
    if (this.world.players.size >= this.config.maxPlayers) return 'serveur plein';
    return null;
  }

  #onConnection(ws, ip) {
    let player = null;
    ws.on('error', () => {});
    const count = (this.connections.get(ip) ?? 0) + 1;
    this.connections.set(ip, count);
    const helloTimeout = setTimeout(() => ws.close(), 5000);
    ws.alive = true;
    ws.on('pong', () => { ws.alive = true; });

    ws.on('close', () => {
      clearTimeout(helloTimeout);
      const n = this.connections.get(ip) - 1;
      if (n > 0) this.connections.set(ip, n); else this.connections.delete(ip);
      if (!player) return;
      this.world.removePlayer(player.id);
      this.#sendRoster();
      this.events.emit('playerDropped', player);
    });

    if (count > this.config.maxConnectionsPerIp) return this.#reject(ws, 'trop de connexions depuis cette adresse');

    ws.on('message', (raw) => {
      if (ws.readyState !== 1) return; // refusé ou expulsé : on n'écoute plus
      if (!this.#allow(ws)) return ws.close();
      let m;
      try { m = JSON.parse(raw); } catch { return ws.close(); }
      if (!m || typeof m !== 'object') return ws.close();

      if (!player) {
        if (m.t !== 'hello' || typeof m.name !== 'string') return ws.close();
        const refusal = this.#refusal(m, ip);
        if (refusal) return this.#reject(ws, refusal);
        clearTimeout(helloTimeout);
        const name = m.name.replace(/[^\p{L}\p{N}_ -]/gu, '').slice(0, 24) || 'Joueur';
        player = this.world.addPlayer(name, ws, ip);
        this.send(ws, {
          t: 'welcome', id: player.id, server: this.config.name,
          tickRate: this.config.tickRate, resources: this.resources.clientBundle(),
        });
        this.#sendRoster();
        this.events.emit('playerConnected', player);
        return;
      }

      if (m.t === 'pos') {
        const { x, y, z, h } = m;
        if ([x, y, z, h].every(Number.isFinite)) this.world.setPosition(player, { x, y, z, h });
      } else if (m.t === 'event' && typeof m.name === 'string') {
        // Les évènements réseau sont préfixés pour ne pas écraser les évènements internes.
        this.events.emit(`net:${m.name}`, player, ...(Array.isArray(m.args) ? m.args : []));
      }
    });
  }

  /** Tous les joueurs, même sans position connue ou hors du rayon de synchro. */
  #sendRoster() {
    this.broadcast({ t: 'roster', players: [...this.world.players.values()].map(({ id, name }) => ({ id, name })) });
  }

  // Limite simple : 200 messages / seconde / connexion
  #allow(ws) {
    const now = Date.now();
    const r = this.rate.get(ws) ?? { start: now, n: 0 };
    if (now - r.start > 1000) { r.start = now; r.n = 0; }
    this.rate.set(ws, r);
    return ++r.n <= 200;
  }

  /** Coupe les connexions mortes (câble débranché, veille) que TCP ne signale pas. */
  #ping() {
    for (const ws of this.wss.clients) {
      if (!ws.alive) { ws.terminate(); continue; }
      ws.alive = false;
      ws.ping();
    }
    const now = Date.now();
    for (const [ip, f] of this.failures) if (now - f.start >= FAILURE_WINDOW_MS) this.failures.delete(ip);
  }

  #tick() {
    if (!this.world.players.size) return;
    const { syncRadius } = this.config;
    const shared = syncRadius > 0 ? null : JSON.stringify({ t: 'snapshot', players: this.world.snapshotFor(null) });
    for (const p of this.world.players.values()) {
      // Client trop lent : on saute des snapshots plutôt que d'accumuler.
      if (p.socket.readyState !== 1 || p.socket.bufferedAmount > MAX_BUFFERED) continue;
      p.socket.send(shared ?? JSON.stringify({ t: 'snapshot', players: this.world.snapshotFor(p, syncRadius) }));
    }
  }
}
