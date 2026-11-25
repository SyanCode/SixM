import { SixMClient } from './client.js';
import { createAdapter } from './adapters/index.js';

// node client/run.js ws://host:30120 Pseudo [mock|victory]
const [url = 'ws://localhost:30120', name = 'Joueur', adapterName = 'victory'] = process.argv.slice(2);
const client = new SixMClient({ url, name, adapter: createAdapter(adapterName) });
await client.connect();
console.log(`[sixm] connecté (id ${client.id}) via l'adaptateur "${adapterName}"`);
process.on('SIGINT', async () => { await client.disconnect(); process.exit(0); });
