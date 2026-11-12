# 版本管理

ftml 的版本模型只有两个层级：

- **大版本 `x`**：一次 部署 。对应一次 git commit + tag，记录线上快照。
- **小版本 `x.y`**：一次 提交 。对应一次本地 git commit，不联网、不发布。

```text
deploy ─► 大版本 1（v1）+ 自动 submit ─► 1.1
submit ─► 1.2
submit ─► 1.3
deploy ─► 大版本 2（v2）+ 自动 submit ─► 2.1
```

## 我该用哪个？

| 我想… | 用 |
| --- | --- |
| 保存当前进度、做本地备份 | **提交** |
| 把当前内容发布到 Wikidot | **部署** |
| 撤销最近一次本地提交 | **提交** 反向操作或 `revert` |
| 把线上退回到某个历史版本 | **回退** |
| 只改本地、不碰线上 | `revert --no-wikidot` |

简而言之：**提交不联网，部署才上线。**

## 提交（submit）

```bash
ftml submit -m "调整 box 组件内侧距"
```

做的事：

1. 构建（默认；`--no-build` 跳过）。
2. `git commit` 当前工作区。
3. 在最近的大版本下递增小版本号，写入 `.ftml/versions.json` 和 `.ftml/history.json`。

不会推送、不会发布 Wikidot。尚未部署过的项目，小版本在 `0` 下（`0.1`、`0.2`…）。

## 部署（deploy）

```bash
ftml deploy -m "上线 v2" --site scpsandboxcn --page my-page
```

做的事：

1. 构建 + 校验（`--no-validate` 跳过）。
2. 创建大版本 `x`：`git commit` + `git tag vx`。
3. 推送远端（有 origin 时；`--no-push` 跳过）。
4. 发布到 Wikidot：入口页 + 本地 `[[include]]` 依赖页（依赖在前），并把本地引用名改写为线上全名。
5. 自动执行一次 submit，得到小版本 `x.1`。

部署前会打印预检摘要（目标页面、将要创建的版本、推送与依赖发布状态）。入口页必须**已存在**于线上；依赖页不存在时会自动创建。

`--no-deps` 退回旧行为：只发入口页，不发布依赖闭包、不改写引用名。

### 依赖闭包

- 递归收集入口 `[[include]]` 到的本地镜像页，叶子在前依次发布。
- `components/box` ↔ `components/box.ftml` 会发布为线上全名 `components:box`。
- 只改写命中本地镜像的引用；纯远程引用原样保留。
- 同一文件被两种引用名指到、两个文件要发布成同一页名等冲突会**直接中止**。
- 大版本快照保存的是**重写后**的入口源码，保证回退时线上与发布一致。

## 回退（revert）

```bash
ftml revert --list                 # 先看版本列表
ftml revert --to 2.3               # 回到小版本 2.3
ftml revert --to 1                 # 回到大版本 1
ftml revert --to HEAD~2            # 按 git 修订回退
ftml revert --no-wikidot --to 1.2  # 只做本地
```

| 目标 | 本地 | 线上 |
| --- | --- | --- |
| 大版本 `x` | 工作区回到大版本 `x` 的内容 | 回到大版本 `x` 的快照 |
| 小版本 `x.y` | 工作区回到小版本 `x.y` 的内容 | 回到**大版本 `x` 创建时**的版本 |
| `hash` / `HEAD~n` | 撤销该提交（单笔语义） | 使用重建后的当前产物 |

为什么回退小版本，线上却回到大版本？因为发布只在大版本发生。小版本 `x.y` 是本地状态，线上没有对应快照；能可靠还原的线上内容只有大版本 `x` 创建时的快照 `.ftml/versions/<x>.ftml`。

### 前置条件

- 项目是 git 仓库（`ftml init`）。
- 工作区干净；Web 编辑器自动保存常导致脏工作区，回退时会自动提交（CLI 用 `--auto-commit`）。
- 版本回退会自动重建产物（`dist/` 被 gitignore，git 无法恢复它）。

### 回退之后

- 本地会多出一笔 `revert <版本>` 提交，不会删除历史。
- `.ftml/` 版本记录不会被回退删除。
- 想再次上线，重新执行 `deploy` 创建一个新大版本。

## 文件与快照

```text
.ftml/
  versions.json           { "major": [...], "minor": [...] }
  versions/<x>.ftml       大版本发布时的入口快照
  history.json            提交 / 部署 / 回退历史
  <源文件名>.json          lastRev 等元数据（site / page 为项目级，存 .ftmlrc.json）
```

`versions.json` 示例：

```json
{
  "major": [ { "version": "1", "commit": "…", "tag": "v1", "message": "…", "createdAt": "…", "wikidotVersion": 12 } ],
  "minor": [ { "version": "1.1", "major": "1", "commit": "…", "message": "…", "createdAt": "…" } ]
}
```

## 常见问题

**部署失败了，版本号会前进吗？**
构建 / 校验失败会在大版本创建前中止；发布失败时也不会写入大版本记录。修复后重试。

**`revert --to x.y` 后线上为什么不是 x.y 的内容？**
线上没有 x.y 的快照，只能回到所属大版本 `x` 发布时的内容。需要 x.y 的内容上线，请重新部署。
