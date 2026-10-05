/**
 * cm-semantics.test.js — CM6 语义层纯计算单测
 *
 * cm-semantics.js 不依赖 CodeMirror / DOM，这里直接喂源码字符串，
 * 覆盖：整篇 token 偏移、[[…]] 配对、wdpr 诊断 → 区间、未知宏、
 * 模板头解析、模板体占位符、模板调用键校验、排序。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILTIN_MACROS,
  lexTokens,
  macroBracketPairs,
  bracketPairAt,
  diagnosticRanges,
  unknownMacroRanges,
  templateHeaderKeys,
  templatePlaceholderRanges,
  templateCallKeyRanges,
  sortRanges,
} from '../src/web/public/js/cm-semantics.js';

/* ------------------------------------------------------------------ *
 * lexTokens
 * ------------------------------------------------------------------ */

test('lexTokens：跨行绝对偏移可与源码对齐', () => {
  const src = '[[div]]\nx';
  const toks = lexTokens(src);
  assert.equal(toks[ 0 ].type, 'macro-delim');
  assert.equal(src.slice(toks[ 0 ].from, toks[ 0 ].to), '[[');

  const name = toks.find((t) => t.type === 'block-marker');
  assert.equal(src.slice(name.from, name.to), 'div');

  const delim = toks.find((t) => t.type === 'macro-delim' && src.slice(t.from, t.to) === ']]');
  assert.equal(src.slice(delim.from, delim.to), ']]');

  const last = toks[ toks.length - 1 ];
  assert.equal(last.from, 8, '第二行起点 = 第一行长度 +1');
  assert.equal(src.slice(last.from, last.to), 'x');
});

test('lexTokens：token 逐个覆盖每行文本（换行符本身不成 token）', () => {
  const src = '前 [[span class="a"]]x[[/span]]\n[[code]]\nraw [[div]]\n[[/code]]';
  const toks = lexTokens(src);
  assert.equal(toks.map((t) => src.slice(t.from, t.to)).join(''), src.replace(/\n/g, ''));
});

/* ------------------------------------------------------------------ *
 * [[ … ]] 配对
 * ------------------------------------------------------------------ */

test('macroBracketPairs：[[div]] 与 [[/div]] 配成一对（而非 [[ 配就近的 ]]）', () => {
  const pairs = macroBracketPairs('[[div]]x[[/div]]');
  assert.deepEqual(pairs, [ { openFrom: 0, openTo: 7, closeFrom: 8, closeTo: 16 } ]);
});

test('macroBracketPairs：惰性区闭标签整体成 token，且 [[div]] 在体内不算开标签', () => {
  const src = '[[code]]\n[[div]]\n[[/code]]\n[[span]]x[[/span]]';
  const pairs = macroBracketPairs(src);
  assert.deepEqual(pairs, [
    { openFrom: 0, openTo: 8, closeFrom: 17, closeTo: 26 },
    { openFrom: 27, openTo: 35, closeFrom: 36, closeTo: 45 },
  ]);
  assert.equal(src.slice(pairs[ 0 ].closeFrom, pairs[ 0 ].closeTo), '[[/code]]');
  assert.equal(src.slice(pairs[ 1 ].openFrom, pairs[ 1 ].openTo), '[[span]]');
  assert.equal(src.slice(pairs[ 1 ].closeFrom, pairs[ 1 ].closeTo), '[[/span]]');
});

test('macroBracketPairs：自闭合标签（[[toc]]）不产生配对', () => {
  assert.deepEqual(macroBracketPairs('[[toc]]\n[[div]]x[[/div]]'), [
    { openFrom: 8, openTo: 15, closeFrom: 16, closeTo: 24 },
  ]);
});

test('bracketPairAt：命中开/闭标签整段，别处返回 null', () => {
  const pairs = macroBracketPairs('[[div]]x[[/div]]');
  const expect = { open: { from: 0, to: 7 }, close: { from: 8, to: 16 } };
  assert.deepEqual(bracketPairAt(0, pairs), expect);
  assert.deepEqual(bracketPairAt(3, pairs), expect, '标签名内部也算命中');
  assert.deepEqual(bracketPairAt(8, pairs), expect);
  assert.deepEqual(bracketPairAt(10, pairs), expect);
  assert.equal(bracketPairAt(7, pairs)?.open.from, 0, '`]]` 边界');
  assert.equal(bracketPairAt(34, pairs), null);
});

/* ------------------------------------------------------------------ *
 * 诊断 → 区间
 * ------------------------------------------------------------------ */

test('diagnosticRanges：优先用 offset，并把波浪线扩到整条标签', () => {
  const src = '[[div]]';
  const diags = [ {
    severity: 'warning', code: 'unclosed-block', message: 'm',
    position: { start: { offset: 0 }, end: { offset: 2 } },
  } ];
  assert.deepEqual(diagnosticRanges(src, diags), [ {
    from: 0, to: 7, severity: 'warning', code: 'unclosed-block', message: 'm',
  } ]);
});

test('diagnosticRanges：缺 offset 时回退 line/column', () => {
  const src = 'a\n[[div]]';
  const diags = [ {
    severity: 'error', code: 'inline-block-element', message: 'm',
    position: { start: { line: 2, column: 1 }, end: { line: 2, column: 3 } },
  } ];
  assert.deepEqual(diagnosticRanges(src, diags), [ {
    from: 2, to: 9, severity: 'error', code: 'inline-block-element', message: 'm',
  } ]);
});

