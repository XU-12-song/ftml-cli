/**
 * css-completion.test.ts — CSS 补全纯函数单测
 *
 * 覆盖（不依赖 DOM / CodeMirror）：
 *   - isCssContext 上下文判定：[[module CSS]] / [[style]] / style="…" / 普通正文 / [[code]]
 *   - CSS 值中的 `/` 不命中闭合标签补全（cssCompletion 占位 + parseCssFragment 判为 value）
 *   - 变量解析（parseCssVars）、噪声 id 过滤（filterSelectorNoise）、去重与上限（dedupeCap）
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isCssContext,
  parseCssFragment,
  parseCssVars,
  filterSelectorNoise,
  dedupeCap,
  cssCompletion,
} from '../../src/web/public/js/css-completion.js';
import { cssTokenRanges } from '../../src/web/public/js/css-tokenize.js';

/** cssCompletion 的最小 CompletionContext 替身（只用到 state.doc 与 pos） */
const ctxAt = (src: string, pos: number) =>
  ({ state: { doc: { toString: () => src } }, pos }) as any;

/* ------------------------------------------------------------------ *
 * 上下文判定
 * ------------------------------------------------------------------ */

test('[[module CSS]] 正文 → module-css', () => {
  const src = '[[module CSS]]\nbody {\n  color: red;\n}\n[[/module]]';
  assert.deepEqual(isCssContext(src, src.indexOf('color') + 1), { type: 'module-css' });
});

test('[[module CSS]] 未闭合（正在写正文）也判定为 module-css', () => {
  const src = '[[module CSS]]\n.dis { display: none; }';
  assert.deepEqual(isCssContext(src, src.indexOf('display')), { type: 'module-css' });
});

test('[[module CSS]] 之外（含闭标签内）不判定', () => {
  const src = '[[module CSS]]\nbody {}\n[[/module]]\n正文';
  assert.equal(isCssContext(src, 2), null);                                   // 开标签上
  assert.equal(isCssContext(src, src.indexOf('[[/module]]') + 3), null);      // 闭标签内
  assert.equal(isCssContext(src, src.length - 1), null);                      // 后续正文
});

test('[[module css]] 小写同样判定', () => {
  const src = '[[module css]]\na {}\n[[/module]]';
  assert.deepEqual(isCssContext(src, src.indexOf('a {')), { type: 'module-css' });
});

test('[[style]] 正文 → style（未闭合同样生效）', () => {
  const closed = '[[style]]\ndiv { font-size: 14px; }\n[[/style]]';
  assert.deepEqual(isCssContext(closed, closed.indexOf('font-size') + 1), { type: 'style' });
  const open = '[[style]]\ndiv { font-size: 14px; }';
  assert.deepEqual(isCssContext(open, open.indexOf('font-size') + 1), { type: 'style' });
});

test('style="…" 属性值内 → attr-style（键名必须是 style，大小写不敏感）', () => {
  const src = '[[div style="color: red;"]]';
  assert.deepEqual(isCssContext(src, src.indexOf('red') + 1), { type: 'attr-style' });
  const upper = '[[div STYLE="color: red"]]';
  assert.deepEqual(isCssContext(upper, upper.indexOf('red') + 1), { type: 'attr-style' });
  // 未闭合的属性值（正在输入）
  const typing = '[[div style="pos';
  assert.deepEqual(isCssContext(typing, typing.length), { type: 'attr-style' });
});

test('非 style 属性（class/data-style）不判定为 attr-style', () => {
  assert.equal(isCssContext('[[div class="style"]]', '[[div class="style'.length), null);
  assert.equal(isCssContext('[[div data-style="color: red"]]', '[[div data-style="color: red'.length), null);
});

test('普通正文与 [[code]] 体内不判定为 CSS 上下文', () => {
  const plain = '这是一段普通正文，有 display: flex 字样。';
  assert.equal(isCssContext(plain, plain.indexOf('display') + 1), null);
  const code = '[[code]]\nbody { color: red; }\n[[/code]]';
  assert.equal(isCssContext(code, code.indexOf('color') + 1), null);
  // code 体内即使出现 style=" 也不算（惰性区不解析）
  const code2 = '[[code]]\n[[div style="color: red"]]\n[[/code]]';
  assert.equal(isCssContext(code2, code2.indexOf('red') + 1), null);
});

