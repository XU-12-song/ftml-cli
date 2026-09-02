/**
 * server.js — web 编辑器 http 服务器（node:http，零依赖）
 *
 *   静态文件服务 src/web/public/ + JSON API 路由（转发到 handlers.js）。
 *   默认绑 127.0.0.1，--host 可覆盖。
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as handlers from './handlers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function contentType(file) {
  return MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
}

/** 读请求体（JSON，限制大小防滥用） */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 10 * 1024 * 1024) {
        reject(new handlers.HttpError(413, '请求体过大'));
        req.destroy();
        return;
      }
      data += chunk;
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new handlers.HttpError(400, '请求体不是合法 JSON'));
      }
    });
    req.on('error', reject);
  });
}

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

/** 匹配 /api/projects/:id/:action，返回 { id, action } */
function parseProjectRoute(url) {
  const m = /^\/api\/projects\/([^/]+)\/([a-z]+)$/.exec(url);
  return m ? { id: decodeURIComponent(m[1]), action: m[2] } : null;
}

async function handleApi(req, res, url) {
  const method = req.method;
  const pathname = url.pathname;

  // ---------------- auth ----------------
  if (pathname === '/api/auth/status' && method === 'GET') {
    return send(res, 200, handlers.authStatus());
  }
  if (pathname === '/api/auth/login' && method === 'POST') {
    return send(res, 200, await handlers.authLogin(await readBody(req)));
  }
  if (pathname === '/api/auth/logout' && method === 'POST') {
    return send(res, 200, handlers.authLogout());
  }

  // ---------------- projects ----------------
  if (pathname === '/api/projects' && method === 'GET') {
    return send(res, 200, await handlers.listProjects());
  }
  if (pathname === '/api/projects' && method === 'POST') {
    return send(res, 200, await handlers.createProject(await readBody(req)));
  }
  const single = /^\/api\/projects\/([^/]+)$/.exec(pathname);
  if (single && method === 'DELETE') {
    return send(res, 200, handlers.deleteProject(decodeURIComponent(single[1])));
  }
  const p = parseProjectRoute(pathname);
  if (p) {
    const { id, action } = p;
    const body = ['GET', 'DELETE'].includes(method) ? {} : await readBody(req);
    switch (action) {
      case 'sidebar':
        if (method !== 'GET') break;
        return send(res, 200, await handlers.getSidebar(id));
      case 'file':
        if (method === 'GET') {
          return send(res, 200, handlers.readProjectFile(id, url.searchParams.get('path')));
        }
        break;
      case 'save':
        if (method !== 'POST') break;
        return send(res, 200, handlers.saveProjectFile(id, body));
      case 'render':
        if (method !== 'POST') break;
        return send(res, 200, await handlers.renderProjectFile(id, body));
      case 'validate':
        if (method !== 'POST') break;
        return send(res, 200, await handlers.validateProjectFile(id, body));
      case 'target':
        if (method !== 'POST') break;
        return send(res, 200, handlers.saveTargetPage(id, body));
      case 'deploy':
        if (method !== 'POST') break;
        return send(res, 200, await handlers.deployProject(id, body));
      case 'revert':
        if (method !== 'POST') break;
        return send(res, 200, await handlers.revertProject(id, body));
      case 'init':
        if (method !== 'POST') break;
        return send(res, 200, await handlers.initProject(id));
      default:
        break;
    }
    return send(res, 404, { error: `未知操作: ${action}` });
  }
  if (pathname.startsWith('/api/')) {
    return send(res, 404, { error: `未知接口: ${method} ${pathname}` });
  }
  return null; // 非 API 路由，走静态文件
}

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  // 防目录穿越：静态资源只允许落在 PUBLIC_DIR 内
  const abs = path.resolve(PUBLIC_DIR, '.' + rel);
  if (!abs.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }
  fs.readFile(abs, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType(abs) });
    res.end(data);
  });
}

export function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      const apiResult = await handleApi(req, res, url);
      if (apiResult === null) serveStatic(req, res, url);
    } catch (err) {
      if (err instanceof handlers.HttpError) {
        send(res, err.status, { error: err.message });
      } else {
        console.error(err);
        send(res, 500, { error: err.message || '服务器内部错误' });
      }
    }
  });
}
