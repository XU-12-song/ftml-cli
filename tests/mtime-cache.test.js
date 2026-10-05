/**
 * mtime-cache.test.js — 进程内「按文件 mtime/size 复用」缓存
 *
 * 覆盖缓存本身的命中/失效语义，以及 loadTemplates 对它的接入
 * （未改动的 .ftmx 复用已解析结果；改动后重解析、签名变化）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, rmSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { fileSignature, memoByFile, clearMtimeCache } from '../src/infra/mtime-cache.js';
import { loadTemplates, templatesSignature } from '../src/core/expand.js';
import { makeTmpDir, cleanup } from './helpers/fixtures.js';

test('fileSignature：存在返回 mtimeMs:size，缺失返回 null', () => {
  const dir = makeTmpDir({ 'a.ftml': 'abc' });
  try {
    assert.match(fileSignature(path.join(dir, 'a.ftml')), /^\d+(\.\d+)?:\d+$/);
    assert.equal(fileSignature(path.join(dir, 'nope.ftml')), null);
  } finally {
    cleanup(dir);
  }
});

test('memoByFile：文件未变时复用，compute 只跑一次', () => {
  clearMtimeCache();
  const dir = makeTmpDir({ 'a.ftml': 'abc' });
  try {
    const abs = path.join(dir, 'a.ftml');
    let calls = 0;
    const compute = () => {
      calls++;
      return { n: calls };
    };
    const first = memoByFile('t', abs, compute);
    const second = memoByFile('t', abs, compute);
    assert.equal(calls, 1);
    assert.equal(first, second); // 同一对象引用（真复用，非重算等值）
  } finally {
    cleanup(dir);
    clearMtimeCache();
  }
});

test('memoByFile：文件大小变化后失效重算', () => {
  clearMtimeCache();
  const dir = makeTmpDir({ 'a.ftml': 'abc' });
  try {
    const abs = path.join(dir, 'a.ftml');
    let calls = 0;
    const compute = () => {
      calls++;
      return `${calls}:${readFileSync(abs, 'utf8')}`;
    };
    const first = memoByFile('t', abs, compute);
    writeFileSync(abs, 'abcd'); // 变长 → size 变 → 必然失效（不依赖 mtime 粒度）
    const second = memoByFile('t', abs, compute);
    assert.equal(calls, 2);
    assert.notEqual(second, first);
    assert.ok(second.includes('abcd'));
  } finally {
    cleanup(dir);
    clearMtimeCache();
  }
});

test('memoByFile：extra 键变化即失效（模板表签名联动用）', () => {
  clearMtimeCache();
  const dir = makeTmpDir({ 'a.ftml': 'abc' });
  try {
    const abs = path.join(dir, 'a.ftml');
    let calls = 0;
    const compute = () => {
      calls++;
      return calls;
    };
    memoByFile('t', abs, compute, 'sig1');
    memoByFile('t', abs, compute, 'sig1');
    assert.equal(calls, 1);
    memoByFile('t', abs, compute, 'sig2'); // extra 变 → 重算
    assert.equal(calls, 2);
    memoByFile('t', abs, compute, 'sig2');
    assert.equal(calls, 2);
  } finally {
    cleanup(dir);
    clearMtimeCache();
  }
});

test('memoByFile：文件不存在返回 null，并在文件恢复后重新计算', () => {
  clearMtimeCache();
  const dir = makeTmpDir({ 'a.ftml': 'abc' });
  try {
    const abs = path.join(dir, 'a.ftml');
    assert.equal(memoByFile('t', abs, () => 'x'), 'x');
    rmSync(abs);
    assert.equal(memoByFile('t', abs, () => 'y'), null);
    writeFileSync(abs, 'z');
    assert.equal(memoByFile('t', abs, () => 'y'), 'y'); // 旧条目已清，重新计算
  } finally {
    cleanup(dir);
    clearMtimeCache();
  }
});

test('clearMtimeCache：按命名空间清除，互不影响', () => {
  clearMtimeCache();
  const dir = makeTmpDir({ 'a.ftml': 'abc' });
  try {
    const abs = path.join(dir, 'a.ftml');
    let calls = 0;
    const compute = () => {
      calls++;
      return calls;
    };
    memoByFile('n1', abs, compute);
    memoByFile('n2', abs, compute);
    assert.equal(calls, 2);

    clearMtimeCache('n1');
    memoByFile('n1', abs, compute); // 已清 → 重算
    assert.equal(calls, 3);
    memoByFile('n2', abs, compute); // 未清 → 仍命中
    assert.equal(calls, 3);
  } finally {
    cleanup(dir);
    clearMtimeCache();
  }
});

test('loadTemplates：未改动的 .ftmx 复用解析结果，改动后重解析且签名变化', async () => {
  clearMtimeCache();
  const dir = makeTmpDir({ 'box.ftmx': '[[div]]{ children }[[/div]]' });
  try {
    const first = await loadTemplates(dir);
    const second = await loadTemplates(dir);
    assert.equal(first.get('box'), second.get('box')); // 同一解析对象
    assert.equal(templatesSignature(first), templatesSignature(second));
    assert.ok(templatesSignature(first).length > 0);

    writeFileSync(path.join(dir, 'box.ftmx'), '[[div class="x"]]{ children }[[/div]]');
    const third = await loadTemplates(dir);
    assert.notEqual(third.get('box'), first.get('box'));
    assert.notEqual(templatesSignature(third), templatesSignature(first));
  } finally {
    cleanup(dir);
    clearMtimeCache('templates');
  }
});

test('loadTemplates：目录不存在返回空表，签名为空串', async () => {
  const map = await loadTemplates('/no/such/dir/at/all');
  assert.equal(map.size, 0);
  assert.equal(templatesSignature(map), '');
});
