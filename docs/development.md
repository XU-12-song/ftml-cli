# 开发与构建

## 环境

- Node.js >= 20（全 ESM）
- Windows 打包需要 Windows；CLI 在 macOS / Linux 同样可用
- `git`（`submit` / `deploy` / `revert` 与测试需要）

```bash
git clone https://github.com/XU-12-song/ftml-cli
cd ftml-cli
npm install
npm run build:web
npm test
npm run typecheck
```

## 脚本

| 脚本 | 作用 |
| --- | --- |
| `npm test` | 运行全部测试（`node:test`，零额外依赖） |
| `npm run test:watch` | 监听测试 |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run build:web` | 构建前端 `src/web/public/js` → `dist/app.js`（产物不入库） |
| `npm run build:web:watch` | 监听前端改动并重建 |
| `npm run build:electron` | 构建 Electron 主进程到 `build/` |
| `npm run electron:dev` | 构建并启动桌面版 |
| `npm run test:electron` | Electron 冒烟测试（需要图形会话） |
| `npm run dist:win` | 产出 NSIS 安装包 + Portable（`release/`） |
| `npm run assets:build` | 从 `assets/masters/*.svg` 生成 PNG / ICO |

改动 `src/web/public/js/` 后必须重新构建前端（`npm run build:web`）；`electron:dev` 与 `dist:win` 会自动执行。

## 代码结构

```text
src/
  cli.ts                命令注册
  commands/             各命令实现（submit / deploy / revert / ...）
  core/                 FTML 解析、展开、转义
  compat/               理想 FTML ↔ Wikidot 兼容层
  domain/               版本、发布闭包、设置、片段等业务逻辑
  infra/                git、wikidot 客户端、配置、缓存、路径
  render/               @wdprlib 渲染与预览文档
  web/                  Express 服务、API handlers、前端
  types/                按模块划分的 TypeScript 类型
electron/                Electron 主进程 / preload / 托盘 / 菜单
tests/                   node:test 测试
scripts/                 前端 / Electron / 资源构建脚本
assets/                  封面、图标（masters 为 SVG 源）
docs/                    文档
```

约定：

- 源码为 TypeScript（`strict`），前端 `src/web/public/js` 为原生 ESM JavaScript。
- 类型集中在 `src/types/<层>/<模块>.ts`，实现文件从那里导入。
- 写线上的入口统一走 `src/infra/wikidot.ts`（兼容转换 + 会话复用）。
- 新增命令时同时更新 `src/cli.ts`、`src/types/commands/` 与本文档 / `docs/cli.md`。

## 测试

```bash
npm test
node --import tsx --test tests/web.test.js   # 单个文件
```

- 测试使用临时目录，并通过 `FTML_CLI_HOME` 隔离用户数据。
- Wikidot 交互使用 `tests/helpers/fake-wikidot.js` 注入假客户端，不联网。
- git 相关测试会创建真实临时仓库。

## 发布

`.github/workflows/release.yml` 在打 tag 时构建 Windows 产物并上传到 GitHub Releases：

- `release/*-setup-x64.exe`
- `release/*-portable-x64.exe`

本地产出：

```bash
npm run dist:win
```

当前构建未签名。

## 文档

文档位于 `docs/`，入口是 [docs/README.md](README.md)。截图放在 `docs/images/`。
修改用户可见行为时，请同步更新对应文档。
