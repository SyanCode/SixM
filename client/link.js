import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PORT_TAKEN = 4; // code de sortie de SixMLink
const SOURCE = fileURLToPath(new URL('../link/SixMLink.cs', import.meta.url));
export const linkSupported = process.platform === 'win32';
export const defaultLinkDir = () => path.join(process.env.SIXM_HOME || path.join(os.homedir(), 'SixM'), 'link');

function run(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, options);
    let out = '';
    for (const s of [p.stdout, p.stderr]) s.setEncoding('utf8').on('data', (d) => (out += d));
    p.on('error', reject);
    p.on('close', (code) => resolve({ code, out }));
  });
}

let building = Promise.resolve();

async function build(dir) {
  if (!linkSupported) throw new Error('le lien avec VIctory demande Windows');
  const hash = crypto.createHash('sha256').update(fs.readFileSync(SOURCE)).digest('hex').slice(0, 16);
  const exe = path.join(dir, `SixMLink-${hash}.exe`);
  if (fs.existsSync(exe)) return exe;
  const csc = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  if (!fs.existsSync(csc)) throw new Error('.NET Framework 4 est introuvable sur ce PC');
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `build-${process.pid}.exe`);
  const { code, out } = await run(csc, ['/nologo', '/target:winexe', '/platform:x64', '/optimize+', '/codepage:65001', '/utf8output',
    '/r:System.Web.Extensions.dll', `/out:${tmp}`, SOURCE], { windowsHide: true });
  if (code !== 0) throw new Error(`compilation de SixM Link impossible : ${out.trim().slice(0, 500)}`);
  fs.renameSync(tmp, exe);
  return exe;
}

/** Compile SixM Link avec le compilateur C# fourni par Windows ; une fois par version du code. */
export function buildLink(dir = defaultLinkDir()) {
  const next = building.catch(() => {}).then(() => build(dir));
  building = next.catch(() => {});
  return next;
}

/**
 * Démarre SixM Link sur 127.0.0.1:port. Si le port est pris, un bridge (par exemple celui d'un futur
 * VIctory) y répond déjà : on l'utilise.
 */
export async function startLink({ port = 30121, dir, demo = false } = {}) {
  const exe = await buildLink(dir);
  // demo : SixM Link ouvre une fausse fenêtre de jeu et y pose sa surcouche.
  const p = spawn(exe, ['--serve', String(port), ...(demo ? ['--demo'] : [])]);
  p.stdin.on('error', () => {});
  p.stdout.setEncoding('utf8');
  p.stderr.resume();
  const exited = new Promise((r) => { p.once('exit', r); p.once('error', r); });
  const lines = [];
  let wake = () => {};
  p.stdout.on('data', (d) => { lines.push(...d.split(/\r?\n/).filter(Boolean)); wake(); });
  const next = async () => {
    while (!lines.length) {
      const done = await Promise.race([new Promise((r) => { wake = () => r(false); }), exited.then(() => true)]);
      if (done && !lines.length) return null;
    }
    return lines.shift();
  };
  const ready = /^ready (\d+)$/.exec(await next() ?? '');
  if (!ready) {
    if (await exited !== PORT_TAKEN) throw new Error('SixM Link ne démarre pas (bloqué par l\'antivirus ?)');
    return { port, external: true, stop: async () => {} };
  }
  return {
    port: Number(ready[1]), external: false, exited,
    /** Enregistre la surcouche en PNG (tests, captures). */
    dump: (file) => { p.stdin.write(`dump ${file}\n`); return next(); },
    stop: async () => {
      p.stdin.end();
      const timer = setTimeout(() => p.kill(), 1500);
      await exited;
      clearTimeout(timer);
    },
  };
}

/** Boîte de choix de Windows (.exe ou dossier). Retourne le chemin choisi ou null. */
export async function pickPath(title, { folder = false, dir } = {}) {
  const { code, out } = await run(await buildLink(dir), [folder ? '--pick-folder' : '--pick', title]);
  return code === 0 ? out.replace(/^\uFEFF/, '') : null;
}
