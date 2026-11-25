import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const run = (cmd, args) => new Promise((resolve) => {
  const p = spawn(cmd, args, { detached: true, stdio: 'ignore' });
  p.once('error', () => resolve(false));
  p.once('spawn', () => { p.unref(); resolve(true); });
});

/** Ouvre `target` (URL ou dossier) avec le programme par défaut du système. */
export function openExternal(target) {
  if (process.platform === 'win32') return run('explorer.exe', [target]);
  return run(process.platform === 'darwin' ? 'open' : 'xdg-open', [target]);
}

/** Ouvre l'interface dans sa propre fenêtre (Edge ou Chrome), sinon dans le navigateur. */
export async function openWindow(url) {
  if (process.platform === 'win32') {
    const roots = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean);
    for (const exe of ['Microsoft\\Edge\\Application\\msedge.exe', 'Google\\Chrome\\Application\\chrome.exe']) {
      for (const root of roots) {
        const file = path.join(root, exe);
        if (fs.existsSync(file) && await run(file, [`--app=${url}`, '--window-size=1100,760'])) return true;
      }
    }
  }
  return openExternal(url);
}
