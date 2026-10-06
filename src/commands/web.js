/**
 * web — 启动本地 web 编辑器
 *
 *   ftml web [--root <dir>] [--port <n>] [--host <addr>] [--open]
 *
 * 默认端口 3000，绑 127.0.0.1。--root 指定默认打开的项目（不存在时编辑器
 * 处于"添加项目"页）。--open 用系统浏览器打开。
 */

import fs from 'node:fs';
import path from 'node:path';
import { createServer } from '../web/server.js';
import { addProject, loadProjects } from '../web/projects.js';
import { homeFtmlCliDir } from '../infra/paths.js';
import { readThemeCss, refreshThemeCss } from '../render/theme.js';

export async function web(options) {
  const root = options.root ? path.resolve(options.root) : null;
  if (root) {
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
      throw new Error(`目录不存在或不是文件夹: ${root}`);
    }
    addProject(root);
  }

  const port = Number(options.port) || 3000;
  const host = options.host || '127.0.0.1';
  const server = createServer();

  // 主题样式表预热：渲染路径只同步读缓存（see handlers/render.js），因此必须在开始
  // 接受请求**之前**把缓存备好，否则首个整篇重载会因缓存为空而退回远程 @import，
  // 又出现「偶发纯黑白」。缓存新鲜时这里立即返回、不联网；刷新失败不阻断启动，
  // 只提示——拿不到缓存的渲染仍会退回 @import（旧行为）。
  await warmThemeCache();

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const url = `http://${host}:${port}`;
  const projects = loadProjects();
  console.log(`✓ ftml web 编辑器已启动 → ${url}（${projects.length} 个项目已注册）`);
  console.log(`  按 Ctrl+C 停止`);

  if (options.open) {
    await openInBrowser(url);
  }

  // 保持进程运行直到 Ctrl+C
  return new Promise(() => {});
}

/** 预热主题缓存：已有可用缓存时不联网，缺失/过期才拉取 */
async function warmThemeCache() {
  if (readThemeCss({ requireFresh: true }).css) return;
  try {
    const { errors } = await refreshThemeCss();
    if (errors.length) {
      console.error(`警告: 主题样式表预热失败（${errors.map((e) => e.url).join(', ')}），预览将退回远程 @import`);
    }
  } catch (e) {
    console.error(`警告: 主题样式表预热失败（${e.message}），预览将退回远程 @import`);
  }
}

/** 用系统默认浏览器打开地址（跨平台） */
async function openInBrowser(url) {
  const { exec } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execAsync = promisify(exec);
  const platform = process.platform;
  try {
    if (platform === 'darwin') {
      await execAsync(`open "${url}"`);
    } else if (platform === 'win32') {
      await execAsync(`start "" "${url}"`);
    } else {
      await execAsync(`xdg-open "${url}"`);
    }
  } catch (e) {
    console.error(`警告: 打开浏览器失败（${e.message}），地址仍在 ${url}`);
  }
}
