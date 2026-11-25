**English** · [Français](README.fr.md) · [Español](README.es.md) · [Deutsch](README.de.md) · [Português](README.pt-BR.md) · [中文](README.zh-CN.md) · [日本語](README.ja.md) · [Русский](README.ru.md)

# SixM

Framework multijoueur / modding **agnostique du jeu**, dans l'esprit de FiveM, pensé pour GTA VI sur PC et les projets de portage. Tout le code est original.

## État (v0.1)

| Brique | Statut |
|---|---|
| Serveur dédié (WebSocket, tick, snapshots, rate-limit) | ✅ |
| Système de ressources (`resource.json`, start/stop/restart, scripts serveur + client) | ✅ |
| API de script (`sixm.on`, `onNet`, `emitClient`, `emitAllClients`, `getPlayers`, `kick`) | ✅ |
| Hébergement (`sixm init` / `start`, mot de passe, bans, console, `info.json`) | ✅ |
| Launcher VIctory et surcouche en jeu (Windows) : chat, joueurs, radar | ✅ testé avec un faux VIctory |
| Position et personnages des autres joueurs dans le jeu | ⛔ demande un module dans VIctory |
| Interface client : jouer, héberger, mods, serveur à télécharger | ✅ |
| Scripts client isolés dans QuickJS/WebAssembly | ✅ |
| Client de référence + adaptateur simulé + bot de test | ✅ |
| **Adaptateur pour un vrai jeu** (`GameAdapter`) | ⛔ à écrire, voir ci-dessous |

## Démarrage

Windows : double-cliquez sur `SixM.bat` ([Node.js](https://nodejs.org) requis). Ailleurs : `npm install` puis `npm run app`.

- **Jouer** : choisissez l'installation du jeu et le serveur ; SixM lance [VIctory](https://github.com/Marvisak/VIctory) puis ajoute chat et joueurs par-dessus (F8 écrire, F9 masquer). Mode démo sans jeu.
- **Réglages** : chemin de `victory.exe` et dossier du jeu extrait de votre disque. SixM ne fournit ni VIctory ni le jeu.
- **Héberger** : serveur sur ce PC en deux clics, mods par glisser-déposer d'un zip.
- **Télécharger le serveur** : zip autonome pour un VPS, un autre PC ou Docker.

En ligne de commande :

```bash
npm install
node bin/sixm.js init ../mon-serveur  # créer son serveur, puis : node bin/sixm.js start ../mon-serveur
npm start          # serveur de démo sur ws://localhost:30120
npm run bot        # (autre terminal) un bot qui se déplace et parle
npm test
```

Héberger : [docs/HOSTING.md](docs/HOSTING.md). Console serveur : tapez `help`.

## Ce que SixM ne fait pas (et pourquoi)

- **GTA VI n'a pas de version PC officielle ni de support de mods** : il n'existe donc aucun point d'accroche légitime. `client/adapter.js` définit le contrat à implémenter le jour où il y en a un (API officielle, ou projet de portage qui autorise explicitement les plugins).
- Le dépôt **ne contient ni n'utilisera** de code, d'assets ou de binaires Rockstar, ni de fuites ou de builds piratés. Ne les ajoutez pas.
- Les scripts **serveur** tournent dans `node:vm`, ce qui **n'est pas** une sandbox de sécurité : l'hébergeur ne doit installer que des ressources de confiance.

Voir [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) et [docs/PROTOCOL.md](docs/PROTOCOL.md).
