**English** · [Français](README.fr.md) · [Español](README.es.md) · [Deutsch](README.de.md) · [Português](README.pt-BR.md) · [中文](README.zh-CN.md) · [日本語](README.ja.md) · [Русский](README.ru.md)

# SixM

Framework multijugador / de modding **independiente del juego**, al estilo de FiveM, pensado para GTA VI en PC y proyectos de portado. Todo el código es original.

## Estado (v0.1)

| Componente | Estado |
|---|---|
| Servidor dedicado (WebSocket, tick, snapshots, límite de tasa) | ✅ |
| Sistema de recursos (`resource.json`, start/stop/restart, scripts de servidor y cliente) | ✅ |
| API de scripts (`sixm.on`, `onNet`, `emitClient`, `emitAllClients`, `getPlayers`, `kick`) | ✅ |
| Cliente de referencia + adaptador simulado + bot de prueba | ✅ |
| **Adaptador para un juego real** (`GameAdapter`) | ⛔ por escribir, ver abajo |

## Primeros pasos

```bash
npm install
npm start          # servidor en ws://localhost:30120
npm run bot        # (otra terminal) un bot que se mueve y habla
npm test
```

Consola del servidor: `start|stop|restart <recurso>`, `players`, `resources`, `quit`.

## Lo que SixM no hace (y por qué)

- **GTA VI no tiene versión oficial para PC ni soporte de mods**, así que hoy no existe ningún punto de enganche legítimo. `client/adapter.js` define el contrato que se implementará cuando exista (API oficial o proyecto de portado que permita plugins explícitamente).
- Este repositorio **no contiene ni contendrá** código, assets o binarios de Rockstar, ni filtraciones o copias piratas. No los añadas.
- Los scripts se aíslan con `node:vm`, que **no** es un sandbox de seguridad: ejecuta solo recursos de confianza.

Consulta [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) y [docs/PROTOCOL.md](docs/PROTOCOL.md).
