# SixM

Framework multijoueur / modding **agnostique du jeu**, dans l'esprit de FiveM, pensé pour GTA VI sur PC
et les projets de portage. Le code est entièrement original.

## État actuel (v0.1)

| Brique | Statut |
|---|---|
| Serveur dédié (WebSocket, tick, snapshots, rate-limit) | ✅ |
| Système de ressources (`resource.json`, start/stop/restart, scripts serveur + client) | ✅ |
| API de script (`sixm.on`, `onNet`, `emitClient`, `emitAllClients`, `getPlayers`, `kick`) | ✅ |
| Client de référence + adaptateur simulé (`mock`) + bot de test | ✅ |
| **Adaptateur pour un vrai jeu** (`GameAdapter`) | ⛔ à écrire, voir ci-dessous |

## Démarrage

```bash
npm install
npm start          # serveur sur ws://localhost:30120
npm run bot        # (autre terminal) un bot qui se déplace et parle
npm test
```

Console serveur : `start|stop|restart <ressource>`, `players`, `resources`, `quit`.

## Ce que SixM ne fait pas (et pourquoi)

- **GTA VI n'a pas de version PC officielle ni de support de mods** : il n'existe donc aucun point d'accroche
  légitime à ce jour. `client/adapter.js` définit le contrat à implémenter le jour où il y en a un
  (API officielle, ou projet de portage qui autorise explicitement les plugins).
- Le dépôt **ne contient ni n'utilisera** de code, d'assets ou de binaires Rockstar, ni de fuites
  ou de builds piratés. Ne les ajoutez pas.
- Les scripts sont isolés par `node:vm`, ce qui **n'est pas** une sandbox de sécurité : n'exécutez que des
  ressources de confiance.

Voir `docs/ARCHITECTURE.md` et `docs/PROTOCOL.md`.
