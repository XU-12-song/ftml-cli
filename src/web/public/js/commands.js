/**
 * commands.js — 命令注册表（命令面板的数据源）
 *
 * 每条命令：{ group, title, key, keywords?, enabled?, run }
 *   key    全局快捷键，由 keymap.js 解析分发（面板右侧显示为芯片）
 *   enabled 返回 false 时命令仍可见但置灰不可执行（如未打开文件时的「保存」），
 *   便于用户发现功能、理解前置条件。
 *
 * 快捷键选型：低频命令统一走 Ctrl+Alt+<字母>，避开浏览器与 Linux 桌面环境
 * 已占用的组合（Ctrl+Alt+T 终端 / Ctrl+Alt+L 锁屏 / Ctrl+Alt+D 显示桌面），
 * 也避开 AltGr 之外的常用键；高频命令保留业界惯例（Ctrl+S、Ctrl+,）。
 * 注意 Ctrl+Alt+<字母> 在使用 AltGr 的欧洲键盘布局上会抢占打字符号，
 * 若遇到可自行改这里的 key。
 */
import { state } from './dom.js';
import {
  newSource, newTemplate, newComponent,
  saveCurrent, remoteRefresh, validateCurrent, deployCurrent,
} from './editor.js';
import { openAddProject, openNewRepo, initGitProject } from './projects.js';
import { openVersionsDialog } from './versions.js';
import { openSettings } from './settings.js';
import { runDoctor } from './git.js';
import { toggleLogin } from './auth.js';
import { toggleLayout, toggleZen } from './layout.js';
import { openTargetDialog } from './target.js';

const hasProject = () => !!state.projectId;
const hasFile = () => !!state.projectId && !!state.filePath;

export const COMMANDS = [
  // ---- 文件 ----
  { group: '文件', title: '新建页面（源文件）', key: 'Ctrl+Alt+N', keywords: 'new page source', run: newSource },
  { group: '文件', title: '新建模板', key: 'Ctrl+Alt+M', keywords: 'new template ftmx', run: newTemplate },
  { group: '文件', title: '新建组件', key: 'Ctrl+Alt+C', keywords: 'new component', run: newComponent },

  // ---- 编辑 ----
  { group: '编辑', title: '保存并渲染', key: 'Ctrl+S', keywords: 'save render', enabled: hasFile, run: saveCurrent },
  { group: '编辑', title: '联网刷新 include', key: 'Ctrl+Shift+R', keywords: 'remote refresh include network', enabled: hasFile, run: remoteRefresh },

  // ---- 项目 ----
  { group: '项目', title: '添加已有项目', key: 'Ctrl+Alt+O', keywords: 'add project open folder', run: openAddProject },
  { group: '项目', title: '新建 ftml 仓库', key: 'Ctrl+Alt+R', keywords: 'new repo create', run: openNewRepo },
  { group: '项目', title: '初始化 git 项目', key: 'Ctrl+Alt+I', keywords: 'init git repository', enabled: () => hasProject() && !state.isRepo, run: initGitProject },
  { group: '项目', title: '版本列表 / 回退', key: 'Ctrl+Alt+V', keywords: 'version revert history', enabled: hasProject, run: openVersionsDialog },

  // ---- 发布 ----
  { group: '发布', title: '部署（创建大版本）', key: 'Ctrl+Alt+P', keywords: 'deploy publish submit', enabled: hasFile, run: deployCurrent },
  { group: '发布', title: '校验当前文件', key: 'Ctrl+Alt+E', keywords: 'validate lint check', enabled: hasFile, run: validateCurrent },
  { group: '发布', title: '目标页面设置…', key: 'Ctrl+Alt+U', keywords: 'target site page', enabled: hasFile, run: openTargetDialog },

  // ---- 视图 ----
  { group: '视图', title: '编辑器设置…', key: 'Ctrl+,', keywords: 'settings preferences', run: openSettings },
  { group: '视图', title: '切换编辑·预览布局', key: 'Ctrl+Alt+S', keywords: 'layout split vertical horizontal', run: toggleLayout },
  { group: '视图', title: '禅模式', key: 'Ctrl+Shift+F', keywords: 'zen focus distraction', run: toggleZen },
  { group: '视图', title: 'git 环境检测', key: 'Ctrl+Alt+H', keywords: 'git doctor environment health', run: runDoctor },

  // ---- 账号 ----
  {
    group: '账号',
    title: () => (state.auth.loggedIn ? '退出登录' : '登录 Wikidot'),
    key: 'Ctrl+Alt+A',
    keywords: 'login logout account auth',
    run: toggleLogin,
  },
];
