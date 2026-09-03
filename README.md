# ftml-cli

FTML（Wikidot 语法）工作流 CLI：模板展开构建、本地校验、监听重建、Wikidot 登录 / 提交 / 部署 / 回退。

```
ftml <命令> [选项]
```

## 安装

```bash
npm install        # 安装依赖
npm link           # 全局安装 ftml 命令（可选）
npm test           # 运行测试（node:test，零额外依赖）
```

## 命令

| 命令 | 作用 |
| --- | --- |
| `ftml login` | 登录 Wikidot，凭证存 `~/.ftml-cli/credentials.json`（0600） |
| `ftml build` | 展开模板调用，输出纯 FTML |
| `ftml expand <file>` | 单文件展开（stdout 或 `-o`） |
| `ftml list` | 列出可用模板 |
| `ftml validate` | 校验 div/style/code 配对、模板调用、展开残留 |
| `ftml watch` | 监听源文件 / 模板变化，自动重建 |
| `ftml preview` | 构建并渲染为 HTML 预览（@wdprlib/render） |
| `ftml submit` | 构建并提交到 Wikidot 页面 |
| `ftml deploy` | 构建 + 校验 + 提交（一步部署） |
| `ftml revert` | git revert 撤销提交，并把恢复的产物回推 Wikidot |
| `ftml init` | 初始化项目结构（`.ftml/`、`.gitignore`、`git init`） |
| `ftml web` | 启动本地 web 编辑器（左侧编辑、右侧实时预览） |

### login

```bash
ftml login                # 交互式输入用户名密码
ftml login --env          # 从环境变量读取并保存
```

凭证来源优先级：环境变量 `WIKIDOT_USERNAME` / `WIKIDOT_PASSWORD`（自动加载 `.env`）> 文件 `~/.ftml-cli/credentials.json`。

### build / expand

```bash
ftml build -s index.ftml -t templates -o dist/index.ftml
ftml expand index.ftml                # 输出到 stdout
ftml expand index.ftml -o out.ftml    # 写入文件
ftml list --json                      # 模板清单（JSON）
```

模板目录解析优先级：`--templates` 参数 > 项目配置 `templatesDir` > 输入文件同级的 `templates/` > 内置 `templates/`。

