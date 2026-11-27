// Génère les README de toutes les langues depuis un seul modèle : npm run readme
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = 'https://github.com/SyanCode/SixM';
const VICTORY = '[VIctory](https://github.com/Marvisak/VIctory)';
const NODE = '[Node.js](https://nodejs.org)';

export const LANGUAGES = {
  en: {
    file: 'README.md', label: 'English',
    tagline: 'Multiplayer, mods and your own servers, in one launcher.',
    intro: `SixM is a game-agnostic multiplayer and modding framework in the spirit of FiveM, designed for GTA VI on PC through port projects such as ${VICTORY}. All code is original.`,
    download: 'Download', downloadCta: 'Download for Windows',
    files: { head: ['File', 'For'], setup: 'Installer. Node.js included, no administrator rights', portable: 'No installation: run `SixM.exe`', server: `Server only, for hosting. Needs ${NODE}` },
    unsigned: 'The program is not signed, so Windows SmartScreen may show a warning. `SHA256SUMS.txt` lists the file checksums.',
    source: `From source: \`SixM.bat\` on Windows, or \`npm install\` then \`npm run app\`. Needs ${NODE} 20.15 or later. Native interface: \`cargo build --release\` in \`desktop/\` (otherwise the web interface opens).`,
    features: 'Features',
    feature: [
      ['Play', 'Pick a game and a server, then press Play. Favourites, chat, players, radar. A demo mode needs no game.'],
      ['VIctory', 'Downloads and compiles VIctory, or a fork such as VIctory Belobug AMD, Tequesta or VIctory-NVIDIA, on your PC, at a pinned version, with a live log. Updates are always manual.'],
      ['In-game overlay', 'Chat, players, radar and mod menus on top of the game window. F7 menu, F8 to type, F9 to hide. Windows only.'],
      ['Other players', 'Their names appear in the world, at their position, through SixM\'s module for VIctory. Needs a local profile.'],
      ['Host', 'Your server in two clicks: public or private, whitelist, admins, password, bans, console.'],
      ['Mod menus', 'Drawn by SixM from what mods describe: M to open, arrows, checkboxes, lists, sliders. An admin menu is included.'],
      ['Mods', 'Drop a zip, switch it on. Players receive it when they connect.'],
      ['Safety', 'Scripts sent by a server run isolated in QuickJS/WebAssembly.'],
    ],
    start: 'Getting started',
    steps: ['Install SixM and open it.', '**Réglages** (settings): install VIctory, then add the game folder extracted from your own disc.', '**Jouer** (play): choose a server and press Jouer. No game? Keep the demo mode.'],
    host: 'Host a server', hostText: 'In the app: **Héberger → Créer un serveur**. To keep it online, **Télécharger le serveur** gives a zip for a VPS, another PC or Docker. From a terminal:',
    status: 'Status', works: 'Works', missing: 'Not yet',
    working: ['Servers, mods, interface and chat', 'Launching VIctory and the overlay, tested with a fake VIctory', 'VIctory compiled and checked, without a game'],
    lacking: ['Other players\' names in the game need a profile for your game version (none is provided); their characters need more work in the module', 'VIctory itself is not playable yet, according to its authors', 'Interface in French only; no encryption without a TLS proxy'],
    limits: 'What SixM does not do',
    limit: ['It **ships no game and no VIctory code**, and modifies no game file. Use your own copy.', 'No Rockstar code or assets, no leaks, no pirated builds in this repository. Do not add any.', '**Server** scripts have access to the machine that hosts them: install only mods you trust.'],
    dev: 'Development', devNote: 'Tests, packaging and releases are automatic: changing the version in `package.json` publishes a release.',
    docs: 'Documentation', doc: ['Hosting and mods', 'Architecture', 'Network protocol', 'VIctory bridge'], docsNote: 'In French.',
    independent: 'Independent project, not affiliated with Rockstar Games, Take-Two or VIctory.',
  },
  fr: {
    file: 'README.fr.md', label: 'Français',
    tagline: 'Le multijoueur, les mods et vos serveurs, dans un seul launcher.',
    intro: `SixM est un framework multijoueur et modding agnostique du jeu, dans l'esprit de FiveM, pensé pour GTA VI sur PC via des projets de portage comme ${VICTORY}. Tout le code est original.`,
    download: 'Télécharger', downloadCta: 'Télécharger pour Windows',
    files: { head: ['Fichier', 'Pour'], setup: 'Installateur. Node.js inclus, sans droits d\'administrateur', portable: 'Sans installation : lancez `SixM.exe`', server: `Serveur seul, pour un hébergement. Demande ${NODE}` },
    unsigned: 'Le programme n\'est pas signé : Windows SmartScreen peut afficher un avertissement. `SHA256SUMS.txt` donne les empreintes des fichiers.',
    source: `Depuis le code : \`SixM.bat\` sous Windows, sinon \`npm install\` puis \`npm run app\`. Demande ${NODE} 20.15 ou plus. Interface native : \`cargo build --release\` dans \`desktop/\` (sinon l'interface web s'ouvre).`,
    features: 'Fonctionnalités',
    feature: [
      ['Jouer', 'Choisissez un jeu et un serveur, puis Jouer. Favoris, chat, joueurs, radar. Un mode démo marche sans jeu.'],
      ['VIctory', 'Télécharge et compile VIctory, ou un fork comme VIctory Belobug AMD, Tequesta ou VIctory-NVIDIA, sur votre PC, à une version précise, avec journal en direct. Mise à jour toujours manuelle.'],
      ['Surcouche en jeu', 'Chat, joueurs, radar et menus des mods par-dessus la fenêtre du jeu. F7 menu, F8 pour écrire, F9 pour masquer. Windows seulement.'],
      ['Autres joueurs', 'Leurs noms apparaissent dans le monde, à leur place, grâce au module SixM pour VIctory. Demande un profil local.'],
      ['Héberger', 'Votre serveur en deux clics : public ou privé, liste blanche, admins, mot de passe, bannissements, console.'],
      ['Menus des mods', 'Dessinés par SixM d\'après ce que décrivent les mods : M pour ouvrir, flèches, cases, listes, curseurs. Un menu d\'administration est fourni.'],
      ['Mods', 'Déposez un zip, activez-le. Les joueurs le reçoivent en se connectant.'],
      ['Sécurité', 'Les scripts envoyés par un serveur tournent isolés dans QuickJS/WebAssembly.'],
    ],
    start: 'Démarrage',
    steps: ['Installez SixM et ouvrez-le.', '**Réglages** : installez VIctory, puis ajoutez le dossier du jeu extrait de votre propre disque.', '**Jouer** : choisissez un serveur et cliquez sur Jouer. Pas de jeu ? Gardez le mode démo.'],
    host: 'Héberger un serveur', hostText: 'Dans l\'application : **Héberger → Créer un serveur**. Pour qu\'il reste en ligne, **Télécharger le serveur** donne un zip pour un VPS, un autre PC ou Docker. En ligne de commande :',
    status: 'État', works: 'Fonctionne', missing: 'Pas encore',
    working: ['Serveurs, mods, interface et chat', 'Lancement de VIctory et surcouche, testés avec un faux VIctory', 'VIctory compilé et vérifié, sans jeu'],
    lacking: ['Les noms des autres joueurs dans le jeu demandent un profil de votre version du jeu (aucun n\'est fourni) ; leurs personnages restent à faire dans le module', 'VIctory lui-même n\'est pas encore jouable, selon ses auteurs', 'Interface en français seulement ; pas de chiffrement sans proxy TLS'],
    limits: 'Ce que SixM ne fait pas',
    limit: ['Il **ne fournit ni jeu ni code de VIctory** et ne modifie aucun fichier du jeu. Utilisez votre propre copie.', 'Ni code ni assets Rockstar, ni fuites, ni builds piratés dans ce dépôt. N\'en ajoutez pas.', 'Les scripts **serveur** ont accès à la machine qui les héberge : n\'installez que des mods de confiance.'],
    dev: 'Développement', devNote: 'Tests, empaquetage et publication sont automatiques : changer la version dans `package.json` publie une version.',
    docs: 'Documentation', doc: ['Hébergement et mods', 'Architecture', 'Protocole réseau', 'Bridge VIctory'], docsNote: '',
    independent: 'Projet indépendant, sans lien avec Rockstar Games, Take-Two ou VIctory.',
  },
  es: {
    file: 'README.es.md', label: 'Español',
    tagline: 'Multijugador, mods y tus propios servidores, en un solo launcher.',
    intro: `SixM es un framework multijugador y de modding independiente del juego, al estilo de FiveM, pensado para GTA VI en PC mediante proyectos de portado como ${VICTORY}. Todo el código es original.`,
    download: 'Descargar', downloadCta: 'Descargar para Windows',
    files: { head: ['Archivo', 'Para'], setup: 'Instalador. Incluye Node.js, sin permisos de administrador', portable: 'Sin instalación: ejecuta `SixM.exe`', server: `Solo el servidor, para alojarlo. Requiere ${NODE}` },
    unsigned: 'El programa no está firmado: Windows SmartScreen puede mostrar un aviso. `SHA256SUMS.txt` contiene las sumas de los archivos.',
    source: `Desde el código: \`SixM.bat\` en Windows, o \`npm install\` y luego \`npm run app\`. Requiere ${NODE} 20.15 o posterior. Interfaz nativa: \`cargo build --release\` en \`desktop/\` (si no, se abre la interfaz web).`,
    features: 'Funciones',
    feature: [
      ['Jugar', 'Elige un juego y un servidor y pulsa Jugar. Favoritos, chat, jugadores, radar. El modo demo no necesita juego.'],
      ['VIctory', 'Descarga y compila VIctory, o un fork como VIctory Belobug AMD, Tequesta o VIctory-NVIDIA, en tu PC, en una versión fija, con registro en directo. Las actualizaciones son siempre manuales.'],
      ['Superposición en el juego', 'Chat, jugadores, radar y menús de mods sobre la ventana del juego. F7 menú, F8 para escribir, F9 para ocultar. Solo Windows.'],
      ['Otros jugadores', 'Sus nombres aparecen en el mundo, en su posición, gracias al módulo de SixM para VIctory. Requiere un perfil local.'],
      ['Alojar', 'Tu servidor en dos clics: público o privado, lista blanca, admins, contraseña, bloqueos, consola.'],
      ['Menús de mods', 'SixM los dibuja a partir de lo que describen los mods: M para abrir, flechas, casillas, listas, deslizadores. Incluye un menú de administración.'],
      ['Mods', 'Suelta un zip y actívalo. Los jugadores lo reciben al conectarse.'],
      ['Seguridad', 'Los scripts que envía un servidor se ejecutan aislados en QuickJS/WebAssembly.'],
    ],
    start: 'Primeros pasos',
    steps: ['Instala SixM y ábrelo.', '**Réglages** (ajustes): instala VIctory y añade la carpeta del juego extraída de tu propio disco.', '**Jouer** (jugar): elige un servidor y pulsa Jouer. ¿Sin juego? Deja el modo demo.'],
    host: 'Alojar un servidor', hostText: 'En la aplicación: **Héberger → Créer un serveur**. Para mantenerlo en línea, **Télécharger le serveur** da un zip para un VPS, otro PC o Docker. Desde la terminal:',
    status: 'Estado', works: 'Funciona', missing: 'Todavía no',
    working: ['Servidores, mods, interfaz y chat', 'Lanzamiento de VIctory y superposición, probados con un VIctory simulado', 'VIctory compilado y verificado, sin juego'],
    lacking: ['Los nombres de los demás jugadores en el juego requieren un perfil de tu versión (no se incluye ninguno); sus personajes están pendientes en el módulo', 'VIctory aún no es jugable, según sus autores', 'Interfaz solo en francés; sin cifrado si no hay un proxy TLS'],
    limits: 'Lo que SixM no hace',
    limit: ['**No incluye ningún juego ni código de VIctory**, y no modifica archivos del juego. Usa tu propia copia.', 'Nada de código o assets de Rockstar, filtraciones ni copias piratas en este repositorio. No los añadas.', 'Los scripts de **servidor** tienen acceso a la máquina que los aloja: instala solo mods de confianza.'],
    dev: 'Desarrollo', devNote: 'Las pruebas, el empaquetado y la publicación son automáticos: cambiar la versión en `package.json` publica una versión.',
    docs: 'Documentación', doc: ['Alojamiento y mods', 'Arquitectura', 'Protocolo de red', 'Bridge de VIctory'], docsNote: 'En francés.',
    independent: 'Proyecto independiente, sin relación con Rockstar Games, Take-Two ni VIctory.',
  },
  de: {
    file: 'README.de.md', label: 'Deutsch',
    tagline: 'Mehrspieler, Mods und eigene Server in einem Launcher.',
    intro: `SixM ist ein spielunabhängiges Mehrspieler- und Modding-Framework im Geist von FiveM, gedacht für GTA VI auf dem PC über Portierungsprojekte wie ${VICTORY}. Der gesamte Code ist eigenständig.`,
    download: 'Herunterladen', downloadCta: 'Für Windows herunterladen',
    files: { head: ['Datei', 'Für'], setup: 'Installationsprogramm. Node.js enthalten, ohne Administratorrechte', portable: 'Ohne Installation: `SixM.exe` starten', server: `Nur der Server, zum Hosten. Benötigt ${NODE}` },
    unsigned: 'Das Programm ist nicht signiert, Windows SmartScreen kann daher warnen. `SHA256SUMS.txt` enthält die Prüfsummen.',
    source: `Aus dem Quellcode: \`SixM.bat\` unter Windows, sonst \`npm install\` und dann \`npm run app\`. Benötigt ${NODE} 20.15 oder neuer. Native Oberfläche: \`cargo build --release\` in \`desktop/\` (sonst öffnet sich die Weboberfläche).`,
    features: 'Funktionen',
    feature: [
      ['Spielen', 'Spiel und Server wählen, dann starten. Favoriten, Chat, Spieler, Radar. Der Demomodus braucht kein Spiel.'],
      ['VIctory', 'Lädt VIctory oder einen Fork wie VIctory Belobug AMD, Tequesta oder VIctory-NVIDIA herunter und kompiliert ihn auf deinem PC, in einer festen Version und mit Live-Protokoll. Aktualisiert wird immer von Hand.'],
      ['Overlay im Spiel', 'Chat, Spieler, Radar und Mod-Menüs über dem Spielfenster. F7 Menü, F8 zum Schreiben, F9 zum Ausblenden. Nur Windows.'],
      ['Andere Spieler', 'Ihre Namen erscheinen an ihrer Position in der Welt, über das SixM-Modul für VIctory. Benötigt ein lokales Profil.'],
      ['Hosten', 'Dein Server in zwei Klicks: öffentlich oder privat, Whitelist, Admins, Passwort, Sperren, Konsole.'],
      ['Mod-Menüs', 'Von SixM gezeichnet, nach der Beschreibung der Mods: M zum Öffnen, Pfeiltasten, Kästchen, Listen, Schieberegler. Ein Admin-Menü ist dabei.'],
      ['Mods', 'Zip ablegen, einschalten. Spieler erhalten den Mod beim Verbinden.'],
      ['Sicherheit', 'Vom Server gesendete Skripte laufen isoliert in QuickJS/WebAssembly.'],
    ],
    start: 'Erste Schritte',
    steps: ['SixM installieren und öffnen.', '**Réglages** (Einstellungen): VIctory installieren, dann den von deiner eigenen Disc extrahierten Spielordner hinzufügen.', '**Jouer** (Spielen): Server wählen und auf Jouer klicken. Kein Spiel? Im Demomodus bleiben.'],
    host: 'Einen Server hosten', hostText: 'In der App: **Héberger → Créer un serveur**. Damit er online bleibt, liefert **Télécharger le serveur** ein Zip für einen VPS, einen anderen PC oder Docker. Im Terminal:',
    status: 'Stand', works: 'Funktioniert', missing: 'Noch nicht',
    working: ['Server, Mods, Oberfläche und Chat', 'Start von VIctory und Overlay, mit einem simulierten VIctory getestet', 'VIctory kompiliert und geprüft, ohne Spiel'],
    lacking: ['Namen anderer Spieler im Spiel brauchen ein Profil für deine Spielversion (keines liegt bei); ihre Figuren fehlen im Modul noch', 'VIctory selbst ist laut seinen Autoren noch nicht spielbar', 'Oberfläche nur auf Französisch; keine Verschlüsselung ohne TLS-Proxy'],
    limits: 'Was SixM nicht tut',
    limit: ['Es **enthält weder ein Spiel noch Code von VIctory** und verändert keine Spieldateien. Nutze deine eigene Kopie.', 'Kein Code und keine Assets von Rockstar, keine Leaks, keine Raubkopien in diesem Repository. Bitte nichts davon hinzufügen.', '**Server**-Skripte haben Zugriff auf den Rechner, der sie hostet: Installiere nur vertrauenswürdige Mods.'],
    dev: 'Entwicklung', devNote: 'Tests, Paketierung und Veröffentlichung laufen automatisch: Eine neue Version in `package.json` löst ein Release aus.',
    docs: 'Dokumentation', doc: ['Hosting und Mods', 'Architektur', 'Netzwerkprotokoll', 'VIctory-Bridge'], docsNote: 'Auf Französisch.',
    independent: 'Unabhängiges Projekt, nicht verbunden mit Rockstar Games, Take-Two oder VIctory.',
  },
  'pt-BR': {
    file: 'README.pt-BR.md', label: 'Português',
    tagline: 'Multiplayer, mods e seus próprios servidores em um só launcher.',
    intro: `SixM é um framework de multiplayer e modding independente do jogo, no espírito do FiveM, pensado para GTA VI no PC por meio de projetos de port como o ${VICTORY}. Todo o código é original.`,
    download: 'Baixar', downloadCta: 'Baixar para Windows',
    files: { head: ['Arquivo', 'Para'], setup: 'Instalador. Inclui Node.js, sem permissão de administrador', portable: 'Sem instalação: execute `SixM.exe`', server: `Somente o servidor, para hospedagem. Requer ${NODE}` },
    unsigned: 'O programa não é assinado: o Windows SmartScreen pode exibir um aviso. `SHA256SUMS.txt` traz as somas de verificação.',
    source: `A partir do código: \`SixM.bat\` no Windows, ou \`npm install\` e depois \`npm run app\`. Requer ${NODE} 20.15 ou mais recente. Interface nativa: \`cargo build --release\` em \`desktop/\` (senão abre a interface web).`,
    features: 'Recursos',
    feature: [
      ['Jogar', 'Escolha um jogo e um servidor e clique em Jogar. Favoritos, chat, jogadores, radar. O modo demo não precisa de jogo.'],
      ['VIctory', 'Baixa e compila o VIctory, ou um fork como o VIctory Belobug AMD, o Tequesta ou o VIctory-NVIDIA, no seu PC, em uma versão fixa, com registro ao vivo. As atualizações são sempre manuais.'],
      ['Sobreposição no jogo', 'Chat, jogadores, radar e menus de mods sobre a janela do jogo. F7 menu, F8 para escrever, F9 para ocultar. Somente Windows.'],
      ['Outros jogadores', 'Os nomes aparecem no mundo, na posição deles, pelo módulo do SixM para o VIctory. Requer um perfil local.'],
      ['Hospedar', 'Seu servidor em dois cliques: público ou privado, lista branca, admins, senha, banimentos, console.'],
      ['Menus de mods', 'Desenhados pelo SixM a partir do que os mods descrevem: M para abrir, setas, caixas, listas, controles deslizantes. Inclui um menu de administração.'],
      ['Mods', 'Solte um zip e ative. Os jogadores recebem ao se conectar.'],
      ['Segurança', 'Os scripts enviados por um servidor rodam isolados em QuickJS/WebAssembly.'],
    ],
    start: 'Primeiros passos',
    steps: ['Instale o SixM e abra.', '**Réglages** (ajustes): instale o VIctory e adicione a pasta do jogo extraída do seu próprio disco.', '**Jouer** (jogar): escolha um servidor e clique em Jouer. Sem jogo? Fique no modo demo.'],
    host: 'Hospedar um servidor', hostText: 'No aplicativo: **Héberger → Créer un serveur**. Para mantê-lo no ar, **Télécharger le serveur** gera um zip para um VPS, outro PC ou Docker. Pelo terminal:',
    status: 'Situação', works: 'Funciona', missing: 'Ainda não',
    working: ['Servidores, mods, interface e chat', 'Inicialização do VIctory e sobreposição, testadas com um VIctory simulado', 'VIctory compilado e verificado, sem jogo'],
    lacking: ['Os nomes dos outros jogadores no jogo exigem um perfil da sua versão (nenhum é fornecido); os personagens ainda faltam no módulo', 'O próprio VIctory ainda não é jogável, segundo seus autores', 'Interface somente em francês; sem criptografia se não houver um proxy TLS'],
    limits: 'O que o SixM não faz',
    limit: ['**Não inclui jogo nem código do VIctory** e não modifica arquivos do jogo. Use sua própria cópia.', 'Nada de código ou assets da Rockstar, vazamentos ou cópias piratas neste repositório. Não adicione.', 'Os scripts de **servidor** têm acesso à máquina que os hospeda: instale apenas mods confiáveis.'],
    dev: 'Desenvolvimento', devNote: 'Testes, empacotamento e publicação são automáticos: mudar a versão em `package.json` publica uma versão.',
    docs: 'Documentação', doc: ['Hospedagem e mods', 'Arquitetura', 'Protocolo de rede', 'Bridge do VIctory'], docsNote: 'Em francês.',
    independent: 'Projeto independente, sem vínculo com Rockstar Games, Take-Two ou VIctory.',
  },
  'zh-CN': {
    file: 'README.zh-CN.md', label: '中文',
    tagline: '多人联机、模组和自建服务器，尽在一个启动器。',
    intro: `SixM 是一个与游戏无关的多人联机和模组框架，理念类似 FiveM，面向通过 ${VICTORY} 等移植项目在 PC 上运行的 GTA VI。全部代码均为原创。`,
    download: '下载', downloadCta: '下载 Windows 版',
    files: { head: ['文件', '用途'], setup: '安装程序。内含 Node.js，无需管理员权限', portable: '免安装：运行 `SixM.exe`', server: `仅服务器，用于托管。需要 ${NODE}` },
    unsigned: '程序未签名，Windows SmartScreen 可能会发出警告。`SHA256SUMS.txt` 列出了文件校验和。',
    source: `从源码运行：Windows 上使用 \`SixM.bat\`，其他系统先 \`npm install\` 再 \`npm run app\`。需要 ${NODE} 20.15 或更高版本。原生界面：在 \`desktop/\` 中运行 \`cargo build --release\`（否则打开网页界面）。`,
    features: '功能',
    feature: [
      ['游玩', '选择游戏和服务器，然后开始。收藏、聊天、玩家列表、雷达。演示模式无需游戏。'],
      ['VIctory', '在你的电脑上下载并编译固定版本的 VIctory 或其分支（如 VIctory Belobug AMD、Tequesta 或 VIctory-NVIDIA），实时显示日志。更新始终由你手动触发。'],
      ['游戏内覆盖层', '在游戏窗口上显示聊天、玩家、雷达和模组菜单。F7 菜单，F8 输入，F9 隐藏。仅限 Windows。'],
      ['其他玩家', '通过 SixM 的 VIctory 模块，在游戏世界中按位置显示其他玩家的名字。需要本地配置文件。'],
      ['托管', '两次点击即可开服：公开或私有、白名单、管理员、密码、封禁、控制台。'],
      ['模组菜单', '由 SixM 根据模组的描述绘制：按 M 打开，方向键、复选框、列表、滑块。附带管理菜单。'],
      ['模组', '拖入 zip 并启用，玩家连接时自动获取。'],
      ['安全', '服务器下发的脚本在 QuickJS/WebAssembly 中隔离运行。'],
    ],
    start: '快速开始',
    steps: ['安装并打开 SixM。', '**Réglages**（设置）：安装 VIctory，然后添加从你自己的光盘提取的游戏文件夹。', '**Jouer**（游玩）：选择服务器并点击 Jouer。没有游戏？保持演示模式即可。'],
    host: '托管服务器', hostText: '在应用中：**Héberger → Créer un serveur**。若要长期在线，**Télécharger le serveur** 会生成可用于 VPS、其他电脑或 Docker 的 zip。命令行：',
    status: '状态', works: '可用', missing: '尚不支持',
    working: ['服务器、模组、界面和聊天', '启动 VIctory 与覆盖层，已用模拟的 VIctory 测试', 'VIctory 已编译并检查，未运行游戏'],
    lacking: ['游戏内显示其他玩家的名字需要对应游戏版本的配置文件（不提供）；角色仍待模块实现', '据其作者称，VIctory 本身尚不可玩', '界面仅有法语；没有 TLS 代理时不加密'],
    limits: 'SixM 不做的事',
    limit: ['**不提供游戏，也不包含 VIctory 的代码**，不修改任何游戏文件。请使用你自己的副本。', '本仓库不含 Rockstar 的代码或素材、泄露内容或盗版。请勿添加。', '**服务器**脚本可以访问托管它的机器：只安装可信的模组。'],
    dev: '开发', devNote: '测试、打包和发布均自动完成：修改 `package.json` 中的版本号即会发布新版本。',
    docs: '文档', doc: ['托管与模组', '架构', '网络协议', 'VIctory 桥接'], docsNote: '法语。',
    independent: '独立项目，与 Rockstar Games、Take-Two 或 VIctory 无关。',
  },
  ja: {
    file: 'README.ja.md', label: '日本語',
    tagline: 'マルチプレイ、MOD、自分のサーバーを一つのランチャーで。',
    intro: `SixM は、FiveM の考え方に沿った、ゲームに依存しないマルチプレイ・MOD フレームワークです。${VICTORY} などの移植プロジェクトを通じた PC 版 GTA VI を想定しています。コードはすべてオリジナルです。`,
    download: 'ダウンロード', downloadCta: 'Windows 版をダウンロード',
    files: { head: ['ファイル', '用途'], setup: 'インストーラー。Node.js 同梱、管理者権限は不要', portable: 'インストール不要：`SixM.exe` を実行', server: `サーバーのみ（ホスティング用）。${NODE} が必要` },
    unsigned: 'プログラムは署名されていないため、Windows SmartScreen が警告を表示することがあります。`SHA256SUMS.txt` にチェックサムがあります。',
    source: `ソースから：Windows では \`SixM.bat\`、それ以外は \`npm install\` の後に \`npm run app\`。${NODE} 20.15 以降が必要です。ネイティブ画面：\`desktop/\` で \`cargo build --release\`（なければ Web 画面が開きます）。`,
    features: '機能',
    feature: [
      ['プレイ', 'ゲームとサーバーを選んで開始。お気に入り、チャット、プレイヤー、レーダー。デモモードはゲーム不要です。'],
      ['VIctory', 'VIctory または VIctory Belobug AMD、Tequesta、VIctory-NVIDIA などのフォークを固定バージョンで PC にダウンロードしてコンパイルし、ログをリアルタイム表示。更新は常に手動です。'],
      ['ゲーム内オーバーレイ', 'ゲーム画面の上にチャット、プレイヤー、レーダー、MOD メニューを表示。F7 でメニュー、F8 で入力、F9 で非表示。Windows のみ。'],
      ['他のプレイヤー', 'VIctory 用 SixM モジュールにより、他プレイヤーの名前をワールド内の位置に表示。ローカルのプロファイルが必要です。'],
      ['ホスト', '2 クリックでサーバーを作成。公開・非公開、ホワイトリスト、管理者、パスワード、BAN、コンソール。'],
      ['MOD メニュー', 'MOD の記述をもとに SixM が描画。M で開き、矢印キー、チェックボックス、リスト、スライダー。管理メニュー付き。'],
      ['MOD', 'zip をドロップして有効化。プレイヤーは接続時に受け取ります。'],
      ['安全性', 'サーバーから届くスクリプトは QuickJS/WebAssembly 内で隔離されます。'],
    ],
    start: 'はじめに',
    steps: ['SixM をインストールして開きます。', '**Réglages**（設定）：VIctory をインストールし、自分のディスクから抽出したゲームフォルダーを追加します。', '**Jouer**（プレイ）：サーバーを選んで Jouer をクリックします。ゲームがなければデモモードのままで。'],
    host: 'サーバーをホストする', hostText: 'アプリで **Héberger → Créer un serveur**。常時稼働させるには **Télécharger le serveur** で VPS、別の PC、Docker 用の zip を入手できます。ターミナルから：',
    status: '状況', works: '動作するもの', missing: '未対応',
    working: ['サーバー、MOD、インターフェース、チャット', 'VIctory の起動とオーバーレイ（模擬 VIctory でテスト済み）', 'VIctory のコンパイルと確認（ゲームなし）'],
    lacking: ['ゲーム内で他プレイヤーの名前を表示するには、お使いのゲーム版のプロファイルが必要です（付属しません）。キャラクター表示は未実装', '作者によると、VIctory 自体はまだプレイできません', 'インターフェースはフランス語のみ。TLS プロキシなしでは暗号化されません'],
    limits: 'SixM がしないこと',
    limit: ['**ゲームも VIctory のコードも含まず**、ゲームファイルを変更しません。自分のコピーを使ってください。', 'このリポジトリに Rockstar のコードやアセット、リーク、海賊版はありません。追加しないでください。', '**サーバー**スクリプトはホストするマシンにアクセスできます。信頼できる MOD だけを入れてください。'],
    dev: '開発', devNote: 'テスト、パッケージ、公開は自動です。`package.json` のバージョンを変えるとリリースされます。',
    docs: 'ドキュメント', doc: ['ホスティングと MOD', 'アーキテクチャ', 'ネットワークプロトコル', 'VIctory ブリッジ'], docsNote: 'フランス語です。',
    independent: '独立したプロジェクトであり、Rockstar Games、Take-Two、VIctory とは関係ありません。',
  },
  ru: {
    file: 'README.ru.md', label: 'Русский',
    tagline: 'Мультиплеер, моды и свои серверы в одном лаунчере.',
    intro: `SixM — не зависящий от игры фреймворк для мультиплеера и моддинга в духе FiveM, рассчитанный на GTA VI на ПК через проекты портирования, такие как ${VICTORY}. Весь код оригинальный.`,
    download: 'Скачать', downloadCta: 'Скачать для Windows',
    files: { head: ['Файл', 'Назначение'], setup: 'Установщик. Node.js включён, права администратора не нужны', portable: 'Без установки: запустите `SixM.exe`', server: `Только сервер, для хостинга. Нужен ${NODE}` },
    unsigned: 'Программа не подписана, поэтому Windows SmartScreen может показать предупреждение. Контрольные суммы — в `SHA256SUMS.txt`.',
    source: `Из исходников: \`SixM.bat\` в Windows, иначе \`npm install\`, затем \`npm run app\`. Нужен ${NODE} 20.15 или новее. Нативный интерфейс: \`cargo build --release\` в \`desktop/\` (иначе откроется веб-интерфейс).`,
    features: 'Возможности',
    feature: [
      ['Игра', 'Выберите игру и сервер и начинайте. Избранное, чат, игроки, радар. Демо-режим работает без игры.'],
      ['VIctory', 'Скачивает и компилирует VIctory или его форк, например VIctory Belobug AMD, Tequesta или VIctory-NVIDIA, на вашем ПК в закреплённой версии, с журналом в реальном времени. Обновление только вручную.'],
      ['Оверлей в игре', 'Чат, игроки, радар и меню модов поверх окна игры. F7 — меню, F8 — писать, F9 — скрыть. Только Windows.'],
      ['Другие игроки', 'Их имена видны в мире, на своих местах, через модуль SixM для VIctory. Нужен локальный профиль.'],
      ['Хостинг', 'Свой сервер в два клика: публичный или приватный, белый список, админы, пароль, баны, консоль.'],
      ['Меню модов', 'SixM рисует их по описанию модов: M — открыть, стрелки, флажки, списки, ползунки. Есть меню администратора.'],
      ['Моды', 'Перетащите zip и включите. Игроки получат мод при подключении.'],
      ['Безопасность', 'Скрипты, присланные сервером, изолированы в QuickJS/WebAssembly.'],
    ],
    start: 'Начало работы',
    steps: ['Установите и откройте SixM.', '**Réglages** (настройки): установите VIctory и добавьте папку игры, извлечённую с вашего собственного диска.', '**Jouer** (играть): выберите сервер и нажмите Jouer. Нет игры? Оставьте демо-режим.'],
    host: 'Свой сервер', hostText: 'В приложении: **Héberger → Créer un serveur**. Чтобы сервер работал постоянно, **Télécharger le serveur** создаёт zip для VPS, другого ПК или Docker. Из терминала:',
    status: 'Состояние', works: 'Работает', missing: 'Пока нет',
    working: ['Серверы, моды, интерфейс и чат', 'Запуск VIctory и оверлей, проверены с имитацией VIctory', 'VIctory скомпилирован и проверен, без игры'],
    lacking: ['Имена других игроков в игре требуют профиля для вашей версии (не поставляется); персонажи в модуле ещё не сделаны', 'По словам авторов, сам VIctory пока не играбелен', 'Интерфейс только на французском; без TLS-прокси нет шифрования'],
    limits: 'Чего SixM не делает',
    limit: ['**Не содержит ни игры, ни кода VIctory** и не меняет файлы игры. Используйте собственную копию.', 'В репозитории нет кода и ассетов Rockstar, утечек и пиратских сборок. Не добавляйте их.', '**Серверные** скрипты имеют доступ к машине, на которой работают: ставьте только моды, которым доверяете.'],
    dev: 'Разработка', devNote: 'Тесты, сборка и публикация автоматические: смена версии в `package.json` выпускает релиз.',
    docs: 'Документация', doc: ['Хостинг и моды', 'Архитектура', 'Сетевой протокол', 'Мост VIctory'], docsNote: 'На французском.',
    independent: 'Независимый проект, не связан с Rockstar Games, Take-Two или VIctory.',
  },
};

