/**
 * menu.js — 原生应用菜单
 *
 * 关闭窗口 = 退出；最小化 = 隐藏到托盘，所以菜单里单独提供「隐藏到托盘」。
 */

import { Menu } from 'electron';

/**
 * @param {object} [options]
 * @param {boolean} [options.isDev]
 * @param {() => void} [options.onOpenProject]
 * @param {() => void} [options.onOpenFile]
 * @param {() => void} [options.onHide]
 * @param {() => void} [options.onQuit]
 * @param {() => void} [options.onReload]
 * @param {() => void} [options.onToggleDevTools]
 * @param {() => void} [options.onOpenDataDir]
 * @param {() => void} [options.onAbout]
 */
export function buildAppMenu({
  isDev = false,
  onOpenProject,
  onOpenFile,
  onHide,
  onQuit,
  onReload,
  onToggleDevTools,
  onOpenDataDir,
  onAbout,
} = {}) {
  const isMac = process.platform === 'darwin';
  /** @type {import('electron').MenuItemConstructorOptions[]} */
  const viewItems = [
    { label: '重新加载', accelerator: 'CmdOrCtrl+R', click: () => onReload?.() },
    ...(isDev
      ? /** @type {import('electron').MenuItemConstructorOptions[]} */ ([
        { label: '开发者工具', accelerator: 'F12', click: () => onToggleDevTools?.() },
        { type: 'separator' },
      ])
      : []),
    { role: 'resetZoom', label: '实际大小' },
    { role: 'zoomIn', label: '放大' },
    { role: 'zoomOut', label: '缩小' },
    { type: 'separator' },
    { role: 'togglefullscreen', label: '全屏' },
  ];

  /** @type {import('electron').MenuItemConstructorOptions[]} */
  const template = [
    ...(isMac
      ? /** @type {import('electron').MenuItemConstructorOptions[]} */ ([ { role: 'appMenu' } ])
      : []),
    {
      label: '文件',
      submenu: [
        { label: '打开项目…', accelerator: 'CmdOrCtrl+O', click: () => onOpenProject?.() },
        { label: '打开 .ftml 文件…', accelerator: 'CmdOrCtrl+Shift+O', click: () => onOpenFile?.() },
        { type: 'separator' },
        { label: '隐藏到托盘', accelerator: 'CmdOrCtrl+W', click: () => onHide?.() },
        { label: '退出', accelerator: 'CmdOrCtrl+Q', click: () => onQuit?.() },
      ],
    },
    { role: 'editMenu', label: '编辑' },
    { label: '视图', submenu: viewItems },
    {
      label: '帮助',
      submenu: [
        { label: '打开数据目录', click: () => onOpenDataDir?.() },
        { label: '关于 ftml', click: () => onAbout?.() },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
