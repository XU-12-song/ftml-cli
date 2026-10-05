import { test } from 'node:test';
import assert from 'node:assert/strict';
import { processWikitext, createSettings } from '@wdprlib/parser';
import {
  dirtToIdeal,
  idealToDirt,
  divergencesFor,
  getDivergence,
  detectEmbedStructuralEscape,
  DIRECTION,
  VERDICT,
} from '../src/compat/index.js';
import { pushPageSource, fetchPageSource } from '../src/infra/wikidot.js';

const settings = { ...createSettings('page'), allowStyleElements: true };
const page = { fullName: 'compat', unixName: 'compat', tags: [] };

async function parseDiagnostics(src) {
  const doc = await processWikitext(src, { settings, page });
  return doc.diagnostics ?? [];
}

test('dirt→ideal：修补真正未闭合的行内标签，且修复后可无诊断解析', async () => {
  const dirt = '[[div]]\n[[span]]a\n[[/div]]\n';
  const r = dirtToIdeal(dirt);

  assert.equal(r.changed, true);
  assert.equal(r.src, '[[div]]\n[[span]]a\n[[/span]][[/div]]\n');
  assert.equal(r.changes.length, 1);
  assert.equal(r.changes[0].tag, 'span');
  assert.equal(r.changes[0].action, 'close-inline');
  assert.equal(r.changes[0].direction, DIRECTION.DIRT_TO_IDEAL);

  assert.deepEqual(await parseDiagnostics(r.src), []);
});

test('#78 最小复现：未闭合 span 使 wdpr 误报 div 未闭合；规范化后不再误报', async () => {
  const dirt = '[[div]]\n[[span]]a\n[[/div]]\n[[/span]]\n';

  // 原始输入：wdpr 把 [[/div]] 当成 span 文本，误报 div 未闭合
  const before = await parseDiagnostics(dirt);
  assert.ok(before.some((d) => d.code === 'unclosed-block' && /\[\[\/div\]\]/.test(d.message)));

  const r = dirtToIdeal(dirt);
  assert.equal(r.src, '[[div]]\n[[span]]a\n[[/span]][[/div]]\n[[/span]]\n');

  // 规范化后：不再有 div 未闭合的误报；游离的 [[/span]] 只作为警告报告
  const after = await parseDiagnostics(r.src);
  assert.ok(!after.some((d) => /\[\[\/div\]\]/.test(d.message)));
  assert.ok(r.diagnostics.some((d) => d.code === 'stray-inline-close'));
});

test('嵌套行内标签：最内层优先闭合', () => {
  const r = dirtToIdeal('[[div]]\n[[span]][[size]]x\n[[/div]]\n');
  assert.equal(r.src, '[[div]]\n[[span]][[size]]x\n[[/size]][[/span]][[/div]]\n');
  assert.deepEqual(r.changes.map((c) => c.tag), ['size', 'span']);
});

test('文件末尾仍开着的行内标签补闭', () => {
  const r = dirtToIdeal('[[span]]a');
  assert.equal(r.src, '[[span]]a[[/span]]');
  assert.equal(r.diagnostics.length, 0);
});

test('未闭合的块标签不自动补，只报告（不静默改写结构）', () => {
  const src = '[[div]]\n[[div]]\n[[/div]]\n';
  const r = dirtToIdeal(src);
  assert.equal(r.changed, false);
  assert.equal(r.src, src);
  assert.ok(r.diagnostics.some((d) => d.code === 'unclosed-block'));
});

test('游离闭标签不删除，只报告', () => {
  const src = '[[/span]]\n';
  const r = dirtToIdeal(src);
  assert.equal(r.changed, false);
  assert.equal(r.src, src);
  assert.equal(r.diagnostics[0].code, 'stray-inline-close');
});

test('合法理想源在 ideal→dirt 下是恒等变换', () => {
  const ideal = '[[div]]\n[[span]]a[[/span]]\n[[/div]]\n';
  const r = idealToDirt(ideal);
  assert.equal(r.changed, false);
  assert.equal(r.src, ideal);
  assert.equal(r.changes.length, 0);
  assert.equal(r.diagnostics.length, 0);
  assert.equal(r.direction, DIRECTION.IDEAL_TO_DIRT);
});

test('ideal→dirt 同样强制不变量 C（防御性保证 Wikidot 可解析）', () => {
  const r = idealToDirt('[[div]]\n[[span]]a\n[[/div]]\n');
  assert.equal(r.src, '[[div]]\n[[span]]a\n[[/span]][[/div]]\n');
});

test('转换幂等：对结果再跑一次不再改动', () => {
  const once = dirtToIdeal('[[div]]\n[[span]]a\n[[/div]]\n');
  const twice = dirtToIdeal(once.src);
  assert.equal(twice.changed, false);
  assert.equal(twice.src, once.src);
});

