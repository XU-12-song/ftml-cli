/**
 * electron-file-open.test.js — 文件关联参数与项目根解析（纯函数）
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { findFtmlFileArg, resolveOpenTarget } from '../electron/file-open.js';
import { makeTmpDir, cleanup } from './helpers/fixtures.js';

test('findFtmlFileArg：跳过 flags/非 .ftml/不存在的路径', () => {
  const root = makeTmpDir({
    'a.ftml': 'a',
    'b.txt': 'b',
    'pages/c.ftml': 'c',
  });
  try {
    const c = path.join(root, 'pages', 'c.ftml');
    const args = [
      'electron.exe',
      '.',
      '--inspect',
      path.join(root, 'b.txt'),
      path.join(root, 'missing.ftml'),
      c,
    ];
    assert.equal(findFtmlFileArg(args), c);
    assert.equal(findFtmlFileArg([ 'electron.exe', '.' ]), null);
    assert.equal(findFtmlFileArg([ path.join(root, 'b.txt') ]), null);
  } finally {
    cleanup(root);
  }
});

test('resolveOpenTarget：优先使用配置文件所在目录作为项目根', () => {
  const root = makeTmpDir({
    '.ftmlrc.json': '{}',
    'pages/a.ftml': 'x',
  });
  try {
    const file = path.join(root, 'pages', 'a.ftml');
    const t = resolveOpenTarget(file);
    assert.equal(t.project, root);
    assert.equal(t.file, 'pages/a.ftml');
    assert.equal(t.isProject, true);
  } finally {
    cleanup(root);
  }
});

test('resolveOpenTarget：没有配置文件时回退到文件父目录', () => {
  const root = makeTmpDir({ 'index.ftml': 'x' });
  try {
    const file = path.join(root, 'index.ftml');
    const t = resolveOpenTarget(file);
    assert.equal(t.project, root);
    assert.equal(t.file, 'index.ftml');
    assert.equal(t.isProject, false, '只有松散 .ftml 时应提示后再注册');
  } finally {
    cleanup(root);
  }
});

test('resolveOpenTarget：有 templates + components 标记时视为项目（可向上查找）', () => {
  const root = makeTmpDir({
    'templates/x.ftmx': 'x',
    'components/c.ftml': 'c',
    'pages/a.ftml': 'a',
  });
  try {
    const t = resolveOpenTarget(path.join(root, 'pages', 'a.ftml'));
    assert.equal(t.isProject, true);
    assert.equal(t.project, root);
    assert.equal(t.file, 'pages/a.ftml');
  } finally {
    cleanup(root);
  }
});

test('resolveOpenTarget：只有 templates 的松散目录仍视为非项目', () => {
  const root = makeTmpDir({ 'templates/x.ftmx': 'x', 'a.ftml': 'a' });
  try {
    const t = resolveOpenTarget(path.join(root, 'a.ftml'));
    assert.equal(t.isProject, false);
  } finally {
    cleanup(root);
  }
});

test('resolveOpenTarget：不存在 / 目录 / 越界输入返回 null', () => {
  const root = makeTmpDir({ 'index.ftml': 'x' });
  try {
    assert.equal(resolveOpenTarget(path.join(root, 'nope.ftml')), null);
    assert.equal(resolveOpenTarget(root), null);
    assert.equal(resolveOpenTarget(''), null);
  } finally {
    cleanup(root);
  }
});
