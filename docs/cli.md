# CLI 命令参考

## 安装

要求 Node.js >= 20（全 ESM）。

```bash
git clone https://github.com/XU-12-song/ftml-cli
cd ftml-cli
npm install
npm run build:web   # 前端产物不入库，克隆后必须构建
npm link            # 全局安装 ftml 命令（可选）
npm test            # 运行测试
```

`git` 不是启动必需，但 `submit` / `deploy` / `revert` 依赖它。用 `ftml doctor` 体检。

## 命令总览

```text
ftml <命令> [选项]
```

| 命令 | 作用 |
| --- | --- |
| `login` | 登录 Wikidot，凭证存 `~/.ftml-cli/credentials.json` |
| `init` | 初始化项目（`.ftml/`、起始 `index.ftml`、`.gitignore`、`git init`） |
| `build` | 展开模板调用，输出纯 FTML |
| `expand <file>` | 单文件展开（stdout 或 `-o`） |
| `list` | 列出可用模板 |
| `validate` | 校验 div/style/code 配对、模板调用、展开残留 |
| `watch` | 监听源文件 / 模板变化，自动重建 |
| `preview` | 构建并渲染为 HTML 预览 |
| `compat` | 理想 FTML ↔ Wikidot 兼容转换 |
| `submit` | 本地提交：git commit + 小版本号（不发线上） |
| `deploy` | 创建大版本 + push + 发布 Wikidot + 一次 submit |
| `revert` | 按版本号回退（本地 + 线上） |
| `doctor` | 体检 git 环境 |
| `web` | 启动本地 web 编辑器 |

## login

```bash
ftml login                # 交互式输入用户名密码
ftml login --env          # 从环境变量读取并保存
```

凭证优先级：环境变量 `WIKIDOT_USERNAME` / `WIKIDOT_PASSWORD`（自动加载 `.env`）> 文件 `~/.ftml-cli/credentials.json`。

## init

```bash
ftml init
```

幂等初始化（可重复执行）：`.ftml/`（含 `history.json`）、`components/`、`templates/`、`.gitignore`（忽略 `dist/` 与 `.ftml/`）、`.ftmlrc.json` 占位、`git init`。
如果目录里还没有 `index.ftml`，会写入一个起始页面，创建后可直接 `ftml preview`。

## build / expand

```bash
ftml build -s index.ftml -t templates -o dist/index.ftml
ftml expand index.ftml                # 输出到 stdout
ftml expand index.ftml -o out.ftml    # 写入文件
ftml list --json                      # 模板清单（JSON）
```

模板目录解析优先级：`--templates` > 项目配置 `templatesDir` > 输入文件同级的 `templates/` > 内置 `templates/`。

## validate

```bash
ftml validate -s dist/index.ftml -t templates
```

退出码 `0` = 通过，`1` = 有错误。div 不平衡但差异 ≤ 10 时只给警告（组件本身可能刻意不平衡）。

## watch

```bash
ftml watch -s index.ftml -o dist/index.ftml --debounce 300
```

监听源文件、模板目录、源文件同目录的 `.ftml` 组件，变化后防抖自动重建。

## preview

```bash
ftml preview                          # 构建 → 渲染，写入与产物同名的 .html
ftml preview -o preview.html
ftml preview --open                   # 生成后用系统浏览器打开
ftml preview --site scpsandboxcn --page my-page
```

- 用 `@wdprlib/parser` + `@wdprlib/render` 渲染为 HTML。
- `[[module CSS]]` 在内联模式下随 HTML 输出。
- 解析 / 渲染诊断以警告输出到 stderr，不阻断生成。
- 本地 `[[include]]` 按源文件目录解析；本地找不到时，已登录会远程拉取并写入磁盘缓存。
- 输出对齐 Wikidot 沙盒站的完整 XHTML 外壳，并内联 `@wdprlib/runtime`，tabview、折叠块、TOC、脚注等可交互。

## compat

```bash
ftml compat --list                    # 查看语言分歧表
ftml compat -s page.ftml --to-dirt    # 理想 FTML → Wikidot 兼容源码
ftml compat -s page.ftml --to-ideal   # Wikidot 源码 → 理想 FTML
```

`submit` / `deploy` / `revert` 写线上前会自动做一次 `--to-dirt` 兼容转换；合法理想源上是恒等变换。

## submit / deploy / revert

三者对应同一套版本模型：**deploy 开大版本，submit 出小版本，revert 按版本号回退**。详见 [版本管理](versions.md)。

```bash
ftml submit -m "更新文档"              # 本地 git commit + 小版本号
ftml submit --no-build -m "直接提交"   # 不构建，直接用现有产物
ftml deploy -m "上线 v2"               # build + validate + 大版本 + push + 发布 + submit
ftml deploy --no-validate -m "跳过校验"
ftml deploy --no-push -m "不推 git 远端"
ftml deploy --no-deps -m "只发入口页"

ftml revert --list                     # 版本列表
ftml revert --to 2.3                   # 回退到小版本 2.3
ftml revert --to 1                     # 回退到大版本 1
ftml revert --to HEAD~2                # 按 git 修订回退
ftml revert --no-wikidot --to 1.2      # 只做本地 git revert
```

如果省略 `-m`，命令行会使用自动生成的说明（`提交 <时间>` / `部署 <时间>`），也可以交互式确认。Web 编辑器里会预填默认说明。

## doctor

```bash
ftml doctor
```

```text
git: 已安装（2.47.3）
user.name: your-name
user.email: you@example.com
当前目录是 git 仓库: 是
✓ git 环境就绪
```

检测 git 是否安装及版本、当前目录是否 git 仓库、生效的 `user.name` / `user.email`。缺失时按「先装 git、再配身份」的顺序给出平台相关命令。

## web

```bash
ftml web                              # 默认 http://127.0.0.1:3000
ftml web --root ~/my-ftml-site        # 启动并注册默认项目
ftml web --port 8080 --host 0.0.0.0   # 自定义端口 / 绑定地址
ftml web --open                       # 启动后用系统浏览器打开
```

详见 [Web 编辑器](web-editor.md)。

## 配置

项目根目录放 `ftml.config.json`（或 `.ftmlrc.json` / `.ftmlrc`），CLI 会向上查找最近的配置文件：

```json
{
  "source": "index.ftml",
  "output": "dist/index.ftml",
  "templatesDir": "templates",
  "site": "scpsandboxcn",
  "page": "my-page",
  "watch": true
}
```

命令行选项优先于配置；相对路径以配置文件所在目录为准。

### site / page 来源（优先级从高到低）

1. 命令行 `--site` / `--page`
2. 配置文件 `ftml.config.json` / `.ftmlrc.json` / `.ftmlrc`
3. 项目元数据 `.ftml/<源文件名>.json`（submit/deploy/revert 时自动写入）

### 环境变量

| 变量 | 作用 |
| --- | --- |
| `FTML_CLI_HOME` | 重定向用户级目录（默认 `~/.ftml-cli`），测试 / 隔离用 |
| `FTML_PROJECTS_DIR` | 覆盖 web「新建仓库」的默认分区 |
| `WIKIDOT_USERNAME` / `WIKIDOT_PASSWORD` | 登录凭证来源（自动加载 `.env`） |

## 退出码

| 码 | 含义 |
| --- | --- |
| `0` | 成功 |
| `1` | 命令失败（校验未通过、git 未就绪、网络 / 登录失败等） |
