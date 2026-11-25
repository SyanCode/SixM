# Bridge SixM ⇄ VIctory

**État :** deux bridges parlent ce protocole.
- **SixM Link** (`link/SixMLink.cs`, Windows) : programme à part, sans modification de VIctory ni lecture de la
  mémoire du jeu. Surcouche (chat, joueurs, radar), F8 pour écrire, F9 pour masquer. Il ne connaît pas la position
  du joueur et ne crée pas de personnages. SixM le compile et le lance tout seul.
- **Module dans VIctory** : reste à écrire. VIctory n'a pas d'API de plugin à ce jour. Si un tel module écoute déjà
  sur le port, SixM l'utilise à la place de SixM Link.

## Principe
Le bridge s'exécute dans le processus VIctory, écoute en TCP **127.0.0.1:30121** (loopback
uniquement) et parle en NDJSON (un objet JSON par ligne, 1 Mio max/ligne). L'adaptateur SixM s'y
connecte comme client. Le bridge lit/écrit l'état du jeu ; le serveur SixM ne voit jamais le jeu.

## Bridge → adaptateur
- `{"t":"ready","build":"<identité du build, ex. BLAKE3 de l'exécutable>"}` — premier message.
  L'adaptateur le refuse si le build n'est pas dans `allowedBuilds`.
- `{"t":"localPlayer","x","y","z","h"}` — position du joueur local (~20 Hz).

- `{"t":"chat","text"}` — message écrit par le joueur depuis le jeu.

## Adaptateur → bridge
- `{"t":"target","pid"}` — processus du jeu, `0` = aucun.
- `{"t":"roster","server","players":["nom"]}` — serveur et tous les joueurs, même sans position.
- `{"t":"setRemote","id","name","x","y","z","h"}` — créer/déplacer l'avatar d'un joueur distant.
- `{"t":"removeRemote","id"}`
- `{"t":"log","text"}` — chat / notifications à afficher.

## Règles (alignées sur docs/asset-policy.md de VIctory)
- Les offsets et signatures propres à un build vivent dans un **profil local hors dépôt**, sous des
  noms choisis par nous. Rien d'extrait du jeu (code, tables, assets) n'est commité ici.
- Le bridge ne doit être joignable que depuis la machine locale.
- Le jeu est hors-ligne par conception côté VIctory : SixM ne touche pas aux services en ligne de
  l'éditeur ; il synchronise uniquement ses propres messages vers le serveur SixM.

## Reconnexion
Si le bridge se ferme, l'adaptateur se reconnecte (contrôle du build compris) et renvoie un `setRemote`
par joueur distant connu. Le bridge doit donc partir d'un état vide à chaque connexion. Entre-temps,
la position locale est inconnue et rien n'est envoyé au serveur. `ready` est attendu sous 5 s.

## Tester sans jeu
```bash
npm run sim-bridge    # bridge simulé sur 127.0.0.1:30121
```

## Utilisation
```bash
node client/run.js ws://serveur:30120 MonPseudo victory
```