完整模板 / 组件语法见下文「[模板与组件语法](#模板与组件语法)」。

### validate

```bash
ftml validate -s dist/index.ftml -t templates
```

退出码 0 = 通过，1 = 有错误。div 不平衡但差异 ≤10 时只给警告（组件本身可能刻意不平衡）。

### watch

```bash
ftml watch -s index.ftml -o dist/index.ftml --debounce 300
```

监听源文件、模板目录、源文件同目录的 `.ftml` 组件，变化后防抖自动重建。

### preview

```bash
ftml preview                          # 构建 → 渲染 HTML → 写入 build 产物同名 .html（dist/index.ftml → dist/index.html）
ftml preview -o preview.html          # 指定输出文件
ftml preview --open                   # 生成后用系统浏览器打开
ftml preview --site scpsandboxcn --page my-page   # 提供页面上下文，正确解析站内引用
```

用 `@wdprlib/parser` + `@wdprlib/render` 把展开后的 FTML 渲染为 HTML：
- `[[module CSS]]`（由 `[[style]]` 构建而来）收集为 `<style>` 内联进 HTML
- 解析/渲染诊断（如未闭合块）以 `警告` 输出到 stderr，不阻断生成
- `[[include]]` 按**源文件所在目录**解析本地 `.ftml`（`component:box` → `component/box.ftml`）；目标文件先展开模板再渲染，嵌套 include 递归展开。遵守 Wikidot 规则：`[[include]]` 必须出现在行首
- 跨站 include（如 `[[include :scp-wiki-cn:theme:parallel]]`）按本地镜像解析：优先 `<site>/<page 斜杠化>.ftml`（→ `scp-wiki-cn/theme/parallel.ftml`），回退到普通位置（→ `theme/parallel.ftml`）；越界路径（`../`）一律拒绝
- **本地找不到的 include 自动远程拉取**：已登录（有凭证）时用 `@ukwhatn/wikidot` 客户端直接拉取页面源码（如 `:scp-wiki-cn:theme:parallel` → scp-wiki-cn 站点的 `theme:parallel` 页），渲染前同样先展开模板。拉取成功会写入**磁盘缓存** `~/.ftml-cli/cache/<site>/<page>.ftml`（跨项目共享），下次直接命中缓存不再请求网络。未登录或拉取失败则渲染「页面不存在」占位，失败会输出 `remote-include-failed` 警告到 stderr
- **输出为完整 HTML 文档并内联客户端 runtime**：生成的不是正文 fragment，而是带 `<!DOCTYPE html>` / `<meta charset="utf-8">` 的完整页面，并在 `<script type="module">` 中**内联 `@wdprlib/runtime`**（自包含 ESM，无网络依赖）并调用 `initWdprRuntime()`。浏览器打开后 tabview 切换、collapsible 折叠、TOC 折叠/展开、脚注悬浮提示、折叠列表、画廊灯箱、数学渲染等小部件可交互；另注入一份小部件基础 CSS（runtime 只自带 gallery 样式）

### submit / deploy / revert

```bash
ftml submit -m "更新文档"              # 构建并提交（-m 必填编辑注释）
ftml submit -s out.ftml --no-build -m "直接提交产物"
ftml deploy -m "上线 v2"               # build + validate + submit
ftml deploy --no-validate -m "跳过校验"
ftml revert                            # git revert HEAD，并把恢复的产物回推线上
ftml revert --to HEAD~2                # 回退到指定 git 提交
ftml revert --no-wikidot               # 只做本地 git revert，不回推线上
```

- `submit` / `revert` 成功后：本地 `git commit`、把记录追加到 `.ftml/history.json`、把 site/page/lastRev 写入 `.ftml/<源文件名>.json` 元数据
- `revert` 前置要求：项目是 git 仓库、工作区干净、已有构建产物。它做两件事——① `git revert <commit>` 生成反向提交恢复源文件与产物；② 把恢复后的构建产物 `edit` 回 Wikidot 页面（与 submit 对称，线上同步回退）
- site/page 对象按客户端缓存（`src/utils/wikidot.js`）：同一进程内重复获取不发网络请求。缓存以客户端实例为键，`client.close()` 登出后自动失效；页面不存在（null）不缓存

### init

```bash
ftml init
```

幂等初始化项目结构（可重复执行）：`.ftml/`（隐藏数据目录，含 `history.json`）、`components/`、`templates/`、`.gitignore`（忽略 `dist/` 与 `.ftml/`）、`.ftmlrc.json` 占位、`git init`（若还不是仓库）。

### web

```bash
ftml web                        # 启动编辑器，默认 http://127.0.0.1:3000
ftml web --root /public/drafts  # 启动并注册默认项目
ftml web --port 8080 --host 0.0.0.0   # 自定义端口/绑定地址
ftml web --open                 # 启动后用系统浏览器打开
```

本地 web 编辑器（`node:http` 零依赖），复用 CLI 命令作为引擎：

- **布局**：左侧 textarea 编辑源文件，右侧 iframe 实时预览（各 50%）；侧边栏列出模板 / 组件 / 源文件，支持模板键自动补全
- **保存即预览**：编辑防抖 600ms 自动保存并重渲染完整 HTML（内联 runtime），Ctrl/Cmd+S 立即保存；预览输出与 `ftml preview` 一致（`<!DOCTYPE html>` + 内联 `@wdprlib/runtime`）
- **多项目**：项目注册表存用户级 `~/.ftml-cli/projects.json`，顶栏下拉切换；`+` 添加目录、删除仅注销不删文件
- **目标页面**：顶栏设置 site / page，保存到 `.ftml/<源文件名>.json` 元数据（优先级不变：命令行 > 配置 > 元数据）
- **操作**：校验（状态栏内联诊断）、部署（build + validate + editPage + git commit + history/元数据）、回退（自动提交 + 真 git revert + rebuild + 回推，对应 `revert --autoCommit --rebuild`）、init、登录/登出（凭证 0600）
- **安全**：默认只绑 `127.0.0.1`（`--host` 覆盖）；文件读写做路径穿越校验，必须落在项目根内

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

### site / page 元数据

`site` / `page` 来源（优先级从高到低）：

1. 命令行 `--site` / `--page`
2. 配置文件 `ftml.config.json` / `.ftmlrc.json` / `.ftmlrc`
3. 项目元数据 `.ftml/<源文件名>.json`（`index.ftml` ↔ `index.json`，submit/revert 时自动写入）

### 目录结构

```
<项目根>/
  .ftml/                    项目级隐藏数据目录
    history.json            提交历史（submit/revert 追加）
    <源文件名>.json         site/page 元数据
  dist/                     构建产物（gitignore）
  components/  templates/   源文件与模板
  .ftmlrc.json              项目配置
~/.ftml-cli/                用户级共享目录（跨 ftml 项目）
  credentials.json          登录凭证（0600）
  cache/<site>/<page>.ftml  远程拉取的 include 源码缓存
```

测试 / 隔离可用环境变量 `FTML_CLI_HOME` 重定向用户级目录。

## 模板与组件语法

### 1. 模板文件（`.ftmx`）

一个 `.ftmx` 文件定义一个模板，必须被**单个元素**包裹：

```
[[div class="addendum" title]]
[[span class="addendum-title"]]{ title }[[/span]]
{ children }
[[/div]]
```

**开标签 `[[ ... ]]` 内的 token 分三类：**

| token | 示例 | 含义 |
| --- | --- | --- |
| 第一个 | `div` | 包裹元素名，展开时输出为 `[[div]]...[[/div]]` |
| 带 `=` | `class="addendum"` | 元素字面属性，展开时原样拼进开标签 |
| 裸词 | `title` | 声明的自定义键，调用方必须传入同名属性 |

- 元素名 / 键名只允许 `A-Za-z0-9_-`，非法命名直接报错
- body 中 `{ title }` 占位符对应的键必须已在开标签声明，调用缺参数也会报错

**body 中的占位符：**

- `{ 键名 }` → 替换为调用时传入的值
- `{ children }` → 内置键，替换为调用开/闭标签之间的子内容（ftml，原样插入）
- 转义：`\{` 输出字面 `{`，`\}` 输出字面 `}`，`\\` 输出字面 `\`

**空名根 `[[]] ... [[/]]`**：模板需要输出多个根元素时，用空名根包裹：

```
[[ ]]
[[div class="block"]]区块一[[/div]]
[[div class="block"]]区块二[[/div]]
[[/]]
```

空名根只输出 body，不产生包裹元素。

**解析校验**：文件必须以 `[[元素...]]` 开头、必须有配对闭合标签、闭合标签之后不能有多余内容。

### 2. 调用处（`.ftml`）

```
[[addendum title='附录A' clearance='3']]
这里写正文，可以包含任意 wiki 语法
[[/addendum]]
```

- 只有 `[[name ...]]` 且 `name` **命中已加载的 `.ftmx`** 时才算模板调用；否则（`div` / `span` / `include` 等原生元素）**原样透传**，不受影响
- 属性值分两种类型：

| 写法 | 类型 | 插入方式 |
| --- | --- | --- |
| `title='值'` 或 `title="值"` | string | FTML 转义（`[[` → `[[]]`）后按**字面文本**插入，值里的 wiki 语法不会被渲染 |
| `content=值`（不带引号） | ftml | **原样**插入，可含任意 wiki 语法 |

```
[[card title='[[div]]x[[/div]]']]     # string：渲染为字面文本 [[div]]x[[/div]]，不产生 div
[[card content=[[note]]hi[[/note]]]]  # ftml：原样插入 [[note]]hi[[/note]]
```

- 不带引号的值可以整体是一段 wiki 语法（如 `content=[[note]]hi[[/note]]`），标签切分按括号深度计数，不会误截断
- children（开/闭标签之间的内容）总是 ftml 类型，原样插入

**嵌套与安全：**

- children 内、模板 body 内都可以再调用模板（先替换占位符，再递归展开嵌套调用）
- 嵌套调用能使用外层参数：模板 body 里写 `[[inner label='{ title }']]`，调用 `[[t title='标题']]` 时内层拿到 `标题`
- 模板循环调用（a→b→a）直接报错；嵌套深度上限 32

### 3. `[[style]]` → `[[module CSS]]`

`[[style]]...[[/style]]` 块**不输出到正文**，而是按出现顺序收集，在结果**开头**生成一个 `[[module CSS]]...[[/module]]`：

- 顶层、children 内、模板 body 内、组件文件内的 `[[style]]` 都会被收集
- 相同内容的块去重（模板被多次调用时 CSS 只输出一次）
- 模板 body 的 CSS 里，`{ 已声明键 }` 会被替换为调用参数；其余 `{ ... }`（如 `.a { color: red }`、`@supports` 块）按 CSS 语法**原样保留**，不会被误当占位符
- `[[code]]` 块内的 `[[style]]` 不收集

### 4. `[[component src="..."]][[/component]]` 文件组件

把一段 `.ftml` 文件按引用内联：

```
[[component src="components/code.ftml"]][[/component]]
```

- 只接受一个 `src` 参数；children 必须为空（不允许子内容）
- 相对路径以**组件所在目录**解析（嵌套引用 `src="sub/b.ftml"` 时以子目录为基准）
- 支持依赖链：组件内可再引用组件，递归展开
- 循环依赖（a→b→a）直接报错
- 组件内可以调用模板、收集 `[[style]]`
- **模板 body 内不允许**使用 `[[component]]`（组件是文件级复用，请写在调用层 `.ftml`）

### 5. `[[code]]` 原样透传

`[[code]]...[[/code]]` 代码块整体原样透传：

- 块内的模板调用不展开（文档示例应保持原样）
- 块内的 `[[style]]` 不收集
- `validate` 的残留检查也跳过 code 块
- 未闭合的 `[[code]]` 报错

### 6. 常见错误信息

| 场景 | 错误 |
| --- | --- |
| 调用缺参数 | `模板 [[addendum]] 调用缺少参数 { title }（模板声明: title）` |
| 调用未闭合 | `模板调用 [[addendum]] 缺少闭合标签 [[/addendum]]` |
| 循环调用 | `模板循环调用检测到: a -> b -> a` |
| 深度超限 | `模板嵌套超过最大深度 32` |
| 组件循环依赖 | `组件循环依赖: /x/a.ftml -> /x/b.ftml -> /x/a.ftml` |
| 组件缺 src / 多余参数 | `[[component]] 只接受一个 src 参数（无自定义参数），收到: (无)` |
| 模板 body 用组件 | `模板 [[t]] 的 body 中不允许使用 [[component]]，请把组件引用放在调用层 .ftml 中` |

## 许可证
ISC