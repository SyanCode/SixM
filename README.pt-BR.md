**English** · [Français](README.fr.md) · [Español](README.es.md) · [Deutsch](README.de.md) · [Português](README.pt-BR.md) · [中文](README.zh-CN.md) · [日本語](README.ja.md) · [Русский](README.ru.md)

# SixM

Framework multiplayer / de modding **independente de jogo**, no espírito do FiveM, pensado para GTA VI no PC e projetos de port. Todo o código é original.

## Status (v0.1)

| Componente | Status |
|---|---|
| Servidor dedicado (WebSocket, tick, snapshots, limite de taxa) | ✅ |
| Sistema de recursos (`resource.json`, start/stop/restart, scripts de servidor e cliente) | ✅ |
| API de scripts (`sixm.on`, `onNet`, `emitClient`, `emitAllClients`, `getPlayers`, `kick`) | ✅ |
| Cliente de referência + adaptador simulado + bot de teste | ✅ |
| **Adaptador para um jogo real** (`GameAdapter`) | ⛔ a escrever, veja abaixo |

## Primeiros passos

```bash
npm install
npm start          # servidor em ws://localhost:30120
npm run bot        # (outro terminal) um bot que se move e conversa
npm test
```

Console do servidor: `start|stop|restart <recurso>`, `players`, `resources`, `quit`.

## O que o SixM não faz (e por quê)

- **GTA VI não tem versão oficial para PC nem suporte a mods**, então hoje não há ponto de acoplamento legítimo. `client/adapter.js` define o contrato a implementar quando houver um (API oficial ou projeto de port que permita plugins explicitamente).
- Este repositório **não contém nem conterá** código, assets ou binários da Rockstar, nem vazamentos ou cópias piratas. Não os adicione.
- Os scripts são isolados com `node:vm`, que **não** é um sandbox de segurança: execute apenas recursos confiáveis.

Veja [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) e [docs/PROTOCOL.md](docs/PROTOCOL.md).
