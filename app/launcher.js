import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';

/** Chemin d'un .exe existant, sinon une erreur lisible. */
function requireExe(file, what) {
  if (typeof file !== 'string' || !path.isAbsolute(file) || !/\.exe$/i.test(file)) throw new Error(`${what} : choisissez un fichier .exe dans les réglages`);
  if (!fs.existsSync(file)) throw new Error(`${what} introuvable : ${file}`);
}

/**
 * Programme du jeu : le chemin donné si c'est un .exe, sinon celui du dossier extrait. Le manifeste
 * MicrosoftGame.config le nomme ; à défaut, l'unique .exe du dossier.
 */
export function resolveGame(target) {
  if (typeof target !== 'string' || !path.isAbsolute(target)) throw new Error('Le jeu : choisissez son dossier dans les réglages');
  let stat;
  try { stat = fs.statSync(target); } catch { throw new Error(`Le jeu est introuvable : ${target}`); }
  if (!stat.isDirectory()) {
    if (/\.exe$/i.test(target)) return target;
    throw new Error('Le jeu : VIctory lit un dossier extrait, pas une image de disque');
  }
  const files = fs.readdirSync(target, { withFileTypes: true }).filter((d) => d.isFile()).map((d) => d.name);
  const find = (name) => files.find((f) => f.toLowerCase() === name.toLowerCase());
  const manifest = find('MicrosoftGame.config');
  if (manifest) {
    const text = fs.readFileSync(path.join(target, manifest), 'utf8').slice(0, 1 << 20).replace(/<!--[\s\S]*?-->/g, '');
    const named = [...text.matchAll(/<Executable\b[^>]*?\bName\s*=\s*"([^"]+)"/g)].map((m) => m[1]);
    // Nom simple exigé : le manifeste ne doit pas pouvoir désigner un programme hors du dossier.
    const safe = named.filter((n) => path.win32.basename(n) === n && /\.exe$/i.test(n));
    for (const n of safe) { const f = find(n); if (f) return path.join(target, f); }
    if (safe.length) throw new Error(`Le dossier du jeu est incomplet : ${safe[0]} manque`);
  }
  const exes = files.filter((f) => /\.exe$/i.test(f));
  if (exes.length === 1) return path.join(target, exes[0]);
  throw new Error(exes.length ? 'Plusieurs programmes dans ce dossier : choisissez le .exe du jeu' : 'Aucun programme du jeu (.exe) dans ce dossier');
}

/** VIctory lit `victory.toml` dans son dossier courant : on remonte depuis l'exe pour le trouver. */
export function workingDir(victory) {
  for (let dir = path.dirname(victory), last = ''; dir !== last; last = dir, dir = path.dirname(dir))
    if (['victory.toml', '.victory-root'].some((f) => fs.existsSync(path.join(dir, f)))) return dir;
  return path.dirname(victory);
}

