import { SixMClient } from '../client/client.js';
import { createAdapter } from '../client/adapters/index.js';
import { serverUrl } from '../client/address.js';

const MAX_LOG = 200;

/** La partie en cours : une seule connexion à la fois, pilotée par l'interface. */
export class Session {
  constructor({ adapterOptions = {} } = {}) {
    this.adapterOptions = adapterOptions;
    this.attempt = 0;
    this.#reset('idle');
  }

  #reset(status) {
    this.status = status; // idle | connecting | connected
    this.client = null;
    this.log = [];
    this.error = null;
    this.address = null;
    this.adapterName = null;
    this.adapter = null;
  }

  connect({ address, name, password, adapter: adapterName }) {
    if (this.status !== 'idle') throw new Error('déjà connecté à un serveur');
    const url = serverUrl(address);
    const adapter = createAdapter(adapterName, this.adapterOptions);
    this.#reset('connecting');
    this.attempt++;
    Object.assign(this, { address, adapterName, adapter });
    adapter.log = this.#recorder();
    const client = this.client = new SixMClient({
      url, name, password, adapter,
      onDisconnect: (reason) => {
        if (this.client !== client) return;
        adapter.shutdown();
        this.#end(reason ?? 'connexion perdue');
      },
    });
    // Pas d'attente ici : l'interface suit l'état (le bridge VIctory peut mettre du temps à répondre).
    return client.connect().then(async () => {
      if (this.client !== client) { await client.disconnect(); return false; } // annulé entre-temps
      this.status = 'connected';
      return true;
    }, (e) => {
      if (this.client === client) this.#end(this.#explain(e));
      return false;
    });
  }

  async disconnect(error = null) {
    const { client } = this;
    if (error) this.#end(error); else this.#reset('idle');
    await client?.disconnect();
  }

  chat(text) {
    if (this.status !== 'connected') throw new Error('pas connecté');
    const clean = String(text).trim().slice(0, 200);
    if (clean) this.client.emitServer('chat', clean);
  }

  state() {
    const { client } = this;
    const connected = this.status === 'connected';
    return {
      status: this.status, attempt: this.attempt, address: this.address, adapter: this.adapterName, error: this.error, log: this.log,
      serverName: connected ? client.serverName : null,
      id: connected ? client.id : null,
      local: connected ? client.adapter.getLocalPlayerPosition() : null,
      players: connected ? client.players : [],
      roster: connected ? client.roster : [],
    };
  }

  /** Attache la surcouche à la fenêtre d'un processus. */
  setTarget(pid) { this.adapter?.setTarget?.(pid); }

  #end(error) {
    const { address } = this;
    this.#reset('idle');
    // L'adresse reste connue pour proposer un nouvel essai.
    Object.assign(this, { error, address });
  }

  #recorder() {
    const { log } = this;
    let seq = 0;
    return (text) => {
      log.push({ seq: seq++, text });
      if (log.length > MAX_LOG) log.shift();
    };
  }

  #explain(e) {
    if (this.adapterName === 'victory' && e.port === (this.adapterOptions.port ?? 30121))
      return 'le lien avec VIctory ne répond pas';
    if (e.code === 'ECONNREFUSED' || e.errors?.some((x) => x.code === 'ECONNREFUSED')) return 'aucun serveur à cette adresse';
    if (e.code === 'ENOTFOUND') return 'adresse introuvable';
    if (e.code === 'ETIMEDOUT') return 'le serveur ne répond pas';
    return e.message || e.code || 'connexion impossible';
  }
}
