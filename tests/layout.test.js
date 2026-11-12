import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  CONTENT_MARKER,
  DEFAULT_SITE,
  TITLE_MARKER,
  clearLayoutCache,
  getLayoutFailure,
  getSiteLayout,
  normalizeSiteName,
  parseSiteLayoutHtml,
  readSiteLayout,
  refreshSiteLayout,
  waitForSiteLayoutRefresh,
} from '../src/infra/layout.js';
import { homeCacheDir } from '../src/infra/paths.js';
import { useIsolatedHome } from './helpers/fixtures.js';

useIsolatedHome();
beforeEach(() => clearLayoutCache());
afterEach(() => clearLayoutCache());

const TEMPLATE_HTML = `<!DOCTYPE html>
<html><head>
<style id="internal-style">
/* modules */
/* theme */
@import url(https://cdn.example.com/base.css);
@import url("/local--theme/site.css");
</style>
</head><body>
<div id="container">
  <div id="header"><h1>My Site</h1><script>evil()</script></div>
  <div id="content-wrap">
    <div id="main-content">
      <div id="page-title">_template</div>
      <div id="page-content"><p>%%content%%</p></div>
    </div>
  </div>
  <a id="nav" href="/nav:side" onclick="bad()">侧栏</a>
  <img id="logo" src="/local--files/logo.png">
</div>
</body></html>`;

const okFetch = (html = TEMPLATE_HTML, calls = []) => async (url) => {
  calls.push(String(url));
  return { ok: true, status: 200, text: async () => html };
};

test('parseSiteLayoutHtml：提取 container、写入 marker、清洗脚本/事件、绝对化链接', () => {
  const layout = parseSiteLayoutHtml('scp-cn', TEMPLATE_HTML);
  assert.ok(layout);
  assert.equal(layout.site, 'scp-cn');
  assert.ok(layout.containerStructure.includes(CONTENT_MARKER));
  assert.ok(layout.containerStructure.includes(TITLE_MARKER));
  assert.ok(layout.containerStructure.includes('My Site'));
  assert.ok(!layout.containerStructure.includes('%%content%%'));
  assert.ok(!layout.containerStructure.includes('<script'));
  assert.ok(!/onclick/i.test(layout.containerStructure));
  assert.ok(
    layout.containerStructure.includes('href="https://scp-cn.wikidot.com/nav:side"'),
    layout.containerStructure
  );
  assert.ok(
    layout.containerStructure.includes('src="https://scp-cn.wikidot.com/local--files/logo.png"'),
    layout.containerStructure
  );
  assert.deepEqual(layout.themes, [
    'https://cdn.example.com/base.css',
    'https://scp-cn.wikidot.com/local--theme/site.css',
  ]);
});

test('parseSiteLayoutHtml：顶栏裸文本 li 补齐 Wikidot 运行时的 <a> 包裹', () => {
  const html = `<div id="container">
    <div id="top-bar">
      <div class="top-bar"><ul>
        <li>菜单A<ul><li><a href="/a">子项</a></li></ul></li>
        <li><a href="/b">已有链接</a></li>
        <li>无子菜单</li>
      </ul></div>
      <div class="mobile-top-bar"><ul>
        <li>移动菜单<ul><li><a href="/m">M</a></li></ul></li>
      </ul></div>
    </div>
    <div id="page-content"></div>
  </div>`;
  const layout = parseSiteLayoutHtml('x', html);
  assert.ok(layout);
  // 桌面与 mobile-top-bar 的裸文本都被包进 <a>（主题的 #top-bar li a 样式依赖它）
  assert.match(layout.containerStructure, /<li><a href="#">菜单A\s*<\/a><ul>/);
  assert.match(layout.containerStructure, /<li><a href="#">无子菜单<\/a><\/li>/);
  assert.match(layout.containerStructure, /<li><a href="#">移动菜单\s*<\/a><ul>/);
  // 已有锚点不重复包裹，且相对链接照常绝对化
  assert.ok(layout.containerStructure.includes('href="https://x.wikidot.com/b"'));
  assert.equal((layout.containerStructure.match(/<a href="#">/g) || []).length, 3);
});

test('parseSiteLayoutHtml：缺 #page-content 返回 null；缺 #page-title 时自动补', () => {
  assert.equal(parseSiteLayoutHtml('x', '<div id="container"><div>x</div></div>'), null);

  const layout = parseSiteLayoutHtml(
    'x',
    '<div id="container"><div id="page-content">old</div></div>'
  );
  assert.ok(layout);
  assert.ok(layout.containerStructure.includes('id="page-title"'));
  assert.ok(layout.containerStructure.includes(TITLE_MARKER));
});

test('normalizeSiteName：空值/站点名/URL/非法输入', () => {
  assert.equal(normalizeSiteName(''), DEFAULT_SITE);
  assert.equal(normalizeSiteName(null), DEFAULT_SITE);
  assert.equal(normalizeSiteName('  SCP-CN  '), 'scp-cn');
  assert.equal(normalizeSiteName('https://www.scp-wiki-cn.wikidot.com/forum/'), 'scp-wiki-cn');
  assert.equal(normalizeSiteName('bad site!'), DEFAULT_SITE);
});

