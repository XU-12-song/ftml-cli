/**
 * publish 相关单测：include 引用名解析/重写、本地镜像解析、依赖闭包计划、建页写入
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  splitPageRef,
  remotePageName,
  canonicalTarget,
  scanIncludeRefs,
  rewriteIncludeRefs,
} from '../src/domain/include-refs.js';
import { resolveIncludeFile } from '../src/domain/include-resolve.js';
import { buildPublishPlan, rewriteDepSource, describeConflicts } from '../src/domain/publish.js';
import { upsertPageSource, pushPageSource } from '../src/infra/wikidot.js';
import { makeTmpDir, cleanup } from './helpers/fixtures.js';
import { fakeMultiPageClient } from './helpers/fake-wikidot.js';

// ---------- include-refs：引用名解析 ----------

test('splitPageRef：与 wdpr parseIncludePageRef 同口径', () => {
  assert.deepEqual(splitPageRef('component:box'), { site: null, page: 'component:box' });
  assert.deepEqual(splitPageRef(':scp-jp:theme:parallel'), { site: 'scp-jp', page: 'theme:parallel' });
  // 只有一个冒号、不构成 :site:page 的形态，整体当 page（不去猜站点名）
  assert.deepEqual(splitPageRef(':onlysite'), { site: null, page: ':onlysite' });
});

test('remotePageName：路径形式归一到冒号形式，已是冒号形式则恒等', () => {
  assert.equal(remotePageName('components/box'), 'components:box');
  assert.equal(remotePageName('/a/b'), 'a:b');
  assert.equal(remotePageName('component:box'), 'component:box');
});

test('canonicalTarget：跨站保留 :site: 前缀，同站只取页面全名', () => {
  assert.equal(canonicalTarget({ site: null, page: 'components/box' }, 'scp-cn'), 'components:box');
  assert.equal(canonicalTarget({ site: 'scp-cn', page: 'components/box' }, 'scp-cn'), 'components:box');
  assert.equal(canonicalTarget({ site: 'scp-jp', page: 'theme/parallel' }, 'scp-cn'), ':scp-jp:theme:parallel');
});

// ---------- include-refs：扫描与重写 ----------

test('scanIncludeRefs：只认行首的 include，start/end 指向目标 token', () => {
  const src = [
    '[[include component:box |k=v]]',
    '正文里的 [[include notthis]] 不算',
    '  [[include indented]]', // 缩进后非行首：Wikidot 也不解析
  ].join('\n');
  const refs = scanIncludeRefs(src);
  assert.equal(refs.length, 1);
  const r = refs[0];
  assert.equal(r.target, 'component:box');
  assert.equal(src.slice(r.start, r.end), 'component:box');
  assert.deepEqual({ site: r.site, page: r.page }, { site: null, page: 'component:box' });
});

test('scanIncludeRefs：参数值里的 [[...]] 不会把标签提前截断', () => {
  const src = '[[include page |a=[[span]]x[[/span]] |b=[[/div]]]]';
  const refs = scanIncludeRefs(src);
  assert.equal(refs.length, 1);
  assert.equal(refs[0].target, 'page');
});

test('rewriteIncludeRefs：按映射替换，未命中的原样保留', () => {
  const src = '[[include components/box]]\n[[include other/page]]\n';
  const out = rewriteIncludeRefs(src, { 'components/box': 'components:box' });
  assert.equal(out, '[[include components:box]]\n[[include other/page]]\n');
});

test('rewriteIncludeRefs：多处替换互不影响偏移（Map 形式）', () => {
  const src = '[[include a/b]]\n[[include a/b]]\n';
  const out = rewriteIncludeRefs(src, new Map([['a/b', 'a:b']]));
  assert.equal(out, '[[include a:b]]\n[[include a:b]]\n');
});

// ---------- include-resolve：本地镜像解析 ----------

test('resolveIncludeFile：同站 `:` → `/` 归一到镜像路径', () => {
  const dir = makeTmpDir({ 'component/box.ftml': 'x' });
  try {
    assert.equal(path.resolve(resolveIncludeFile({ site: null, page: 'component:box' }, dir, 'scp-cn')), path.join(dir, 'component', 'box.ftml'));
    // 无名回退：路径形式直取
    assert.equal(path.resolve(resolveIncludeFile({ site: null, page: 'component/box' }, dir, 'scp-cn')), path.join(dir, 'component', 'box.ftml'));
    // 缺失 → null
    assert.equal(resolveIncludeFile({ site: null, page: 'component:none' }, dir, 'scp-cn'), null);
  } finally {
    cleanup(dir);
  }
});

test('resolveIncludeFile：跨站优先 <site>/<page>，其次退到裸 page', () => {
  const dir = makeTmpDir({ 'scp-jp/theme/parallel.ftml': 'jp', 'theme/parallel.ftml': 'bare' });
  try {
    const abs = path.resolve(resolveIncludeFile({ site: 'scp-jp', page: 'theme:parallel' }, dir, 'scp-cn'));
    assert.equal(abs, path.join(dir, 'scp-jp', 'theme', 'parallel.ftml'));
  } finally {
    cleanup(dir);
  }
});

test('resolveIncludeFile：拒绝 ../ 越界（即便外部文件真实存在）', () => {
  // baseDir = <parent>/sub，外部真实文件 <parent>/secret.ftml；`../secret` 命中它也不该被认
  const parent = makeTmpDir({ 'sub/inside.ftml': 'x', 'secret.ftml': 'leak' });
  try {
    const baseDir = path.join(parent, 'sub');
    assert.equal(resolveIncludeFile({ site: null, page: '../secret' }, baseDir, 'scp-cn'), null);
    // 界内正常命中
    assert.equal(path.resolve(resolveIncludeFile({ site: null, page: 'inside' }, baseDir, 'scp-cn')), path.join(baseDir, 'inside.ftml'));
  } finally {
    cleanup(parent);
  }
});

// ---------- publish：依赖闭包计划 ----------

test('buildPublishPlan：递归收集依赖、叶子在前、路径引用名重写为线上全名', async () => {
  const dir = makeTmpDir({
    'components/box.ftml': '[[include components/inner]]\n[[div]]box[[/div]]\n',
    'components/inner.ftml': '[[div]]inner[[/div]]\n',
  });
  try {
    const entrySource = '[[include components/box |k=v]]\nmain\n';
    const plan = await buildPublishPlan({
      entrySource,
      entryDir: dir,
      currentSite: 'scp-cn',
      entryName: 'main',
      templates: new Map(),
    });

    assert.deepEqual(plan.conflicts, []);
    // 叶子在前：被引用的 inner 先于引用它的 box
    assert.deepEqual(plan.pages.map((p) => p.name), ['components:inner', 'components:box']);
    // 引用名归一到线上全名
    assert.equal(plan.entry, '[[include components:box |k=v]]\nmain\n');
    assert.equal(plan.rewrites.get('components/box'), 'components:box');
    assert.equal(plan.rewrites.get('components/inner'), 'components:inner');

    // 依赖页自身源码也走同一张映射表重写
    const box = plan.pages.find((p) => p.name === 'components:box');
    assert.equal(rewriteDepSource(plan, box.source), '[[include components:inner]]\n[[div]]box[[/div]]\n');
  } finally {
    cleanup(dir);
  }
});

test('buildPublishPlan：远程引用（本地无镜像）不收集、也不重写', async () => {
  const dir = makeTmpDir({});
  try {
    const entrySource = '[[include :other-site:remote:page]]\n[[include scripts/whatever]]\n';
    const plan = await buildPublishPlan({
      entrySource,
      entryDir: dir,
      currentSite: 'scp-cn',
      templates: new Map(),
    });
    assert.deepEqual(plan.pages, []);
    assert.equal(plan.rewrites.size, 0);
    assert.equal(plan.entry, entrySource); // 原样
  } finally {
    cleanup(dir);
  }
});

test('buildPublishPlan：依赖页名撞入口页名 → entry-cycle 冲突', async () => {
  const dir = makeTmpDir({ 'hello.ftml': 'dep\n' });
  try {
    const plan = await buildPublishPlan({
      entrySource: '[[include hello]]\n',
      entryDir: dir,
      currentSite: 'scp-cn',
      entryName: 'hello',
      templates: new Map(),
    });
    assert.equal(plan.conflicts.length, 1);
    assert.equal(plan.conflicts[0].kind, 'entry-cycle');
    assert.deepEqual(plan.pages, []);
  } finally {
    cleanup(dir);
  }
});

test('buildPublishPlan：同一文件被两种引用名指到 → file-alias 冲突', async () => {
  // `a//b` 与 `a/b` 都归到同一个文件 a/b.ftml，但线上名分别是 a::b 与 a:b
  const dir = makeTmpDir({ 'a/b.ftml': 'x\n' });
  try {
    const plan = await buildPublishPlan({
      entrySource: '[[include a//b]]\n[[include a/b]]\n',
      entryDir: dir,
      currentSite: 'scp-cn',
      templates: new Map(),
    });
    assert.equal(plan.conflicts.length, 1);
    assert.equal(plan.conflicts[0].kind, 'file-alias');
    assert.deepEqual(plan.conflicts[0].names.sort(), ['a::b', 'a:b']);
    // 只发布第一个遇到的
    assert.equal(plan.pages.length, 1);
  } finally {
    cleanup(dir);
  }
});

test('describeConflicts：三类冲突都能转成可读文本', () => {
  const text = describeConflicts([
    { kind: 'file-alias', file: '/x/a.ftml', names: ['a::b', 'a:b'] },
    { kind: 'name-clash', name: 'a:b', files: ['/x/a.ftml', '/y/a.ftml'] },
    { kind: 'entry-cycle', name: 'main', file: '/x/main.ftml' },
  ]);
  assert.match(text, /同一文件被两种引用名指到/);
  assert.match(text, /两个文件要发布成同一个页面名 a:b/);
  assert.match(text, /依赖页名与入口页重名：main/);
});

// ---------- wikidot：建页 / 覆盖写入 ----------

test('upsertPageSource：页面存在则 edit，不存在则 create', async () => {
  const { client, site, calls, store } = fakeMultiPageClient({ 'exists:page': 'old' });
  void client;

  const edited = await upsertPageSource({ site, pageName: 'exists:page', source: 'new', comment: 'c' });
  assert.equal(edited.created, false);
  assert.deepEqual(calls.edit, ['exists:page']);
  assert.equal(store.get('exists:page'), 'new');

  const created = await upsertPageSource({ site, pageName: 'fresh:page', source: 'fresh', comment: 'c' });
  assert.equal(created.created, true);
  assert.deepEqual(calls.create, ['fresh:page']);
  assert.equal(store.get('fresh:page'), 'fresh');
});

test('pushPageSource：传入已登录 client 时复用且不关闭（由 withClient 统一关闭）', async () => {
  const { client, site, calls, store } = fakeMultiPageClient({ p: 'old' });
  void site;
  let closes = 0;
  client.close = async () => { closes++; };

  const r = await pushPageSource({ siteName: 'scp-cn', pageName: 'p', source: 'new', comment: 'c', client });
  assert.equal(r.revisionsCount, 1);
  assert.deepEqual(calls.edit, ['p']);
  assert.equal(store.get('p'), 'new');
  assert.equal(closes, 0); // 传入的 client 不被 pushPageSource 关闭
});
