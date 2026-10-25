/**
 * electron/smoke.test.js — Electron 冒烟测试（不进入 npm test 的顶层 glob）
 *
 *   npm run test:electron
 *
 * 验证：窗口加载、preload 暴露、文件关联 deep link 生效、编辑器打开文件。
 * 使用临时 FTML_CLI_HOME，不读写真实用户目录。
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
const skip = process.platform !== 'win32';

test('Electron 冒烟：窗口、preload、deep link 与文件打开', { skip, timeout: 120000 }, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ftml-e2e-home-'));
  const root = makeTmpDir({
    '.ftmlrc.json': JSON.stringify({ site: 'scp-cn', page: 'hello' }),
    'index.ftml': '[[div]]E2E-MARKER[[/div]]\n',
  });
  const file = path.join(root, 'index.ftml');

  let app = null;
  const t0 = Date.now();
  const mark = (label) => console.log(`[e2e] ${label} +${Date.now() - t0}ms`);
  try {
    app = await electron.launch({
      args: [ '.', file ],
      cwd: repoRoot,
      env: { ...process.env, FTML_CLI_HOME: home, FTML_E2E: '1' },
      timeout: 60000,
    });
    console.log('[e2e] launched, pid', app.process().pid);
    mark('launched');
    app.process().stdout?.on('data', (d) => console.log('[e2e:out]', d.toString().trim()));
    app.process().stderr?.on('data', (d) => console.log('[e2e:err]', d.toString().trim()));
    app.on('window', (p) => console.log('[e2e] window event', p.url()));

    const page = await Promise.race([
      app.firstWindow(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('firstWindow timeout')), 20000)),
    ]);
    console.log('[e2e] firstWindow', page.url());
    mark('firstWindow');
    await page.waitForSelector('#preview', { timeout: 60000 });
    mark('#preview');

    assert.equal(await page.evaluate(() => window.ftmlDesktop?.isDesktop === true), true);
    mark('isDesktop');

    await page.waitForFunction(
      () => !!document.querySelector('#project-select')?.value,
      null,
      { timeout: 60000 }
    );
    mark('project-select');

    await page.waitForFunction(
      () => document.querySelector('.cm-content')?.textContent?.includes('E2E-MARKER'),
      null,
      { timeout: 60000 }
    );
    mark('cm-content');

    // 分隔条：左右布局鼠标拖动 + 键盘调整，再切上下布局验证轴向
    assert.equal(await page.getAttribute('#splitter', 'data-axis'), 'x');
    assert.equal(
      await page.locator('#splitter').evaluate((n) => getComputedStyle(n).cursor),
      'col-resize'
    );

    const width1 = await page.locator('#editor-container').evaluate((n) => n.getBoundingClientRect().width);
    const box = await page.locator('#splitter').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 120, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(250);
    const widthDragged = await page.locator('#editor-container').evaluate((n) => n.getBoundingClientRect().width);
    assert.ok(widthDragged < width1 - 40, `鼠标拖动后编辑区应变窄: ${width1} -> ${widthDragged}`);

    await page.focus('#splitter');
    await page.keyboard.press('Shift+ArrowLeft');
    await page.waitForTimeout(250);
    const width2 = await page.locator('#editor-container').evaluate((n) => n.getBoundingClientRect().width);
    assert.ok(width2 < widthDragged - 20, `键盘调整后编辑区应继续变窄: ${widthDragged} -> ${width2}`);

    await page.click('#layout-toggle');
    await page.waitForTimeout(250);
    assert.equal(await page.getAttribute('#splitter', 'data-axis'), 'y');
    assert.equal(
      await page.locator('#splitter').evaluate((n) => getComputedStyle(n).cursor),
      'row-resize'
    );

    const height1 = await page.locator('#editor-container').evaluate((n) => n.getBoundingClientRect().height);
    await page.focus('#splitter');
    await page.keyboard.press('Shift+ArrowUp');
    await page.waitForTimeout(250);
    const height2 = await page.locator('#editor-container').evaluate((n) => n.getBoundingClientRect().height);
    assert.ok(height2 < height1 - 20, `上下布局编辑区应变矮: ${height1} -> ${height2}`);
  } finally {
    mark('before close');
    await app?.close().catch(() => {});
    mark('after close');
    cleanup(root);
    cleanup(home);
  }
});

test('Electron：项目下拉可移除当前工作区（只取消注册）', { skip, timeout: 120000 }, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ftml-e2e-remove-'));
  const root = makeTmpDir({
    '.ftmlrc.json': JSON.stringify({ site: 'scp-cn', page: 'hello' }),
    'index.ftml': '[[div]]REMOVE-CHECK[[/div]]\n',
  });
  let app = null;
  try {
    app = await electron.launch({
      args: [ '.', path.join(root, 'index.ftml') ],
      cwd: repoRoot,
      env: { ...process.env, FTML_CLI_HOME: home, FTML_E2E: '1' },
      timeout: 60000,
    });
    const page = await app.firstWindow();
    await page.waitForFunction(() => !!document.querySelector('#project-select')?.value, null, { timeout: 60000 });

    page.on('dialog', (d) => d.accept());
    await page.click('#project-select');
    await page.waitForSelector('.select-menu-action', { timeout: 10000 });
    await page.click('.select-menu-action');

    await page.waitForFunction(
      () => document.querySelector('#project-select')?.value === '',
      null,
      { timeout: 30000 }
    );

    const remaining = await page.evaluate(() => fetch('/api/projects').then((r) => r.json()));
    assert.deepEqual(remaining, []);
  } finally {
    await app?.close().catch(() => {});
    cleanup(root);
    cleanup(home);
  }
});
