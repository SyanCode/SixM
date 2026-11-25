**English** · [Français](README.fr.md) · [Español](README.es.md) · [Deutsch](README.de.md) · [Português](README.pt-BR.md) · [中文](README.zh-CN.md) · [日本語](README.ja.md) · [Русский](README.ru.md)

# SixM

A **game-agnostic** multiplayer / modding framework, in the spirit of FiveM, designed for GTA VI on PC and port projects. All code is original.

## Status (v0.1)

| Component | Status |
|---|---|
| Dedicated server (WebSocket, tick, snapshots, rate limiting) | ✅ |
| Resource system (`resource.json`, start/stop/restart, server + client scripts) | ✅ |
| Script API (`sixm.on`, `onNet`, `emitClient`, `emitAllClients`, `getPlayers`, `kick`) | ✅ |
| Reference client + mock adapter + test bot | ✅ |
| `victory` adapter ([VIctory](https://github.com/Marvisak/VIctory)), SixM side + local protocol | ✅ tested against a fake bridge |
| **VIctory-side bridge module** (reads/writes game state) | ⛔ to be written, see [integrations/victory/PROTOCOL.md](integrations/victory/PROTOCOL.md) |

## Getting started

```bash
npm install
npm start          # server on ws://localhost:30120
npm run bot        # (another terminal) a bot that moves and chats
npm test
```

Server console: `start|stop|restart <resource>`, `players`, `resources`, `quit`.

## What SixM does not do (and why)

- **GTA VI has no official PC release or mod support**, so there is currently no legitimate hook point. `client/adapter.js` defines the contract to implement once one exists (official API, or a port project that explicitly allows plugins).
- This repository **contains and will contain no** Rockstar code, assets or binaries, nor leaks or pirated builds. Do not add them.
- Scripts are isolated with `node:vm`, which is **not** a security sandbox: only run trusted resources.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/PROTOCOL.md](docs/PROTOCOL.md).
