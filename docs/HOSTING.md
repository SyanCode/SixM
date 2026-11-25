# Héberger son serveur

## Depuis l'interface
- **Sur ce PC** : Héberger → Créer un serveur. Le dossier est dans `~/SixM/servers` (`SIXM_HOME` le change).
- **Ailleurs** : Héberger → Télécharger le serveur, ou Partager → Télécharger ce serveur (réglages et mods inclus).
  Dézippez sur la machine, installez Node.js 20.15 ou plus, lancez `start.bat` / `start.sh`, ou utilisez le `Dockerfile`.
  Équivalent en ligne de commande : `node bin/sixm.js pack SixM-Server.zip`.

## Mods
Un mod est un dossier avec un `resource.json` :
```json
{ "name": "accueil", "description": "Message de bienvenue", "server": ["s.js"], "client": ["c.js"] }
```
- Depuis l'interface : onglet Mods, déposez le zip du dossier, puis activez-le.
- À la main : copiez le dossier dans `resources/`. `"autostart": ["*"]` démarre tous les mods présents.

Les joueurs reçoivent la partie client à la connexion : un joueur déjà connecté doit revenir.

## En ligne de commande
```bash
npm install
node bin/sixm.js init ../mon-serveur
node bin/sixm.js start ../mon-serveur     # ou start.bat / start.sh dans ce dossier
```
`npm link` rend la commande `sixm` disponible partout. `start.bat` et `start.sh` contiennent le chemin de
SixM : si vous déplacez SixM, corrigez ce chemin.

## server.json
| Clé | Défaut | Rôle |
|---|---|---|
| `name`, `description` | | affichés dans `info.json` |
| `host` | `null` | adresse d'écoute ; `null` = toutes, `"127.0.0.1"` = cette machine |
| `port` | `30120` | TCP |
| `maxPlayers` | `32` | |
| `password` | `""` | vide = serveur ouvert |
| `tickRate` | `20` | snapshots par seconde |
| `syncRadius` | `0` | distance de synchro, `0` = illimitée |
| `maxConnectionsPerIp` | `16` | |
| `trustProxy` | `false` | lire `X-Forwarded-For` ; uniquement derrière un reverse proxy |
| `resourcesDir`, `autostart` | `"resources"`, `[]` | ressources |
| `bansFile` | `"bans.json"` | bannissements |

`SIXM_PORT` et `SIXM_PASSWORD` priment sur le fichier.

## Ouvrir le serveur aux autres
1. Pare-feu Windows, en PowerShell administrateur :
   `New-NetFirewallRule -DisplayName SixM -Direction Inbound -Protocol TCP -LocalPort 30120 -Action Allow`
2. Box / routeur : rediriger le port TCP 30120 vers la machine.
3. Les joueurs rejoignent avec votre IP publique ou un nom de domaine.

## Rejoindre
```bash
node bin/sixm.js info 203.0.113.7
node bin/sixm.js connect 203.0.113.7:30120 Pseudo
```
Mot de passe : variable `SIXM_PASSWORD`.

## Administrer
Console : `players`, `kick <id>`, `ban <id>`, `bans`, `unban <ip>`, `say <message>`, `resources`,
`start|stop|restart <ressource>`, `info`, `quit`. Les bannissements (par IP) sont gardés dans `bans.json`.

## Sécurité
- `ws://` n'est pas chiffré, mot de passe compris. Sur Internet, placez un reverse proxy TLS devant
  (joueurs en `wss://…`), avec `host: "127.0.0.1"` et `trustProxy: true`.
- Les scripts **client** sont isolés chez les joueurs (QuickJS en WebAssembly).
- Les scripts **serveur** s'exécutent avec les droits de votre machine (`node:vm` n'est pas une sandbox) :
  n'installez que des ressources de confiance.
- Un bannissement par IP se contourne en changeant d'IP et touche tous les joueurs d'un même réseau.
