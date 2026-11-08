# ftml-cli 文档

FTML（Wikidot 语法）工作流工具：模板展开、本地实时预览、版本管理、一键发布。
提供 **Windows 桌面版** 与 **CLI** 两个入口，共用同一套引擎、项目注册表、设置与登录凭证。

## 我该从哪里开始？

| 你的情况 | 先看 |
| --- | --- |
| 第一次使用，想尽快写出一篇页面 | [5 分钟上手](getting-started.md) |
| 想了解桌面版的全部行为（托盘、文件关联、便携版…） | [桌面版](desktop.md) |
| 想用命令行 / 接入自动化 | [CLI 命令参考](cli.md) |
| 搞不清 提交 / 部署 / 回退 | [版本管理](versions.md) |
| 想写模板和组件 | [模板与组件语法](templates.md) |
| 想用浏览器里的编辑器与 HTTP API | [Web 编辑器](web-editor.md) |
| 遇到报错 | [常见问题](troubleshooting.md) |
| 想参与开发或打包 | [开发与构建](development.md) |

## 示例图

```text
写 FTML 源文件 ──► 本地预览 ──► 提交小版本（本地 git）
        │                              │
        └── 引用模板 / 组件 ◄──────────┘
                       │
                       ▼
              部署大版本（push + 发布 Wikidot）
                       │
                       ▼
              回退到任意版本（本地 + 线上）
```

- **项目**：一个包含 `index.ftml`、`templates/`、`components/` 的目录，`ftml init` 会创建它。
- **模板 / 组件**：把重复的 FTML 结构抽出复用，调用/部署时才展开。
- **目标页面**：这个项目要发布到哪个 Wikidot 站点、哪个页面。
- **提交（submit）**：只做本地 git 提交 + 小版本号，不联网。
- **部署（deploy）**：创建大版本、推送 git、发布 Wikidot，并自动再提交一次。
- **回退（revert）**：把本地和线上一起退到某个版本。

## 获取帮助

- 桌面版：按 `Ctrl+K` 打开命令面板，这包含绝大多数功能。
- CLI：`ftml --help`，或 `ftml <命令> --help`。
- 环境体检：`ftml doctor`。
