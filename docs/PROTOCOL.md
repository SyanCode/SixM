# Protocole (JSON / WebSocket)

Client → serveur
- `{t:"hello", name, password?, key?, sig?}` — premier message obligatoire (timeout 5 s), en réponse à `challenge`.
  `key` : clé publique Ed25519 du joueur (SPKI DER, base64) ; `sig` : signature de `sixm-hello:<nonce>`.
  L'identifiant du joueur est `sixm:` + les 20 premiers caractères hexadécimaux du SHA-256 de la clé.
  Sans clé ni signature valide, le joueur n'a pas d'identifiant et une liste blanche le refuse.
- `{t:"pos", x,y,z,h}` — position du joueur local
- `{t:"event", name, args[]}` — évènement réseau, reçu côté serveur sous `net:<name>` (`sixm.onNet`)
- `{t:"menuOpen"}` — touche Menu : le serveur répond par son menu principal
- `{t:"menu", menu, item, value?}` — choix dans un menu ; `value` : booléen (case), nombre (liste, curseur) ou texte
  (saisie, 200 caractères)

Serveur → client
- `{t:"challenge", nonce}` — dès la connexion ; un client qui ne le reçoit pas en 1,5 s envoie `hello` sans signature
- `{t:"welcome", id, server, uid, motd, tickRate, resources:[{name,files:[{file,source}]}]}`
- `{t:"roster", players:[{id,name,admin}]}` — tous les joueurs, à chaque arrivée et départ
- `{t:"menu", menu}` — ouvre un menu (forme : docs/MENUS.md) ; `{t:"menuClose"}` le ferme
- `{t:"notify", notice:{title,text,icon,color,seconds}}` — notification d'un mod
- `{t:"world", world:{minutes,weather,frozen}}` — heure et météo, aussi dans `welcome` ; le client avance d'une minute
  toutes les 2 s tant que l'heure n'est pas figée
- `{t:"snapshot", players:[{id,name,pos}]}` — à chaque tick ; limité à `syncRadius` si > 0, et sans les
  joueurs dont la position est encore inconnue. Un joueur absent du snapshot est retiré chez le client.
  `h` est en radians.
- `{t:"event", name, args[]}` — vers les scripts client (`sixm.on`)
- `{t:"kick", reason}` — aussi envoyé à la place de `welcome` en cas de refus (plein, banni, mot de passe)

HTTP, même port : `GET /info.json` (fiche du serveur, avec `visibility`, `whitelist`, `tags`), `GET /players.json`
(`[{id,name}]`, 403 si le serveur est privé).

Réseau local : un serveur public diffuse `{"sixm":1,"port","name"}` en UDP sur le port 30199 toutes les 5 s.

Annuaire (`sixm directory`) : `POST /announce {port}` (l'annuaire lit `info.json` à l'adresse de l'expéditeur et ne
garde que les serveurs publics qui répondent, 3 min sans nouvelle inscription), `GET /servers.json`.

Limites : 64 Kio/message, 200 msg/s/connexion, 5 échecs de mot de passe/min/IP, ping toutes les 15 s, nom nettoyé et tronqué à 24 caractères.
