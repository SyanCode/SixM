# Architecture

```
SixM.bat                  lance l'interface sous Windows
app/server.js             interface locale : API sur 127.0.0.1, jeton par session
app/ui/                   pages de l'interface (sans dépendance)
app/session.js, hosts.js  partie en cours ; serveurs hébergés
app/launcher.js           lance VIctory sur l'installation choisie
app/mods.js, pack.js      import de mods ; serveur téléchargeable (zip.js)
bin/sixm.js               CLI : app, init, start, pack, info, connect
server/scaffold.js        création d'un dossier de serveur
client/link.js            compile et lance SixM Link
link/SixMLink.cs          bridge et surcouche sur VIctory (Windows)
client/address.js         adresses et fiche d'un serveur
server/config.js          lecture et contrôle de server.json
server/bans.js            bannissements par IP
server/console.js         console d'administration
server/core/network.js    WebSocket, handshake, mot de passe, info HTTP, tick, snapshots
server/core/world.js      joueurs
server/core/resources.js  chargement/vm des ressources
server/core/events.js     bus d'évènements (nettoyé par ressource à l'arrêt)
client/client.js          client de référence (réseau + scripts client)
client/interpolation.js   lissage des positions distantes (retard de 100 ms)
client/sandbox.js         scripts client isolés (QuickJS/WebAssembly)
client/adapter.js         contrat GameAdapter  <-- seule partie dépendante du jeu
client/adapters/mock.js   adaptateur de test
```

## Brancher un jeu
Implémenter `GameAdapter` (position locale, avatars distants, affichage) dans un plugin natif chargé par
le jeu ou le portage, qui parle le même protocole. Si le plugin n'est pas en JS, il suffit de
réimplémenter `client/client.js` (le protocole est du JSON simple).

## Pistes suivantes
Entités/véhicules synchronisés, authentification (tokens), persistance, ressources Lua/C#,
interface NUI, serveur de liste.
