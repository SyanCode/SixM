<!-- Généré par scripts/readme.mjs : modifiez ce fichier-là, puis npm run readme -->
<div align="center">

<img src="app/ui/favicon.svg" width="96" height="96" alt="SixM">

# SixM

**Мультиплеер, моды и свои серверы в одном лаунчере.**

<a href="README.md">English</a> · <a href="README.fr.md">Français</a> · <a href="README.es.md">Español</a> · <a href="README.de.md">Deutsch</a> · <a href="README.pt-BR.md">Português</a> · <a href="README.zh-CN.md">中文</a> · <a href="README.ja.md">日本語</a> · <b>Русский</b>

[![Release](https://img.shields.io/github/v/release/SyanCode/SixM?label=release&color=f6b83c)](https://github.com/SyanCode/SixM/releases/latest)
[![Tests](https://img.shields.io/github/actions/workflow/status/SyanCode/SixM/release.yml?branch=main&label=tests)](https://github.com/SyanCode/SixM/actions)

### [Скачать для Windows](https://github.com/SyanCode/SixM/releases/latest)

<img src="docs/images/play.jpg" width="49%" alt="Игра"> <img src="docs/images/host.jpg" width="49%" alt="Хостинг">

</div>

SixM — не зависящий от игры фреймворк для мультиплеера и моддинга в духе FiveM, рассчитанный на GTA VI на ПК через проекты портирования, такие как [VIctory](https://github.com/Marvisak/VIctory). Весь код оригинальный.

## Возможности

| | |
|---|---|
| **Игра** | Выберите игру и сервер и начинайте. Избранное, чат, игроки, радар. Демо-режим работает без игры. |
| **VIctory** | Скачивает и компилирует VIctory или его форк, например VIctory Belobug AMD, Tequesta или VIctory-NVIDIA, на вашем ПК в закреплённой версии, с журналом в реальном времени. Обновление только вручную. |
| **Оверлей в игре** | Чат, игроки, радар и меню модов поверх окна игры. F7 — меню, F8 — писать, F9 — скрыть. Только Windows. |
| **Другие игроки** | 3D-аватар (модель, размер и цвет на выбор) и имя, нарисованные в мире на своих местах, через модуль SixM для VIctory. Нужен локальный профиль. |
| **Хостинг** | Свой сервер в два клика: публичный или приватный, белый список, админы, пароль, баны, консоль. |
| **Меню модов** | SixM рисует их по описанию модов: M — открыть, стрелки, флажки, списки, ползунки. Есть меню администратора. |
| **Моды** | Перетащите zip и включите. Игроки получат мод при подключении. |
| **Безопасность** | Скрипты, присланные сервером, изолированы в QuickJS/WebAssembly. |

## Скачать

| Файл | Назначение |
|---|---|
| `SixM-Setup` | Установщик. Node.js включён, права администратора не нужны |
| `SixM-portable` | Без установки: запустите `SixM.exe` |
| `SixM-Server` | Только сервер, для хостинга. Нужен [Node.js](https://nodejs.org) |

Программа не подписана, поэтому Windows SmartScreen может показать предупреждение. Контрольные суммы — в `SHA256SUMS.txt`.

Из исходников: `SixM.bat` в Windows, иначе `npm install`, затем `npm run app`. Нужен [Node.js](https://nodejs.org) 20.15 или новее. Нативный интерфейс: `cargo build --release` в `desktop/` (иначе откроется веб-интерфейс).

## Начало работы

1. Установите и откройте SixM.
2. **Réglages** (настройки): установите VIctory и добавьте папку игры, извлечённую с вашего собственного диска.
3. **Jouer** (играть): выберите сервер и нажмите Jouer. Нет игры? Оставьте демо-режим.

## Свой сервер

В приложении: **Héberger → Créer un serveur**. Чтобы сервер работал постоянно, **Télécharger le serveur** создаёт zip для VPS, другого ПК или Docker. Из терминала:

```bash
npm install
node bin/sixm.js init ../my-server
node bin/sixm.js start ../my-server
```

## Состояние

| ✅ Работает | ⛔ Пока нет |
|---|---|
| Серверы, моды, интерфейс и чат | Имена других игроков в игре требуют профиля для вашей версии (не поставляется); персонажи в модуле ещё не сделаны |
| Запуск VIctory и оверлей, проверены с имитацией VIctory | По словам авторов, сам VIctory пока не играбелен |
| VIctory скомпилирован и проверен, без игры | Интерфейс только на французском; без TLS-прокси нет шифрования |

## Чего SixM не делает

- **Не содержит ни игры, ни кода VIctory** и не меняет файлы игры. Используйте собственную копию.
- В репозитории нет кода и ассетов Rockstar, утечек и пиратских сборок. Не добавляйте их.
- **Серверные** скрипты имеют доступ к машине, на которой работают: ставьте только моды, которым доверяете.

## Разработка

```bash
npm test
npm run bot
npm run sim-bridge
npm run package
```

Тесты, сборка и публикация автоматические: смена версии в `package.json` выпускает релиз.

## Документация

- [Хостинг и моды](docs/HOSTING.md)
- [Архитектура](docs/ARCHITECTURE.md)
- [Сетевой протокол](docs/PROTOCOL.md)
- [Мост VIctory](integrations/victory/PROTOCOL.md)

На французском.

---

<div align="center"><sub>Независимый проект, не связан с Rockstar Games, Take-Two или VIctory.</sub></div>
