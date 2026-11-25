// Fabrique dans dist/ : SixM-Setup-<v>.exe, SixM-portable-<v>.zip, SixM-Server-<v>.zip, SHA256SUMS.txt.
// Windows seulement. Compilateur : le csc.exe de Windows. Node.js : binaire officiel, empreinte vérifiée.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createZip } from '../app/zip.js';
import { packServer } from '../app/pack.js';

const here = path.dirname(fileURLToPath(import.meta.url)), root = path.join(here, '..'), dist = path.join(root, 'dist');
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`version invalide : ${version}`);
const runtime = JSON.parse(fs.readFileSync(path.join(here, 'node.json'), 'utf8'));
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const csc = path.join(process.env.SystemRoot, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} : ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function nodeExe() {
  const cache = path.join(here, '.cache', `node-${runtime.version}.exe`);
  if (!fs.existsSync(cache)) {
    const data = await download(`https://nodejs.org/dist/v${runtime.version}/win-x64/node.exe`);
    fs.mkdirSync(path.dirname(cache), { recursive: true });
    fs.writeFileSync(cache, data);
  }
  const data = fs.readFileSync(cache);
  if (sha256(data) !== runtime.sha256) {
    fs.rmSync(cache);
    throw new Error('empreinte de node.exe inattendue');
  }
  return data;
}

function walk(dir, prefix, out, skip = () => false) {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skip(d.name)) continue;
    const file = path.join(dir, d.name);
    if (d.isDirectory()) walk(file, `${prefix}/${d.name}`, out, skip);
    else if (d.isFile()) out.push({ name: `${prefix}/${d.name}`, data: fs.readFileSync(file) });
  }
  return out;
}

/** Dépendances de production, d'après le lockfile. */
function dependencies() {
  const { packages } = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  const out = [];
  for (const [p, info] of Object.entries(packages)) {
    if (!p.startsWith('node_modules/') || info.dev || info.optional) continue;
    const dir = path.join(root, p);
    if (!fs.existsSync(dir)) throw new Error(`${p} manque : lancez npm ci`);
    walk(dir, `app/${p}`, out, (n) => n === 'node_modules');
  }
  return out;
}

function compile(source, out, { resources = [], references = [] }) {
  const info = path.join(dist, 'AssemblyInfo.cs');
  fs.writeFileSync(info, `using System.Reflection;\n[assembly: AssemblyVersion("${version}.0")]\n[assembly: AssemblyFileVersion("${version}.0")]\n[assembly: AssemblyProduct("SixM")]\n[assembly: AssemblyTitle("SixM")]\n`);
  execFileSync(csc, ['/nologo', '/target:winexe', '/platform:x64', '/optimize+', '/codepage:65001', '/utf8output', `/win32icon:${path.join(here, 'sixm.ico')}`,
    ...references.map((r) => `/r:${r}`), ...resources.map(([f, n]) => `/resource:${f},${n}`), `/out:${out}`, path.join(here, source), info], { stdio: 'inherit' });
  fs.rmSync(info);
}

fs.mkdirSync(dist, { recursive: true });
for (const f of fs.readdirSync(dist)) if (/^(SixM|SHA256SUMS|payload)/.test(f)) fs.rmSync(path.join(dist, f), { recursive: true });

const launcher = path.join(dist, 'SixM.exe');
compile('Launcher.cs', launcher, {});
const files = [
  { name: 'SixM.exe', data: fs.readFileSync(launcher) },
  { name: 'node/node.exe', data: await nodeExe() },
  { name: 'node/LICENSE', data: await download(`https://raw.githubusercontent.com/nodejs/node/v${runtime.version}/LICENSE`) },
  ...['package.json', 'server.json'].map((f) => ({ name: `app/${f}`, data: fs.readFileSync(path.join(root, f)) })),
  ...['app', 'bin', 'client', 'link', 'resources', 'server'].flatMap((d) => walk(path.join(root, d), `app/${d}`, [])),
  ...dependencies(),
];
const payload = createZip(files);
const portable = `SixM-portable-${version}.zip`, setup = `SixM-Setup-${version}.exe`, server = `SixM-Server-${version}.zip`;
fs.writeFileSync(path.join(dist, portable), createZip(files.map((f) => ({ ...f, name: `SixM/${f.name}` }))));
fs.writeFileSync(path.join(dist, server), packServer());
const zip = path.join(dist, 'payload.zip');
fs.writeFileSync(zip, payload);
compile('Setup.cs', path.join(dist, setup), { resources: [[zip, 'payload.zip']], references: ['System.IO.Compression.dll', 'System.IO.Compression.FileSystem.dll'] });
fs.rmSync(zip);
fs.rmSync(launcher);
fs.writeFileSync(path.join(dist, 'SHA256SUMS.txt'), [setup, portable, server].map((f) => `${sha256(fs.readFileSync(path.join(dist, f)))}  ${f}`).join('\n') + '\n');
for (const f of fs.readdirSync(dist)) console.log(f, fs.statSync(path.join(dist, f)).size);
