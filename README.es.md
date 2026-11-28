<!-- Généré par scripts/readme.mjs : modifiez ce fichier-là, puis npm run readme -->
<div align="center">

<img src="app/ui/favicon.svg" width="96" height="96" alt="SixM">

# SixM

**Multijugador, mods y tus propios servidores, en un solo launcher.**

<a href="README.md">English</a> · <a href="README.fr.md">Français</a> · <b>Español</b> · <a href="README.de.md">Deutsch</a> · <a href="README.pt-BR.md">Português</a> · <a href="README.zh-CN.md">中文</a> · <a href="README.ja.md">日本語</a> · <a href="README.ru.md">Русский</a>

[![Release](https://img.shields.io/github/v/release/SyanCode/SixM?label=release&color=f6b83c)](https://github.com/SyanCode/SixM/releases/latest)
[![Tests](https://img.shields.io/github/actions/workflow/status/SyanCode/SixM/release.yml?branch=main&label=tests)](https://github.com/SyanCode/SixM/actions)

### [Descargar para Windows](https://github.com/SyanCode/SixM/releases/latest)

<img src="docs/images/play.jpg" width="49%" alt="Jugar"> <img src="docs/images/host.jpg" width="49%" alt="Alojar">

</div>

SixM es un framework multijugador y de modding independiente del juego, al estilo de FiveM, pensado para GTA VI en PC mediante proyectos de portado como [VIctory](https://github.com/Marvisak/VIctory). Todo el código es original.

## Funciones

| | |
|---|---|
| **Jugar** | Elige un juego y un servidor y pulsa Jugar. Favoritos, chat, jugadores, radar. El modo demo no necesita juego. |
| **VIctory** | Descarga y compila VIctory, o un fork como VIctory Belobug AMD, Tequesta o VIctory-NVIDIA, en tu PC, en una versión fija, con registro en directo. Las actualizaciones son siempre manuales. |
| **Superposición en el juego** | Chat, jugadores, radar y menús de mods sobre la ventana del juego. F7 menú, F8 para escribir, F9 para ocultar. Solo Windows. |
| **Otros jugadores** | Un avatar 3D (modelo, tamaño y color a elegir) y su nombre, dibujados en el mundo en su posición, gracias al módulo de SixM para VIctory. Requiere un perfil local. |
| **Alojar** | Tu servidor en dos clics: público o privado, lista blanca, admins, contraseña, bloqueos, consola. |
| **Menús de mods** | SixM los dibuja a partir de lo que describen los mods: M para abrir, flechas, casillas, listas, deslizadores. Incluye un menú de administración. |
| **Mods** | Suelta un zip y actívalo. Los jugadores lo reciben al conectarse. |
| **Seguridad** | Los scripts que envía un servidor se ejecutan aislados en QuickJS/WebAssembly. |

## Descargar

| Archivo | Para |
|---|---|
| `SixM-Setup` | Instalador. Incluye Node.js, sin permisos de administrador |
| `SixM-portable` | Sin instalación: ejecuta `SixM.exe` |
| `SixM-Server` | Solo el servidor, para alojarlo. Requiere [Node.js](https://nodejs.org) |

El programa no está firmado: Windows SmartScreen puede mostrar un aviso. `SHA256SUMS.txt` contiene las sumas de los archivos.

Desde el código: `SixM.bat` en Windows, o `npm install` y luego `npm run app`. Requiere [Node.js](https://nodejs.org) 20.15 o posterior. Interfaz nativa: `cargo build --release` en `desktop/` (si no, se abre la interfaz web).

## Primeros pasos

1. Instala SixM y ábrelo.
2. **Réglages** (ajustes): instala VIctory y añade la carpeta del juego extraída de tu propio disco.
3. **Jouer** (jugar): elige un servidor y pulsa Jouer. ¿Sin juego? Deja el modo demo.

## Alojar un servidor

En la aplicación: **Héberger → Créer un serveur**. Para mantenerlo en línea, **Télécharger le serveur** da un zip para un VPS, otro PC o Docker. Desde la terminal:

```bash
npm install
node bin/sixm.js init ../my-server
node bin/sixm.js start ../my-server
```

## Estado

| ✅ Funciona | ⛔ Todavía no |
|---|---|
| Servidores, mods, interfaz y chat | Los nombres de los demás jugadores en el juego requieren un perfil de tu versión (no se incluye ninguno); sus personajes están pendientes en el módulo |
| Lanzamiento de VIctory y superposición, probados con un VIctory simulado | VIctory aún no es jugable, según sus autores |
| VIctory compilado y verificado, sin juego | Interfaz solo en francés; sin cifrado si no hay un proxy TLS |

## Lo que SixM no hace

- **No incluye ningún juego ni código de VIctory**, y no modifica archivos del juego. Usa tu propia copia.
- Nada de código o assets de Rockstar, filtraciones ni copias piratas en este repositorio. No los añadas.
- Los scripts de **servidor** tienen acceso a la máquina que los aloja: instala solo mods de confianza.

## Desarrollo

```bash
npm test
npm run bot
npm run sim-bridge
npm run package
```

Las pruebas, el empaquetado y la publicación son automáticos: cambiar la versión en `package.json` publica una versión.

## Documentación

- [Alojamiento y mods](docs/HOSTING.md)
- [Arquitectura](docs/ARCHITECTURE.md)
- [Protocolo de red](docs/PROTOCOL.md)
- [Bridge de VIctory](integrations/victory/PROTOCOL.md)

En francés.

---

<div align="center"><sub>Proyecto independiente, sin relación con Rockstar Games, Take-Two ni VIctory.</sub></div>