test('diagnosticRanges：越界起点丢弃，未知 severity 归为 warning，结果按 from 排序', () => {
  assert.deepEqual(diagnosticRanges('ab', [ { position: { start: { offset: 5 } } } ]), []);
  const src = '\n[[div]]\n[[span]]';
  const out = diagnosticRanges(src, [
    { severity: 'hint', code: 'b', position: { start: { offset: 10 }, end: { offset: 12 } } },
    { severity: 'error', code: 'a', position: { start: { offset: 1 }, end: { offset: 3 } } },
  ]);
  assert.deepEqual(out.map((d) => d.code), [ 'a', 'b' ]);
  assert.equal(out[ 0 ].severity, 'error');
  assert.equal(out[ 1 ].severity, 'warning');
});

/* ------------------------------------------------------------------ *
 * 未知宏
 * ------------------------------------------------------------------ */

test('unknownMacroRanges：只报不认识的开标签', () => {
  const src = '[[zzz]]\n[[div]]x[[span]]';
  const known = new Set([ 'div', 'span' ]);
  const r = unknownMacroRanges(src, known);
  assert.equal(r.length, 1);
  assert.equal(r[ 0 ].name, 'zzz');
  assert.equal(src.slice(r[ 0 ].from, r[ 0 ].to), 'zzz');
});

test('unknownMacroRanges：行首块级闭标签（[[/div]]）不误报', () => {
  const src = '[[div]]\n\n[[/div]]\n';
  assert.deepEqual(unknownMacroRanges(src, BUILTIN_MACROS), []);
  // 未知宏仍报开标签，闭标签不重复报
  const unknown = unknownMacroRanges('[[zzz]]\n[[/zzz]]', BUILTIN_MACROS);
  assert.deepEqual(unknown.map((r) => r.name), [ 'zzz' ]);
});

test('unknownMacroRanges：模板名并入已知集后不再报警', () => {
  const src = '[[box]]';
  assert.equal(unknownMacroRanges(src, new Set()).length, 1);
  assert.equal(unknownMacroRanges(src, new Set([ 'box' ])).length, 0);
});

test('BUILTIN_MACROS：含常见原生标签', () => {
  for (const n of [ 'div', 'span', 'code', 'html', 'embed', 'iframe', 'module', 'include', 'table' ]) {
    assert.ok(BUILTIN_MACROS.has(n), `应含 ${n}`);
  }
});

/* ------------------------------------------------------------------ *
 * 模板头 / 占位符
 * ------------------------------------------------------------------ */

test('templateHeaderKeys：解析元素名与声明键（跳过字面属性）', () => {
  const h = templateHeaderKeys('[[div key1 key2 class="x"]]\n{ children }');
  assert.equal(h.element, 'div');
  assert.deepEqual(h.keys, [ 'key1', 'key2' ]);
  assert.equal(templateHeaderKeys('hello'), null);
});

test('templatePlaceholderRanges：只报未声明且未转义的 { key }（children 内置）', () => {
  const src = '[[div k]]\n{ k } { other } { children }';
  const r = templatePlaceholderRanges(src, [ 'k' ]);
  assert.equal(r.length, 1);
  assert.equal(r[ 0 ].key, 'other');
  assert.equal(src.slice(r[ 0 ].from, r[ 0 ].to), 'other');
});

test('templatePlaceholderRanges：[[style]] 体与转义括号不参与检查', () => {
  const src = '[[style]]\n{ notdeclared }\n[[/style]]\n\\{ k \\} { real }';
  const r = templatePlaceholderRanges(src, [ 'k' ]);
  assert.deepEqual(r.map((x) => x.key), [ 'real' ]);
});

/* ------------------------------------------------------------------ *
 * 模板调用键校验
 * ------------------------------------------------------------------ */

test('templateCallKeyRanges：只报模板未声明的键', () => {
  const src = '[[tmpl k=1 bad=2]]';
  const r = templateCallKeyRanges(src, { tmpl: [ 'k' ] });
  assert.equal(r.length, 1);
  assert.equal(r[ 0 ].name, 'tmpl');
  assert.equal(r[ 0 ].key, 'bad');
  assert.equal(src.slice(r[ 0 ].from, r[ 0 ].to), 'bad');
});

test('templateCallKeyRanges：非模板名 / 无值 token 不报', () => {
  assert.equal(templateCallKeyRanges('[[div class="x"]]', { tmpl: [ 'k' ] }).length, 0);
  assert.equal(templateCallKeyRanges('[[tmpl k]]', { tmpl: [ 'k' ] }).length, 0);
});

test('templateCallKeyRanges：接受 Map 输入', () => {
  const m = new Map([ [ 'tmpl', [ 'k' ] ] ]);
  const r = templateCallKeyRanges('[[tmpl k=1 bad=2]]', m);
  assert.deepEqual(r.map((x) => x.key), [ 'bad' ]);
});

/* ------------------------------------------------------------------ *
 * sortRanges
 * ------------------------------------------------------------------ */

test('sortRanges：按 from 升序且不改原数组', () => {
  const input = [ { from: 5, to: 6 }, { from: 1, to: 2 } ];
  assert.deepEqual(sortRanges(input), [ { from: 1, to: 2 }, { from: 5, to: 6 } ]);
  assert.equal(input[ 0 ].from, 5, '原数组不应被修改');
});
