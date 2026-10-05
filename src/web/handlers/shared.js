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

/** 被更新的同类请求取代（`superseded` 标记供 server.js 映射为 409，客户端静默忽略） */
export class SupersededError extends Error {
  constructor() {
    super('已被更新的请求取代');
    this.name = 'SupersededError';
    this.superseded = true;
  }
}

// key → { gen, tail }：每个 key 一条“最新者胜”串行链
const gates = new Map();

/**
 * 同一 key 上的异步任务“最新者胜”串行门。
 *
 * 编辑器每次输入都会 POST /render，而一次完整渲染是 CPU 密集的（数百 ms）。
 * 连发的请求会在 Node 事件循环上排队：旧的渲染白做，还把新结果拖后。
 * 这里保证同一 key 上至多一个任务在跑，且还在排队/执行中的旧任务一旦发现
 * 已有更新的请求到来就抛 SupersededError 直接放弃。
 *
 * 注意：正在跑的 CPU 段无法被抢占，只能靠调用方在昂贵步骤前调用 checkpoint()
 * 主动检查。跳过点只在 await 边界有效（同步段内新请求根本进不来）。
 *
 * @param {string} key 通常为 `${projectId}::${relPath}`
 * @param {(checkpoint: () => void) => Promise<any>} task
 */
export function latestOnly(key, task) {
  const gate = gates.get(key) ?? { gen: 0, tail: Promise.resolve() };
  gates.set(key, gate);
  const myGen = ++gate.gen;

  const run = gate.tail.then(async () => {
    if (gate.gen !== myGen) throw new SupersededError(); // 排队期间已被更新的请求取代
    return task(() => {
      if (gate.gen !== myGen) throw new SupersededError(); // 执行途中出现更新的请求
    });
  });
  // tail 只用于排队，不能让失败断链（也不产生未处理拒绝）
  gate.tail = run.catch(() => {});
  run.finally(() => {
    if (gate.gen === myGen) gates.delete(key); // 没有更新的请求才回收
  }).catch(() => {});
  return run;
}
