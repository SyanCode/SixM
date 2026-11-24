import { SixMClient } from './client.js';
import { MockAdapter } from './adapters/mock.js';

const url = process.argv[2] ?? 'ws://localhost:30120';
const adapter = new MockAdapter();
const c = new SixMClient({ url, name: process.argv[3] ?? 'Bot', adapter });
await c.connect();
let t = 0;
setInterval(() => { t += 0.1; adapter.local = { x: Math.cos(t) * 50, y: Math.sin(t) * 50, z: 0, h: t }; }, 50);
setInterval(() => c.emitServer('chat', 'salut !'), 5000);
