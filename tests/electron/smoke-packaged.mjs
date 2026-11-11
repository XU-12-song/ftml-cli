/**
 * smoke-packaged.mjs — 打包产物冒烟测试（不属于 *.test.js 发现规则）
 *
 *   npm run test:packaged
 *
 * 启动 electron-builder 产出的 win-unpacked exe，验证 asar/资源/主进程入口完整。
 * release workflow 中通过 FTML_REQUIRE_PACKAGED=1 确保产物缺失时直接失败。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import { makeTmpDir, cleanup } from '../helpers/fixtures.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const exe = process.env.FTML_PACKAGED_EXE || path.join(repoRoot, 'release', 'win-unpacked', 'Ftml Editor.exe');
const requireExe = process.env.FTML_REQUIRE_PACKAGED === '1';
const skip = process.platform !== 'win32' || (!requireExe && !fs.existsSync(exe));

test('打包产物冒烟：窗口、preload 与文件打开', { skip, timeout: 120000 }, async () => {
  assert.ok(fs.existsSync(exe), `未找到打包产物: ${exe}`);

  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ftml-e2e-packaged-home-'));
  const root = makeTmpDir({
    '.ftmlrc.json': JSON.stringify({ site: 'scp-cn', page: 'hello' }),
    'index.ftml': '[[div]]PACKAGED-MARKER[[/div]]\n',
  });

  let app = null;
  try {
    app = await electron.launch({
      executablePath: exe,
      args: [ path.join(root, 'index.ftml') ],
      env: { ...process.env, FTML_CLI_HOME: home, FTML_E2E: '1' },
      timeout: 60000,
    });

    const page = await app.firstWindow();
    await page.waitForSelector('#preview', { timeout: 60000 });
    assert.equal(await page.evaluate(() => window.ftmlDesktop?.isDesktop === true), true);

    await page.waitForFunction(
      () => !!document.querySelector('#project-select')?.value,
      null,
      { timeout: 60000 }
    );
    await page.waitForFunction(
      () => document.querySelector('.cm-content')?.textContent?.includes('PACKAGED-MARKER'),
      null,
      { timeout: 60000 }
    );
  } finally {
    await app?.close().catch(() => {});
    cleanup(root);
    cleanup(home);
  }
});
