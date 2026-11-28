# Menus des mods

Un mod serveur décrit ses menus en JSON ; SixM les dessine et renvoie les choix du joueur :
- dans la fenêtre de SixM, touche **M** en partie (souris aussi) ;
- dans le jeu, par la surcouche de SixM Link (Windows), touche **F7**. Flèches, Entrée, Retour arrière.

Le menu d'une entrée du menu principal y reste rangé : Retour ramène au menu principal. Quand un mod rouvre son
menu après une action, le joueur reste sur la même page et la même ligne. Dans la fenêtre de SixM, Ctrl+F filtre
la page, la molette fait défiler.

## Le menu principal
Chaque mod y ajoute ses entrées. `open` construit le menu pour ce joueur ; `visible` le réserve à certains.
```js
sixm.addMenu({
  id: 'garage', label: 'Garage', icon: 'car', description: 'Vos véhicules.',
  visible: (player) => true,
  open: (player) => ({
    id: 'garage', title: 'Garage', subtitle: 'Choisissez un véhicule', color: '#2f80ed',
    items: [
      { id: 'sortir', label: 'Sortir le véhicule', icon: 'car' },
      { id: 'couleur', type: 'list', label: 'Couleur', options: ['Noir', 'Blanc', 'Rouge'], value: 0 },
      { id: 'turbo', type: 'checkbox', label: 'Turbo', value: false },
      { id: 'plaque', type: 'input', label: 'Plaque', placeholder: 'SIXM 123', maxLength: 8 },
      { id: 'vendre', label: 'Vendre', confirm: true, badge: 'NOUVEAU', badgeColor: '#30a46c' },
      { id: 'teinte', type: 'slider', label: 'Teinte des vitres', min: 0, max: 100, step: 10, value: 30 },
      { type: 'separator', label: 'Plus' },
      { id: 'options', type: 'submenu', label: 'Options', menu: { id: 'garage:options', title: 'Options', items: [] } },
    ],
  }),
});

sixm.onMenu('garage', (player, item, value) => {
  // bouton : value = null ; case : true/false ; liste : index ; curseur : nombre ; saisie : texte
  if (item === 'vendre') sixm.notify(player.id, { title: 'Garage', text: 'Véhicule vendu', icon: 'money', color: '#30a46c' });
});
```

## Ouvrir un menu à tout moment
`sixm.openMenu(idJoueur, menu)`, `sixm.closeMenu(idJoueur)`. Un menu rouvert avec les mêmes données remplace
l'ancien : c'est ainsi qu'on rafraîchit un menu après une action.

## Forme d'un menu
| Champ | |
|---|---|
| `id` | requis, 48 caractères ; les choix arrivent à `sixm.onMenu(id, …)` |
| `title`, `subtitle` | bandeau et ligne sous le bandeau |
| `color` | `#rrggbb`, couleur du bandeau et de la sélection |
| `items` | 100 au plus |

Ligne : `id`, `label`, `type` (`button` par défaut, `checkbox`, `list`, `slider`, `input`, `separator`, `submenu`),
`description` (affichée sous le menu), `right` (texte à droite), `icon`, `disabled`, `value`, `options` (liste),
`min`/`max`/`step` (curseur), `placeholder`/`maxLength` (saisie, 200 caractères au plus), `badge`/`badgeColor`
(pastille à côté du libellé), `confirm` (il faut valider deux fois : expulser, bannir, vendre…), `menu` (sous-menu,
4 niveaux au plus). Les sous-menus sont parcourus chez le joueur, sans aller-retour ; leurs choix arrivent sous l'`id`
du sous-menu. `open` (racine seulement) : ids des lignes de sous-menu à ouvrir d'emblée.

Icônes : `user`, `users`, `user-plus`, `smiley`, `shield`, `megaphone`, `sign-out`, `prohibit`, `crown`, `car`,
`gear`, `star`, `map`, `money`, `heart`, `wrench`, `lightning`, `music`, `gift`, `house`, `crosshair`, `clock`,
`weather`, `palette`, `target`, `phone`, `briefcase`, `game`, `chat`, `flag`, `check`, `bell`.

## Notifications
`sixm.notify(idJoueur | null, { title, text, icon, color, seconds })` : une carte en haut à droite, chez un joueur ou
chez tous (null). Donnez toujours un retour après une action faite dans un menu.

