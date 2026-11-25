import dgram from 'node:dgram';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { loadConfig, normalizeConfig } from '../server/config.js';
import { CLI, scaffoldServer } from '../server/scaffold.js';
import { importMod, listMods } from './mods.js';
import { packServer } from './pack.js';

const MAX_LOG = 300;
const EDITABLE = ['name', 'description', 'port', 'maxPlayers', 'password', 'syncRadius'];

/** Adresse IPv4 utilisée pour sortir sur le réseau (ignore les cartes virtuelles), ou null. */
export const lanAddress = () => new Promise((resolve) => {
  const s = dgram.createSocket('udp4');
  const done = (ip) => { s.close(); resolve(ip); };
  s.once('error', () => done(null));
  // Un "connect" UDP n'envoie rien : il demande seulement au système quelle carte il choisirait.
  s.connect(9, '192.0.2.1', () => done(s.address().address));
});

/** Serveurs hébergés depuis l'application, un dossier chacun. */
export class Hosts {
  constructor(dir) {
    this.dir = dir;
    this.running = new Map(); // id -> { process, status, log, players }
  }

  ids() {
    if (!fs.existsSync(this.dir)) return [];
    return fs.readdirSync(this.dir).filter((id) => fs.existsSync(path.join(this.dir, id, 'server.json')));
  }

  list() {
    return this.ids().map((id) => {
      const run = this.running.get(id);
      const base = { id, dir: this.path(id), status: run?.status ?? 'stopped', log: run?.log ?? [], stale: run?.stale ?? false };
      try {
        const c = this.#read(id);
        const { password, name, description, port, maxPlayers, syncRadius, autostart } = normalizeConfig(c);
        const all = autostart.includes('*');
        return {
          ...base, name, description, port, maxPlayers, syncRadius, hasPassword: password !== '',
          mods: listMods(this.#resources(id)).map((m) => ({ ...m, enabled: all || autostart.includes(m.name) })),
        };
      } catch (e) {
        return { ...base, name: id, broken: e.message, mods: [] };
      }
    });
  }

  path(id) {
    if (!this.ids().includes(id)) throw new Error('serveur inconnu');
    return path.join(this.dir, id);
  }

  create(input) {
    const patch = this.#pick(input);
    if (!patch.name?.trim()) throw new Error('donnez un nom au serveur');
    normalizeConfig(patch);
    const slug = patch.name.normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 32) || 'serveur';
    let id = `sixm-${slug}`;
    for (let n = 2; fs.existsSync(path.join(this.dir, id)); n++) id = `sixm-${slug}-${n}`;
    scaffoldServer(path.join(this.dir, id), patch);
    return id;
  }

  update(id, input) {
    const raw = { ...this.#read(id), ...this.#pick(input) };
    normalizeConfig(raw);
    this.#write(id, raw);
    const run = this.running.get(id);
    if (run) run.stale = true; // réglages appliqués au prochain démarrage
  }

  start(id) {
    const dir = this.path(id);
    if (['starting', 'running'].includes(this.running.get(id)?.status)) throw new Error('déjà démarré');
    loadConfig(dir);
    // SIXM_PARENT : le serveur s'arrête tout seul si l'application disparaît.
    const env = { ...process.env, SIXM_PARENT: '1' };
    delete env.SIXM_PORT;
    delete env.SIXM_PASSWORD;
    const child = spawn(process.execPath, [CLI, 'start', dir], { env, windowsHide: true });
    const run = { process: child, status: 'starting', log: [], stale: false };
    this.running.set(id, run);
    const add = (chunk) => {
      for (const line of chunk.split(/\r?\n/)) if (line) run.log.push(line.slice(0, 500));
      run.log.splice(0, run.log.length - MAX_LOG);
      if (run.status === 'starting' && chunk.includes('en écoute sur')) run.status = 'running';
    };
    for (const s of [child.stdout, child.stderr]) s.setEncoding('utf8').on('data', add);
    child.stdin.on('error', () => {});
    run.exited = new Promise((res) => {
      child.on('error', (e) => { add(e.message); run.status = 'failed'; res(); });
      child.on('exit', (code) => { run.status = run.status === 'stopping' || code === 0 ? 'stopped' : 'failed'; res(); });
    });
  }

  async stop(id) {
    const run = this.running.get(id);
    if (!run || ['stopped', 'failed'].includes(run.status)) return;
    run.status = 'stopping';
    run.process.stdin.write('quit\n');
    const timer = setTimeout(() => run.process.kill(), 4000);
    await run.exited;
    clearTimeout(timer);
  }

  async stopAll() { await Promise.all([...this.running.keys()].map((id) => this.stop(id))); }

  command(id, line) {
    const run = this.running.get(id);
    if (run?.status !== 'running') throw new Error('le serveur n\'est pas démarré');
    const text = String(line).replace(/[\r\n]/g, ' ').slice(0, 300);
    run.log.push(`> ${text}`);
    run.process.stdin.write(`${text}\n`);
  }

  /** Active ou désactive un mod, tout de suite si le serveur tourne. */
  setMod(id, name, enabled) {
    const mods = listMods(this.#resources(id));
    if (!mods.some((m) => m.name === name)) throw new Error('mod inconnu');
    const raw = this.#read(id);
    const current = normalizeConfig(raw).autostart;
    const on = new Set(current.includes('*') ? mods.map((m) => m.name) : current);
    if (enabled) on.add(name); else on.delete(name);
    this.#write(id, { ...raw, autostart: [...on] });
    if (this.running.get(id)?.status === 'running') this.command(id, `${enabled ? 'start' : 'stop'} ${name}`);
  }

  /** De quoi rejoindre son propre serveur sans retaper le mot de passe. */
  joinInfo(id) {
    const { port, password } = loadConfig(this.path(id));
    return { address: `localhost:${port}`, password };
  }

  importMod(id, buffer, fileName) { return importMod(this.#resources(id), buffer, fileName); }

  pack(id) {
    return id ? packServer({ config: this.#read(id), resourcesDir: this.#resources(id) }) : packServer();
  }

  #resources(id) { return loadConfig(this.path(id)).resourcesDir; }
  #read(id) { return JSON.parse(fs.readFileSync(path.join(this.path(id), 'server.json'), 'utf8').replace(/^﻿/, '')); }
  #write(id, raw) {
    fs.writeFileSync(path.join(this.path(id), 'server.json'), JSON.stringify(raw, null, 2) + '\n');
  }
  #pick(input) {
    const out = {};
    for (const k of EDITABLE) if (input?.[k] !== undefined) out[k] = input[k];
    return out;
  }
}