test('[[html]] 内 <style> → html-style；[[html]] 其余正文不判定', () => {
  const src = '[[html]]\n<div>外层</div>\n<style>\nbody { margin: 0; }\n</style>\n[[/html]]';
  assert.deepEqual(isCssContext(src, src.indexOf('margin') + 1), { type: 'html-style' });
  assert.equal(isCssContext(src, src.indexOf('外层') + 1), null);
  // 未闭合 </style> 也判定
  const open = '[[html]]\n<style>\nbody {';
  assert.deepEqual(isCssContext(open, open.length - 1), { type: 'html-style' });
});

test('边界：空串、越界 pos 不抛异常', () => {
  assert.equal(isCssContext('', 0), null);
  assert.deepEqual(isCssContext('[[module CSS]]', 999), { type: 'module-css' }); // 越界收敛到文末（正文体）
  assert.equal(isCssContext('[[module CSS]]', 0), null);                        // 文档头不在任何 CSS 区
});

/* ------------------------------------------------------------------ *
 * CSS 值中的 `/` 不命中闭合标签补全
 * ------------------------------------------------------------------ */

test('CSS 值里的 `/`：cssCompletion 占住上下文（FTML 源由自身守卫退出）', () => {
  const src = '[[module CSS]]\nfont: 12px/1.5;\n[[/module]]';
  const pos = src.indexOf('/1.5');
  assert.deepEqual(isCssContext(src, pos), { type: 'module-css' });

  const frag = parseCssFragment(src, pos, 'module-css');
  assert.equal(frag.kind, 'value');       // `/` 是值的一部分，不是选择器/at-rule
  assert.equal(frag.property, 'font');

  // cssCompletion 返回空候选结果对象（而不是 null），不会让出位置
  const result = cssCompletion(ctxAt(src, pos));
  assert.ok(result, 'CSS 上下文中必须返回结果对象');
  assert.equal(result!.options.length, 0);
});

test('斜杠简写只在 FTML 正文生效：CSS 内 `/` 完全无候选，正文外 css 返回 null', () => {
  const cssSrc = '[[module CSS]]\ngrid-area: 1 / 2;\n[[/module]]';
  const inCss = cssCompletion(ctxAt(cssSrc, cssSrc.indexOf('/ 2')));
  assert.ok(inCss);
  assert.equal(inCss!.options.length, 0);

  const plain = 'hello /module world';
  assert.equal(cssCompletion(ctxAt(plain, plain.indexOf('/module') + 1)), null);
});

/* ------------------------------------------------------------------ *
 * 变量解析 / 噪声过滤 / 去重与上限
 * ------------------------------------------------------------------ */

test('parseCssVars：提取 --x: 定义处，去重、忽略引用处之外的噪声', () => {
  const css = ':root {\n  --main-color: red;\n  --main-color: blue;\n  --header-font: monospace;\n}\na { color: var(--main-color); }';
  const vars = parseCssVars(css);
  assert.ok(vars.includes('--main-color'));
  assert.ok(vars.includes('--header-font'));
  assert.equal(vars.length, 2);
});

test('filterSelectorNoise：过滤 wiki-tab 随机 id / hex / 纯数字 / 非法标识符', () => {
  const kept = filterSelectorNoise([
    'page-rate-widget-box', 'side-bar', 'u_credit', '_private',
    'wiki-tab-0-1', 'wiki-tab-1', 'tab-3-7', 'deadbeefcafe', '1234', 'a', '',
  ]);
  assert.deepEqual(kept, [ 'page-rate-widget-box', 'side-bar', 'u_credit', '_private' ]);
});

test('dedupeCap：去重保序并遵守上限', () => {
  assert.deepEqual(dedupeCap([ 'b', 'a', 'b', 'c', 'a' ]), [ 'b', 'a', 'c' ]);
  const many = Array.from({ length: 5000 }, (_, i) => `x-${i}`);
  assert.equal(dedupeCap(many).length, 2000);
  assert.equal(dedupeCap(many, 5).length, 5);
  assert.deepEqual(dedupeCap(many, 3), [ 'x-0', 'x-1', 'x-2' ]);
});

/* ------------------------------------------------------------------ *
 * 片段解析与候选内容（Node 环境走静态回退表）
 * ------------------------------------------------------------------ */

