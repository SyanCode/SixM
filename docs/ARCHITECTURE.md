# Architecture

```
server/core/network.js    WebSocket, handshake, tick, snapshots
server/core/world.js      joueurs
server/core/resources.js  chargement/vm des ressources
server/core/events.js     bus d'évènements (nettoyé par ressource à l'arrêt)
client/client.js          client de référence (réseau + scripts client)
client/adapter.js         contrat GameAdapter  <-- seule partie dépendante du jeu
client/adapters/mock.js   adaptateur de test
```

## Brancher un jeu
Implémenter `GameAdapter` (position locale, avatars distants, affichage) dans un plugin natif chargé par
le jeu ou le portage, qui parle le même protocole. Si le plugin n'est pas en JS, il suffit de
réimplémenter `client/client.js` (le protocole est du JSON simple).

## Pistes suivantes
Entités/véhicules synchronisés, interpolation, authentification (tokens), persistance, ressources Lua/C#,
interface NUI, serveur de liste, interest management (OneSync-like).
