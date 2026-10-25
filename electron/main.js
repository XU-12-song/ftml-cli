/**
 * main.js — Electron 主进程
 *
 * 复用现有 Express 编辑器：本地随机端口 + 一次性 token，窗口加载本地 URL。
 * 桌面集成：单实例、.ftml 文件关联、托盘、原生目录选择、窗口状态。
 *
 * 交互约定：最小化 → 隐藏到托盘；点关闭 → 退出应用。
 */

import { app, BrowserWindow, ipcMain, dialog, shell, screen } from 'electron';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { startWebServer } from '../src/web/start.js';
import { addProject, loadProjects } from '../src/web/projects.js';
import { homeFtmlCliDir } from '../src/infra/paths.js';
import { findFtmlFileArg, resolveOpenTarget } from './file-open.js';
import { loadWindowState, trackWindowState } from './window-state.js';
import { createTray, updateTrayMenu, destroyTray } from './tray.js';
import { buildAppMenu } from './menu.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ID = 'com.ftml.cli';
const IS_E2E = process.env.FTML_E2E === '1';
const IS_DEV = !app.isPackaged;

let mainWindow = null;
let serverCtl = null;
let tray = null;
let isQuitting = false;
let quitCleanupStarted = false;
let pendingTarget = null;
let rendererReady = false;
let trayHintShown = false;

app.setAppUserModelId(APP_ID);

const gotLock = IS_E2E || app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const file = findFtmlFileArg(argv);
    if (file) openFtmlFile(file);
    else showWindow();
  });

  app.whenReady().then(boot).catch(fatal);
}

function fatal(err) {
  try {
    dialog.showErrorBox('ftml 启动失败', err?.stack || err?.message || String(err));
  } finally {
    app.quit();
  }
}

function statePath() {
  return path.join(homeFtmlCliDir(), 'window-state.json');
}

function assetPath(rel) {
  const inApp = path.join(app.getAppPath(), rel);
  if (fs.existsSync(inApp)) return inApp;
  return path.join(process.resourcesPath, rel);
}

function loadingUrl() {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>ftml</title>
<style>
html,body{height:100%;margin:0;background:#14181f;color:#dbe1ea;font:14px system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
body{display:grid;place-items:center}
.box{text-align:center;letter-spacing:.04em}
.logo{font-size:28px;font-weight:650;color:#8ab4f8}
.sub{margin-top:10px;color:#7c8595;font-size:12px}
</style></head><body><div class="box"><div class="logo">ftml</div><div class="sub">正在启动编辑器…</div></div></body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function createWindow() {
  const bounds = loadWindowState(statePath(), screen.getAllDisplays());
  const win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#14181f',
    title: 'ftml',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      webviewTag: false,
    },
  });

  mainWindow = win;
  if (bounds.maximized) win.maximize();
  trackWindowState(win, statePath());

  win.once('ready-to-show', () => win.show());
  win.on('closed', () => { if (mainWindow === win) mainWindow = null; });
  win.on('close', () => {
    if (IS_E2E) console.log('[ftml] window close');
    isQuitting = true;
  });
  win.on('minimize', (event) => {
    if (IS_E2E || isQuitting) return;
    event.preventDefault?.();
    win.hide();
    showTrayHint();
  });

  win.webContents.on('did-start-loading', () => { rendererReady = false; });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (isAllowedUrl(url)) return;
    event.preventDefault();
    if (/^https?:/i.test(url)) shell.openExternal(url).catch(() => {});
  });
  win.webContents.on('will-frame-navigate', (event) => {
    if (isAllowedUrl(event.url)) return;
    event.preventDefault();
    if (/^https?:/i.test(event.url)) shell.openExternal(event.url).catch(() => {});
  });

  win.loadURL(loadingUrl());
  return win;
}

function isAllowedUrl(url) {
  if (!url) return false;
  if (url.startsWith('data:') || url.startsWith('blob:') || url === 'about:blank') return true;
  if (!serverCtl) return false;
  try {
    return new URL(url).origin === new URL(serverCtl.url).origin;
  } catch {
    return false;
  }
}

function loadAppUrl(target) {
  if (!mainWindow || mainWindow.isDestroyed() || !serverCtl) return;
  const params = new URLSearchParams({ ftml_token: serverCtl.token ?? '' });
  if (target?.project) {
    params.set('project', target.project);
    if (target.file) params.set('file', target.file);
  }
  mainWindow.loadURL(`${serverCtl.url}/?${params.toString()}`);
}

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function showTrayHint() {
  if (IS_E2E || trayHintShown || !tray) return;
  trayHintShown = true;
  try {
    tray.displayBalloon({
      title: 'ftml',
      content: 'ftml 已隐藏到托盘；右键托盘图标可退出。',
      iconType: 'info',
    });
  } catch {
    /* 平台不支持气球提示 */
  }
}

function refreshTray() {
  if (!tray) return;
  updateTrayMenu({
    recentProjects: loadProjects(),
    onOpen: showWindow,
    onOpenProject: chooseProjectFolder,
    onOpenRecent: openProjectFolder,
    onQuit: quitApp,
  });
}

function setupTray() {
  if (IS_E2E) return;
  tray = createTray({
    iconPath: assetPath(path.join('assets', 'icons', 'tray', 'tray.ico')),
    tooltip: 'ftml',
    recentProjects: loadProjects(),
    onOpen: showWindow,
    onOpenProject: chooseProjectFolder,
    onOpenRecent: openProjectFolder,
    onQuit: quitApp,
  });
}

