**English** · [Français](README.fr.md) · [Español](README.es.md) · [Deutsch](README.de.md) · [Português](README.pt-BR.md) · [中文](README.zh-CN.md) · [日本語](README.ja.md) · [Русский](README.ru.md)

# SixM

A **game-agnostic** multiplayer / modding framework, in the spirit of FiveM, designed for GTA VI on PC and port projects. All code is original.

## Status (v0.2)

| Component | Status |
|---|---|
| Dedicated server (WebSocket, tick, snapshots, rate limiting) | ✅ |
| Resource system (`resource.json`, start/stop/restart, server + client scripts) | ✅ |
| Script API (`sixm.on`, `onNet`, `emitClient`, `emitAllClients`, `getPlayers`, `kick`) | ✅ |
| Self-hosting (`sixm init` / `start`, password, bans, admin console, `info.json`) | ✅ |
| VIctory launcher and in-game overlay (Windows): chat, players, radar | ✅ tested with a fake VIctory |
| VIctory installed and compiled from the interface (pinned commit, manual updates) | ✅ |
| Positions and characters of other players in the game | ⛔ needs a module inside VIctory |
| Client interface: play, host, mods, downloadable server | ✅ (French UI) |
| Client scripts isolated in QuickJS/WebAssembly | ✅ |
| Reference client + mock adapter + test bot | ✅ |
| `victory` adapter ([VIctory](https://github.com/Marvisak/VIctory)), SixM side + local protocol | ✅ tested against a fake bridge |
| **VIctory-side bridge module** (reads/writes game state) | ⛔ to be written, see [integrations/victory/PROTOCOL.md](integrations/victory/PROTOCOL.md) |

## Getting started

Windows: download `SixM-Setup` from the [releases](https://github.com/SyanCode/SixM/releases) (Node.js included, no administrator rights). It is not signed, so SmartScreen may warn. From source: `SixM.bat` ([Node.js](https://nodejs.org) required). Elsewhere: `npm install`, then `npm run app`.

- **Play**: pick a game installation and a server; SixM launches [VIctory](https://github.com/Marvisak/VIctory), then adds chat and players on top (F8 type, F9 hide). Demo mode without a game.
- **Settings**: path to `victory.exe` and the game folder extracted from your disc. SixM ships neither VIctory nor the game.
- **Host**: a server on this PC in two clicks, mods by dropping a zip.
- **Download the server**: self-contained zip for a VPS, another PC or Docker.

Command line:

```bash
npm install
node bin/sixm.js init ../my-server    # create your own server, then: node bin/sixm.js start ../my-server
npm start          # demo server on ws://localhost:30120
npm run bot        # (another terminal) a bot that moves and chats
npm test
```

Hosting guide (French): [docs/HOSTING.md](docs/HOSTING.md). Server console: type `help`.

## What SixM does not do (and why)

- **GTA VI has no official PC release or mod support**, so there is currently no legitimate hook point. `client/adapter.js` defines the contract to implement once one exists (official API, or a port project that explicitly allows plugins).
- This repository **contains and will contain no** Rockstar code, assets or binaries, nor leaks or pirated builds. Do not add them.
- **Server** scripts run in `node:vm`, which is **not** a security sandbox: hosts must only install trusted resources.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/PROTOCOL.md](docs/PROTOCOL.md).
