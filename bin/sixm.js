#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { queryServer, serverUrl } from '../client/address.js';

const self = fileURLToPath(import.meta.url);
// Le pack serveur téléchargeable ne contient pas l'interface.
const hasApp = fs.existsSync(path.join(path.dirname(self), '..', 'app', 'main.js'));

const HELP = `usage :
  sixm                                       ouvrir l'interface
  sixm init <dossier>                        créer un serveur
  sixm start [dossier]                       héberger le serveur de ce dossier
  sixm pack [fichier.zip]                    créer le serveur téléchargeable
  sixm info <hôte[:port]>                    interroger un serveur
  sixm connect <hôte[:port]> [pseudo] [victory|mock]
                                             rejoindre (mot de passe : SIXM_PASSWORD)`;

async function main([cmd = hasApp ? 'app' : 'help', ...args]) {
  switch (cmd) {
    case 'app': {
      const { runApp } = await import('../app/main.js');
      return runApp({ open: !args.includes('--no-open') });
    }
    case 'init': {
      if (!args[0]) throw new Error('dossier attendu : sixm init <dossier>');
      const { scaffoldServer } = await import('../server/scaffold.js');
      console.log(`[sixm] serveur créé dans ${scaffoldServer(args[0])}`);
      return console.log('[sixm] réglages : server.json ; lancement : start.bat (Windows) ou ./start.sh');
    }
    case 'start': {
      const { hostDirectory } = await import('../server/index.js');
      return void await hostDirectory(path.resolve(args[0] ?? '.'));
    }
    case 'pack': {
      const { packServer } = await import('../app/pack.js');
      const file = path.resolve(args[0] ?? 'SixM-Server.zip');
      fs.writeFileSync(file, packServer(), { flag: 'wx' });
      return console.log(`[sixm] ${file}`);
    }
    case 'info':
      if (!args[0]) throw new Error('adresse attendue : sixm info <hôte[:port]>');
      return console.log(JSON.stringify(await queryServer(args[0], { timeoutMs: 5000 }), null, 2));
    case 'connect': {
      const { join } = await import('../client/run.js');
      return join(serverUrl(args[0] ?? 'localhost'), args[1], args[2]);
    }
    default:
      console.log(HELP);
      if (cmd !== 'help') process.exitCode = 1;
  }
}

// realpath : `npm link` lance ce fichier à travers un lien symbolique.
if (process.argv[1] && fs.existsSync(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(self)) {
  try {
    await main(process.argv.slice(2));
  } catch (e) {
    console.error(`[sixm] ${e.message || e.code}`);
    process.exit(1);
  }
}
