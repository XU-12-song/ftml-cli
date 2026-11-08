/**
 * bin-launcher.test.js — `npm link` / 全局安装后的 ftml 入口可运行
 *
 * 源码是 TypeScript，内部用 `.js` 后缀导入 `.ts`（NodeNext + tsx 解析）。
 * bin 若直接指向 src/cli.ts，npm 生成的 shim 用 node 启动时会因为
 * `.js` 无法映射到 `.ts` 而报 ERR_MODULE_NOT_FOUND。启动器必须先注册
 * tsx loader；这里用真正启动子进程的方式守住该行为。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('bin 启动器用裸 node 即可运行 CLI（npm link 场景）', () => {
  const launcher = path.join(root, 'bin', 'ftml.mjs');
  const r = spawnSync(process.execPath, [launcher, '--version'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30000,
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout.trim(), /^\d+\.\d+\.\d+/);
});

test('package.json 的 bin 指向存在的启动器', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const bin = path.resolve(root, pkg.bin.ftml);
  assert.ok(fs.existsSync(bin), `bin 不存在: ${bin}`);
  assert.ok(fs.readFileSync(bin, 'utf8').startsWith('#!/usr/bin/env node'));
});