## Heure et météo
`sixm.getWorld()` et `sixm.setWorld({ minutes, weather, frozen })` : heure (minutes depuis minuit), météo (`clear`,
`clouds`, `rain`, `thunder`, `fog`, `snow`), heure figée. Partagées par tous les joueurs ; une journée dure 48 minutes.
SixM les affiche ; les appliquer dans le jeu revient au portage qui sait le faire.

## Ressources
`sixm.resources.list()` (`[{ name, running }]`), `.start(nom)`, `.stop(nom)`, `.restart(nom)`. Une ressource ne peut
pas s'arrêter elle-même.

## Joueurs et droits
`sixm.getPlayer(id)` et `sixm.getPlayers()` donnent `{ id, name, uid, admin, pos }`. `sixm.isAdmin(id)`,
`sixm.setAdmin(id, true|false)`, `sixm.kick`, `sixm.ban`, `sixm.chat(id|null, texte)`,
`sixm.whitelist.enabled()`, `.add(uid, nom)`, `.remove(uid)`, `.requests()`.

Un client peut envoyer n'importe quel choix, même d'un menu qu'il n'a pas reçu : vérifiez les droits dans `onMenu`
(voir `resources/menu/server.js`).

## Agir sur le jeu des joueurs
`sixm.game` passe par le module SixM compilé dans VIctory, et seulement là où le **profil local** du joueur le permet
(`teleport = on`, lignes `value.<nom>` : integrations/victory/PROTOCOL.md). Sans profil, ou en démo sans ces lignes,
rien n'est permis ; le mode démo simule `teleport`, `noclip` et `invincible` pour essayer les menus.
```js
sixm.game.abilities(id)                    // { teleport: true, values: [{ name: 'noclip', type: 'u8' }] }
sixm.game.teleport(id, { x, y, z, h })     // faux si son jeu ne le permet pas
sixm.game.set(id, 'noclip', 1, { hold: true })  // hold : réécrite à chaque image jusqu'à release
sixm.game.release(id, 'noclip')
sixm.on('gameAbilities', (player) => {})   // ce que son jeu permet a changé (sixm.getPlayer(id).game)
sixm.on('gameResult', (player, { what, ok, error }) => {})  // réponse du jeu à chaque action
```
Recherche mémoire, si le joueur l'a activée dans les réglages de SixM (`sixm.game.abilities(id).scanner`) :
```js
sixm.game.scan(id, { first: true, type: 'f32', test: 'between', a: -5000, b: 5000 })  // puis first: false, test: 'changed'…
sixm.game.poke(id, address, 'u8', 1, { hold: true }); sixm.game.unpoke(id, address)
sixm.game.pointers(id, address)            // chemins stables vers une adresse
sixm.game.saveProfile(id, { key: 'value', name: 'noclip', type: 'u8', chain })  // ou { key: 'position', chain, teleport: true }
sixm.on('gameScan', (player, { busy, progress, type, count, results, error }) => {})
sixm.on('gamePointers', (player, { address, chains }) => {})
```
Le mod `menu` en fait « Recherche mémoire » pour les admins.

`sixm.getPlayer(id)` donne aussi `located` (position connue) et `game` (ce que son jeu permet). Le mod `menu` s'en sert
pour « Mon jeu » (no clip, valeurs du profil, aller vers un joueur) et, dans l'administration, « Aller vers lui » et
« L'amener ici ». Réservez ces actions aux admins : un serveur qui donne le no clip à tous permet de tricher.

## Avatars 3D
La surcouche dessine chaque joueur avec un modèle 3D, à sa position et selon son cap, avec la caméra du jeu (il faut
donc une position et une caméra dans le profil local). Ce n'est pas un personnage du jeu : il n'a pas de collision
et reste visible à travers les murs. Les noms sont affichés au-dessus. Au-delà de 300 m, seul le nom reste.

Un mod fournit des modèles Wavefront OBJ (`resource.json` : `"models": ["models/robot.obj"]`, ou `{ "name", "file" }`).
Unités : mètres, z vers le haut, l'origine au centre du joueur, l'avant vers +y. `usemtl #rrggbb` donne une couleur aux
faces qui suivent ; sans couleur, elles prennent celle du joueur. 4 000 sommets et 6 000 triangles au plus par
modèle, 32 modèles par serveur. Le mod `avatars` en donne un exemple ; `sixm:humain` est le modèle par défaut.
```js
sixm.models()                                   // ['sixm:humain', 'robot']
sixm.setAvatar(id, { model: 'robot', scale: 1.5, color: '#e5484d' })   // échelle de 0,1 à 10
sixm.getPlayer(id).avatar
```
Le mod `menu` le propose dans « Mon profil » : modèle, taille, couleur.

