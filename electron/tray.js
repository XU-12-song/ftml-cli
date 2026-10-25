/**
 * tray.js — 托盘图标与菜单
 *
 * 交互约定：最小化时隐藏到托盘；关闭窗口直接退出。
 * 托盘菜单提供恢复、打开项目、最近项目与退出。
 */

import { Tray, Menu, nativeImage } from 'electron';

let tray = null;
let handlers = {};

function buildMenu() {
  const recent = (handlers.recentProjects ?? []).slice(0, 5);
  return Menu.buildFromTemplate([
    { label: '打开 ftml', click: () => handlers.onOpen?.() },
    { label: '打开项目…', click: () => handlers.onOpenProject?.() },
    {
      label: '最近项目',
      submenu: recent.length
        ? recent.map((p) => ({
          label: p.name || p.root,
          click: () => handlers.onOpenRecent?.(p.root),
        }))
        : [ { label: '（无）', enabled: false } ],
    },
    { type: 'separator' },
    { label: '退出', click: () => handlers.onQuit?.() },
  ]);
}

/** 首次创建托盘；iconPath 不存在时用空图占位（开发期未生成资产） */
export function createTray({ iconPath, tooltip = 'ftml', ...rest }) {
  handlers = { ...handlers, ...rest };
  let image = nativeImage.createFromPath(iconPath);
  if (image.isEmpty()) image = nativeImage.createEmpty();
  tray = new Tray(image);
  tray.setToolTip(tooltip);
  tray.on('click', () => handlers.onOpen?.());
  tray.on('double-click', () => handlers.onOpen?.());
  updateTrayMenu(rest);
  return tray;
}

/** 最近项目变化后重建菜单 */
export function updateTrayMenu(opts = {}) {
  if (!tray) return;
  handlers = { ...handlers, ...opts };
  tray.setContextMenu(buildMenu());
}

export function destroyTray() {
  if (!tray) return;
  tray.destroy();
  tray = null;
}
