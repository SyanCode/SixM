import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const REPO = 'https://github.com/Marvisak/VIctory.git';
/** Commit installé par défaut : compilé et vérifié avec cette version de SixM. */
export const PINNED = '13f91caee25f2fdf2c062be5f7a27f058e51cbca';
const MODULE = fileURLToPath(new URL('../integrations/victory/sixm-bridge', import.meta.url));
const NEEDED_GB = 5; // mesuré : 0,4 Go de compilation, plus la version de Rust épinglée par VIctory
const MAX_LOG = 400;
const SHA = /^[0-9a-f]{40}$/;

const PACKAGES = {
  git: { id: 'Git.Git', url: 'https://git-scm.com/download/win' },
  rust: { id: 'Rustlang.Rustup', url: 'https://rustup.rs' },
  msvc: {
    id: 'Microsoft.VisualStudio.2022.BuildTools', url: 'https://visualstudio.microsoft.com/visual-cpp-build-tools/',
    extra: ['--override', '--wait --passive --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended'],
  },
};

/** Fichiers du module SixM et leur empreinte. */
export function moduleSource(dir = MODULE) {
  const files = ['Cargo.toml', ...fs.readdirSync(path.join(dir, 'src')).filter((f) => f.endsWith('.rs')).sort().map((f) => `src/${f}`)]
    .map((name) => ({ name, data: fs.readFileSync(path.join(dir, name)) }));
  const hash = crypto.createHash('sha256');
  // Fins de ligne normalisées : même empreinte quel que soit le checkout git.
  for (const f of files) hash.update(`${f.name}\n`).update(f.data.toString('utf8').replaceAll('\r\n', '\n'));
  return { files, id: hash.digest('hex').slice(0, 12) };
}

