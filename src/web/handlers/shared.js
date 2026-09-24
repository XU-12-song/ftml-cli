/**
 * handlers/shared.js — API 处理器公用件
 *
 * HttpError（携带 HTTP 状态码，server.js 的错误中间件据此响应）、
 * 项目根内路径解析（防目录穿越）、console 捕获（把 CLI 命令的进度转成前端日志）、
 * 项目注册表查找。
 */

import path from 'node:path';

import { loadProjects } from '../projects.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** 项目根内的路径解析（防目录穿越） */
export function resolveInProject(root, relPath) {
  const base = path.resolve(root);
  const abs = path.resolve(base, relPath);
  if (abs !== base && !abs.startsWith(base + path.sep)) {
    throw new HttpError(400, `路径越界: ${relPath}`);
  }
  return abs;
}

/** 运行 fn 时捕获 console 输出（CLI 命令的进度/诊断反馈给前端） */
export async function captureLogs(fn) {
  const logs = [];
  const push = (kind) => (msg) => {
    logs.push({ kind, msg: typeof msg === 'string' ? msg : String(msg) });
  };
  const orig = { log: console.log, warn: console.warn, error: console.error };
  console.log = push('log');
  console.warn = push('warn');
  console.error = push('error');
  try {
    return { logs, result: await fn() };
  } finally {
    console.log = orig.log;
    console.warn = orig.warn;
    console.error = orig.error;
  }
}

export function findProject(id) {
  const list = loadProjects();
  const p = list.find((x) => x.id === id);
  if (!p) throw new HttpError(404, `项目未注册: ${id}`);
  return p;
}
