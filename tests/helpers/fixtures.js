/**
 * helpers/fixtures.js — 测试公用 fixture 工具
 *
 * 临时目录 / FTML_CLI_HOME 隔离。后者是必需的：所有用户级数据
 * （凭证、include 缓存、settings、snippets、项目注册表）都落在 FTML_CLI_HOME，
 * 不重定向就会写进真实家目录并在用例之间串扰。
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach } from 'node:test';

/** 递归删除临时目录（beforeEach/afterEach 与 try/finally 通用） */
export function cleanup(dir) {
  if (dir) rmSync(dir, { recursive: true, force: true });
}

/**
 * 建临时目录；files 为 { 相对路径: 内容 }，父目录自动创建。
 * @param {Record<string, string>} [files]
 * @param {{ prefix?: string }} [opts]
 */
export function makeTmpDir(files = {}, { prefix = 'ftml-test-' } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  for (const [name, content] of Object.entries(files)) {
    const p = path.join(dir, name);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, content);
  }
  return dir;
}

/**
 * 在隔离的 FTML_CLI_HOME 下运行 fn，结束后还原环境变量并删除临时目录。
 * @template T
 * @param {(home: string) => T | Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withHome(fn) {
  const home = mkdtempSync(path.join(os.tmpdir(), 'ftml-home-'));
  const old = process.env.FTML_CLI_HOME;
  process.env.FTML_CLI_HOME = home;
  try {
    return await fn(home);
  } finally {
    if (old === undefined) delete process.env.FTML_CLI_HOME;
    else process.env.FTML_CLI_HOME = old;
    cleanup(home);
  }
}

/**
 * 注册 beforeEach/afterEach：每个用例各自一个临时 FTML_CLI_HOME。
 * 在测试文件顶层调用一次即可。
 * @param {{ prefix?: string }} [opts]
 */
export function useIsolatedHome({ prefix = 'ftml-home-' } = {}) {
  let oldHome;
  let home;
  beforeEach(() => {
    oldHome = process.env.FTML_CLI_HOME;
    home = mkdtempSync(path.join(os.tmpdir(), prefix));
    process.env.FTML_CLI_HOME = home;
  });
  afterEach(() => {
    cleanup(home);
    if (oldHome === undefined) delete process.env.FTML_CLI_HOME;
    else process.env.FTML_CLI_HOME = oldHome;
  });
}
