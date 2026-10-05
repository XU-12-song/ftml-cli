/**
 * problems.test.js — 统一问题模型 + 堆栈美化/打包帧映射
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { FtmlError } from '../src/core/errors.js';
import {
  diagnosticToProblem,
  errorToProblem,
  sortProblems,
  countProblems,
} from '../src/render/problems.js';
import { mapStack, clearStackCache } from '../src/render/stack.js';

test('diagnosticToProblem：保留严重度/位置，缺 offset 时按行列补', () => {
  const src = 'line1\nline2\n[[div]]'; // 每行 6 字符（含 \n）
  const p = diagnosticToProblem(
    {
      severity: 'warning',
      code: 'unclosed-block',
      message: '缺少 [[/div]]',
      position: { start: { line: 3, column: 1 }, end: { line: 3, column: 3 } },
    },
    src,
    { file: 'a.ftml' }
  );
  assert.equal(p.severity, 'warning');
  assert.equal(p.code, 'unclosed-block');
  assert.equal(p.file, 'a.ftml');
  assert.equal(p.position.start.offset, 12);
  assert.equal(p.stack, null);
});

test('diagnosticToProblem：未知/缺省 severity 归一为 warning', () => {
  const p = diagnosticToProblem({ severity: 'fatal', code: 'x', message: 'm' }, '');
  assert.equal(p.severity, 'warning');
  assert.equal(diagnosticToProblem(null), null);
});

test('errorToProblem：同文件 FtmlError 给出位置 + 堆栈', () => {
  const src = '[[card]]x[[/card]]';
  const err = new FtmlError('缺少参数', { code: 'missing-param', offset: 8, file: 'index.ftml' });
  const p = errorToProblem(err, { source: src, file: 'index.ftml' });
  assert.equal(p.severity, 'error');
  assert.equal(p.code, 'missing-param');
  assert.equal(p.file, 'index.ftml');
  assert.equal(p.position.start.offset, 8);
  assert.ok(typeof p.stack === 'string' && p.stack.length > 0);
});

test('errorToProblem：组件文件错误只报文件不报偏移（坐标系不同）', () => {
  const err = new FtmlError('boom', {
    code: 'component-read',
    offset: 3,
    file: '/abs/components/x.ftml',
  });
  const p = errorToProblem(err, { source: 'caller', file: 'index.ftml', cwd: '/abs' });
  assert.equal(p.file, 'components/x.ftml');
  assert.equal(p.position, null);
});

test('errorToProblem：普通 Error → internal-error，带堆栈', () => {
  const p = errorToProblem(new Error('kaboom'), { source: 'x', file: 'index.ftml' });
  assert.equal(p.code, 'internal-error');
  assert.ok(p.stack.includes('kaboom'));
});

test('sortProblems：有位置按 offset 升序，无位置排最后', () => {
  const mk = (o) => ({
    severity: 'warning',
    code: 'c',
    message: 'm',
    position: o == null ? null : { start: { offset: o } },
  });
  const out = sortProblems([mk(5), mk(null), mk(1)]);
  assert.deepEqual(
    out.map((p) => p.position?.start.offset ?? null),
    [1, 5, null]
  );
});

test('countProblems：按归一后的严重度计数', () => {
  const c = countProblems([
    { severity: 'error' },
    { severity: 'error' },
    { severity: 'fatal' },
    { severity: 'info' },
  ]);
  assert.deepEqual(c, { error: 2, warning: 1, info: 1 });
});

test('mapStack：@wdprlib 打包帧映射回源文件段（近似行）', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ftml-stack-'));
  try {
    const distDir = path.join(dir, '@wdprlib', 'parser', 'dist');
    mkdirSync(distDir, { recursive: true });
    const dist = path.join(distDir, 'index.js');
    writeFileSync(
      dist,
      [
        '// packages/parser/src/lexer/tokens.ts',
        'function a() {}',
        'function b() {}',
        '// packages/parser/src/parser/block.ts',
        'function c() {}',
      ].join('\n')
    );
    clearStackCache();

    const stack = [
      'Error: boom',
      `    at parseBlock (${dist}:5:10)`,
      `    at Object.<anonymous> (${dist}:2:3)`,
    ].join('\n');
    const { text, hasBundled } = mapStack(stack, { cwd: dir });
    assert.equal(hasBundled, true);
    assert.ok(text.includes('@wdprlib/parser/src/parser/block.ts'));
    assert.ok(text.includes('@wdprlib/parser/src/lexer/tokens.ts'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('mapStack：非打包帧保留并转为 cwd 相对路径', () => {
  const stack = 'Error: x\n    at foo (/tmp/proj/src/a.js:1:1)';
  const { text, hasBundled } = mapStack(stack, { cwd: '/tmp/proj' });
  assert.equal(hasBundled, false);
  assert.ok(text.includes('src/a.js:1:1'));
});
