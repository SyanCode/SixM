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
