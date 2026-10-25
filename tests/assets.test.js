/**
 * assets.test.js — 确保提交的图标/封面存在且尺寸正确
 *
 * 生成物由 `npm run assets:build` 产出并提交；CI 不重新生成，
 * 这里防止资产缺失或尺寸漂移。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function readPng(file) {
  const buf = fs.readFileSync(file);
  assert.deepEqual(buf.subarray(0, 8), PNG_SIGNATURE, `${file} 不是 PNG`);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function readIcoCount(file) {
  const buf = fs.readFileSync(file);
  assert.equal(buf.readUInt16LE(0), 0, `${file} reserved 应为 0`);
  assert.equal(buf.readUInt16LE(2), 1, `${file} type 应为 1`);
  return buf.readUInt16LE(4);
}

test('app icon：PNG 尺寸与 ICO 数量', () => {
  for (const size of [ 256, 512, 1024 ]) {
    const dim = readPng(path.join(ROOT, 'assets/icons/app', `ftml-${size}.png`));
    assert.deepEqual(dim, { width: size, height: size });
  }
  assert.equal(readIcoCount(path.join(ROOT, 'assets/icons/app/ftml.ico')), 7);
});

test('file icon：PNG 尺寸与 ICO 数量', () => {
  assert.deepEqual(readPng(path.join(ROOT, 'assets/icons/file/ftml-file-256.png')), {
    width: 256,
    height: 256,
  });
  assert.equal(readIcoCount(path.join(ROOT, 'assets/icons/file/ftml.ico')), 7);
});

test('tray icon：16/32 PNG 与 ICO', () => {
  assert.deepEqual(readPng(path.join(ROOT, 'assets/icons/tray/tray-16.png')), { width: 16, height: 16 });
  assert.deepEqual(readPng(path.join(ROOT, 'assets/icons/tray/tray-32.png')), { width: 32, height: 32 });
  assert.equal(readIcoCount(path.join(ROOT, 'assets/icons/tray/tray.ico')), 3);
});

test('cover：README / Release 两种尺寸', () => {
  assert.deepEqual(readPng(path.join(ROOT, 'assets/cover/ftml-cover-1600x900.png')), {
    width: 1600,
    height: 900,
  });
  assert.deepEqual(readPng(path.join(ROOT, 'assets/cover/ftml-cover-1280x640.png')), {
    width: 1280,
    height: 640,
  });
});
