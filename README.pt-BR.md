<!-- Généré par scripts/readme.mjs : modifiez ce fichier-là, puis npm run readme -->
<div align="center">

<img src="app/ui/favicon.svg" width="96" height="96" alt="SixM">

# SixM

**Multiplayer, mods e seus próprios servidores em um só launcher.**

<a href="README.md">English</a> · <a href="README.fr.md">Français</a> · <a href="README.es.md">Español</a> · <a href="README.de.md">Deutsch</a> · <b>Português</b> · <a href="README.zh-CN.md">中文</a> · <a href="README.ja.md">日本語</a> · <a href="README.ru.md">Русский</a>

[![Release](https://img.shields.io/github/v/release/SyanCode/SixM?label=release&color=f6b83c)](https://github.com/SyanCode/SixM/releases/latest)
[![Tests](https://img.shields.io/github/actions/workflow/status/SyanCode/SixM/release.yml?branch=main&label=tests)](https://github.com/SyanCode/SixM/actions)

### [Baixar para Windows](https://github.com/SyanCode/SixM/releases/latest)

<img src="docs/images/play.jpg" width="49%" alt="Jogar"> <img src="docs/images/host.jpg" width="49%" alt="Hospedar">

</div>

SixM é um framework de multiplayer e modding independente do jogo, no espírito do FiveM, pensado para GTA VI no PC por meio de projetos de port como o [VIctory](https://github.com/Marvisak/VIctory). Todo o código é original.

## Recursos

| | |
|---|---|
| **Jogar** | Escolha um jogo e um servidor e clique em Jogar. Favoritos, chat, jogadores, radar. O modo demo não precisa de jogo. |
| **VIctory** | Baixa e compila o VIctory, ou um fork como o VIctory Belobug AMD, o Tequesta ou o VIctory-NVIDIA, no seu PC, em uma versão fixa, com registro ao vivo. As atualizações são sempre manuais. |
| **Sobreposição no jogo** | Chat, jogadores, radar e menus de mods sobre a janela do jogo. F7 menu, F8 para escrever, F9 para ocultar. Somente Windows. |
| **Outros jogadores** | Os nomes aparecem no mundo, na posição deles, pelo módulo do SixM para o VIctory. Requer um perfil local. |
| **Hospedar** | Seu servidor em dois cliques: público ou privado, lista branca, admins, senha, banimentos, console. |
| **Menus de mods** | Desenhados pelo SixM a partir do que os mods descrevem: M para abrir, setas, caixas, listas, controles deslizantes. Inclui um menu de administração. |
| **Mods** | Solte um zip e ative. Os jogadores recebem ao se conectar. |
| **Segurança** | Os scripts enviados por um servidor rodam isolados em QuickJS/WebAssembly. |

## Baixar

| Arquivo | Para |
|---|---|
| `SixM-Setup` | Instalador. Inclui Node.js, sem permissão de administrador |
| `SixM-portable` | Sem instalação: execute `SixM.exe` |
| `SixM-Server` | Somente o servidor, para hospedagem. Requer [Node.js](https://nodejs.org) |

O programa não é assinado: o Windows SmartScreen pode exibir um aviso. `SHA256SUMS.txt` traz as somas de verificação.

A partir do código: `SixM.bat` no Windows, ou `npm install` e depois `npm run app`. Requer [Node.js](https://nodejs.org) 20.15 ou mais recente. Interface nativa: `cargo build --release` em `desktop/` (senão abre a interface web).

## Primeiros passos

1. Instale o SixM e abra.
2. **Réglages** (ajustes): instale o VIctory e adicione a pasta do jogo extraída do seu próprio disco.
3. **Jouer** (jogar): escolha um servidor e clique em Jouer. Sem jogo? Fique no modo demo.

## Hospedar um servidor

No aplicativo: **Héberger → Créer un serveur**. Para mantê-lo no ar, **Télécharger le serveur** gera um zip para um VPS, outro PC ou Docker. Pelo terminal:

```bash
npm install
node bin/sixm.js init ../my-server
node bin/sixm.js start ../my-server
```

## Situação

| ✅ Funciona | ⛔ Ainda não |
|---|---|
| Servidores, mods, interface e chat | Os nomes dos outros jogadores no jogo exigem um perfil da sua versão (nenhum é fornecido); os personagens ainda faltam no módulo |
| Inicialização do VIctory e sobreposição, testadas com um VIctory simulado | O próprio VIctory ainda não é jogável, segundo seus autores |
| VIctory compilado e verificado, sem jogo | Interface somente em francês; sem criptografia se não houver um proxy TLS |

## O que o SixM não faz

- **Não inclui jogo nem código do VIctory** e não modifica arquivos do jogo. Use sua própria cópia.
- Nada de código ou assets da Rockstar, vazamentos ou cópias piratas neste repositório. Não adicione.
- Os scripts de **servidor** têm acesso à máquina que os hospeda: instale apenas mods confiáveis.

## Desenvolvimento

```bash
npm test
npm run bot
npm run sim-bridge
npm run package
```

Testes, empacotamento e publicação são automáticos: mudar a versão em `package.json` publica uma versão.

## Documentação

- [Hospedagem e mods](docs/HOSTING.md)
- [Arquitetura](docs/ARCHITECTURE.md)
- [Protocolo de rede](docs/PROTOCOL.md)
- [Bridge do VIctory](integrations/victory/PROTOCOL.md)

Em francês.

---

<div align="center"><sub>Projeto independente, sem vínculo com Rockstar Games, Take-Two ou VIctory.</sub></div>
