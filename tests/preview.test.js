import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderPreview, resolveIncludeFile } from '../src/utils/preview.js';
import { buildPreviewDocument } from '../src/utils/preview-page.js';
import { getSite, getPage } from '../src/utils/wikidot.js';
import { parseFtmx } from '../src/core/parse-ftmx.js';
import { readPageCache } from '../src/utils/cache.js';

// 远程 include 的磁盘缓存落在 FTML_CLI_HOME（默认 ~/.ftml-cli/cache）。
// 每个用例隔离到独立临时目录，避免污染真实主目录、也避免用例间缓存串扰。
let oldHome;
let homeDir;
beforeEach(() => {
  oldHome = process.env.FTML_CLI_HOME;
  homeDir = mkdtempSync(path.join(os.tmpdir(), 'ftml-home-'));
  process.env.FTML_CLI_HOME = homeDir;
});
afterEach(() => {
  rmSync(homeDir, { recursive: true, force: true });
  if (oldHome === undefined) delete process.env.FTML_CLI_HOME;
  else process.env.FTML_CLI_HOME = oldHome;
});

function tmpdir(files) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ftml-pv-'));
  for (const [name, content] of Object.entries(files)) {
    const p = path.join(dir, name);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, content);
  }
  return dir;
}

// ---------- renderPreview：@wdprlib 渲染管线 ----------

test('渲染 div/strong/em/code 为 HTML', async () => {
  const { html, diagnostics } = await renderPreview(
    `[[div class="box"]]
内容 **加粗** 和 //斜体//
[[/div]]`
  );
  assert.ok(html.includes('<div class="box">'));
  assert.ok(html.includes('<strong>加粗</strong>'));
  assert.ok(html.includes('<em>斜体</em>'));
  assert.deepEqual(diagnostics, []);
});

test('[[module CSS]]（build 后的 style 产物）收集为 <style> 并内联进 HTML', async () => {
  const { html, styles } = await renderPreview(
    `[[module CSS]]
.box { color: red; }
[[/module]]
[[div class="box"]]x[[/div]]`
  );
  assert.ok(styles.some((s) => s.includes('.box { color: red; }')));
  assert.ok(html.includes('<style>'));
  assert.ok(html.includes('.box { color: red; }'));
});

test('code 块内容转义为 pre/code', async () => {
  const { html } = await renderPreview(`[[code]][[div]]x[[/div]][[/code]]`);
  assert.ok(html.includes('<pre><code>'));
  assert.ok(html.includes('[[div]]x[[/div]]'));
});

test('未闭合块产生诊断（不阻断输出）', async () => {
  const { html, diagnostics } = await renderPreview(`[[div]]\n缺闭合\n`);
  assert.ok(html.includes('缺闭合'));
  assert.ok(diagnostics.some((d) => d.code === 'unclosed-block'));
});

// ---------- [[include]] 本地解析 ----------

