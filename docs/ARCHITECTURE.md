# Architecture

```
SixM.bat                  lance l'interface sous Windows
app/server.js             interface locale : API sur 127.0.0.1, jeton par session
desktop/                  interface native en Rust (egui) : fenêtre de SixM, parle à app/server.js
app/ui/                   interface web, utilisée si l'interface native manque (SIXM_WEB_UI=1 pour la forcer)
app/session.js, hosts.js  partie en cours ; serveurs hébergés
app/builder.js            télécharge et compile VIctory (git, cargo), sans code de VIctory ici
app/ports.js              portages connus (VIctory, VIctory Belobug AMD, Tequesta, dépôt au choix) et leurs options de lancement
app/updater.js            mise à jour de SixM depuis GitHub
app/launcher.js           lance VIctory sur l'installation choisie
app/mods.js, pack.js      import de mods ; serveur téléchargeable (zip.js)
bin/sixm.js               CLI : app, init, start, pack, info, connect
server/scaffold.js        création d'un dossier de serveur
client/module.js          client du module SixM dans VIctory
client/link.js            compile et lance SixM Link
link/SixMLink.cs          bridge et surcouche sur VIctory (Windows)
client/address.js         adresses et fiche d'un serveur
server/config.js          lecture et contrôle de server.json
server/bans.js            bannissements par IP et par identifiant
server/identity.js        identité des joueurs : clé Ed25519, défi signé, identifiant sixm:…
server/access.js          liste blanche, demandes d'accès, administrateurs (access.json)
server/menus.js           menus des mods : forme vérifiée, menu principal (docs/MENUS.md)
server/announce.js        serveur public : diffusion sur le réseau local, inscription aux annuaires
server/directory.js       annuaire de serveurs publics (sixm directory)
app/discovery.js          serveurs du réseau local, lecture des annuaires
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

## Interface native
`desktop/` est un programme Rust (eframe/egui, rendu OpenGL) qui dessine toute l'interface. Il ne contient aucune
logique de jeu : il lit `/api/state` toutes les 600 ms et appelle les mêmes routes que l'interface web, avec le jeton
de session. `app/window.js` le lance en lui passant l'adresse dans `SIXM_URL` ; lancé seul, il retrouve SixM par
`~/SixM/app.json` ou le démarre (`node bin/sixm.js app --no-open`). Compilation : `cargo build --release` dans
`desktop/` (l'installateur le fait). Police Inter embarquée (OFL, `desktop/assets/Inter-LICENSE.txt`).

## Installer VIctory
`app/builder.js` clone le dépôt public dans `~/SixM/victory/src` au commit `PINNED` et lance
`cargo build --release -p victory --locked`. Le résultat n'est adopté qu'après vérification (`victory.exe --help`) ;
une version par commit dans `builds/`, avec sa licence GPL-3. Rien ne se lance sans clic.

## Mises à jour
Au lancement puis toutes les 30 min, si rien ne tourne. Installé : dernier `SixM-Setup` publié, dont l'empreinte doit
être celle annoncée par GitHub. Code source : `git merge --ff-only` de `main`, si rien n'est modifié. Portable : signale
seulement. Si le module de VIctory a changé, la même version de VIctory est recompilée une fois. Réglage : `autoUpdate`.

## Publier une version
Changez `version` dans `package.json` puis poussez sur `main` : `.github/workflows/release.yml` teste, fabrique
l'installateur, l'essaie et publie. Localement : `npm ci && npm run package`, puis `packaging/test-setup.ps1`.

## Brancher un jeu
Implémenter `GameAdapter` (position locale, avatars distants, affichage) dans un plugin natif chargé par
le jeu ou le portage, qui parle le même protocole. Si le plugin n'est pas en JS, il suffit de
réimplémenter `client/client.js` (le protocole est du JSON simple).

## Pistes suivantes
Entités/véhicules synchronisés, authentification (tokens), persistance, ressources Lua/C#,
interface NUI, serveur de liste.
