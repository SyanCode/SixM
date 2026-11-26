import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CLI = path.join(root, 'bin', 'sixm.js');
// SixM installé : Node.js est fourni à côté et n'est pas forcément dans le PATH.
const bundled = path.join(root, '..', 'node', 'node.exe');
const NODE = fs.existsSync(bundled) ? `"${bundled.replaceAll('%', '%%')}"` : 'node';

/** Crée un dossier de serveur prêt à lancer. `overrides` complète server.json. */
export function scaffoldServer(dir, overrides = {}) {
  const target = path.resolve(dir);
  if (fs.existsSync(path.join(target, 'server.json'))) throw new Error(`un serveur existe déjà dans ${target}`);
  fs.mkdirSync(path.join(target, 'resources'), { recursive: true });
  const write = (name, text, options) => {
    const file = path.join(target, name);
    if (!fs.existsSync(file)) fs.writeFileSync(file, text, options);
  };
  write('server.json', JSON.stringify({
    name: 'Mon serveur SixM', description: '', port: 30120, maxPlayers: 32, password: '',
    tickRate: 20, syncRadius: 0, resourcesDir: 'resources', autostart: ['hello', 'menu'],
    visibility: 'public', whitelist: false, tags: [], motd: '', ...overrides,
  }, null, 2) + '\n');
  // server.json peut contenir le mot de passe, bans.json des adresses IP, access.json des identifiants.
  write('.gitignore', 'server.json\nbans.json\naccess.json\n');
  write('start.bat', `@echo off\r\nchcp 65001 >nul\r\n${NODE} "${CLI.replaceAll('%', '%%')}" start "%~dp0."\r\npause\r\n`);
  write('start.sh', `#!/bin/sh\nexec node '${CLI.replaceAll("'", "'\\''")}' start "$(dirname "$0")"\n`, { mode: 0o755 });
  for (const name of ['hello', 'menu']) {
    const dest = path.join(target, 'resources', name);
    if (!fs.existsSync(dest)) fs.cpSync(path.join(root, 'resources', name), dest, { recursive: true });
  }
  return target;
}