test('分歧表按方向过滤', () => {
  const both = divergencesFor(DIRECTION.DIRT_TO_IDEAL);
  assert.ok(both.some((d) => d.id === 'inline-scope-cross-block'));
  // bug 类条目不参与任何转换方向
  const bug = divergencesFor(DIRECTION.IDEAL_TO_DIRT).find((d) => d.verdict === VERDICT.BUG);
  assert.equal(bug, undefined);
});

// ---- embed 结构逃逸：渲染期告警（见分歧 embed-structural-escape）----

test('检测 [[embed]] 体内裸露的块闭标签（史诗级 bug 最小复现）', () => {
  const src = '[[collapsible show="a" hide="b"]]\n[[embed]]\n<iframe src="[[/collapsible]]"></iframe>\n[[/embed]]\n';
  const ds = detectEmbedStructuralEscape(src);
  assert.equal(ds.length, 1);
  assert.equal(ds[0].code, 'embed-structural-escape');
  assert.equal(ds[0].severity, 'warning');
  assert.equal(ds[0].position.start.line, 3);
  assert.ok(ds[0].message.includes('[[/collapsible]]'));
  assert.ok(ds[0].message.includes('[[embed]]'));
});

test('embed 体内平衡的标签对不算逃逸', () => {
  const src = '[[embed]]\n[[span]]x[[/span]]\n[[/embed]]\n';
  assert.deepEqual(detectEmbedStructuralEscape(src), []);
});

test('正常闭合的 embed/html 不告警', () => {
  assert.deepEqual(detectEmbedStructuralEscape('[[embed]]\n<b>hi</b>\n[[/embed]]\n'), []);
  assert.deepEqual(detectEmbedStructuralEscape('[[html]]\n<b>hi</b>\n[[/html]]\n'), []);
});

test('[[html]] 体内的裸 [[/div]] 同样告警', () => {
  const ds = detectEmbedStructuralEscape('[[html]]\n[[/div]]\n[[/html]]\n');
  assert.equal(ds.length, 1);
  assert.equal(ds[0].code, 'embed-structural-escape');
  assert.ok(ds[0].message.includes('[[html]]'));
});

test('分歧表登记 embed-structural-escape：diverge 但不参与转换方向', () => {
  const d = getDivergence('embed-structural-escape');
  assert.equal(d.verdict, VERDICT.DIVERGE);
  assert.deepEqual(d.directions, []);
  assert.equal(d.rule, 'warn-embed-structural-escape');
  assert.ok(!divergencesFor(DIRECTION.DIRT_TO_IDEAL).some((x) => x.id === 'embed-structural-escape'));
  assert.ok(!divergencesFor(DIRECTION.IDEAL_TO_DIRT).some((x) => x.id === 'embed-structural-escape'));
});

// ---- 读写边界：转换真正挂到了线上 I/O 上 ----

/** page.edit 捕获实际提交源码的最小假客户端 */
function editCaptureClient() {
  const calls = { source: null };
  const page = {
    name: 'p',
    revisionsCount: 3,
    edit: async ({ source }) => {
      calls.source = source;
      return { isOk: () => true };
    },
  };
  const site = { unixName: 's', client: null, page: { get: async () => ({ isOk: () => true, value: page }) } };
  const client = { site: { get: async () => ({ isOk: () => true, value: site }) }, close: async () => {} };
  site.client = client;
  return { client, calls };
}

test('写入边界：pushPageSource 提交前补全未闭合行内标签', async () => {
  const { client, calls } = editCaptureClient();
  const r = await pushPageSource({
    siteName: 's',
    pageName: 'p',
    source: '[[div]]\n[[span]]a\n[[/div]]\n',
    comment: 'c',
    clientFactory: () => client,
  });
  assert.equal(r.compat.changed, true);
  assert.equal(calls.source, '[[div]]\n[[span]]a\n[[/span]][[/div]]\n');
});

test('写入边界：理想源在提交时是恒等变换', async () => {
  const { client, calls } = editCaptureClient();
  const ideal = '[[div]]\n[[span]]a[[/span]]\n[[/div]]\n';
  const r = await pushPageSource({ siteName: 's', pageName: 'p', source: ideal, comment: 'c', clientFactory: () => client });
  assert.equal(r.compat.changed, false);
  assert.equal(calls.source, ideal);
});

test('读取边界：fetchPageSource 把线上脏源码规范化为理想 FTML', async () => {
  const page = { getSource: async () => ({ isOk: () => true, value: '[[div]]\n[[span]]a\n[[/div]]\n' }) };
  assert.equal(await fetchPageSource(page), '[[div]]\n[[span]]a\n[[/span]][[/div]]\n');
});
