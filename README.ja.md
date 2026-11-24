**English** · [Français](README.fr.md) · [Español](README.es.md) · [Deutsch](README.de.md) · [Português](README.pt-BR.md) · [中文](README.zh-CN.md) · [日本語](README.ja.md) · [Русский](README.ru.md)

# SixM

FiveM の発想に近い、**ゲーム非依存**のマルチプレイヤー / Mod フレームワーク。PC 版 GTA VI や移植プロジェクトを想定しています。コードはすべてオリジナルです。

## 現状 (v0.1)

| コンポーネント | 状態 |
|---|---|
| 専用サーバー（WebSocket、tick、スナップショット、レート制限） | ✅ |
| リソースシステム（`resource.json`、start/stop/restart、サーバー/クライアントスクリプト） | ✅ |
| スクリプト API（`sixm.on`、`onNet`、`emitClient`、`emitAllClients`、`getPlayers`、`kick`） | ✅ |
| リファレンスクライアント + モックアダプター + テストボット | ✅ |
| **実ゲーム用アダプター**（`GameAdapter`） | ⛔ 未実装（下記参照） |

## はじめに

```bash
npm install
npm start          # ws://localhost:30120 でサーバー起動
npm run bot        # （別ターミナル）移動してチャットするボット
npm test
```

サーバーコンソール: `start|stop|restart <リソース>`、`players`、`resources`、`quit`。

## SixM がしないこと（とその理由）

- **GTA VI には公式 PC 版も Mod サポートもない**ため、現時点で正当なフックポイントはありません。`client/adapter.js` は、将来それが登場した際（公式 API、またはプラグインを明示的に許可する移植プロジェクト）に実装すべきインターフェースを定義します。
- このリポジトリには Rockstar のコード・アセット・バイナリ、リークや海賊版ビルドは**含まれず、今後も含みません**。追加しないでください。
- スクリプトは `node:vm` で分離されますが、これはセキュリティサンドボックス**ではありません**。信頼できるリソースのみ実行してください。

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) と [docs/PROTOCOL.md](docs/PROTOCOL.md) も参照してください。