/** Un .exe Windows existant (en-tête MZ). */
export function isExe(file) {
  if (typeof file !== 'string' || !path.isAbsolute(file) || !/\.exe$/i.test(file)) return false;
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(2);
    return fs.readSync(fd, head, 0, 2, 0) === 2 && head.toString('latin1') === 'MZ';
  } catch {
    return false;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/** Paquets d'un Cargo.lock : « nom version empreinte ». */
export function lockPackages(text) {
  return new Set(text.replaceAll('\r\n', '\n').split('[[package]]').slice(1).map((p) => {
    const get = (k) => new RegExp(`^${k} = "([^"]*)"`, 'm').exec(p)?.[1] ?? '';
    return `${get('name')} ${get('version')} ${get('checksum')}`;
  }));
}

/** Cherche un programme dans des dossiers absolus (jamais le dossier courant). */
function which(name, extra = []) {
  const dirs = [...extra, ...(process.env.PATH ?? '').split(path.delimiter)].filter((d) => d && path.isAbsolute(d));
  return dirs.map((d) => path.join(d, name)).find((f) => fs.existsSync(f)) ?? null;
}

function defaultTools() {
  const { ProgramFiles = 'C:\\Program Files', LOCALAPPDATA = '' } = process.env;
  const x86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
  const cargoBin = path.join(process.env.CARGO_HOME || path.join(os.homedir(), '.cargo'), 'bin');
  const tool = (file) => (file ? [file] : null);
  return {
    // Relu à chaque contrôle : un outil vient peut-être d'être installé.
    git: () => tool(which('git.exe', [path.join(ProgramFiles, 'Git', 'cmd'), path.join(LOCALAPPDATA, 'Programs', 'Git', 'cmd')])),
    cargo: () => tool(which('cargo.exe', [cargoBin])),
    rustup: () => tool(which('rustup.exe', [cargoBin])),
    winget: () => tool(which('winget.exe', [path.join(LOCALAPPDATA, 'Microsoft', 'WindowsApps')])),
    vswhere: () => tool(which('vswhere.exe', [path.join(x86, 'Microsoft Visual Studio', 'Installer')])),
    sdk: () => {
      const lib = path.join(x86, 'Windows Kits', '10', 'Lib');
      try { return fs.readdirSync(lib).some((v) => fs.existsSync(path.join(lib, v, 'um', 'x64', 'kernel32.lib'))); } catch { return false; }
    },
    freeBytes: (dir) => { const s = fs.statfsSync(dir); return s.bavail * s.bsize; },
  };
}

/**
 * Installe VIctory depuis son dépôt public et le compile sur cette machine. SixM ne contient aucun code
 * de VIctory (GPL-3) : il appelle git et cargo. Le dernier victory.exe qui marche n'est remplacé
 * qu'après une compilation réussie et vérifiée.
 */
export class VictoryBuilder {
  constructor(dir, { onInstalled = () => {}, tools = {}, repo = REPO, pinned = PINNED, module = MODULE, supported = process.platform === 'win32', logDir = dir } = {}) {
    Object.assign(this, { dir, repo, pinned, supported, onInstalled, module: moduleSource(module) });
    this.tools = { ...defaultTools(), ...tools };
    this.src = path.join(dir, 'src');
    this.logFile = path.join(logDir, 'victory-build.log');
    this.status = 'idle'; // idle | running | done | failed | cancelled
    this.task = null; // install | update | git | rust | msvc
    this.step = '';
    this.progress = null; // 0..1
    this.error = null;
    this.log = [];
    this.checks = null;
    this.child = null;
    this.cancelled = false;
  }

  get busy() { return this.status === 'running'; }

  /** Version installée par SixM, ou null. */
  installed() {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(this.dir, 'state.json'), 'utf8'));
      return SHA.test(s.commit) && isExe(s.exe) ? { commit: s.commit, exe: s.exe, builtAt: String(s.builtAt ?? ''), module: s.module ?? null } : null;
    } catch {
      return null;
    }
  }

  state() {
    const { supported, status, task, step, progress, error, checks, pinned } = this;
    const installed = this.installed();
    return { supported, status, task, step, progress, error, checks, pinned, installed, moduleStale: this.moduleStale(installed), log: this.log.slice(-120) };
  }

  /** Contrôle des prérequis : [{ id, name, ok, detail }]. */
  async check() {
    const [git, rust, msvc] = await Promise.all([this.#version('git'), this.#rust(), this.#msvc()]);
    this.checks = [
      { id: 'git', name: 'Git', ...git },
      { id: 'rust', name: 'Rust', ...rust },
      { id: 'msvc', name: 'Outils C++ (MSVC)', ...msvc },
      { id: 'disk', name: 'Espace disque', ...this.#disk() },
    ];
    return this.checks;
  }

  /** Installe un prérequis avec winget. Appelé seulement après un clic de l'utilisateur. */
  installTool(id) {
    const pkg = Object.hasOwn(PACKAGES, id) ? PACKAGES[id] : null;
    if (!pkg) throw new Error('élément inconnu');
    const winget = this.tools.winget();
    if (!winget) throw new Error(`winget est introuvable : installez l'outil depuis ${pkg.url}`);
    return this.#run(id, async () => {
      this.#progress(`Installation de ${pkg.id}`, null);
      await this.#exec(winget, ['install', '--id', pkg.id, '-e', '--source', 'winget', '--silent', '--accept-package-agreements',
        '--accept-source-agreements', '--disable-interactivity', ...(pkg.extra ?? [])], { cwd: this.dir });
      await this.check();
      if (!this.checks.find((c) => c.id === id).ok) throw new Error('installé, mais pas encore détecté : redémarrez SixM');
    });
  }

  /** Installe le commit épinglé. */
  install() { return this.#run('install', () => this.#build(async () => this.pinned)); }

  /** Le module SixM a changé depuis la compilation. */
  moduleStale(installed = this.installed()) { return !!installed && installed.module !== this.module.id; }

  /** Recompile la même version de VIctory avec le module SixM actuel. */
  rebuild() {
    const installed = this.installed();
    if (!installed) throw new Error('VIctory n\'est pas installé');
    return this.#run('rebuild', () => this.#build(async () => installed.commit));
  }

  /** Recompilation automatique : un seul essai par version du module, même raté ou annulé. */
  autoRebuild() {
    if (!this.supported || this.busy || !this.moduleStale()) return false;
    const mark = path.join(this.dir, 'rebuild-tried.txt');
    try { if (fs.readFileSync(mark, 'utf8') === this.module.id) return false; } catch { /* premier essai */ }
    fs.writeFileSync(mark, this.module.id);
    this.rebuild();
    return true;
  }

  /** Passe au dernier commit publié. Toujours sur demande. */
  update() { return this.#run('update', () => this.#build(() => this.latest())); }

  /** Dernier commit publié, sans rien télécharger d'autre. */
  async latest() {
    const git = this.tools.git();
    if (!git) throw new Error('Git est introuvable');
    const out = await this.#capture(git, [...this.#gitSafe(), 'ls-remote', '--exit-code', this.repo, 'HEAD']);
    const sha = out.trim().split(/\s/)[0];
    if (!SHA.test(sha)) throw new Error('le dépôt VIctory ne répond pas');
    return sha;
  }

  cancel() {
    if (!this.busy) return;
    this.cancelled = true;
    this.#kill();
  }

  async close() {
    this.cancel();
    await this.running;
  }

  // --- déroulement ---------------------------------------------------------------------------

  /** Lance une opération ; une seule à la fois. Ne rejette jamais : le résultat est dans l'état. */
  #run(task, fn) {
    if (!this.supported) throw new Error('l\'installation de VIctory demande Windows');
    if (this.busy) throw new Error('une installation est déjà en cours');
    Object.assign(this, { status: 'running', task, step: 'Préparation', progress: null, error: null, log: [], cancelled: false });
    fs.mkdirSync(this.dir, { recursive: true });
    fs.mkdirSync(path.dirname(this.logFile), { recursive: true });
    fs.writeFileSync(this.logFile, '');
    this.running = (async () => {
      try {
        await fn();
        this.status = this.cancelled ? 'cancelled' : 'done';
      } catch (e) {
        this.status = this.cancelled ? 'cancelled' : 'failed';
        this.error = this.cancelled ? null : e.message;
        this.#line(`! ${this.cancelled ? 'annulé' : e.message}`);
      } finally {
        this.progress = null;
      }
    })();
    return this.running;
  }

  async #build(target) {
    this.#progress('Vérification des prérequis', null);
    const missing = (await this.check()).filter((c) => !c.ok);
    if (missing.length) throw new Error(`il manque : ${missing.map((c) => c.name).join(', ')}`);

    const commit = await target();
    this.#alive();
    const done = path.join(this.dir, 'builds', `${commit.slice(0, 12)}-${this.module.id.slice(0, 6)}`, 'victory.exe');
    if (!isExe(done)) {
      await this.#checkout(commit);
      await this.#integrate();
      await this.#compile(done);
    }
    this.#alive();
    const tmp = path.join(this.dir, 'state.json.tmp');
    fs.writeFileSync(tmp, JSON.stringify({ commit, exe: done, builtAt: new Date().toISOString(), module: this.module.id }, null, 2) + '\n');
    fs.renameSync(tmp, path.join(this.dir, 'state.json'));
    this.#progress('Terminé', 1);
    this.#line(`VIctory ${commit.slice(0, 12)} : ${done}`);
    this.onInstalled(done);
  }

  async #checkout(commit) {
    const git = [...this.tools.git(), ...this.#gitSafe()];
    const run = (...args) => this.#exec(git, args, { cwd: this.src });
    this.#progress('Téléchargement du code de VIctory', null);
    fs.mkdirSync(this.src, { recursive: true });
    if (!fs.existsSync(path.join(this.src, '.git'))) await run('init', '--quiet');
    // Adresse donnée à chaque fois : un dépôt local modifié ne peut pas rediriger le téléchargement.
    await run('fetch', '--progress', '--depth', '1', '--no-tags', '--no-recurse-submodules', this.repo, commit);
    await run('checkout', '--quiet', '--force', '--detach', commit);
    await run('clean', '-ffdxq');
    const head = (await this.#capture(git, ['rev-parse', 'HEAD'], { cwd: this.src })).trim();
    if (head !== commit) throw new Error(`commit inattendu : ${head.slice(0, 12)}`);
  }

  /**
   * Ajoute le module SixM (code original, MIT) à la copie locale de VIctory : un crate, une dépendance,
   * un appel au démarrage. Le verrou de VIctory ne doit gagner que ce crate.
   */
  async #integrate() {
    this.#progress('Ajout du module SixM', null);
    const at = (...p) => path.join(this.src, ...p);
    const cargo = this.tools.cargo(), options = { cwd: this.src, env: this.#cargoEnv(), cargo: true };
    const before = lockPackages(fs.readFileSync(at('Cargo.lock'), 'utf8'));
    await this.#exec(cargo, ['fetch', '--locked'], options);
    const edit = (file, pattern, added) => {
      const text = fs.readFileSync(file, 'utf8');
      if (text.split(pattern).length !== 2) throw new Error(`VIctory a changé : ${path.basename(file)} ne se laisse plus compléter`);
      fs.writeFileSync(file, text.replace(pattern, (m) => m + added));
    };
    edit(at('apps', 'victory', 'Cargo.toml'), /^\[dependencies\]\r?\n/m, 'sixm-bridge = { path = "../../crates/sixm-bridge" }\n');
    edit(at('apps', 'victory', 'src', 'main.rs'), /^fn main\(\)[^{\n]*\{\r?\n/m, '    sixm_bridge::start();\n');
    fs.rmSync(at('crates', 'sixm-bridge'), { recursive: true, force: true });
    for (const f of this.module.files) {
      fs.mkdirSync(path.dirname(at('crates', 'sixm-bridge', f.name)), { recursive: true });
      fs.writeFileSync(at('crates', 'sixm-bridge', f.name), f.data);
    }
    await this.#exec(cargo, ['update', '--workspace', '--offline', '--quiet'], options);
    const after = lockPackages(fs.readFileSync(at('Cargo.lock'), 'utf8'));
    if ([...after].filter((p) => !before.has(p)).join() !== 'sixm-bridge 0.1.0 ' || [...before].some((p) => !after.has(p)))
      throw new Error('les dépendances de VIctory ont bougé : compilation refusée');
  }

  #cargoEnv() {
    const env = { ...process.env, CARGO_TARGET_DIR: path.join(this.dir, 'target'), CARGO_TERM_COLOR: 'never', CARGO_TERM_PROGRESS_WHEN: 'always', CARGO_TERM_PROGRESS_WIDTH: '100' };
    delete env.CARGO_BUILD_TARGET; // déplacerait victory.exe
    delete env.RUSTUP_TOOLCHAIN; // VIctory épingle sa version de Rust
    return env;
  }

  async #compile(done) {
    this.#progress('Compilation', 0);
    const target = path.join(this.dir, 'target');
    const env = this.#cargoEnv();
    const built = path.join(target, 'release', 'victory.exe');
    fs.rmSync(built, { force: true }); // ne jamais prendre un ancien résultat pour un nouveau
    await this.#exec(this.tools.cargo(), ['build', '--release', '-p', 'victory', '--locked'], { cwd: this.src, env, cargo: true });

    this.#progress('Vérification', null);
    if (!isExe(built)) throw new Error('cargo n\'a pas produit victory.exe');
    const dir = path.dirname(done);
    const staging = `${dir}.tmp`;
    fs.rmSync(staging, { recursive: true, force: true });
    fs.mkdirSync(staging, { recursive: true });
    fs.copyFileSync(built, path.join(staging, 'victory.exe'));
    fs.copyFileSync(path.join(this.src, 'LICENSE'), path.join(staging, 'LICENSE'));
    // Aide seulement : aucun jeu n'est lancé.
    await this.#capture([path.join(staging, 'victory.exe')], ['--help'], { cwd: staging });
    this.#alive();
    fs.rmSync(dir, { recursive: true, force: true });
    fs.renameSync(staging, dir);
  }

  // --- prérequis -----------------------------------------------------------------------------

  async #version(id) {
    const tool = this.tools[id]();
    if (!tool) return { ok: false, detail: 'non installé' };
    try {
      return { ok: true, detail: (await this.#capture(tool, ['--version'])).trim().split('\n')[0].slice(0, 80) };
    } catch {
      return { ok: false, detail: 'ne répond pas' };
    }
  }

  async #rust() {
    if (!this.tools.rustup()) return { ok: false, detail: this.tools.cargo() ? 'cargo sans rustup' : 'non installé' };
    return this.#version('cargo');
  }

  async #msvc() {
    const vswhere = this.tools.vswhere();
    if (!vswhere) return { ok: false, detail: 'non installés' };
    try {
      const out = await this.#capture(vswhere, ['-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationVersion']);
      if (!out.trim()) return { ok: false, detail: 'composant C++ manquant' };
      if (!this.tools.sdk()) return { ok: false, detail: 'SDK Windows manquant' };
      return { ok: true, detail: `Visual Studio ${out.trim().split('\n')[0]}` };
    } catch {
      return { ok: false, detail: 'ne répond pas' };
    }
  }

  #disk() {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const free = this.tools.freeBytes(this.dir) / 2 ** 30;
      return { ok: free >= NEEDED_GB, detail: `${Math.floor(free)} Go libres, ${NEEDED_GB} Go nécessaires` };
    } catch {
      return { ok: false, detail: 'illisible' };
    }
  }

  // --- processus -----------------------------------------------------------------------------

  #gitSafe() {
    // Ni hooks, ni dépôts locaux, ni demande de mot de passe.
    return ['-c', `core.hooksPath=${path.join(this.dir, 'no-hooks')}`, '-c', 'protocol.file.allow=never', '-c', 'core.autocrlf=false', '-c', 'core.longpaths=true', '-c', 'credential.helper='];
  }

  #alive() { if (this.cancelled) throw new Error('annulé'); }

  #progress(step, value) {
    this.#alive();
    this.step = step;
    this.progress = value;
  }

  #line(text) {
    const clean = text.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '').replace(/[\u0000-\u0008\u000b-\u001f]/g, '').trimEnd();
    if (!clean) return;
    this.log.push(clean.slice(0, 400));
    if (this.log.length > MAX_LOG) this.log.splice(0, this.log.length - MAX_LOG);
    try { fs.appendFileSync(this.logFile, clean + '\n'); } catch { /* le journal à l'écran suffit */ }
  }

  /** Exécute en affichant la sortie en direct. */
  #exec(tool, args, { cwd, env = process.env, cargo = false }) {
    this.#alive();
    this.#line(`> ${path.basename(tool[0])} ${args.join(' ')}`);
    return new Promise((resolve, reject) => {
      const p = this.child = spawn(tool[0], [...tool.slice(1), ...args], { cwd, env: { ...env, GIT_TERMINAL_PROMPT: '0' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      const feed = (stream) => {
        let buf = '';
        stream.setEncoding('utf8').on('data', (d) => {
          buf += d;
          // Les barres de progression se réécrivent avec \r : elles ne vont pas dans le journal.
          const parts = buf.split(/(\r\n|\n|\r(?!$))/);
          buf = parts.pop().slice(-4000);
          for (let i = 0; i < parts.length; i += 2) this.#output(parts[i], parts[i + 1] === '\r', cargo);
        }).on('end', () => this.#output(buf, false, cargo));
      };
      feed(p.stdout);
      feed(p.stderr);
      p.on('error', (e) => reject(new Error(`${path.basename(tool[0])} ne démarre pas : ${e.message}`)));
      p.on('close', (code) => {
        this.child = null;
        if (this.cancelled) reject(new Error('annulé'));
        else if (code !== 0) reject(new Error(`${path.basename(tool[0])} a échoué (code ${code})`));
        else resolve();
      });
    });
  }

  #output(text, transient, cargo) {
    const bar = cargo && /Building \[.*\] (\d+)\/(\d+)/.exec(text);
    if (bar) {
      const value = Number(bar[1]) / Math.max(1, Number(bar[2]));
      // Le total de cargo grandit parfois : la barre ne recule pas.
      if (this.step === 'Compilation') this.progress = Math.max(this.progress ?? 0, Math.min(1, value));
      return;
    }
    const pct = /(\d{1,3})% \(\d+\/\d+\)/.exec(text);
    if (pct && !cargo) this.progress = Math.min(1, Number(pct[1]) / 100);
    if (!transient) this.#line(text);
  }

  /** Exécute sans affichage et retourne la sortie. */
  #capture(tool, args, options = {}) {
    const failed = (e) => new Error(`${path.basename(tool[0])} a échoué : ${e.message.split('\n')[0]}`);
    return new Promise((resolve, reject) => {
      // Un fichier qui n'est pas un programme fait lever `execFile` tout de suite.
      try {
        execFile(tool[0], [...tool.slice(1), ...args], {
          timeout: 60000, windowsHide: true, maxBuffer: 1 << 20, cwd: os.tmpdir(), env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, ...options,
        }, (e, out) => (e ? reject(failed(e)) : resolve(out)));
      } catch (e) {
        reject(failed(e));
      }
    });
  }

  /** Arrête le processus et ses enfants (rustc, link…). */
  #kill() {
    const { child } = this;
    if (!child?.pid) return;
    if (process.platform !== 'win32') return void child.kill('SIGTERM');
    const taskkill = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe');
    execFile(taskkill, ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, (e) => { if (e) child.kill(); });
  }
}
