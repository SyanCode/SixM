import os from 'node:os';
import path from 'node:path';
import { createApp } from './server.js';
import { openWindow } from './window.js';

/** Dossier des réglages et des serveurs hébergés ; SIXM_HOME le remplace. */
export const dataDir = () => process.env.SIXM_HOME || path.join(os.homedir(), 'SixM');

export async function runApp({ open = true } = {}) {
  let stopping = false;
  const quit = async () => {
    if (stopping) return;
    stopping = true;
    await app.close();
    process.exit(0);
  };
  const app = await createApp({ dataDir: dataDir(), port: Number(process.env.SIXM_UI_PORT ?? 0), onQuit: quit });
  for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(s, quit);
  console.log(`[sixm] interface : ${app.url}`);
  console.log('[sixm] fermer cette fenêtre arrête SixM et les serveurs hébergés');
  if (open && !await openWindow(app.url)) console.log('[sixm] ouvrez cette adresse dans un navigateur');
}
