import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const UI_EXE = process.platform === 'win32' ? 'sixm-ui.exe' : 'sixm-ui';

const run = (cmd, args, env) => new Promise((resolve) => {
  const p = spawn(cmd, args, { detached: true, stdio: 'ignore', ...(env && { env: { ...process.env, ...env } }) });
  p.once('error', () => resolve(false));
  p.once('spawn', () => { p.unref(); resolve(true); });
});

/** Ouvre `target` (URL ou dossier) avec le programme par défaut du système. */
export function openExternal(target) {
  if (process.platform === 'win32') return run('explorer.exe', [target]);
  return run(process.platform === 'darwin' ? 'open' : 'xdg-open', [target]);
}

/**
 * Interface native (desktop/, en Rust) : SIXM_UI_BIN, celle fournie avec l'installation, ou celle compilée
 * avec `cargo build --release`. SIXM_WEB_UI garde l'interface web.
 */
export function nativeUi(env = process.env, dir = root) {
  if (env.SIXM_WEB_UI) return null;
  const files = [env.SIXM_UI_BIN, path.join(dir, 'desktop', UI_EXE), path.join(dir, 'desktop', 'target', 'release', UI_EXE)];
  return files.find((f) => f && fs.existsSync(f)) ?? null;
}

/** Ouvre l'interface native, sinon une fenêtre d'Edge ou de Chrome, sinon le navigateur. */
export async function openWindow(url) {
  // L'adresse contient le jeton de session : passée par l'environnement, pas sur la ligne de commande.
  const native = nativeUi();
  if (native && await run(native, [], { SIXM_URL: url })) return true;
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
