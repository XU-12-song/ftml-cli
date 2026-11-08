# 模板与组件语法

ftml 提供两种复用方式：

| 方式 | 文件 | 适合 |
| --- | --- | --- |
| **模板** | `templates/*.ftmx` | 带参数的重复结构（卡片、附录、警告框…） |
| **组件** | `components/*.ftml` | 整段固定 FTML 文件的内联复用 |

模板调用写在 `.ftml` 源文件中，构建时展开为纯 FTML。

## 1. 模板文件（`.ftmx`）

一个 `.ftmx` 文件定义一个模板，必须被**单个元素**包裹：

```ftml
[[div class="addendum" title]]
[[span class="addendum-title"]]{ title }[[/span]]
{ children }
[[/div]]
```

### 开标签 token

开标签 `[[ ... ]]` 内的 token 分三类：

| token | 示例 | 含义 |
| --- | --- | --- |
| 第一个 | `div` | 包裹元素名，展开时输出为 `[[div]]...[[/div]]` |
| 带 `=` | `class="addendum"` | 元素字面属性，展开时原样拼进开标签 |
| 裸词 | `title` | 声明的自定义键，调用方必须传入同名属性 |

- 元素名 / 键名只允许 `A-Za-z0-9_-`，非法命名直接报错。
- body 中 `{ title }` 占位符对应的键必须已在开标签声明；调用缺参数也会报错。

### body 占位符

- `{ 键名 }` → 替换为调用时传入的值。
- `{ children }` → 内置键，替换为调用开 / 闭标签之间的子内容（FTML，原样插入）。
- 转义：`\{` 输出字面 `{`，`\}` 输出字面 `}`，`\\` 输出字面 `\`。

### 空名根

模板需要输出多个根元素时，用空名根包裹：

```ftml
[[ ]]
[[div class="block"]]区块一[[/div]]
[[div class="block"]]区块二[[/div]]
[[/]]
```

空名根只输出 body，不产生包裹元素。

### 解析校验

文件必须以 `[[元素...]]` 开头、必须有配对闭合标签、闭合标签之后不能有多余内容。

## 2. 调用处（`.ftml`）

```ftml
[[addendum title='附录A' clearance='3']]
这里写正文，可以包含任意 wiki 语法
[[/addendum]]
```

- 只有 `[[name ...]]` 且 `name` **命中已加载的 `.ftmx`** 时才算模板调用；否则（`div` / `span` / `include` 等原生元素）**原样透传**。
- 属性值分两种类型：

| 写法 | 类型 | 插入方式 |
| --- | --- | --- |
| `title='值'` 或 `title="值"` | string | FTML 转义（`[[` → `[[]]`）后按**字面文本**插入，值里的 wiki 语法不会被渲染 |
| `content=值`（不带引号） | ftml | **原样**插入，可含任意 wiki 语法 |

```ftml
[[card title='[[div]]x[[/div]]']]     # string：渲染为字面文本，不产生 div
[[card content=[[note]]hi[[/note]]]]  # ftml：原样插入 [[note]]hi[[/note]]
```

- 不带引号的值可以整体是一段 wiki 语法（如 `content=[[note]]hi[[/note]]`），标签切分按括号深度计数，不会误截断。
- children（开 / 闭标签之间的内容）总是 ftml 类型，原样插入。

### 嵌套与安全

- children 内、模板 body 内都可以再调用模板（先替换占位符，再递归展开嵌套调用）。
- 嵌套调用能使用外层参数：模板 body 里写 `[[inner label='{ title }']]`，调用 `[[t title='标题']]` 时内层拿到 `标题`。
- 模板循环调用（a→b→a）直接报错；嵌套深度上限 32。

## 3. `[[style]]` → `[[module CSS]]`

`[[style]]...[[/style]]` 块**不输出到正文**，而是按出现顺序收集，在结果**末尾**生成一个 `[[module CSS]]...[[/module]]`：

- 顶层、children 内、模板 body 内、组件文件内的 `[[style]]` 都会被收集。
- 相同内容的块去重（模板被多次调用时 CSS 只输出一次）。
- 模板 body 的 CSS 里，`{ 已声明键 }` 会被替换为调用参数；其余 `{ ... }`（如 `.a { color: red }`、`@supports` 块）按 CSS 语法**原样保留**。
- `[[code]]` 块内的 `[[style]]` 不收集。

## 4. `[[component src="..."]][[/component]]`

把一段 `.ftml` 文件按引用内联：

```ftml
[[component src="components/code.ftml"]][[/component]]
```

- 只接受一个 `src` 参数；children 必须为空。
- 相对路径以**组件所在目录**解析（嵌套引用 `src="sub/b.ftml"` 时以子目录为基准）。
- 支持依赖链：组件内可再引用组件，递归展开。
- 循环依赖（a→b→a）直接报错。
- 组件内可以调用模板、收集 `[[style]]`。
- **模板 body 内不允许**使用 `[[component]]`（组件是文件级复用，请写在调用层 `.ftml`）。

## 5. `[[code]]` 原样透传

`[[code]]...[[/code]]` 代码块整体原样透传：

- 块内的模板调用不展开（文档示例应保持原样）。
- 块内的 `[[style]]` 不收集。
- `validate` 的残留检查也跳过 code 块。
- 未闭合的 `[[code]]` 报错。

## 6. 常见错误

| 场景 | 错误 |
| --- | --- |
| 调用缺参数 | `模板 [[addendum]] 调用缺少参数 { title }（模板声明: title）` |
| 调用未闭合 | `模板调用 [[addendum]] 缺少闭合标签 [[/addendum]]` |
| 循环调用 | `模板循环调用检测到: a -> b -> a` |
| 深度超限 | `模板嵌套超过最大深度 32` |
| 组件循环依赖 | `组件循环依赖: /x/a.ftml -> /x/b.ftml -> /x/a.ftml` |
| 组件缺 src / 多余参数 | `[[component]] 只接受一个 src 参数（无自定义参数），收到: (无)` |
| 模板 body 用组件 | `模板 [[t]] 的 body 中不允许使用 [[component]]，请把组件引用放在调用层 .ftml 中` |

## 示例：卡片模板

`templates/card.ftmx`：

```ftml
[[div class="block"]]
[[span class="card-title"]]{ title }[[/span]]

{ children }
[[/div]]
```

`index.ftml`：

```ftml
[[card title="项目卡片"]]
模板让重复结构只写一次，调用时只需要传参数。
[[/card]]
```
