<!-- Généré par scripts/readme.mjs : modifiez ce fichier-là, puis npm run readme -->
<div align="center">

<img src="app/ui/favicon.svg" width="96" height="96" alt="SixM">

# SixM

**多人联机、模组和自建服务器，尽在一个启动器。**

<a href="README.md">English</a> · <a href="README.fr.md">Français</a> · <a href="README.es.md">Español</a> · <a href="README.de.md">Deutsch</a> · <a href="README.pt-BR.md">Português</a> · <b>中文</b> · <a href="README.ja.md">日本語</a> · <a href="README.ru.md">Русский</a>

[![Release](https://img.shields.io/github/v/release/SyanCode/SixM?label=release&color=f6b83c)](https://github.com/SyanCode/SixM/releases/latest)
[![Tests](https://img.shields.io/github/actions/workflow/status/SyanCode/SixM/release.yml?branch=main&label=tests)](https://github.com/SyanCode/SixM/actions)

### [下载 Windows 版](https://github.com/SyanCode/SixM/releases/latest)

<img src="docs/images/play.jpg" width="49%" alt="游玩"> <img src="docs/images/host.jpg" width="49%" alt="托管">

</div>

SixM 是一个与游戏无关的多人联机和模组框架，理念类似 FiveM，面向通过 [VIctory](https://github.com/Marvisak/VIctory) 等移植项目在 PC 上运行的 GTA VI。全部代码均为原创。

## 功能

| | |
|---|---|
| **游玩** | 选择游戏和服务器，然后开始。收藏、聊天、玩家列表、雷达。演示模式无需游戏。 |
| **VIctory** | 在你的电脑上下载并编译固定版本的 VIctory 或其分支（如 VIctory Belobug AMD、Tequesta 或 VIctory-NVIDIA），实时显示日志。更新始终由你手动触发。 |
| **游戏内覆盖层** | 在游戏窗口上显示聊天、玩家、雷达和模组菜单。F7 菜单，F8 输入，F9 隐藏。仅限 Windows。 |
| **其他玩家** | 通过 SixM 的 VIctory 模块，在游戏世界中按位置显示其他玩家的名字。需要本地配置文件。 |
| **托管** | 两次点击即可开服：公开或私有、白名单、管理员、密码、封禁、控制台。 |
| **模组菜单** | 由 SixM 根据模组的描述绘制：按 M 打开，方向键、复选框、列表、滑块。附带管理菜单。 |
| **模组** | 拖入 zip 并启用，玩家连接时自动获取。 |
| **安全** | 服务器下发的脚本在 QuickJS/WebAssembly 中隔离运行。 |

## 下载

| 文件 | 用途 |
|---|---|
| `SixM-Setup` | 安装程序。内含 Node.js，无需管理员权限 |
| `SixM-portable` | 免安装：运行 `SixM.exe` |
| `SixM-Server` | 仅服务器，用于托管。需要 [Node.js](https://nodejs.org) |

程序未签名，Windows SmartScreen 可能会发出警告。`SHA256SUMS.txt` 列出了文件校验和。

从源码运行：Windows 上使用 `SixM.bat`，其他系统先 `npm install` 再 `npm run app`。需要 [Node.js](https://nodejs.org) 20.15 或更高版本。原生界面：在 `desktop/` 中运行 `cargo build --release`（否则打开网页界面）。

## 快速开始

1. 安装并打开 SixM。
2. **Réglages**（设置）：安装 VIctory，然后添加从你自己的光盘提取的游戏文件夹。
3. **Jouer**（游玩）：选择服务器并点击 Jouer。没有游戏？保持演示模式即可。

## 托管服务器

在应用中：**Héberger → Créer un serveur**。若要长期在线，**Télécharger le serveur** 会生成可用于 VPS、其他电脑或 Docker 的 zip。命令行：

```bash
npm install
node bin/sixm.js init ../my-server
node bin/sixm.js start ../my-server
```

## 状态

| ✅ 可用 | ⛔ 尚不支持 |
|---|---|
| 服务器、模组、界面和聊天 | 游戏内显示其他玩家的名字需要对应游戏版本的配置文件（不提供）；角色仍待模块实现 |
| 启动 VIctory 与覆盖层，已用模拟的 VIctory 测试 | 据其作者称，VIctory 本身尚不可玩 |
| VIctory 已编译并检查，未运行游戏 | 界面仅有法语；没有 TLS 代理时不加密 |

## SixM 不做的事

- **不提供游戏，也不包含 VIctory 的代码**，不修改任何游戏文件。请使用你自己的副本。
- 本仓库不含 Rockstar 的代码或素材、泄露内容或盗版。请勿添加。
- **服务器**脚本可以访问托管它的机器：只安装可信的模组。

## 开发

```bash
npm test
npm run bot
npm run sim-bridge
npm run package
```

测试、打包和发布均自动完成：修改 `package.json` 中的版本号即会发布新版本。

## 文档

- [托管与模组](docs/HOSTING.md)
- [架构](docs/ARCHITECTURE.md)
- [网络协议](docs/PROTOCOL.md)
- [VIctory 桥接](integrations/victory/PROTOCOL.md)

法语。

---

<div align="center"><sub>独立项目，与 Rockstar Games、Take-Two 或 VIctory 无关。</sub></div>