export function render(code) {
  const t = LANGUAGES[code];
  const bar = Object.entries(LANGUAGES).map(([c, l]) => (c === code ? `<b>${l.label}</b>` : `<a href="${l.file}">${l.label}</a>`)).join(' · ');
  const list = (items) => items.map((i) => `- ${i}`).join('\n');
  return `<!-- Généré par scripts/readme.mjs : modifiez ce fichier-là, puis npm run readme -->
<div align="center">

<img src="app/ui/favicon.svg" width="96" height="96" alt="SixM">

# SixM

**${t.tagline}**

${bar}

[![Release](https://img.shields.io/github/v/release/SyanCode/SixM?label=release&color=f6b83c)](${REPO}/releases/latest)
[![Tests](https://img.shields.io/github/actions/workflow/status/SyanCode/SixM/release.yml?branch=main&label=tests)](${REPO}/actions)

### [${t.downloadCta}](${REPO}/releases/latest)

<img src="docs/images/play.jpg" width="49%" alt="${t.feature[0][0]}"> <img src="docs/images/host.jpg" width="49%" alt="${t.feature[4][0]}">

</div>

${t.intro}

## ${t.features}

| | |
|---|---|
${t.feature.map(([k, v]) => `| **${k}** | ${v} |`).join('\n')}

## ${t.download}

| ${t.files.head.join(' | ')} |
|---|---|
| \`SixM-Setup\` | ${t.files.setup} |
| \`SixM-portable\` | ${t.files.portable} |
| \`SixM-Server\` | ${t.files.server} |

${t.unsigned}

${t.source}

## ${t.start}

${t.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}

## ${t.host}

${t.hostText}

\`\`\`bash
npm install
node bin/sixm.js init ../my-server
node bin/sixm.js start ../my-server
\`\`\`

## ${t.status}

| ✅ ${t.works} | ⛔ ${t.missing} |
|---|---|
${t.working.map((w, i) => `| ${w} | ${t.lacking[i]} |`).join('\n')}

## ${t.limits}

${list(t.limit)}

## ${t.dev}

\`\`\`bash
npm test
npm run bot
npm run sim-bridge
npm run package
\`\`\`

${t.devNote}

## ${t.docs}

${list([[t.doc[0], 'docs/HOSTING.md'], [t.doc[1], 'docs/ARCHITECTURE.md'], [t.doc[2], 'docs/PROTOCOL.md'], [t.doc[3], 'integrations/victory/PROTOCOL.md']].map(([n, f]) => `[${n}](${f})`))}
${t.docsNote ? `\n${t.docsNote}\n` : ''}
---

<div align="center"><sub>${t.independent}</sub></div>
`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  for (const code of Object.keys(LANGUAGES)) fs.writeFileSync(path.join(root, LANGUAGES[code].file), render(code));