function setupMenu() {
  buildAppMenu({
    isDev: IS_DEV,
    onOpenProject: chooseProjectFolder,
    onOpenFile: chooseFtmlFile,
    onHide: () => mainWindow?.hide(),
    onQuit: quitApp,
    onReload: () => mainWindow?.webContents.reload(),
    onToggleDevTools: () => mainWindow?.webContents.toggleDevTools(),
    onOpenDataDir: () => shell.openPath(homeFtmlCliDir()).catch(() => {}),
    onAbout: showAbout,
  });
}

function showAbout() {
  const opts = {
    type: 'info',
    title: '关于 ftml',
    message: `ftml ${app.getVersion()}`,
    detail: `Electron ${process.versions.electron}\nNode ${process.versions.node}\n数据目录：${homeFtmlCliDir()}`,
    buttons: [ '确定' ],
    noLink: true,
  };
  if (mainWindow) dialog.showMessageBox(mainWindow, opts);
  else dialog.showMessageBox(opts);
}

function quitApp() {
  isQuitting = true;
  app.quit();
}

function registerIpc() {
  ipcMain.handle('ftml:pick-directory', async (event, opts = {}) => {
    if (!isTrustedSender(event)) return null;
    const dialogOpts = {
      title: opts.title || '选择目录',
      defaultPath: opts.defaultPath || undefined,
      properties: [ 'openDirectory' ],
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, dialogOpts)
      : await dialog.showOpenDialog(dialogOpts);
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  ipcMain.handle('ftml:renderer-ready', (event) => {
    if (!isTrustedSender(event)) return null;
    rendererReady = true;
    const target = pendingTarget;
    pendingTarget = null;
    return target;
  });
}

function isTrustedSender(event) {
  if (!serverCtl) return false;
  try {
    const url = event.senderFrame?.url || event.sender.getURL();
    return url.startsWith(serverCtl.url);
  } catch {
    return false;
  }
}

async function chooseProjectFolder() {
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, { title: '打开 ftml 项目', properties: [ 'openDirectory' ] })
    : await dialog.showOpenDialog({ title: '打开 ftml 项目', properties: [ 'openDirectory' ] });
  if (!result.canceled && result.filePaths[0]) openProjectFolder(result.filePaths[0]);
}

async function chooseFtmlFile() {
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, {
      title: '打开 .ftml 文件',
      properties: [ 'openFile' ],
      filters: [ { name: 'FTML', extensions: [ 'ftml' ] }, { name: '所有文件', extensions: [ '*' ] } ],
    })
    : await dialog.showOpenDialog({
      title: '打开 .ftml 文件',
      properties: [ 'openFile' ],
      filters: [ { name: 'FTML', extensions: [ 'ftml' ] }, { name: '所有文件', extensions: [ '*' ] } ],
    });
  if (!result.canceled && result.filePaths[0]) openFtmlFile(result.filePaths[0]);
}

function deliverTarget(target) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    pendingTarget = target;
    return;
  }
  if (rendererReady) {
    mainWindow.webContents.send('ftml:open-file', target);
  } else {
    pendingTarget = target;
  }
}

function openFtmlFile(filePath) {
  const target = resolveOpenTarget(filePath);
  if (!target) {
    showWindow();
    return;
  }
  try {
    addProject(target.project);
  } catch (e) {
    dialog.showErrorBox('无法打开文件', e.message);
    return;
  }
  refreshTray();
  showWindow();
  deliverTarget(target);
}

function openProjectFolder(root) {
  const abs = path.resolve(root);
  try {
    addProject(abs);
  } catch (e) {
    dialog.showErrorBox('无法打开项目', e.message);
    return;
  }
  refreshTray();
  showWindow();
  deliverTarget({ project: abs, file: null });
}

async function boot() {
  createWindow();
  registerIpc();
  setupMenu();

  try {
    serverCtl = await startWebServer({
      port: 0,
      host: '127.0.0.1',
      sessionToken: crypto.randomBytes(24).toString('base64url'),
      warmTheme: !IS_E2E, // 冒烟测试不联网预热主题
    });
  } catch (e) {
    fatal(e);
    return;
  }

  const initialFile = findFtmlFileArg(process.argv);
  let target = initialFile ? resolveOpenTarget(initialFile) : null;
  if (target) {
    try {
      addProject(target.project);
    } catch {
      target = null;
    }
  }

  loadAppUrl(target);
  setupTray();
  refreshTray();
}

app.on('before-quit', () => {
  if (IS_E2E) console.log('[ftml] before-quit');
  isQuitting = true;
});

app.on('will-quit', (event) => {
  if (IS_E2E) console.log('[ftml] will-quit, cleanup started =', quitCleanupStarted);
  if (quitCleanupStarted) return;
  quitCleanupStarted = true;
  event.preventDefault();
  destroyTray();
  Promise.resolve(serverCtl?.close?.())
    .then(() => { if (IS_E2E) console.log('[ftml] server closed'); })
    .catch(() => {})
    .finally(() => {
      if (IS_E2E) console.log('[ftml] quitting again');
      // 退出流程已拿到 will-quit 并被 preventDefault 拦截过一次；
      // 再次 app.quit() 在 Electron 里可能被忽略，直接 exit 保证进程结束。
      app.exit(0);
    });
});

app.on('window-all-closed', () => {
  if (IS_E2E) console.log('[ftml] window-all-closed');
  app.quit();
});
app.on('activate', () => showWindow());
