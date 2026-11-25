# Protocole (JSON / WebSocket)

Client → serveur
- `{t:"hello", name, password?}` — premier message obligatoire (timeout 5 s)
- `{t:"pos", x,y,z,h}` — position du joueur local
- `{t:"event", name, args[]}` — évènement réseau, reçu côté serveur sous `net:<name>` (`sixm.onNet`)

Serveur → client
- `{t:"welcome", id, server, tickRate, resources:[{name,files:[{file,source}]}]}`
- `{t:"roster", players:[{id,name}]}` — tous les joueurs, à chaque arrivée et départ
- `{t:"snapshot", players:[{id,name,pos}]}` — à chaque tick ; limité à `syncRadius` si > 0, et sans les
  joueurs dont la position est encore inconnue. Un joueur absent du snapshot est retiré chez le client.
  `h` est en radians.
- `{t:"event", name, args[]}` — vers les scripts client (`sixm.on`)
- `{t:"kick", reason}` — aussi envoyé à la place de `welcome` en cas de refus (plein, banni, mot de passe)

HTTP, même port : `GET /info.json` (fiche du serveur), `GET /players.json` (`[{id,name}]`).

Limites : 64 Kio/message, 200 msg/s/connexion, 5 échecs de mot de passe/min/IP, ping toutes les 15 s, nom nettoyé et tronqué à 24 caractères.
