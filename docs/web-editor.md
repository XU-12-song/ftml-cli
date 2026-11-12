# Web 编辑器

`ftml web` 启动一个本地 web 编辑器。桌面版复用的也是这套界面。

```bash
ftml web                              # 默认 http://127.0.0.1:3000
ftml web --root ~/my-ftml-site        # 启动并注册默认项目
ftml web --port 8080 --host 0.0.0.0   # 自定义端口 / 绑定地址
ftml web --open                       # 启动后用系统浏览器打开
```

HTTP 层用 **express**（静态文件 + JSON API），业务逻辑复用 CLI 命令作为引擎。

## 第一次打开

没有任何已注册项目时，界面会显示欢迎面板：

- **新建 ftml 仓库**：默认落在 `~/.ftml-cli/projects/<仓库名>`（`FTML_PROJECTS_DIR` 可改），自动初始化并写入起始 `index.ftml`。
- **添加已有项目**：注册一个已有目录（不复制、不移动文件）。
- **登录 Wikidot**：发布前需要。

按 `Ctrl+K` 随时打开命令面板，它是所有功能的完整目录。

## 功能

- **布局**：左侧编辑器、右侧 iframe 实时预览（默认各 50%）；顶栏可切换上下布局，窄屏下侧边栏变抽屉。
- **侧边栏**：模板 / 组件 / 源文件 / 代码片段四个分组，均可在 web 内新建；模板条目展示声明的键，支持输入 `[[` 时自动补全。
- **保存即预览**：编辑防抖后自动保存并重渲染完整 HTML（沙盒外壳 + 内联 runtime），`Ctrl/Cmd+S` 立即保存；状态栏显示本次渲染的 include 来源统计（本地 / 缓存 / 远程 / 未命中）。
- **可调分栏**：拖动交界处调整占比，双击恢复 50%，方向键微调；两种布局分别记忆比例。
- **多项目**：项目注册表存 `~/.ftml-cli/projects.json`，顶栏下拉切换；删除仅注销不删文件。
- **新建仓库**：自动 `init` + 写入起始 `index.ftml` + 注册；目录已存在且非空时拒绝。
- **目标页面**：顶栏 `Ctrl+Alt+U` 设置项目级 site / page，写回 `.ftmlrc.json`（或项目已有配置文件）；切换项目时自动读取。
- **操作**：校验、提交、部署、版本 / 回退、init、登录 / 登出、git 环境体检。
- **设置**：自动预览间隔、是否开启自动预览、渲染样式模式、是否联网解析远程 include，保存在 `~/.ftml-cli/settings.json`。
- **代码片段**：自定义片段增删改，支持导入 / 导出 Ace `.snippets` 文本。
- **安全**：默认只绑 `127.0.0.1`；文件读写做路径穿越校验，必须落在项目根内。

## 联网策略

- 自动预览与 `Ctrl+S` 只读本地 / 磁盘缓存。
- 点顶栏「联网刷新 include」（`Ctrl+Alt+Shift+R`）才登录 Wikidot 拉取未命中的远程 include。
- 「真实解析模块」会临时使用线上数据解析 ListPages / ListUsers / TagCloud / Rate 等模块。
- 可在设置里关闭「允许联网解析远程 include」，完全离线使用。

## 设置

保存于 `~/.ftml-cli/settings.json`，读取时缺失字段用默认值补齐，写入时只接受已知字段：

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `previewIntervalMs` | `600` | 自动预览防抖间隔，允许 100–10000 ms |
| `autoPreview` | `true` | 是否开启输入即预览 |
| `renderStyleMode` | `inline` | 预览渲染模式（透传给 `@wdprlib/render` 的 `styleMode`） |
| `useRemoteInclude` | `true` | 渲染时是否联网解析本地缺失的 `[[include]]` |
| `theme` | `auto` | 编辑器配色：`auto` / `dark` / `light` |

## 代码片段

自定义片段存 `~/.ftml-cli/snippets/snippets.json`：

```json
{ "name": "卡片", "prefix": "card", "description": "标准卡片", "body": "[[card title=\"${1:标题}\"]]\n${0}\n[[/card]]", "source": "user" }
```

导入 / 导出使用 Ace `.snippets` 文本格式：

```text
# 注释行以 # 开头，忽略
snippet 卡片
	[[card title="${1:标题}"]]
	${0}
	[[/card]]
```

- `snippet <名称>` 开始一个片段，其后**缩进一行**的内容是片段正文（统一去掉一级 Tab 或 4 空格缩进）。
- `${1:默认值}` / `${n}` / `$0` 是 Ace 制表位，解析时原样保留，由前端在插入时展开。
- 合并规则：以 `prefix`（缺失时用 `name`）为唯一键，同键覆盖、否则追加。

## HTTP API

所有接口挂在 `/api` 下，返回 JSON；错误统一为 `{ "error": "…" }` 并带对应状态码。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/auth/status` | 登录状态 |
| POST | `/api/auth/login` | 登录（body: `username` / `password`） |
| POST | `/api/auth/logout` | 登出 |
| GET | `/api/git-env?root=` | git 体检 |
| GET / POST | `/api/settings` | 读取 / 保存编辑器偏好 |
| GET / POST | `/api/snippets` | 列出 / 新增或更新片段 |
| POST | `/api/snippets/import` | 导入片段（body: `text` 或 `file`） |
| GET | `/api/snippets/export` | 导出为 Ace `.snippets` 文本 |
| DELETE | `/api/snippets/:name` | 删除片段 |
| GET / DELETE | `/api/include-cache` | 列出 / 清空远程 include 磁盘缓存 |
| GET | `/api/projects` | 项目列表（含 `isRepo`；失效目录自动跳过） |
| POST | `/api/projects` | 注册已有目录（body: `root`） |
| POST | `/api/projects/create` | 新建 ftml 仓库（body: `name`，可选 `parent`） |
| DELETE | `/api/projects/:id` | 注销项目（不删文件） |
| ALL | `/api/projects/:id/:action` | 项目级操作：`sidebar` / `file` / `save` / `render` / `validate` / `target` / `versions` / `deploy` / `revert` / `init` |
