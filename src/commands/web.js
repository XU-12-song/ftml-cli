/**
 * web — 启动本地 web 编辑器
 *
 *   ftml web [--root <dir>] [--port <n>] [--host <addr>] [--open]
 *
 * 默认端口 3000，绑 127.0.0.1。--root 指定默认打开的项目（不存在时编辑器
 * 处于"添加项目"页）。--open 用系统浏览器打开。
 */

import { loadProjects } from '../web/projects.js';
import { startWebServer } from '../web/start.js';

export async function web(options) {
  // startWebServer 负责 root 校验、addProject、主题预热、监听与真实端口
  const { url } = await startWebServer({
    root: options.root,
    port: options.port,
    host: options.host,
  });

  const projects = loadProjects();
  console.log(`✓ ftml web 编辑器已启动 → ${url}（${projects.length} 个项目已注册）`);
  console.log('  按 Ctrl+C 停止');

  if (options.open) {
    await openInBrowser(url);
  }

  // 保持进程运行直到 Ctrl+C
  return new Promise(() => {});
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
