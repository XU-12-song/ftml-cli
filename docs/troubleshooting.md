# 常见问题

## 安装 / 启动

### Windows 提示「已保护你的电脑」

当前构建未签名，SmartScreen 会拦截新下载的 exe。核对文件来自本仓库 Releases 后，点「更多信息 → 仍要运行」。

### 双击 `.ftml` 没有关联

便携版不注册文件关联。改用安装版，或在应用内通过「添加已有项目 / 打开文件」打开。

### 端口被占用

```bash
ftml web --port 8080
```

桌面版使用随机端口，一般不会冲突。

### 页面打开后是空白 / 黑白

预览主题需要联网获取并缓存。首次离线启动会退回远程 `@import`，可能短暂无样式。联网启动一次 `ftml preview` 或 `ftml web` 会预热缓存。

## 项目 / 文件

### 提示 `ENOENT ... index.ftml`

目录还不是 ftml 项目，或 `index.ftml` 不存在。

```bash
ftml init
```

新版本 `init` 会补一个起始 `index.ftml`。也可以自己创建任意 `.ftml` 并 `ftml build -s 文件名.ftml`。

### 项目下拉是空的

还没有注册项目。桌面版点「添加已有项目」或「新建 ftml 仓库」；CLI 用 `ftml web --root <目录>` 启动并注册。

### 侧边栏看不到文件

模板只扫描 `templates/`，组件只扫描 `components/`，源文件扫描项目根及子目录的 `.ftml`。确认文件扩展名与位置正确。

## git / 版本

### 提示 git 未安装或未配置身份

```bash
ftml doctor
```

按输出提示安装 git，并配置：

```bash
git config --global user.name "你的名字"
git config --global user.email "you@example.com"
```

### 提交 / 部署提示「不是 git 仓库」

```bash
ftml init
```

或在桌面版命令面板执行「初始化 git 项目」。

### 回退提示工作区有未提交改动

先提交 / stash，或加 `--auto-commit`：

```bash
ftml revert --auto-commit --to 1.2
```

Web 编辑器回退时会自动提交。

### 部署失败后版本号前进了吗？

不会。构建、校验或发布失败时不会写入大版本记录，修复后重试即可。

### 回退小版本，线上为什么回到大版本？

线上只在大版本发布。小版本是本地状态，没有线上快照。详见 [版本管理](versions.md#回退revert)。

## Wikidot

### 提示未找到凭证

```bash
ftml login
# 或
export WIKIDOT_USERNAME='...'
export WIKIDOT_PASSWORD='...'
ftml login --env
```

凭证也保存在 `~/.ftml-cli/credentials.json`。

### 部署提示「页面不存在」

部署不会自动创建入口页。先到 Wikidot 手动创建目标页面，或检查站点 / 页面名是否写错。

依赖页（本地 `[[include]]` 指向的页面）不存在时会自动创建。

### include 显示「页面不存在」占位

本地找不到、又未登录或网络失败时会发生：

1. 把页面镜像到本地（如 `scp-wiki-cn/theme/parallel.ftml`）。
2. 登录后点「联网刷新 include」。
3. 检查跨站引用名是否正确。

### 登录失败

确认用户名密码正确、站点可访问；部分站点要求先完成验证码或两步验证。也可以试试 `ftml login --env`。

## 其他

### 数据存在哪里？

默认 `~/.ftml-cli`，见 [目录结构](getting-started.md#2-创建第一个项目)。可用 `FTML_CLI_HOME` 重定向。

### 怎么彻底重来？

项目文件不会被工具删除；用户级数据在 `~/.ftml-cli`。清理前请备份 `credentials.json`、`projects.json` 与各项目的 `.ftml/`。

### 还有问题？

[提交 Issue](https://github.com/XU-12-song/ftml-cli/issues)，附上：

- 使用的入口（桌面版 / CLI / web）与版本
- 完整报错信息
- `ftml doctor` 输出（涉及 git / 版本问题时）
