**English** · [Français](README.fr.md) · [Español](README.es.md) · [Deutsch](README.de.md) · [Português](README.pt-BR.md) · [中文](README.zh-CN.md) · [日本語](README.ja.md) · [Русский](README.ru.md)

# SixM

Ein **spielunabhängiges** Multiplayer-/Modding-Framework im Geiste von FiveM, gedacht für GTA VI auf dem PC und Portierungsprojekte. Der gesamte Code ist eigenständig geschrieben.

## Status (v0.1)

| Baustein | Status |
|---|---|
| Dedizierter Server (WebSocket, Tick, Snapshots, Ratenbegrenzung) | ✅ |
| Ressourcensystem (`resource.json`, start/stop/restart, Server- und Client-Skripte) | ✅ |
| Skript-API (`sixm.on`, `onNet`, `emitClient`, `emitAllClients`, `getPlayers`, `kick`) | ✅ |
| Referenzclient + Mock-Adapter + Testbot | ✅ |
| **Adapter für ein echtes Spiel** (`GameAdapter`) | ⛔ noch zu schreiben, siehe unten |

## Erste Schritte

```bash
npm install
npm start          # Server auf ws://localhost:30120
npm run bot        # (anderes Terminal) ein Bot, der sich bewegt und chattet
npm test
```

Server-Konsole: `start|stop|restart <Ressource>`, `players`, `resources`, `quit`.

## Was SixM nicht tut (und warum)

- **GTA VI hat keine offizielle PC-Version und keine Mod-Unterstützung**, daher gibt es derzeit keinen legitimen Einstiegspunkt. `client/adapter.js` definiert den Vertrag, der implementiert wird, sobald es einen gibt (offizielle API oder Portierungsprojekt, das Plugins ausdrücklich erlaubt).
- Dieses Repository **enthält und enthalten wird keinen** Code, keine Assets oder Binärdateien von Rockstar, keine Leaks und keine Raubkopien. Bitte nicht hinzufügen.
- Skripte werden mit `node:vm` isoliert, das **keine** Sicherheits-Sandbox ist: Führe nur vertrauenswürdige Ressourcen aus.

Siehe [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) und [docs/PROTOCOL.md](docs/PROTOCOL.md).
