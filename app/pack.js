import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createZip } from './zip.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_BYTES = 200 << 20;

function walk(dir, prefix, out, skip = () => false) {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, d.name), name = `${prefix}/${d.name}`;
    if (skip(d.name)) continue;
    if (d.isDirectory()) walk(file, name, out, skip);
    else if (d.isFile()) out.push({ name, data: fs.readFileSync(file) }); // liens symboliques ignorés
  }
  return out;
}

const bat = `@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js est requis : https://nodejs.org ^(version LTS^)
  pause
  exit /b 1
)
node sixm\\bin\\sixm.js start .
pause
`.replaceAll('\n', '\r\n');

const sh = `#!/bin/sh
cd "$(dirname "$0")" || exit 1
command -v node >/dev/null || { echo "Node.js est requis : https://nodejs.org"; exit 1; }
exec node sixm/bin/sixm.js start .
`;

const readme = (port) => `SERVEUR SIXM
============

1. Installez Node.js (version LTS) : https://nodejs.org
2. Réglez server.json : nom, places, mot de passe.
3. Lancez start.bat (Windows) ou ./start.sh (Linux, macOS).
4. Ouvrez le port TCP ${port} (pare-feu et box / hébergeur).

Les joueurs rejoignent avec  votre-adresse:${port}

MODS
----
Déposez chaque mod dans le dossier resources/ puis redémarrez.
"autostart": ["*"] démarre tous les mods ; sinon listez leurs noms.
Les scripts serveur d'un mod ont accès à cette machine : n'installez que des mods de confiance.

DOCKER
------
docker build -t sixm .
docker run -d --restart unless-stopped -p ${port}:${port} -v "$PWD/resources:/srv/resources" sixm

CONSOLE
-------
Tapez help dans la fenêtre du serveur.

La connexion n'est pas chiffrée (ws://), mot de passe compris : sur Internet, placez un proxy TLS devant.
`;

const dockerfile = (port) => `FROM node:22-alpine
WORKDIR /srv
COPY . .
EXPOSE ${port}
CMD ["node", "sixm/bin/sixm.js", "start", "."]
`;

/**
 * Zip d'un serveur autonome : code serveur, dépendance ws, mods, scripts de lancement.
 * Il ne demande que Node.js sur la machine d'hébergement (pas de npm install).
 */
export function packServer({ config = {}, resourcesDir = path.join(root, 'resources') } = {}) {
  const { bansFile, host, ...kept } = config;
  const serverJson = {
    name: 'Mon serveur SixM', description: '', port: 30120, maxPlayers: 32, password: '',
    tickRate: 20, syncRadius: 0, autostart: ['*'], ...kept, resourcesDir: 'resources',
  };
  const ws = path.dirname(fileURLToPath(import.meta.resolve('ws')));
  const top = 'SixM-Server';
  const files = [
    { name: `${top}/LISEZMOI.txt`, data: '﻿' + readme(serverJson.port).replaceAll('\n', '\r\n') },
    { name: `${top}/server.json`, data: JSON.stringify(serverJson, null, 2) + '\n' },
    { name: `${top}/start.bat`, data: bat },
    { name: `${top}/start.sh`, data: sh, mode: 0o755 },
    { name: `${top}/Dockerfile`, data: dockerfile(serverJson.port) },
    { name: `${top}/sixm/package.json`, data: '{ "name": "sixm-server", "private": true, "type": "module" }\n' },
    { name: `${top}/sixm/bin/sixm.js`, data: fs.readFileSync(path.join(root, 'bin', 'sixm.js')) },
    { name: `${top}/sixm/client/address.js`, data: fs.readFileSync(path.join(root, 'client', 'address.js')) },
  ];
  walk(path.join(root, 'server'), `${top}/sixm/server`, files);
  for (const r of ['hello', 'menu']) walk(path.join(root, 'resources', r), `${top}/sixm/resources/${r}`, files);
  walk(ws, `${top}/sixm/node_modules/ws`, files, (n) => n === 'node_modules');
  if (fs.existsSync(resourcesDir)) walk(resourcesDir, `${top}/resources`, files, (n) => n === '.git' || n === 'node_modules');
  if (files.reduce((n, f) => n + f.data.length, 0) > MAX_BYTES) throw new Error('serveur trop volumineux pour être empaqueté (200 Mo)');
  return createZip(files);
}
