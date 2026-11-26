import net from 'node:net';
import { pathToFileURL } from 'node:url';

/**
 * Bridge simulé : parle le protocole de PROTOCOL.md sans aucun jeu.
 * Sert aux tests et à développer SixM de bout en bout.
 *   node integrations/victory/sim-bridge.js [port]
 */
export function startSimBridge({ port = 30121, build = 'sim', rateHz = 20, path = null } = {}) {
  const remotes = new Map();
  const logs = [];
  const menus = []; // menus reçus, null pour une fermeture
  const sockets = new Set();
  const position = path ?? ((t) => ({ x: Math.cos(t) * 10, y: Math.sin(t) * 10, z: 0, h: t }));
  const start = performance.now();

  const server = net.createServer((s) => {
    sockets.add(s);
    remotes.clear(); // un nouveau client renvoie son état complet
    s.setEncoding('utf8');
    const write = (m) => s.write(JSON.stringify(m) + '\n');
    write({ t: 'ready', build });
    const timer = setInterval(() => {
      write({ t: 'localPlayer', ...position((performance.now() - start) / 1000) });
    }, 1000 / rateHz);
    let buf = '';
    s.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m?.t === 'setRemote') remotes.set(m.id, { name: m.name, x: m.x, y: m.y, z: m.z, h: m.h });
        else if (m?.t === 'removeRemote') remotes.delete(m.id);
        else if (m?.t === 'log') logs.push(m.text);
        else if (m?.t === 'menu') menus.push(m.menu);
        else if (m?.t === 'menuClose') menus.push(null);
      }
    });
    s.on('error', () => {});
    s.on('close', () => { clearInterval(timer); sockets.delete(s); });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({
      port: server.address().port, remotes, logs, menus,
      /** Message du « jeu » vers SixM, ex. { t: 'menuOpen' } (touche du menu). */
      send: (m) => { for (const s of sockets) s.write(JSON.stringify(m) + '\n'); },
      close: () => {
        for (const s of sockets) s.destroy();
        return new Promise((r) => server.close(r));
      },
    }));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const b = await startSimBridge({ port: Number(process.argv[2] ?? 30121) });
  console.log(`[sim-bridge] en écoute sur 127.0.0.1:${b.port}`);
  setInterval(() => { if (b.remotes.size) console.table([...b.remotes.values()]); }, 2000);
}
