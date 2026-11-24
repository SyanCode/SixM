# Protocole (JSON / WebSocket)

Client → serveur
- `{t:"hello", name}` — premier message obligatoire (timeout 5 s)
- `{t:"pos", x,y,z,h}` — position du joueur local
- `{t:"event", name, args[]}` — évènement réseau, reçu côté serveur sous `net:<name>` (`sixm.onNet`)

Serveur → client
- `{t:"welcome", id, server, tickRate, resources:[{name,files:[{file,source}]}]}`
- `{t:"snapshot", players:[{id,name,pos}]}` — à chaque tick
- `{t:"event", name, args[]}` — vers les scripts client (`sixm.on`)
- `{t:"kick", reason}`

Limites : 64 Kio/message, 200 msg/s/connexion, nom nettoyé et tronqué à 24 caractères.
