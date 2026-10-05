/**
 * server.js — web 编辑器 HTTP 服务器（express）
 *
 *   静态文件服务 src/web/public/ + JSON API（转发到 handlers/）。
 *   默认绑 127.0.0.1，--host 可覆盖。
 *
 *   createServer(env) 的 env 透传给 handlers，测试可注入 fake wikidot client。
 */

import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

import * as handlers from './handlers/index.js';
import { mapStack } from '../render/stack.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');

/** 把 async handler 包成 express 中间件，异常统一交给错误中间件 */
function wrap(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/** 构造 API 路由（挂到 /api 下） */
function apiRouter(env) {
  const router = express.Router();

  // ---------------- auth ----------------
  router.get('/auth/status', wrap(async (req, res) => {
    res.json(await handlers.authStatus());
  }));
  router.post('/auth/login', wrap(async (req, res) => {
    res.json(await handlers.authLogin(req.body));
  }));
  router.post('/auth/logout', wrap(async (req, res) => {
    res.json(await handlers.authLogout());
  }));

  // ---------------- git 环境 ----------------
  router.get('/git-env', wrap(async (req, res) => {
    res.json(await handlers.gitEnv(req.query.root));
  }));

  // ---------------- 全局设置 / 代码片段 ----------------
  router.get('/settings', wrap(async (req, res) => {
    res.json(await handlers.getSettings());
  }));
  router.post('/settings', wrap(async (req, res) => {
    res.json(await handlers.saveSettings(req.body));
  }));
  router.get('/snippets', wrap(async (req, res) => {
    res.json(await handlers.listSnippets());
  }));
  router.post('/snippets', wrap(async (req, res) => {
    res.json(await handlers.saveSnippet(req.body));
  }));
  router.post('/snippets/import', wrap(async (req, res) => {
    res.json(await handlers.importSnippets(req.body));
  }));
  router.get('/snippets/export', wrap(async (req, res) => {
    res.json(await handlers.exportSnippets());
  }));
  router.delete('/snippets/:name', wrap(async (req, res) => {
    res.json(await handlers.deleteSnippet(req.params.name));
  }));

  // ---------------- include 磁盘缓存 ----------------
  router.get('/include-cache', wrap(async (req, res) => {
    res.json(await handlers.listIncludeCache());
  }));
  router.delete('/include-cache', wrap(async (req, res) => {
    res.json(await handlers.clearIncludeCache());
  }));

  // ---------------- projects ----------------
  router.get('/projects', wrap(async (req, res) => {
    res.json(await handlers.listProjects());
  }));
  router.post('/projects', wrap(async (req, res) => {
    res.json(await handlers.createProject(req.body));
  }));
  // 在指定父目录下新建 ftml 仓库（.ftml-cli 分区）
  router.post('/projects/create', wrap(async (req, res) => {
    res.json(await handlers.createFtmlProject(req.body));
  }));
  router.delete('/projects/:id', wrap(async (req, res) => {
    res.json(await handlers.deleteProject(req.params.id));
  }));

  // 项目作用域操作：/projects/:id/:action
  const actions = {
    sidebar: (req) => handlers.getSidebar(req.params.id),
    file: (req) => handlers.readProjectFile(req.params.id, req.query.path),
    save: (req) => handlers.saveProjectFile(req.params.id, req.body),
    render: (req) => handlers.renderProjectFile(req.params.id, req.body, env),
    validate: (req) => handlers.validateProjectFile(req.params.id, req.body),
    target: (req) => handlers.saveTargetPage(req.params.id, req.body),
    versions: (req) => handlers.listProjectVersions(req.params.id),
    deploy: (req) => handlers.deployProject(req.params.id, req.body, env),
    revert: (req) => handlers.revertProject(req.params.id, req.body, env),
    init: (req) => handlers.initProject(req.params.id, env),
  };

  router.all('/projects/:id/:action', wrap(async (req, res) => {
    const handler = actions[req.params.action];
    if (!handler) throw new handlers.HttpError(404, `未知操作: ${req.params.action}`);
    res.json(await handler(req));
  }));

  // 未匹配的 /api/* → 404
  router.use((req, res) => {
    res.status(404).json({ error: `未知接口: ${req.method} ${req.originalUrl}` });
  });

  return router;
}

/** 统一错误响应：HttpError 用其状态码，其余 500 */
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (err instanceof handlers.HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  // 渲染请求被更新的同类请求取代：客户端已取消，标记 409 便于识别/静默
  if (err?.superseded) {
    res.status(409).json({ error: err.message, superseded: true });
    return;
  }
  if (err?.type === 'entity.too.large') {
    res.status(413).json({ error: '请求体过大' });
    return;
  }
  // express.json 解析失败 → SyntaxError（带 status 400）
  if (err instanceof SyntaxError && err.status === 400) {
    res.status(400).json({ error: '请求体不是合法 JSON' });
    return;
  }
  console.error(err);
  // 非预期异常：把（美化过的）堆栈与 cause 一并回传，前端可展开定位；
  // @wdprlib 打包帧会被映射回源文件（见 render/stack.js）
  const { text: stack, hasBundled } = mapStack(err?.stack ?? '', { cwd: process.cwd() });
  const cause = err?.cause ? (err.cause.message ?? String(err.cause)) : null;
  res.status(err?.status || 500).json({
    error: err?.message || '服务器内部错误',
    stack,
    bundled: hasBundled,
    cause,
  });
}

export function createServer(env = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '10mb' }));
  app.use('/api', apiRouter(env));
  app.use(express.static(PUBLIC_DIR));
  app.use(errorHandler);
  // 返回 http.Server，保持 web.js 的 listen/once('error') 契约不变
  return http.createServer(app);
}