test('readSiteLayout 初始为空；allowNetwork=false 不联网', async () => {
  const calls = [];
  assert.equal(readSiteLayout('scp-cn'), null);
  const layout = await getSiteLayout('scp-cn', { allowNetwork: false, fetchImpl: okFetch(TEMPLATE_HTML, calls) });
  assert.equal(layout, null);
  assert.equal(calls.length, 0);
});

test('getSiteLayout：首次抓取并缓存，后续不再联网', async () => {
  const calls = [];
  const layout = await getSiteLayout('scp-cn', { fetchImpl: okFetch(TEMPLATE_HTML, calls) });
  assert.ok(layout);
  assert.equal(calls.length, 1);
  assert.equal(calls[0], 'https://scp-cn.wikidot.com/_template');
  assert.ok(fs.existsSync(path.join(homeCacheDir(), 'layout', 'scp-cn.json')));

  const again = await getSiteLayout('scp-cn', { fetchImpl: okFetch(TEMPLATE_HTML, calls) });
  assert.ok(again);
  assert.equal(calls.length, 1);
  assert.ok(readSiteLayout('scp-cn'));
});

test('getSiteLayout：过期缓存先返回旧值，后台刷新后再更新', async () => {
  const calls = [];
  await refreshSiteLayout('scp-cn', { fetchImpl: okFetch(TEMPLATE_HTML, calls) });
  assert.equal(calls.length, 1);

  // maxAgeMs=0：缓存一律视为过期；本次仍返回旧值，不等待网络
  let release;
  const slowFetch = async (url) => {
    calls.push(String(url));
    await new Promise((resolve) => { release = resolve; });
    return { ok: true, status: 200, text: async () => TEMPLATE_HTML };
  };
  const stale = await getSiteLayout('scp-cn', { fetchImpl: slowFetch, maxAgeMs: 0 });
  assert.ok(stale); // 网络还没返回就已经拿到旧布局
  assert.equal(calls.length, 2); // 后台请求已发出

  release();
  await waitForSiteLayoutRefresh();
  assert.equal(calls.length, 2); // 后台补齐
  const entry = JSON.parse(
    fs.readFileSync(path.join(homeCacheDir(), 'layout', 'scp-cn.json'), 'utf8')
  );
  assert.ok(Date.now() - entry.fetchedAt < 5000); // 时间戳已更新
});

test('refreshSiteLayout：强制联网；失败时返回旧缓存与错误信息', async () => {
  const calls = [];
  await refreshSiteLayout('scp-cn', { fetchImpl: okFetch(TEMPLATE_HTML, calls) });
  assert.equal(calls.length, 1);

  const refreshed = await refreshSiteLayout('scp-cn', { fetchImpl: okFetch(TEMPLATE_HTML, calls) });
  assert.ok(refreshed.layout);
  assert.equal(calls.length, 2);

  const failing = async () => ({ ok: false, status: 503, text: async () => '' });
  const failed = await refreshSiteLayout('scp-cn', { fetchImpl: failing });
  assert.ok(failed.layout); // 回退旧缓存
  assert.match(failed.error, /503/);

  const throwing = async () => { throw new Error('offline'); };
  const offline = await refreshSiteLayout('scp-cn', { fetchImpl: throwing });
  assert.ok(offline.layout);
  assert.match(offline.error, /offline/);
});

test('refreshSiteLayout：结构不完整的响应不覆盖旧缓存', async () => {
  await refreshSiteLayout('scp-cn', { fetchImpl: okFetch(TEMPLATE_HTML) });
  const broken = await refreshSiteLayout('scp-cn', {
    fetchImpl: okFetch('<html><body>no container</body></html>'),
  });
  assert.ok(broken.layout);
  assert.match(broken.error, /页面结构解析失败/);
});

test('getSiteLayout：失败后本会话不再自动重试，手动刷新可恢复', async () => {
  const calls = [];
  const failing = async (url) => {
    calls.push(String(url));
    throw new Error('offline');
  };
  assert.equal(await getSiteLayout('scp-cn', { fetchImpl: failing }), null);
  assert.equal(calls.length, 1);
  assert.match(getLayoutFailure('scp-cn'), /offline/);

  // 第二次直接回退，不再等网络
  assert.equal(await getSiteLayout('scp-cn', { fetchImpl: failing }), null);
  assert.equal(calls.length, 1);

  // 显式刷新会重试，成功后清除失败记忆
  const ok = await refreshSiteLayout('scp-cn', { fetchImpl: okFetch(TEMPLATE_HTML, calls) });
  assert.ok(ok.layout);
  assert.equal(calls.length, 2);
  assert.equal(getLayoutFailure('scp-cn'), null);
  assert.ok(await getSiteLayout('scp-cn', { fetchImpl: failing }));
});

test('clearLayoutCache：清空磁盘与进程内缓存', async () => {
  await getSiteLayout('scp-cn', { fetchImpl: okFetch(TEMPLATE_HTML) });
  assert.ok(fs.existsSync(path.join(homeCacheDir(), 'layout', 'scp-cn.json')));
  clearLayoutCache();
  assert.equal(readSiteLayout('scp-cn'), null);
  assert.ok(!fs.existsSync(path.join(homeCacheDir(), 'layout', 'scp-cn.json')));
});
