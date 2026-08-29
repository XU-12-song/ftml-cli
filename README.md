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
| `ftml submit` | 构建并提交到 Wikidot 页面 |
| `ftml deploy` | 构建 + 校验 + 提交（一步部署） |
| `ftml revert` | 从 Wikidot 拉取线上 / 历史版本覆盖本地 |

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

### submit / deploy / revert

```bash
ftml submit -m "更新文档"              # 构建并提交（-m 必填编辑注释）
ftml submit -s out.ftml --no-build -m "直接提交产物"
ftml deploy -m "上线 v2"               # build + validate + submit
ftml deploy --no-validate -m "跳过校验"
ftml revert --site scpsandboxcn --page mypage          # 拉线上版覆盖本地
ftml revert --to 3 --output /tmp/old.ftml              # 拉历史修订到指定文件
```

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
