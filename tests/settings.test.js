import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_MODULE_PLACEHOLDERS,
  normalizeModulePlaceholders,
  normalizeSettings,
  loadSettings,
  saveSettings,
} from '../src/domain/settings.js';
import { useIsolatedHome } from './helpers/fixtures.js';

useIsolatedHome();

test('normalizeSettings：缺失文件/空对象带完整占位默认值', () => {
  const s = normalizeSettings({});
  assert.deepEqual(s.modulePlaceholders, DEFAULT_MODULE_PLACEHOLDERS);
  assert.notEqual(s.modulePlaceholders, DEFAULT_MODULE_PLACEHOLDERS); // 深拷贝，调用方可安全修改
});

test('normalizeModulePlaceholders：只覆盖传入模块，兄弟模块保留默认', () => {
  const p = normalizeModulePlaceholders({ listPages: { count: 7 } });
  assert.equal(p.listPages.count, 7);
  assert.equal(p.listPages.title, DEFAULT_MODULE_PLACEHOLDERS.listPages.title);
  assert.deepEqual(p.listUsers, DEFAULT_MODULE_PLACEHOLDERS.listUsers);
  assert.deepEqual(p.tagCloud, DEFAULT_MODULE_PLACEHOLDERS.tagCloud);
});

test('normalizeModulePlaceholders：数值收敛与非法值回退', () => {
  const p = normalizeModulePlaceholders({
    listPages: { count: 999, rating: 'abc', date: 'not-a-date' },
    listUsers: { count: -3 },
    tagCloud: { count: 1000, minWeight: 80, maxWeight: 10 },
    rate: { votes: -5 },
  });
  assert.equal(p.listPages.count, 50);
  assert.equal(p.listPages.rating, DEFAULT_MODULE_PLACEHOLDERS.listPages.rating);
  assert.equal(p.listPages.date, DEFAULT_MODULE_PLACEHOLDERS.listPages.date);
  assert.equal(p.listUsers.count, 0);
  assert.equal(p.tagCloud.count, 100);
  assert.equal(p.tagCloud.minWeight, 80);
  assert.equal(p.tagCloud.maxWeight, 80); // max 不得小于 min
  assert.equal(p.rate.votes, 0);
});

test('saveSettings：局部保存一个模块不清空其它模块', async () => {
  assert.deepEqual(loadSettings().modulePlaceholders, DEFAULT_MODULE_PLACEHOLDERS);

  saveSettings({ modulePlaceholders: { listUsers: { count: 4 } } });
  const afterFirst = loadSettings();
  assert.equal(afterFirst.modulePlaceholders.listUsers.count, 4);
  assert.equal(afterFirst.modulePlaceholders.listPages.count, DEFAULT_MODULE_PLACEHOLDERS.listPages.count);

  saveSettings({ modulePlaceholders: { tagCloud: { count: 12 } } });
  const afterSecond = loadSettings();
  assert.equal(afterSecond.modulePlaceholders.listUsers.count, 4);
  assert.equal(afterSecond.modulePlaceholders.tagCloud.count, 12);
});
