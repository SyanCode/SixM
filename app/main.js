import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from './server.js';
import { RESTART_CODE } from './updater.js';
import { openWindow } from './window.js';

const IDLE_MS = 3 * 60000;

/** Dossier des réglages et des serveurs hébergés ; SIXM_HOME le remplace. */
export const dataDir = () => process.env.SIXM_HOME || path.join(os.homedir(), 'SixM');

/** Adresse du SixM déjà ouvert sur ce dossier, ou null. */
async function running(lock) {
  try {
    const { url } = JSON.parse(fs.readFileSync(lock, 'utf8'));
    const { origin, hostname, hash } = new URL(url);
    if (hostname !== '127.0.0.1') return null;
    const res = await fetch(`${origin}/api/state`, { headers: { 'x-sixm-token': hash.slice(1) }, signal: AbortSignal.timeout(2000) });
    return res.ok ? url : null;
  } catch {
    return null;
  }
}

export async function runApp({ open = true } = {}) {
  open = open && !process.env.SIXM_NO_WINDOW;
  const dir = dataDir(), lock = path.join(dir, 'app.json');
  const already = await running(lock);
  if (already) {
    console.log('[sixm] déjà ouvert');
    if (open) await openWindow(already);
    return;
  }

  let stopping = false;
  const quit = async (code = 0) => {
    if (stopping) return;
    stopping = true;
    try { if (JSON.parse(fs.readFileSync(lock, 'utf8')).pid === process.pid) fs.rmSync(lock); } catch { /* déjà retiré */ }
    await app.close();
    process.exit(typeof code === 'number' ? code : 0); // un signal passe son nom
  };
  const app = await createApp({ dataDir: dir, port: Number(process.env.SIXM_UI_PORT ?? 0), autoUpdate: !process.env.SIXM_NO_UPDATE, onQuit: quit, onRestart: () => quit(RESTART_CODE) });
  fs.mkdirSync(dir, { recursive: true });
  // Contient le jeton de session : lisible par l'utilisateur seulement.
  fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, url: app.url }), { mode: 0o600 });
  for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(s, quit);
  console.log(`[sixm] interface : ${app.url}`);
  // Sans console visible, SixM s'arrête quand sa fenêtre est fermée et que rien ne tourne.
  if (process.env.SIXM_BACKGROUND) setInterval(() => { if (app.idleFor(IDLE_MS)) quit(); }, 30000);
  else console.log('[sixm] fermer cette fenêtre arrête SixM et les serveurs hébergés');
  if (open && !await openWindow(app.url)) console.log('[sixm] ouvrez cette adresse dans un navigateur');
}
