import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDiagnostic, formatDiagnostics } from '../src/render/diagnostics.js';

const pos = (l1, c1, l2 = l1, c2 = c1 + 1) => ({
  start: { line: l1, column: c1, offset: 0 },
  end: { line: l2, column: c2, offset: 0 },
});

test('空诊断返回空串', () => {
  assert.equal(formatDiagnostics([], 'x'), '');
  assert.equal(formatDiagnostics(undefined, 'x'), '');
});

test('错误严重度 + 位置 + code + 源码片段与插入符', () => {
  const src = '[[div]]\n未闭合';
  const out = formatDiagnostic(
    { severity: 'error', code: 'unclosed-block', message: '缺少 [[/div]]', position: pos(1, 1, 1, 8) },
    src,
    { file: 'index.ftml' }
  );
  assert.ok(out.includes('✖ 错误 index.ftml:1:1 (unclosed-block)'));
  assert.ok(out.includes('缺少 [[/div]]'));
  assert.ok(out.includes('1 | [[div]]'));
  assert.ok(out.includes('| ^^^^^^^'));
});

test('warning/info 标签不同', () => {
  const w = formatDiagnostic({ severity: 'warning', code: 'c', message: 'm', position: pos(1, 1) }, 'x');
  const i = formatDiagnostic({ severity: 'info', code: 'c', message: 'm', position: pos(1, 1) }, 'x');
  assert.ok(w.startsWith('⚠ 警告'));
  assert.ok(i.startsWith('ℹ 提示'));
});

test('relatedPosition 作为“相关位置”一并标出', () => {
  const src = '[[div]]\n内容';
  const out = formatDiagnostic(
    {
      severity: 'warning',
      code: 'unclosed-block',
      message: '缺少闭合',
      position: pos(2, 1),
      relatedPosition: pos(1, 1, 1, 8),
    },
    src,
    { file: 'a.ftml' }
  );
  assert.ok(out.includes('相关位置 a.ftml:1:1'));
  assert.ok(out.includes('1 | [[div]]'));
});

test('缺少 position 不抛错，回退为未知位置', () => {
  const out = formatDiagnostic({ severity: 'warning', code: 'x', message: 'm' }, '', { file: 'f.ftml' });
  assert.ok(out.includes('f.ftml'));
  assert.ok(out.includes('m'));
});

test('多条诊断以空行分隔', () => {
  const src = 'a\nb';
  const out = formatDiagnostics(
    [
      { severity: 'warning', code: 'x', message: '第一', position: pos(1, 1) },
      { severity: 'error', code: 'y', message: '第二', position: pos(2, 1) },
    ],
    src
  );
  assert.ok(out.includes('第一'));
  assert.ok(out.includes('第二'));
  assert.ok(out.includes('\n\n'));
});
