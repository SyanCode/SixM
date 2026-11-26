# Bridge SixM ⇄ VIctory

**État :** deux bridges parlent ce protocole.
- **SixM Link** (`link/SixMLink.cs`, Windows) : programme à part, sans modification de VIctory ni lecture de la
  mémoire du jeu. Surcouche (chat, joueurs, radar, menus des mods), F7 pour le menu, F8 pour écrire, F9 pour
  masquer. Les flèches, Entrée, Retour arrière et Échap ne sont prises au jeu que menu ouvert. Il ne connaît pas la position
  du joueur et ne crée pas de personnages. SixM le compile et le lance tout seul.
- **Module dans VIctory** (`sixm-bridge/`, Rust, MIT) : SixM l'ajoute en compilant VIctory. Il donne la position du
  joueur et la caméra, lues sans rien écrire, à l'endroit indiqué par un **profil local** de la version du jeu. SixM
  n'en fournit aucun. Il ne crée pas encore de personnages : SixM Link affiche les noms à leur place dans le monde.

### Profil
Fichier `~/SixM/profiles/<build>.profile` ; l'interface affiche le `<build>` de votre jeu une fois lancé.
```text
build    = 6912ab34-1a2b000      # TimeDateStamp-SizeOfImage de l'image
position = 0x1000, 0x20, 0x90    # trois f32 : x, y, z
heading  = 0x1000, 0x20, 0xa0    # un f32 en radians (facultatif)
camera   = 0x2000, 0x0           # seize f32 : matrice vue-projection (facultatif)
camera_order = row               # row ou column
```
`a` se lit à `base + a` ; `a, b, c` à `[[base + a] + b] + c`. Le fichier est relu pendant la partie.

### Module → SixM
Connexion sur `127.0.0.1:SIXM_BRIDGE_PORT`, première ligne : `SIXM_BRIDGE_TOKEN`. Puis `ready` (`build`, `profile`,
`error`), `localPlayer`, `camera` (`m` : 16 nombres par lignes, `clip = m * (x, y, z, 1)`), `tick`.

## Principe
Le bridge s'exécute dans le processus VIctory, écoute en TCP **127.0.0.1:30121** (loopback
uniquement) et parle en NDJSON (un objet JSON par ligne, 1 Mio max/ligne). L'adaptateur SixM s'y
connecte comme client. Le bridge lit/écrit l'état du jeu ; le serveur SixM ne voit jamais le jeu.

## Bridge → adaptateur
- `{"t":"ready","build":"<identité du build, ex. BLAKE3 de l'exécutable>"}` — premier message.
  L'adaptateur le refuse si le build n'est pas dans `allowedBuilds`.
- `{"t":"localPlayer","x","y","z","h"}` — position du joueur local (~20 Hz).

- `{"t":"chat","text"}` — message écrit par le joueur depuis le jeu.
- `{"t":"menuOpen"}` — touche du menu ; `{"t":"menuClose"}` — menu fermé dans le jeu.
- `{"t":"menuSelect","menu","item","value"}` — choix dans un menu (`value` : `null`, booléen, nombre ou texte).

## Adaptateur → bridge
- `{"t":"view","m":[16],"x","y","z"}` — caméra du jeu et position locale, pour placer les noms.
- `{"t":"target","pid"}` — processus du jeu, `0` = aucun.
- `{"t":"roster","server","players":["nom"]}` — serveur et tous les joueurs, même sans position.
- `{"t":"setRemote","id","name","x","y","z","h"}` — créer/déplacer l'avatar d'un joueur distant.
- `{"t":"removeRemote","id"}`
- `{"t":"log","text"}` — chat / notifications à afficher.
- `{"t":"menu","menu"}` — menu d'un mod à dessiner (forme : docs/MENUS.md) ; `{"t":"menuClose"}` le ferme.
  Les sous-menus sont parcourus dans le bridge.
- `{"t":"notify","title","text","color","seconds"}` — notification à afficher.
- `{"t":"world","minutes","weather","frozen"}` — heure et météo du serveur. Un portage qui sait les appliquer peut
  le faire ; SixM Link les affiche.

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
`npm run overlay-demo` (Windows) : SixM Link ouvre une fausse fenêtre de jeu, s'y attache et rejoint un serveur local
avec le mod `menu` ; F7 ouvre le menu. `SixMLink.exe --render-menu menu.json sortie.png` dessine un menu sans fenêtre.

```bash
npm run sim-bridge    # bridge simulé sur 127.0.0.1:30121
```

## Utilisation
```bash
node client/run.js ws://serveur:30120 MonPseudo victory
```
