# Menus des mods

Un mod serveur décrit ses menus en JSON ; SixM les dessine (fenêtre de SixM, touche **M** en partie) et renvoie les
choix du joueur. Le joueur navigue avec les flèches, Entrée, Retour arrière ; la souris marche aussi.

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
      { id: 'teinte', type: 'slider', label: 'Teinte des vitres', min: 0, max: 100, step: 10, value: 30 },
      { type: 'separator', label: 'Plus' },
      { id: 'options', type: 'submenu', label: 'Options', menu: { id: 'garage:options', title: 'Options', items: [] } },
    ],
  }),
});

sixm.onMenu('garage', (player, item, value) => {
  // bouton : value = null ; case : true/false ; liste : index ; curseur : nombre
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

Ligne : `id`, `label`, `type` (`button` par défaut, `checkbox`, `list`, `slider`, `separator`, `submenu`),
`description` (affichée sous le menu), `right` (texte à droite), `icon`, `disabled`, `value`, `options` (liste),
`min`/`max`/`step` (curseur), `menu` (sous-menu, 4 niveaux au plus). Les sous-menus sont parcourus chez le joueur,
sans aller-retour ; leurs choix arrivent sous l'`id` du sous-menu.

Icônes : `user`, `users`, `user-plus`, `smiley`, `shield`, `megaphone`, `sign-out`, `prohibit`, `crown`, `car`,
`gear`, `star`, `map`, `money`, `heart`, `wrench`, `lightning`, `music`, `gift`, `house`, `crosshair`, `clock`,
`weather`, `palette`, `target`, `phone`, `briefcase`, `game`.

## Joueurs et droits
`sixm.getPlayer(id)` et `sixm.getPlayers()` donnent `{ id, name, uid, admin, pos }`. `sixm.isAdmin(id)`,
`sixm.setAdmin(id, true|false)`, `sixm.kick`, `sixm.ban`, `sixm.chat(id|null, texte)`,
`sixm.whitelist.enabled()`, `.add(uid, nom)`, `.remove(uid)`, `.requests()`.

Un client peut envoyer n'importe quel choix, même d'un menu qu'il n'a pas reçu : vérifiez les droits dans `onMenu`
(voir `resources/menu/server.js`).
