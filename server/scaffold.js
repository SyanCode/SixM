import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CLI = path.join(root, 'bin', 'sixm.js');

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
    tickRate: 20, syncRadius: 0, resourcesDir: 'resources', autostart: ['hello'], ...overrides,
  }, null, 2) + '\n');
  // server.json peut contenir le mot de passe, bans.json contient des adresses IP.
  write('.gitignore', 'server.json\nbans.json\n');
  write('start.bat', `@echo off\r\nchcp 65001 >nul\r\nnode "${CLI.replaceAll('%', '%%')}" start "%~dp0."\r\npause\r\n`);
  write('start.sh', `#!/bin/sh\nexec node '${CLI.replaceAll("'", "'\\''")}' start "$(dirname "$0")"\n`, { mode: 0o755 });
  const hello = path.join(target, 'resources', 'hello');
  if (!fs.existsSync(hello)) fs.cpSync(path.join(root, 'resources', 'hello'), hello, { recursive: true });
  return target;
}