test('resolveIncludeFile：同目录 / 分类斜杠映射 / 越界 / 跨站镜像', () => {
  const dir = tmpdir({
    'box.ftml': 'x',
    'component/box.ftml': 'y',
    'other/box.ftml': 'z',
    'scp-wiki-cn/theme/parallel.ftml': 't',
  });
  try {
    assert.equal(resolveIncludeFile({ site: null, page: 'box' }, dir, 'mysite'), path.join(dir, 'box.ftml'));
    assert.equal(
      resolveIncludeFile({ site: null, page: 'component:box' }, dir, 'mysite'),
      path.join(dir, 'component/box.ftml')
    );
    assert.equal(resolveIncludeFile({ site: null, page: '../evil' }, dir, 'mysite'), null);
    // 跨站 include：优先 <site>/<page 斜杠化> 镜像，其次普通位置
    assert.equal(resolveIncludeFile({ site: 'other', page: 'box' }, dir, 'mysite'), path.join(dir, 'other/box.ftml'));
    assert.equal(
      resolveIncludeFile({ site: 'scp-wiki-cn', page: 'theme:parallel' }, dir, 'mysite'),
      path.join(dir, 'scp-wiki-cn/theme/parallel.ftml')
    );
    assert.equal(resolveIncludeFile({ site: 'nope', page: 'box' }, dir, 'mysite'), path.join(dir, 'box.ftml'));
    // 镜像和普通位置都不存在才返回 null
    assert.equal(resolveIncludeFile({ site: 'nope', page: 'ghost' }, dir, 'mysite'), null);
    assert.equal(resolveIncludeFile({ site: 'mysite', page: 'box' }, dir, 'mysite'), path.join(dir, 'box.ftml'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('renderPreview 解析本地 [[include]]，目标内模板调用被展开', async () => {
  const templates = new Map([
    ['addendum', parseFtmx(`[[div class="addendum" title]]\n[[span]]{ title }[[/span]]\n{ children }\n[[/div]]`, 'addendum')],
  ]);
  const dir = tmpdir({
    'box.ftml': `[[addendum title='来自include']]\n内容\n[[/addendum]]`,
  });
  try {
    const { html } = await renderPreview(`[[include box]]`, {
      page: { fullName: 'test:main', unixName: 'main', tags: [], site: 'mysite' },
      includeBaseDir: dir,
      includeTemplates: templates,
    });
    assert.ok(html.includes(`<div class="addendum">`));
    assert.ok(html.includes('来自include'));
    assert.ok(!html.includes('error-block'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('renderPreview 未提供 includeBaseDir 时 include 渲染为占位', async () => {
  const { html } = await renderPreview(`[[include missing]]`);
  assert.ok(html.includes('error-block'));
});

// ---------- 远程 include 回退（本地缺失 → 已登录客户端拉取） ----------

/** 构造可远程获取页面的假 client（site.page.get 返回 page 或 null） */
function fakeRemoteClient(pages) {
  const site = {
    unixName: 'remote',
    client: null,
    page: {
      get: async (name) => {
        const p = pages[name];
        return { isOk: () => true, value: p ?? null };
      },
    },
  };
  const client = {
    site: {
      get: async () => ({ isOk: () => true, value: site }),
    },
  };
  site.client = client;
  return client;
}

test('本地缺失的 include 通过已登录客户端远程拉取（并展开模板）', async () => {
  const templates = new Map([
    ['addendum', parseFtmx(`[[div class="addendum" title]]\n{ title }\n[[/div]]`, 'addendum')],
  ]);
  const client = fakeRemoteClient({
    'theme:parallel': {
      getSource: async () => ({ isOk: () => true, value: `[[addendum title='远程主题']]\n[[/addendum]]` }),
    },
  });
  const dir = tmpdir({}); // 本地无任何 .ftml
  try {
    const { html } = await renderPreview(`[[include :remote:theme:parallel]]`, {
      page: { fullName: 'mysite:main', unixName: 'main', tags: [], site: 'mysite' },
      includeBaseDir: dir,
      includeTemplates: templates,
      client,
    });
    assert.ok(html.includes('<div class="addendum">'));
    assert.ok(html.includes('远程主题'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('远程 include 页面不存在时渲染占位', async () => {
  const client = fakeRemoteClient({});
  const dir = tmpdir({});
  try {
    const { html } = await renderPreview(`[[include :remote:ghost]]`, {
      page: { fullName: 'mysite:main', unixName: 'main', tags: [], site: 'mysite' },
      includeBaseDir: dir,
      client,
    });
    assert.ok(html.includes('error-block'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('远程拉取失败产生警告诊断并渲染占位（不抛出）', async () => {
  const client = {
    site: {
      get: async () => ({ isOk: () => false, error: '请求超时' }),
    },
  };
  const dir = tmpdir({});
  try {
    const { html, diagnostics } = await renderPreview(`[[include :remote:theme:parallel]]`, {
      page: { fullName: 'mysite:main', unixName: 'main', tags: [], site: 'mysite' },
      includeBaseDir: dir,
      client,
    });
    assert.ok(html.includes('error-block'));
    assert.ok(diagnostics.some((d) => d.code === 'remote-include-failed'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('远程拉取成功后写入磁盘缓存，下次命中缓存不再请求网络', async () => {
  const templates = new Map([
    ['addendum', parseFtmx(`[[div class="addendum"]]{ children }[[/div]]`, 'addendum')],
  ]);
  const client = fakeRemoteClient({
    'theme:parallel': {
      getSource: async () => ({ isOk: () => true, value: `[[addendum]]来自远程[[/addendum]]` }),
    },
  });
  const dir = tmpdir({});
  const page = { fullName: 'mysite:main', unixName: 'main', tags: [], site: 'mysite' };
  try {
    // 第一次：网络拉取 + 落盘 ~/.ftml-cli/cache/remote/theme/parallel.ftml
    const first = await renderPreview(`[[include :remote:theme:parallel]]`, {
      page, includeBaseDir: dir, includeTemplates: templates, client,
    });
    assert.ok(first.html.includes('来自远程'));
    assert.ok(readPageCache('remote', 'theme:parallel')?.includes('来自远程'));

    // 第二次：换一个必然失败的 client，缓存命中则不会发起请求
    const broken = {
      site: { get: async () => { throw new Error('不应请求网络'); } },
    };
    const second = await renderPreview(`[[include :remote:theme:parallel]]`, {
      page, includeBaseDir: dir, includeTemplates: templates, client: broken,
    });
    assert.ok(second.html.includes('来自远程'));
    assert.ok(!second.diagnostics.some((d) => d.code === 'remote-include-failed'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('renderPreview 嵌套 include 递归展开', async () => {
  // Wikidot 规则：[[include]] 必须出现在行首，内层 include 要独占一行
  const dir = tmpdir({
    'outer.ftml': `外层:\n[[include inner]]`,
    'inner.ftml': `内层`,
  });
  try {
    const { html } = await renderPreview(`[[include outer]]`, {
      page: { fullName: 'test:main', unixName: 'main', tags: [], site: 'mysite' },
      includeBaseDir: dir,
    });
    assert.ok(html.includes('外层'));
    assert.ok(html.includes('内层'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- site/page 缓存 ----------

/** 构造可计数的假 client/site/page，验证 getSite/getPage 复用缓存 */
function fakeWorld() {
  let siteCalls = 0;
  let pageCalls = 0;
  const page = { name: 'test', fullname: 'test', title: 'T' };
  const site = {
    unixName: 'mysite',
    client: null, // 下面填
    page: {
      get: async () => {
        pageCalls++;
        return { isOk: () => true, value: page };
      },
    },
  };
  const client = {
    site: {
      get: async () => {
        siteCalls++;
        return { isOk: () => true, value: site };
      },
    },
  };
  site.client = client;
  return { client, site, counts: () => ({ siteCalls, pageCalls }) };
}

test('同一客户端重复 getSite/getPage 命中缓存', async () => {
  const { client, site, counts } = fakeWorld();
  const s1 = await getSite(client, 'mysite');
  const s2 = await getSite(client, 'mysite');
  assert.equal(s1, s2);
  assert.equal(counts().siteCalls, 1);

  const p1 = await getPage(site, 'test');
  const p2 = await getPage(site, 'test');
  assert.equal(p1, p2);
  assert.equal(counts().pageCalls, 1);
});

test('不同客户端各自缓存（不互相污染）', async () => {
  const w1 = fakeWorld();
  const w2 = fakeWorld();
  await getSite(w1.client, 'mysite');
  await getSite(w2.client, 'mysite');
  const p1 = await getPage(w1.site, 'test');
  assert.ok(p1);
  assert.equal(w1.counts().siteCalls, 1);
  assert.equal(w2.counts().siteCalls, 1);
});

test('页面不存在（null）不缓存', async () => {
  const siteCalls = { n: 0 };
  const client = {
    site: {
      get: async () => ({ isOk: () => true, value: { unixName: 's', client: null, page: { get: async () => { siteCalls.n++; return { isOk: () => true, value: null }; } } } }),
    },
  };
  const site = await getSite(client, 's');
  site.client = client;
  const p1 = await getPage(site, 'nope');
  const p2 = await getPage(site, 'nope');
  assert.equal(p1, null);
  assert.equal(p2, null);
  assert.equal(siteCalls.n, 2);
});

// ---------- buildPreviewDocument：完整文档包装 + runtime 注入 ----------

test('buildPreviewDocument 包装为完整文档并内联 runtime', () => {
  const doc = buildPreviewDocument({ html: '<p>你好</p>', title: '测试 <页>' });
  // 文档外壳
  assert.ok(doc.startsWith('<!DOCTYPE html>'));
  assert.ok(doc.includes('<html lang="zh">'));
  assert.ok(doc.includes('<meta charset="utf-8">'));
  assert.ok(doc.includes('<title>测试 &lt;页&gt;</title>'));
  assert.ok(doc.includes('<div id="page-content">\n<p>你好</p>'));
  // runtime 以 <script type="module"> 内联，自包含（无外部 import），保留 export
  assert.ok(doc.includes('<script type="module">'));
  assert.ok(doc.includes('function initWdprRuntime'));
  assert.ok(!doc.includes('import.meta'));
  assert.ok(!doc.includes(' from '));
  // 引导脚本在源码之后调用
  assert.ok(doc.includes("initWdprRuntime({ root: document.getElementById('page-content') });"));
  // script 标签配对闭合
  assert.equal((doc.match(/<script/g) || []).length, (doc.match(/<\/script>/g) || []).length);
});

test('buildPreviewDocument 附带小部件基础样式', () => {
  const doc = buildPreviewDocument({ html: '<p>x</p>' });
  for (const sel of [
    '.collapsible-block',
    '.yui-navset .yui-nav',
    'a.footnoteref',
    '#odialog-hovertips .hovertip',
    '#toc',
    '.foldable-list-container .foldable-list-toggle',
  ]) {
    assert.ok(doc.includes(sel), `widget css 缺少 ${sel}`);
  }
});