test('裸词 dis → mixed（属性优先 display）', () => {
  const src = '[[module CSS]]\ndis\n[[/module]]';
  const pos = src.indexOf('dis') + 3;
  const frag = parseCssFragment(src, pos, 'module-css');
  assert.equal(frag.kind, 'mixed');
  assert.equal(frag.query, 'dis');

  const result = cssCompletion(ctxAt(src, pos))!;
  const labels = result.options.map((o: any) => o.label);
  assert.ok(labels.includes('display'));
});

test('.page-r → selector（命中 .page-rate-widget-box）', () => {
  const src = '[[module CSS]]\n.page-r\n[[/module]]';
  const pos = src.indexOf('.page-r') + 7;
  assert.equal(parseCssFragment(src, pos, 'module-css').kind, 'selector');

  const result = cssCompletion(ctxAt(src, pos))!;
  const labels = result.options.map((o: any) => o.label);
  assert.ok(labels.includes('.page-rate-widget-box'));
});

test('var(-- → 变量候选（静态回退含 BHL 变量）', () => {
  const src = '[[module CSS]]\ncolor: var(--\n[[/module]]';
  const pos = src.indexOf('var(--') + 'var(--'.length; // `--` 之后，仍在闭标签之前
  assert.equal(parseCssFragment(src, pos, 'module-css').kind, 'var');

  const result = cssCompletion(ctxAt(src, pos))!;
  const labels = result.options.map((o: any) => o.label);
  assert.ok(labels.includes('--header-title'));
  assert.ok(labels.every((l: string) => l.startsWith('--')));
});

test('style="pos → 属性候选（position）', () => {
  const src = '[[div style="pos"]]';
  const pos = src.indexOf('pos') + 3;
  assert.deepEqual(isCssContext(src, pos), { type: 'attr-style' });
  assert.equal(parseCssFragment(src, pos, 'attr-style').kind, 'mixed');

  const result = cssCompletion(ctxAt(src, pos))!;
  const labels = result.options.map((o: any) => o.label);
  assert.ok(labels.includes('position'));
  // style 属性里不出现选择器/元素候选
  assert.ok(!labels.some((l: string) => l.startsWith('#') || l.startsWith('.')));
});

test('display 值上下文 → flex/grid 等枚举；数字后给单位', () => {
  const src = '[[module CSS]]\ndisplay: fl\n[[/module]]';
  const pos = src.indexOf('fl') + 2;
  const frag = parseCssFragment(src, pos, 'module-css');
  assert.equal(frag.kind, 'value');
  assert.equal(frag.property, 'display');

  const labels = cssCompletion(ctxAt(src, pos))!.options.map((o: any) => o.label);
  assert.ok(labels.includes('flex'));

  // 空值位（`display: ` 之后）列出全部枚举
  const src2 = '[[module CSS]]\ndisplay: \n[[/module]]';
  const pos2 = src2.indexOf('display: ') + 'display: '.length;
  const labels2 = cssCompletion(ctxAt(src2, pos2))!.options.map((o: any) => o.label);
  assert.ok(labels2.includes('flex'));
  assert.ok(labels2.includes('grid'));

  const src3 = '[[module CSS]]\nwidth: 12\n[[/module]]';
  const pos3 = src3.indexOf('12') + 2;
  const labels3 = cssCompletion(ctxAt(src3, pos3))!.options.map((o: any) => o.label);
  assert.ok(labels3.includes('12px'));
});

test('正文 / FTML 属性上下文不出现 CSS 候选', () => {
  const plain = '这是一个 div 段落。';
  assert.equal(cssCompletion(ctxAt(plain, plain.indexOf('div') + 1)), null);
  const ftml = '[[div class="box"]]';
  assert.equal(cssCompletion(ctxAt(ftml, ftml.indexOf('box') + 1)), null); // class= 不是 style=
});

/* ------------------------------------------------------------------ *
 * CSS 着色扫描（css-tokenize.js）
 * ------------------------------------------------------------------ */

test('cssTokenRanges：声明区标出属性名', () => {
  const toks = cssTokenRanges('display: none;', 'decl');
  const prop = toks.find((t) => t.kind === 'property');
  assert.ok(prop, '应标出属性名');
  assert.equal('display: none;'.slice(prop!.from, prop!.to), 'display');
});

