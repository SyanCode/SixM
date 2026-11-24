**English** · [Français](README.fr.md) · [Español](README.es.md) · [Deutsch](README.de.md) · [Português](README.pt-BR.md) · [中文](README.zh-CN.md) · [日本語](README.ja.md) · [Русский](README.ru.md)

# SixM

一个**与具体游戏无关**的多人联机 / Mod 框架，理念类似 FiveM，面向 PC 版 GTA VI 及各类移植项目。所有代码均为原创。

## 当前状态 (v0.1)

| 组件 | 状态 |
|---|---|
| 专用服务器（WebSocket、tick、快照、限流） | ✅ |
| 资源系统（`resource.json`、start/stop/restart、服务端 + 客户端脚本） | ✅ |
| 脚本 API（`sixm.on`、`onNet`、`emitClient`、`emitAllClients`、`getPlayers`、`kick`） | ✅ |
| 参考客户端 + 模拟适配器 + 测试机器人 | ✅ |
| **真实游戏适配器**（`GameAdapter`） | ⛔ 待编写，见下文 |

## 快速开始

```bash
npm install
npm start          # 服务器监听 ws://localhost:30120
npm run bot        # （另开终端）一个会移动并聊天的机器人
npm test
```

服务器控制台：`start|stop|restart <资源>`、`players`、`resources`、`quit`。

## SixM 不做什么（以及原因）

- **GTA VI 没有官方 PC 版，也不支持 Mod**，因此目前没有合法的挂钩点。`client/adapter.js` 定义了未来出现挂钩点（官方 API，或明确允许插件的移植项目）时需要实现的接口。
- 本仓库**不包含也不会包含** Rockstar 的代码、资源或二进制文件，也不包含泄露内容或盗版构建。请勿添加。
- 脚本通过 `node:vm` 隔离，但这**不是**安全沙箱：请只运行可信的资源。

参见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 和 [docs/PROTOCOL.md](docs/PROTOCOL.md)。
