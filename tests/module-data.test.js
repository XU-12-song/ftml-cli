import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MODULE_CAPS } from '../src/render/module-caps.js';
import {
  buildPlaceholderFetchers,
  applyListUsersRepeat,
} from '../src/render/module-placeholders.js';
import { createModuleDataProvider } from '../src/render/module-data.js';
import { toSearchPagesParams, parseTagAnchors } from '../src/render/module-resolve.js';
import { DEFAULT_MODULE_PLACEHOLDERS } from '../src/domain/settings.js';

const page = { fullName: 'scp-173', unixName: 'scp-173', site: 'scp-wiki' };

function fetchers(overrides = {}) {
  return buildPlaceholderFetchers({
    placeholders: {
      ...DEFAULT_MODULE_PLACEHOLDERS,
      listPages: { ...DEFAULT_MODULE_PLACEHOLDERS.listPages, count: 3 },
      ...overrides,
    },
    page,
    caps: DEFAULT_MODULE_CAPS,
  });
}

test('ListPages 占位：行数、标题模板与完整字段', async () => {
  const data = await fetchers().fetchListPages({ limit: 10 });
  assert.equal(data.pages.length, 3);
  assert.equal(data.totalCount, 3);
  assert.equal(data.pages[0].title, '示例页面 1');
  assert.equal(data.pages[2].title, '示例页面 3');
  assert.equal(data.pages[0].content, DEFAULT_MODULE_PLACEHOLDERS.listPages.text);
  assert.ok(data.pages[0].ratingPercent >= 0 && data.pages[0].ratingPercent <= 100);
  assert.deepEqual(data.pages[0].tags, ['示例', '占位']);
  assert.equal(data.site.name, 'scp-wiki');
});

test('ListPages 占位：query.limit 小于设置时以 limit 为准', async () => {
  const data = await fetchers().fetchListPages({ limit: 2 });
  assert.equal(data.pages.length, 2);
});

test('ListUsers 占位：按模块实例编号生成', async () => {
  const data = await fetchers().fetchListUsers({ id: 1, users: '.', neededVariables: ['name'] });
  assert.equal(data.user.name, 'user-2');
  assert.equal(data.user.title, '示例用户 2');
});

test('TagCloud 占位：数量、权重与 category 归一化', async () => {
  const data = await fetchers().fetchTagCloud({ limit: 3, category: 'News Foo' });
  assert.equal(data.status, 'ok');
  assert.equal(data.tags.length, 3);
  assert.equal(data.tags[0].weight, 50);
  assert.equal(data.tags[2].weight, 1);
  assert.equal(data.category, 'news-foo');
});

test('TagCloud 占位：数量为 0 时返回空标签', async () => {
  const f = buildPlaceholderFetchers({
    placeholders: {
      ...DEFAULT_MODULE_PLACEHOLDERS,
      tagCloud: { ...DEFAULT_MODULE_PLACEHOLDERS.tagCloud, count: 0 },
    },
    page,
    caps: DEFAULT_MODULE_CAPS,
  });
  const data = await f.fetchTagCloud({ limit: 50, category: null });
  assert.deepEqual(data.tags, []);
});

test('Rate 占位：为每个 ref 生成只读状态', async () => {
  const refs = [{ kind: 'main' }, { kind: 'custom', axisKey: 'theme' }];
  const states = await fetchers().fetchRatings(refs);
  assert.equal(states.length, 2);
  assert.deepEqual(states[0].aggregate, { points: 12, votes: 20, percent: 80 });
  assert.equal(states[0].canVote, false);
  assert.equal(states[1].label, 'theme');
});

test('applyListUsersRepeat：只在 count > 1 时复制模块块', () => {
  const src = 'A\n[[module ListUsers users="."]]\n%%name%%\n[[/module]]\nB';
  assert.equal(applyListUsersRepeat(src, 1), src);
  const out = applyListUsersRepeat(src, 2);
  assert.equal(out.match(/\[\[module ListUsers/g)?.length, 2);
});

test('toSearchPagesParams：归一化查询 → Wikidot 搜索参数', () => {
  const warnings = [];
  const params = toSearchPagesParams({
    category: { include: ['news'], exclude: ['blog'], all: false, current: false },
    tags: { all: ['a'], any: [], none: ['b'], special: null },
    parent: { type: 'children' },
    rating: { op: '>=', value: 3 },
    limit: 100,
    perPage: 300,
    offset: 5,
    order: { field: 'created_at', direction: 'desc' },
  }, page, DEFAULT_MODULE_CAPS, warnings);

  assert.equal(params.category, 'news -blog');
  assert.equal(params.tags, '+a -b');
  assert.equal(params.parent, '.');
  assert.equal(params.rating, '>=3');
  assert.equal(params.limit, DEFAULT_MODULE_CAPS.listPagesMaxRows);
  assert.equal(params.perPage, 250);
  assert.equal(params.offset, 5);
  assert.equal(params.order, 'created_at desc');
  assert.deepEqual(warnings, []);
});

test('toSearchPagesParams：不支持的评分轴/排序给出警告', () => {
  const warnings = [];
  const params = toSearchPagesParams({
    ratingAxis: 'theme',
    order: { field: 'metadata', key: 'date', direction: 'desc' },
  }, page, DEFAULT_MODULE_CAPS, warnings);
  assert.equal(params.order, 'title asc');
  assert.ok(warnings.some((w) => w.code === 'module-real-listpages-rating-axis'));
  assert.ok(warnings.some((w) => w.code === 'module-real-listpages-order-metadata'));
});

test('parseTagAnchors：读取 class=tag 与 font-size 权重并解码实体', () => {
  const html = [
    '<a class="tag" style="font-size: 120%;">a&amp;b</a>',
    '<a class="other" style="font-size: 10%;">skip</a>',
    '<a href="#x" class="tag" style="font-size: 80%">c</a>',
  ].join('');
  const tags = parseTagAnchors(html, 10);
  assert.deepEqual(tags, [{ tag: 'a&b', weight: 120 }, { tag: 'c', weight: 80 }]);
});

test('createModuleDataProvider：real 模式无客户端 → 占位 + 告警', async () => {
  const { fetchers: f, warnings, summary } = createModuleDataProvider({
    mode: 'real',
    placeholders: DEFAULT_MODULE_PLACEHOLDERS,
    page,
    client: null,
    clientError: new Error('not logged in'),
  });
  const data = await f.fetchListPages({ limit: 10 });
  assert.equal(data.pages.length, DEFAULT_MODULE_PLACEHOLDERS.listPages.count);
  assert.equal(summary.fallback, true);
  assert.ok(warnings.some((w) => w.code === 'module-real-no-client'));
});

test('createModuleDataProvider：单个真实 fetcher 失败 → 仅该模块回退占位', async () => {
  const { fetchers: f, warnings, summary } = createModuleDataProvider({
    mode: 'real',
    placeholders: DEFAULT_MODULE_PLACEHOLDERS,
    page,
    client: {}, // 没有 me，ListUsers 会抛错
  });
  const user = await f.fetchListUsers({ id: 0, users: '.' });
  assert.equal(user.user.name, 'user-1');
  assert.equal(summary.fallback, true);
  assert.ok(warnings.some((w) => w.code === 'module-real-listusers-failed'));
});
