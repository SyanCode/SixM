import { pathToFileURL } from 'node:url';
import { SixMClient } from './client.js';
import { createAdapter } from './adapters/index.js';
import { linkSupported, startLink } from './link.js';

/** Rejoint un serveur. Le mot de passe vient de SIXM_PASSWORD (pas de la ligne de commande). */
export async function join(url, name = 'Joueur', adapterName = 'victory') {
  const link = adapterName === 'victory' && linkSupported ? await startLink() : null;
  const client = new SixMClient({
    url, name, adapter: createAdapter(adapterName), password: process.env.SIXM_PASSWORD,
    onDisconnect: async (reason) => {
      console.error(`[sixm] déconnecté${reason ? ` : ${reason}` : ''}`);
      await client.adapter.shutdown();
      await link?.stop();
      process.exit(1);
    },
  });
  try {
    await client.connect();
  } catch (e) {
    await link?.stop();
    throw new Error(`connexion impossible : ${e.message || e.code}`);
  }
  console.log(`[sixm] connecté (id ${client.id}) via l'adaptateur "${adapterName}"`);
  process.on('SIGINT', async () => { await client.disconnect(); await link?.stop(); process.exit(0); });
}

// node client/run.js ws://host:30120 Pseudo [mock|victory]
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [url = 'ws://localhost:30120', name, adapterName] = process.argv.slice(2);
  try {
    await join(url, name, adapterName);
  } catch (e) {
    console.error(`[sixm] ${e.message}`);
    process.exit(1);
  }
}
