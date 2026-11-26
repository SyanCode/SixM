<!-- Généré par scripts/readme.mjs : modifiez ce fichier-là, puis npm run readme -->
<div align="center">

<img src="app/ui/favicon.svg" width="96" height="96" alt="SixM">

# SixM

**マルチプレイ、MOD、自分のサーバーを一つのランチャーで。**

<a href="README.md">English</a> · <a href="README.fr.md">Français</a> · <a href="README.es.md">Español</a> · <a href="README.de.md">Deutsch</a> · <a href="README.pt-BR.md">Português</a> · <a href="README.zh-CN.md">中文</a> · <b>日本語</b> · <a href="README.ru.md">Русский</a>

[![Release](https://img.shields.io/github/v/release/SyanCode/SixM?label=release&color=f6b83c)](https://github.com/SyanCode/SixM/releases/latest)
[![Tests](https://img.shields.io/github/actions/workflow/status/SyanCode/SixM/release.yml?branch=main&label=tests)](https://github.com/SyanCode/SixM/actions)

### [Windows 版をダウンロード](https://github.com/SyanCode/SixM/releases/latest)

<img src="docs/images/play.jpg" width="49%" alt="プレイ"> <img src="docs/images/host.jpg" width="49%" alt="ホスト">

</div>

SixM は、FiveM の考え方に沿った、ゲームに依存しないマルチプレイ・MOD フレームワークです。[VIctory](https://github.com/Marvisak/VIctory) などの移植プロジェクトを通じた PC 版 GTA VI を想定しています。コードはすべてオリジナルです。

## 機能

| | |
|---|---|
| **プレイ** | ゲームとサーバーを選んで開始。お気に入り、チャット、プレイヤー、レーダー。デモモードはゲーム不要です。 |
| **VIctory** | VIctory を固定バージョンで PC にダウンロードしてコンパイルし、ログをリアルタイム表示。更新は常に手動です。 |
| **ゲーム内オーバーレイ** | ゲーム画面の上にチャット、プレイヤー、レーダーを表示。F8 で入力、F9 で非表示。Windows のみ。 |
| **他のプレイヤー** | VIctory 用 SixM モジュールにより、他プレイヤーの名前をワールド内の位置に表示。ローカルのプロファイルが必要です。 |
| **ホスト** | 2 クリックでサーバーを作成。公開・非公開、ホワイトリスト、管理者、パスワード、BAN、コンソール。 |
| **MOD メニュー** | MOD の記述をもとに SixM が描画。M で開き、矢印キー、チェックボックス、リスト、スライダー。管理メニュー付き。 |
| **MOD** | zip をドロップして有効化。プレイヤーは接続時に受け取ります。 |
| **安全性** | サーバーから届くスクリプトは QuickJS/WebAssembly 内で隔離されます。 |

## ダウンロード

| ファイル | 用途 |
|---|---|
| `SixM-Setup` | インストーラー。Node.js 同梱、管理者権限は不要 |
| `SixM-portable` | インストール不要：`SixM.exe` を実行 |
| `SixM-Server` | サーバーのみ（ホスティング用）。[Node.js](https://nodejs.org) が必要 |

プログラムは署名されていないため、Windows SmartScreen が警告を表示することがあります。`SHA256SUMS.txt` にチェックサムがあります。

ソースから：Windows では `SixM.bat`、それ以外は `npm install` の後に `npm run app`。[Node.js](https://nodejs.org) 20.15 以降が必要です。ネイティブ画面：`desktop/` で `cargo build --release`（なければ Web 画面が開きます）。

## はじめに

1. SixM をインストールして開きます。
2. **Réglages**（設定）：VIctory をインストールし、自分のディスクから抽出したゲームフォルダーを追加します。
3. **Jouer**（プレイ）：サーバーを選んで Jouer をクリックします。ゲームがなければデモモードのままで。

## サーバーをホストする

アプリで **Héberger → Créer un serveur**。常時稼働させるには **Télécharger le serveur** で VPS、別の PC、Docker 用の zip を入手できます。ターミナルから：

```bash
npm install
node bin/sixm.js init ../my-server
node bin/sixm.js start ../my-server
```

## 状況

| ✅ 動作するもの | ⛔ 未対応 |
|---|---|
| サーバー、MOD、インターフェース、チャット | ゲーム内で他プレイヤーの名前を表示するには、お使いのゲーム版のプロファイルが必要です（付属しません）。キャラクター表示は未実装 |
| VIctory の起動とオーバーレイ（模擬 VIctory でテスト済み） | 作者によると、VIctory 自体はまだプレイできません |
| VIctory のコンパイルと確認（ゲームなし） | インターフェースはフランス語のみ。TLS プロキシなしでは暗号化されません |

## SixM がしないこと

- **ゲームも VIctory のコードも含まず**、ゲームファイルを変更しません。自分のコピーを使ってください。
- このリポジトリに Rockstar のコードやアセット、リーク、海賊版はありません。追加しないでください。
- **サーバー**スクリプトはホストするマシンにアクセスできます。信頼できる MOD だけを入れてください。

## 開発

```bash
npm test
npm run bot
npm run sim-bridge
npm run package
```

テスト、パッケージ、公開は自動です。`package.json` のバージョンを変えるとリリースされます。

## ドキュメント

- [ホスティングと MOD](docs/HOSTING.md)
- [アーキテクチャ](docs/ARCHITECTURE.md)
- [ネットワークプロトコル](docs/PROTOCOL.md)
- [VIctory ブリッジ](integrations/victory/PROTOCOL.md)

フランス語です。

---

<div align="center"><sub>独立したプロジェクトであり、Rockstar Games、Take-Two、VIctory とは関係ありません。</sub></div>
