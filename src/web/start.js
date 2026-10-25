/**
 * start.js — web 服务器启动生命周期（CLI web 与 Electron 共用）
 *
 * 负责：项目注册、主题缓存预热、监听、真实端口解析、幂等关闭。
 * Electron 通过 port:0 + sessionToken 启动；CLI 仍使用默认 3000 且不启用安全层。
 */

import fs from 'node:fs';
import path from 'node:path';
import { createServer } from './server.js';
import { addProject } from './projects.js';
import { readThemeCss, refreshThemeCss } from '../render/theme.js';

/** 预热主题样式表：已有可用缓存时不联网，缺失/过期才拉取 */
export async function warmThemeCache() {
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

/** 端口：undefined/null/'' → 3000；允许 0（随机端口）；其余必须是 0–65535 整数 */
function normalizePort(port) {
  if (port === undefined || port === null || port === '') return 3000;
  const n = Number(port);
  if (!Number.isInteger(n) || n < 0 || n > 65535) {
    throw new Error(`非法端口: ${port}`);
  }
  return n;
}

/**
 * 启动 web 编辑器。
 * @param {object} [opts]
 * @param {string|null} [opts.root] 可选：注册并作为默认项目
 * @param {number} [opts.port] 默认 3000；0 表示随机端口
 * @param {string} [opts.host] 默认 127.0.0.1
 * @param {object} [opts.env] 透传给 handlers（测试注入 fake client）
 * @param {string|null} [opts.publicDir] 覆盖静态目录（默认 src/web/public）
 * @param {string|null} [opts.sessionToken] 设置后启用 Electron 模式安全层
 * @param {boolean} [opts.warmTheme] 是否启动前预热主题缓存
 * @returns {Promise<{server,url,host,port,token,projectRoot,close}>}
 */
export async function startWebServer({
  root = null,
  port = 3000,
  host = '127.0.0.1',
  env = {},
  publicDir = null,
  sessionToken = null,
  warmTheme = true,
} = {}) {
  let projectRoot = null;
  if (root) {
    const abs = path.resolve(root);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
      throw new Error(`目录不存在或不是文件夹: ${abs}`);
    }
    addProject(abs);
    projectRoot = abs;
  }

  const listenPort = normalizePort(port);
  const security = sessionToken ? { token: sessionToken, port: 0 } : null;
  const server = publicDir
    ? createServer(env, { publicDir, security })
    : createServer(env, { security });

  if (warmTheme) await warmThemeCache();

  await new Promise((resolve, reject) => {
    const onError = (err) => { server.off('listening', onListening); reject(err); };
    const onListening = () => { server.off('error', onError); resolve(); };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(listenPort, host);
  });

  const actualPort = server.address().port;
  if (security) security.port = actualPort;

  // 0.0.0.0 / :: 不能直接给浏览器打开；统一回落到回环地址
  const displayHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
  const urlHost = displayHost.includes(':') && !displayHost.startsWith('[')
    ? `[${displayHost}]`
    : displayHost;
  const url = `http://${urlHost}:${actualPort}`;

  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(() => resolve()));
  };

  return { server, url, host, port: actualPort, token: sessionToken, projectRoot, close };
}
