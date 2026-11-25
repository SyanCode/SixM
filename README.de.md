<!-- Généré par scripts/readme.mjs : modifiez ce fichier-là, puis npm run readme -->
<div align="center">

<img src="app/ui/favicon.svg" width="96" height="96" alt="SixM">

# SixM

**Mehrspieler, Mods und eigene Server in einem Launcher.**

<a href="README.md">English</a> · <a href="README.fr.md">Français</a> · <a href="README.es.md">Español</a> · <b>Deutsch</b> · <a href="README.pt-BR.md">Português</a> · <a href="README.zh-CN.md">中文</a> · <a href="README.ja.md">日本語</a> · <a href="README.ru.md">Русский</a>

[![Release](https://img.shields.io/github/v/release/SyanCode/SixM?label=release&color=f6b83c)](https://github.com/SyanCode/SixM/releases/latest)
[![Tests](https://img.shields.io/github/actions/workflow/status/SyanCode/SixM/release.yml?branch=main&label=tests)](https://github.com/SyanCode/SixM/actions)

### [Für Windows herunterladen](https://github.com/SyanCode/SixM/releases/latest)

<img src="docs/images/play.jpg" width="49%" alt="Spielen"> <img src="docs/images/host.jpg" width="49%" alt="Hosten">

</div>

SixM ist ein spielunabhängiges Mehrspieler- und Modding-Framework im Geist von FiveM, gedacht für GTA VI auf dem PC über Portierungsprojekte wie [VIctory](https://github.com/Marvisak/VIctory). Der gesamte Code ist eigenständig.

## Funktionen

| | |
|---|---|
| **Spielen** | Spiel und Server wählen, dann starten. Favoriten, Chat, Spieler, Radar. Der Demomodus braucht kein Spiel. |
| **VIctory** | Lädt VIctory herunter und kompiliert es auf deinem PC, in einer festen Version und mit Live-Protokoll. Aktualisiert wird immer von Hand. |
| **Overlay im Spiel** | Chat, Spieler und Radar über dem Spielfenster. F8 zum Schreiben, F9 zum Ausblenden. Nur Windows. |
| **Andere Spieler** | Ihre Namen erscheinen an ihrer Position in der Welt, über das SixM-Modul für VIctory. Benötigt ein lokales Profil. |
| **Hosten** | Dein Server in zwei Klicks: Passwort, Sperren, Konsole, Einstellungen. |
| **Mods** | Zip ablegen, einschalten. Spieler erhalten den Mod beim Verbinden. |
| **Sicherheit** | Vom Server gesendete Skripte laufen isoliert in QuickJS/WebAssembly. |

## Herunterladen

| Datei | Für |
|---|---|
| `SixM-Setup` | Installationsprogramm. Node.js enthalten, ohne Administratorrechte |
| `SixM-portable` | Ohne Installation: `SixM.exe` starten |
| `SixM-Server` | Nur der Server, zum Hosten. Benötigt [Node.js](https://nodejs.org) |

Das Programm ist nicht signiert, Windows SmartScreen kann daher warnen. `SHA256SUMS.txt` enthält die Prüfsummen.

Aus dem Quellcode: `SixM.bat` unter Windows, sonst `npm install` und dann `npm run app`. Benötigt [Node.js](https://nodejs.org) 20.15 oder neuer.

## Erste Schritte

1. SixM installieren und öffnen.
2. **Réglages** (Einstellungen): VIctory installieren, dann den von deiner eigenen Disc extrahierten Spielordner hinzufügen.
3. **Jouer** (Spielen): Server wählen und auf Jouer klicken. Kein Spiel? Im Demomodus bleiben.

## Einen Server hosten

In der App: **Héberger → Créer un serveur**. Damit er online bleibt, liefert **Télécharger le serveur** ein Zip für einen VPS, einen anderen PC oder Docker. Im Terminal:

```bash
npm install
node bin/sixm.js init ../my-server
node bin/sixm.js start ../my-server
```

## Stand

| ✅ Funktioniert | ⛔ Noch nicht |
|---|---|
| Server, Mods, Oberfläche und Chat | Namen anderer Spieler im Spiel brauchen ein Profil für deine Spielversion (keines liegt bei); ihre Figuren fehlen im Modul noch |
| Start von VIctory und Overlay, mit einem simulierten VIctory getestet | VIctory selbst ist laut seinen Autoren noch nicht spielbar |
| VIctory kompiliert und geprüft, ohne Spiel | Oberfläche nur auf Französisch; keine Verschlüsselung ohne TLS-Proxy |

## Was SixM nicht tut

- Es **enthält weder ein Spiel noch Code von VIctory** und verändert keine Spieldateien. Nutze deine eigene Kopie.
- Kein Code und keine Assets von Rockstar, keine Leaks, keine Raubkopien in diesem Repository. Bitte nichts davon hinzufügen.
- **Server**-Skripte haben Zugriff auf den Rechner, der sie hostet: Installiere nur vertrauenswürdige Mods.

## Entwicklung

```bash
npm test
npm run bot
npm run sim-bridge
npm run package
```

Tests, Paketierung und Veröffentlichung laufen automatisch: Eine neue Version in `package.json` löst ein Release aus.

## Dokumentation

- [Hosting und Mods](docs/HOSTING.md)
- [Architektur](docs/ARCHITECTURE.md)
- [Netzwerkprotokoll](docs/PROTOCOL.md)
- [VIctory-Bridge](integrations/victory/PROTOCOL.md)

Auf Französisch.

---

<div align="center"><sub>Unabhängiges Projekt, nicht verbunden mit Rockstar Games, Take-Two oder VIctory.</sub></div>