/** PID d'un VIctory déjà ouvert (nom du victory.exe configuré), ou 0. */
export function findVictory(victory) {
  const name = path.basename(victory || 'victory.exe');
  if (process.platform !== 'win32' || /["*?]/.test(name)) return Promise.resolve(0);
  return new Promise((resolve) => {
    execFile('tasklist.exe', ['/FI', `IMAGENAME eq ${name}`, '/FO', 'CSV', '/NH'], { windowsHide: true }, (e, out) => {
      resolve(e ? 0 : Number(/^"[^"]*","(\d+)"/m.exec(out)?.[1] ?? 0));
    });
  });
}

/** Chemins que le joueur a pu régler lui-même : gardés. Les autres VICTORY_… viennent du portage choisi. */
const KEPT = ['VICTORY_CONFIG', 'VICTORY_GAME_DIR', 'VICTORY_CACHE_DIR', 'VICTORY_DATA_DIR', 'VICTORY_FIDELITYFX_DIR', 'VICTORY_STREAMLINE_DIR'];
function portBase() {
  return Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^VICTORY_/i.test(k) || KEPT.includes(k.toUpperCase())));
}

/**
 * Lance VIctory sur une installation du jeu choisie par l'utilisateur. SixM ne fournit, ne télécharge
 * et ne modifie ni VIctory ni le jeu : il ne connaît que leurs chemins.
 */
export class Launcher {
  constructor(dir, { onExit = () => {}, profiles = path.join(dir, 'profiles') } = {}) {
    this.profiles = profiles;
    this.bridge = null; // { port, token } du module SixM dans VIctory
    this.logFile = path.join(dir, 'victory.log');
    this.onExit = onExit;
    this.status = 'stopped'; // stopped | running | failed
    this.game = null;
    this.child = null;
    this.error = null;
  }

  get pid() { return this.status === 'running' ? this.child.pid ?? 0 : 0; }

  /** Vérifie les chemins sans rien lancer ; retourne le programme du jeu. */
  check(victory, game) {
    requireExe(victory, 'VIctory');
    return resolveGame(game.path);
  }

  /** Port libre et jeton pour le module de la prochaine partie. */
  async prepare() {
    const port = await new Promise((resolve, reject) => {
      const s = net.createServer().once('error', reject).listen(0, '127.0.0.1', () => { const { port: p } = s.address(); s.close(() => resolve(p)); });
    });
    fs.mkdirSync(this.profiles, { recursive: true });
    if (this.status !== 'running') this.bridge = { port, token: crypto.randomBytes(24).toString('hex'), profiles: this.profiles };
  }

  /** extraEnv : réglages du portage (variables VICTORY_…) ; argsFor(exe, console) : sa ligne de commande. */
  launch(victory, game, extraEnv = {}, argsFor = (exe, console) => ['run', exe, '--execute', '--console', console]) {
    if (this.status === 'running') throw new Error('VIctory est déjà lancé');
    const exe = this.check(victory, game);
    fs.mkdirSync(path.dirname(this.logFile), { recursive: true });
    const log = fs.openSync(this.logFile, 'w');
    let child;
    try {
      // detached : pas de console, et la partie survit à la fermeture de SixM.
      // Journal dans un fichier, pas un tube : VIctory ne dépend plus de SixM une fois lancé.
      child = spawn(victory, argsFor(exe, game.console), {
        cwd: workingDir(victory), detached: true, stdio: ['ignore', log, log],
        // Lu par le module SixM s'il est compilé dans VIctory ; sans effet sinon.
        env: { ...portBase(), ...extraEnv, ...(this.bridge && { SIXM_BRIDGE_PORT: String(this.bridge.port), SIXM_BRIDGE_TOKEN: this.bridge.token, SIXM_PROFILES: this.profiles }) },
      });
    } catch (e) {
      throw new Error(`VIctory ne démarre pas : ${e.message}`);
    } finally {
      fs.closeSync(log);
    }
    Object.assign(this, { child, game, status: 'running', error: null });
    const end = (status, error) => {
      if (this.child !== child) return;
      Object.assign(this, { status, error, child: null });
      this.onExit(error);
    };
    child.on('error', (e) => end('failed', `VIctory ne démarre pas : ${e.message}`));
    child.on('exit', (code) => (code === 0 || child.killed ? end('stopped', null) : end('failed', `VIctory s'est arrêté (code ${code})`)));
    child.unref();
  }

  stop() { this.child?.kill(); }

  state() {
    return { status: this.status, gameId: this.game?.id ?? null, name: this.game?.name ?? null, error: this.error, log: this.#tail() };
  }

  /** Dernières lignes du journal, sans séquences de couleur. */
  #tail() {
    if (!this.game) return [];
    let fd;
    try {
      fd = fs.openSync(this.logFile, 'r');
      const { size } = fs.fstatSync(fd);
      const buf = Buffer.alloc(Math.min(size, 8192));
      fs.readSync(fd, buf, 0, buf.length, size - buf.length);
      return buf.toString('utf8').replace(/\u001b\[[0-9;]*m/g, '').split(/\r?\n/).filter(Boolean).slice(-40);
    } catch {
      return [];
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
  }
}
