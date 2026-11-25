import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = 'SyanCode/SixM';
const ASSETS = `https://github.com/${REPO}/releases/download/`;
const MAX_SETUP = 300 << 20;
/** Code de sortie qui demande à SixM.bat de relancer. */
export const RESTART_CODE = 75;

/** 1 si a est plus récente que b, -1 si plus ancienne, 0 sinon. Versions x.y.z uniquement. */
export function compareVersions(a, b) {
  const parse = (v) => /^v?(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/.exec(v)?.slice(1).map(Number);
  const x = parse(a), y = parse(b);
  if (!x || !y) return 0; // illisible : jamais une mise à jour
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  return 0;
}

const run = (cmd, args, cwd) => new Promise((resolve, reject) => {
  execFile(cmd, args, { cwd, windowsHide: true, timeout: 300000, maxBuffer: 4 << 20, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
    (e, out, err) => (e ? reject(new Error(`${path.basename(cmd)} : ${(err || e.message).trim().split('\n')[0]}`)) : resolve(out.trim())));
});

/**
 * Met SixM à jour depuis GitHub.
 *  - installé : dernier installateur publié, empreinte vérifiée, lancé sans question ;
 *  - code source (git) : avance rapide de main, seulement si rien n'a été modifié ici ;
 *  - portable : signale seulement.
 */
export class Updater {
  constructor(dir, { root = ROOT, fetch: get = globalThis.fetch, exec = run, start = null, git = 'git', canApply = () => true, onRestart = () => {} } = {}) {
    Object.assign(this, { dir, root, get, exec, git, canApply, onRestart });
    this.start = start ?? ((file, args) => new Promise((resolve, reject) => {
      const p = spawn(file, args, { detached: true, stdio: 'ignore', cwd: path.dirname(file) });
      p.once('error', reject);
      p.once('spawn', () => { p.unref(); resolve(); });
    }));
    this.version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
    this.status = 'idle'; // idle | checking | current | available | downloading | restarting | failed
    this.latest = null;
    this.error = null;
  }

  get mode() {
    const top = path.join(this.root, '..');
    if (fs.existsSync(path.join(top, 'sixm-install.txt')) && fs.existsSync(path.join(top, 'SixM.exe'))) return 'installed';
    if (fs.existsSync(path.join(top, 'node', 'node.exe')) && fs.existsSync(path.join(top, 'SixM.exe'))) return 'portable';
    return fs.existsSync(path.join(this.root, '.git')) ? 'source' : 'other';
  }

  state() {
    const { version, status, latest, error, mode } = this;
    return { version, status, latest, error, mode };
  }

  get busy() { return ['checking', 'downloading', 'restarting'].includes(this.status); }

  /** Cherche une version plus récente. Ne change rien aux fichiers de SixM. */
  async check() {
    if (this.busy) return false;
    Object.assign(this, { status: 'checking', error: null });
    try {
      const found = this.mode === 'source' ? await this.#checkSource() : await this.#checkRelease();
      this.status = found ? 'available' : 'current';
      return found;
    } catch (e) {
      Object.assign(this, { status: 'failed', error: e.message });
      return false;
    }
  }

  /** Applique la mise à jour trouvée, si rien ne tourne. Retourne true si SixM va redémarrer. */
  async apply() {
    if (this.status !== 'available' || !['installed', 'source'].includes(this.mode)) return false;
    if (!this.canApply()) return false; // partie, serveur ou compilation en cours : plus tard
    this.status = 'downloading';
    try {
      if (this.mode === 'source') await this.#applySource(); else await this.#applyRelease();
      this.status = 'restarting';
      this.onRestart();
      return true;
    } catch (e) {
      Object.assign(this, { status: 'failed', error: e.message });
      return false;
    }
  }

  // --- version publiée -----------------------------------------------------------------------

  async #json(url) {
    const res = await this.get(url, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'sixm' }, signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`GitHub répond ${res.status}`);
    return res.json();
  }

  async #checkRelease() {
    const r = await this.#json(`https://api.github.com/repos/${REPO}/releases/latest`);
    if (r.draft || r.prerelease || compareVersions(String(r.tag_name), this.version) <= 0) return false;
    const version = String(r.tag_name).replace(/^v/, ''), name = `SixM-Setup-${version}.exe`;
    const asset = (Array.isArray(r.assets) ? r.assets : []).find((a) => a?.name === name);
    const digest = /^sha256:([0-9a-f]{64})$/.exec(asset?.digest ?? '')?.[1];
    if (!asset || asset.browser_download_url !== `${ASSETS}v${version}/${name}` || !digest) throw new Error('version publiée incomplète');
    this.release = { version, name, url: asset.browser_download_url, digest };
    this.latest = version;
    return true;
  }

  async #applyRelease() {
    const { name, url, digest } = this.release;
    const res = await this.get(url, { signal: AbortSignal.timeout(600000) });
    if (!res.ok) throw new Error(`téléchargement impossible (${res.status})`);
    const hash = crypto.createHash('sha256'), chunks = [];
    let size = 0;
    for await (const c of res.body) {
      size += c.length;
      if (size > MAX_SETUP) throw new Error('installateur trop volumineux');
      hash.update(c);
      chunks.push(c);
    }
    // Jamais écrit sur le disque avant d'être vérifié.
    if (hash.digest('hex') !== digest) throw new Error('empreinte de l\'installateur incorrecte');
    if (!this.canApply()) throw new Error('reportée : une partie ou un serveur a démarré');
    const dir = path.join(this.dir, 'updates');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, name);
    fs.writeFileSync(file, Buffer.concat(chunks));
    const target = path.resolve(this.root, '..');
    const standard = path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'SixM');
    await this.start(file, ['--silent', '--no-shortcuts', ...(target.toLowerCase() === standard.toLowerCase() ? [] : ['--dir', target])]);
  }

  // --- code source ---------------------------------------------------------------------------

  #run(...args) { return this.exec(this.git, args, this.root); }

  async #checkSource() {
    const remote = await this.#run('remote', 'get-url', 'origin');
    if (!new RegExp(`^(https://github\\.com/|git@github\\.com:)${REPO}(\\.git)?$`, 'i').test(remote)) throw new Error('ce dossier ne suit pas le dépôt de SixM');
    if (await this.#run('rev-parse', '--abbrev-ref', 'HEAD') !== 'main') return false; // travail sur une branche
    await this.#run('fetch', '--quiet', '--no-tags', 'origin', 'main');
    const [ahead, behind] = (await this.#run('rev-list', '--left-right', '--count', 'HEAD...origin/main')).split(/\s+/).map(Number);
    this.latest = await this.#run('rev-parse', '--short=10', 'origin/main');
    return behind > 0 && ahead === 0;
  }

  async #applySource() {
    if (await this.#run('status', '--porcelain')) throw new Error('des fichiers de SixM sont modifiés ici : mise à jour laissée à vous');
    const lock = () => { try { return fs.readFileSync(path.join(this.root, 'package-lock.json'), 'utf8'); } catch { return ''; } };
    const before = lock();
    await this.#run('merge', '--ff-only', '--quiet', 'origin/main');
    if (lock() === before) return;
    const npm = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
    if (!fs.existsSync(npm)) throw new Error('lancez npm install pour finir la mise à jour');
    await this.exec(process.execPath, [npm, 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], this.root);
  }
}
