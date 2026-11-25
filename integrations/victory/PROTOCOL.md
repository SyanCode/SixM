# Bridge SixM ⇄ VIctory

**État :** côté SixM (`client/adapters/victory.js`) implémenté et testé contre un faux bridge.
Côté VIctory, **le module bridge reste à écrire** : VIctory n'a pas d'API de plugin à ce jour
(README du projet : « Not playable yet », réseau « offline by design »).

## Principe
Le bridge s'exécute dans le processus VIctory, écoute en TCP **127.0.0.1:30121** (loopback
uniquement) et parle en NDJSON (un objet JSON par ligne, 1 Mio max/ligne). L'adaptateur SixM s'y
connecte comme client. Le bridge lit/écrit l'état du jeu ; le serveur SixM ne voit jamais le jeu.

## Bridge → adaptateur
- `{"t":"ready","build":"<identité du build, ex. BLAKE3 de l'exécutable>"}` — premier message.
  L'adaptateur le refuse si le build n'est pas dans `allowedBuilds`.
- `{"t":"localPlayer","x","y","z","h"}` — position du joueur local (~20 Hz).

## Adaptateur → bridge
- `{"t":"setRemote","id","name","x","y","z","h"}` — créer/déplacer l'avatar d'un joueur distant.
- `{"t":"removeRemote","id"}`
- `{"t":"log","text"}` — chat / notifications à afficher.

## Règles (alignées sur docs/asset-policy.md de VIctory)
- Les offsets et signatures propres à un build vivent dans un **profil local hors dépôt**, sous des
  noms choisis par nous. Rien d'extrait du jeu (code, tables, assets) n'est commité ici.
- Le bridge ne doit être joignable que depuis la machine locale.
- Le jeu est hors-ligne par conception côté VIctory : SixM ne touche pas aux services en ligne de
  l'éditeur ; il synchronise uniquement ses propres messages vers le serveur SixM.

## Utilisation
```bash
node client/run.js ws://serveur:30120 MonPseudo victory
```