test('cssTokenRanges：选择器 + @media + 嵌套规则属性', () => {
  const css = '@media (max-width: 768px) {\n  .page-rate-widget-box {\n    color: red;\n  }\n}';
  const toks = cssTokenRanges(css, 'selector');
  const kinds = toks.map((t) => t.kind);
  assert.ok(kinds.includes('atrule'));
  assert.ok(kinds.includes('property'));
  const at = toks.find((t) => t.kind === 'atrule')!;
  assert.equal(css.slice(at.from, at.to), '@media');
  const sel = toks.find((t) => t.kind === 'selector')!;
  assert.equal(css.slice(sel.from, sel.to), '(max-width: 768px)');
  const innerSel = toks.filter((t) => t.kind === 'selector')[ 1 ];
  assert.ok(innerSel, '嵌套规则的选择器应标出');
  assert.equal(css.slice(innerSel!.from, innerSel!.to), '.page-rate-widget-box');
});

test('cssTokenRanges：注释 / 字符串 / var / !important', () => {
  const css = '/* 注释 */\n.content::before { content: "a;b"; color: var(--main-color) !important; }';
  const toks = cssTokenRanges(css, 'selector');
  const kinds = toks.map((t) => t.kind);
  assert.ok(kinds.includes('comment'));
  assert.ok(kinds.includes('string'));
  assert.ok(kinds.includes('variable'));
  assert.ok(kinds.includes('important'));
  const v = toks.find((t) => t.kind === 'variable')!;
  assert.equal(css.slice(v.from, v.to), 'var(--main-color)');
});

test('cssTokenRanges：规则之间的注释不吞选择器（截图场景）', () => {
  const css = '.a { color: red; }\n/* ========= base ========= */\nhtml,body{\n  background-color: var(--br-paper);\n}';
  const toks = cssTokenRanges(css, 'selector');
  const comments = toks.filter((t) => t.kind === 'comment').map((t) => css.slice(t.from, t.to));
  assert.deepEqual(comments, [ '/* ========= base ========= */' ], '注释应完整标出');
  const selectors = toks.filter((t) => t.kind === 'selector').map((t) => css.slice(t.from, t.to));
  assert.ok(selectors.includes('.a'));
  assert.ok(selectors.includes('html,body'));
  assert.ok(!selectors.some((s) => s.includes('base')), '注释不应并进选择器');
});

test('cssTokenRanges：半成品（未闭合注释/字符串/括号）不抛异常且区间合法', () => {
  for (const css of [ '/* 未闭合', 'content: "未闭合', '.a { color:', '}}}', '' ]) {
    const toks = cssTokenRanges(css, 'selector');
    assert.ok(Array.isArray(toks));
    for (const t of toks) {
      assert.ok(t.to > t.from && t.from >= 0 && t.to <= css.length, `${css} → ${JSON.stringify(t)}`);
    }
  }
});

/* ------------------------------------------------------------------ *
 * 属性补全：自动补 `: ;`，光标在中间
 * ------------------------------------------------------------------ */

test('属性补全 apply：插入 position: ;，光标落在 : 与 ; 之间', () => {
  const src = '[[module CSS]]\npos\n[[/module]]';
  const pos = src.indexOf('pos') + 3;
  const result = cssCompletion(ctxAt(src, pos))!;
  const opt = result.options.find((o: any) => o.label === 'position');
  assert.ok(opt, '应出现 position 候选');
  assert.equal(result.from, pos - 3, '替换整个已输入词');

  const calls: any[] = [];
  const fakeView = { dispatch: (tr: any) => calls.push(tr) };
  (opt as any).apply(fakeView, opt, result.from, pos);

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].changes, { from: result.from, to: pos, insert: 'position: ;' });
  assert.equal(calls[0].selection.anchor, result.from + 'position: '.length);
  assert.equal(calls[0].changes.insert.slice(0, calls[0].selection.anchor - result.from), 'position: ');
});

test('属性补全 apply：style="…" 内同样插入 : ;', () => {
  const src = '[[div style="pos"]]';
  const pos = src.indexOf('pos') + 3;
  const result = cssCompletion(ctxAt(src, pos))!;
  const opt = result.options.find((o: any) => o.label === 'position')!;
  const calls: any[] = [];
  (opt as any).apply({ dispatch: (tr: any) => calls.push(tr) }, opt, result.from, pos);
  assert.equal(calls[0].changes.insert, 'position: ;');
  assert.equal(calls[0].selection.anchor - result.from, 'position: '.length);
});
