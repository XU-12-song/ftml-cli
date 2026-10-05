/**
 * cm-lexer.test.js — FTML 基础词法器（纯函数）单测
 *
 * 用一个最小 StringStream 替身驱动 token()，不依赖 CodeMirror，
 * 覆盖：块/行内宏、惰性区（code/html/embed）、注释、字面量、链接、半截输入容错。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { token, startState, INERT_CONTAINERS } from '../src/web/public/js/cm-lexer.js';

/** CodeMirror StringStream 的最小替身（单行） */
class S {
  constructor(str) { this.string = str; this.pos = 0; }
  peek() { return this.pos < this.string.length ? this.string[this.pos] : undefined; }
  next() { if (this.pos < this.string.length) return this.string[this.pos++]; }
  skipToEnd() { this.pos = this.string.length; }
  eol() { return this.pos >= this.string.length; }
  sol() { return this.pos === 0; }
  match(pat) {
    const rest = this.string.slice(this.pos);
    if (typeof pat === 'string') {
      if (rest.startsWith(pat)) { this.pos += pat.length; return pat; }
      return null;
    }
    const m = pat.exec(rest);
    if (m && m.index === 0) { this.pos += m[0].length; return m[0]; }
    return null;
  }
}

/** 逐 token 扫描一行，返回 [[token, text], …] 与结束状态 */
function lexLine(line, state = startState()) {
  const s = new S(line);
  const out = [];
  let guard = 0;
  while (!s.eol()) {
    const p = s.pos;
    const t = token(s, state);
    if (s.pos === p) s.next(); // 防御：绝不空转
    out.push([ t, s.string.slice(p, s.pos) ]);
    if (++guard > 5000) throw new Error('lexer 未前进');
  }
  return { out, state };
}

/** 只取 token 名序列（忽略 null 文本） */
const toks = (line, state) => lexLine(line, state).out.map(([ t ]) => t);
const text = (line, state) => lexLine(line, state).out.map(([ , x ]) => x).join('');

test('行首块级宏 → block-marker，行内宏 → macro', () => {
  const a = lexLine('[[div class="x"]]');
  assert.deepEqual(a.out, [
    [ 'macro-delim', '[[' ],
    [ 'block-marker', 'div' ],
    [ null, ' ' ],
    [ 'macro-attr', 'class' ],
    [ 'macro-op', '=' ],
    [ 'macro-string', '"x"' ],
    [ 'macro-delim', ']]' ],
  ]);
  assert.equal(text('[[div class="x"]]'), '[[div class="x"]]');

  const b = toks('前 [[span]]x[[/span]] 后');
  assert.ok(b.includes('macro'));
  assert.ok(b.includes('macro-close'));
  assert.ok(!b.includes('block-marker'), '行内宏不应弱化');
});

test('行首带前导空格 → 不算块级（Wikidot 语义）', () => {
  const t = toks('  [[div]]');
  assert.ok(t.includes('macro'));
  assert.ok(!t.includes('block-marker'));
});

test('惰性区：[[code]] 体内的 [[div]] 不解析，闭标签独立着色', () => {
  const s0 = startState();
  const l1 = lexLine('[[code]]', s0);
  assert.deepEqual(l1.out.map(([ t ]) => t), [ 'macro-delim', 'block-marker', 'macro-delim' ]);
  assert.equal(s0.inert, 'code');

  const l2 = lexLine('[[div]] x [[/div]]', s0);
  assert.deepEqual(l2.out, [ [ 'inert', '[[div]] x [[/div]]' ] ]);
  assert.equal(s0.inert, 'code', '体内闭标签不应结束惰性区');

  const l3 = lexLine('[[/code]]', s0);
  assert.deepEqual(l3.out, [ [ 'macro-delim', '[[/' ], [ 'macro-close', 'code' ], [ 'macro-delim', ']]' ] ]);
  assert.equal(s0.inert, null);
});

test('惰性区：html / embed 同样生效，且每行只出一个 inert token', () => {
  for (const c of [ 'html', 'embed', 'embedvideo', 'embedaudio' ]) {
    assert.ok(INERT_CONTAINERS.has(c));
    const s = startState();
    lexLine(`[[${c}]]`, s);
    assert.equal(s.inert, c);
    const body = lexLine('<iframe src="[[/collapsible]]"></iframe>', s);
    assert.deepEqual(body.out, [ [ 'inert', '<iframe src="[[/collapsible]]"></iframe>' ] ]);
  }
});

test('[[style]] / [[component]] 作为块级容器（行首弱化，style 体内为惰性 CSS）', () => {
  const a = lexLine('[[style]]');
  assert.deepEqual(a.out.map(([ t ]) => t), [ 'macro-delim', 'block-marker', 'macro-delim' ]);
  assert.equal(a.state.inert, 'style');

  const body = lexLine('body { color: red } /* [[div]] */', a.state);
  assert.deepEqual(body.out, [ [ 'inert', 'body { color: red } /* [[div]] */' ] ]);
  assert.equal(a.state.inert, 'style', '体内闭标签不应结束惰性区');

  const close = lexLine('[[/style]]', a.state);
  assert.deepEqual(close.out, [ [ 'macro-delim', '[[/' ], [ 'macro-close', 'style' ], [ 'macro-delim', ']]' ] ], '惰性区闭标签拆成 分隔符/名字/分隔符');
  assert.equal(a.state.inert, null);

  // component：开/闭都是块级（行首弱化），体内不多解析
  assert.deepEqual(toks('[[component src="box.ftml"]]'), [ 'macro-delim', 'block-marker', null, 'macro-attr', 'macro-op', 'macro-string', 'macro-delim' ]);
  assert.deepEqual(toks('[[/component]]'), [ 'macro-delim', 'macro-close', 'macro-delim' ]);
  // 非行首仍是普通行内宏
  assert.ok(toks('x [[style]]').includes('macro'));
});

test('注释 [!-- … --]：单行与跨行', () => {
  assert.deepEqual(toks('a [!-- hi --] b'), [ null, null, 'comment', 'comment', null, null ]);
  const s = startState();
  assert.deepEqual(toks('[!-- 跨行', s), [ 'comment', 'comment' ]);
  assert.equal(s.comment, true);
  assert.deepEqual(toks('还在注释 [[div]] 里', s), [ 'comment' ]);
  assert.equal(s.comment, true);
  const end = toks('结束 --] 之后 [[span]]', s);
  assert.equal(end[ 0 ], 'comment', '注释区从行首一直吃到 --]');
  assert.ok(end.includes('macro'), '--] 之后的 [[span]] 应恢复解析');
  assert.equal(s.comment, false);
});

test('字面量 @@ … @@：体内宏不解析', () => {
  const s = startState();
  const r = lexLine('@@[[div]] @@', s);
  assert.ok(r.out.every(([ t ]) => t === 'literal'), '整段都应着色为 literal');
  assert.ok(!r.out.some(([ t ]) => t === 'macro'), '体内的 [[div]] 不应解析为宏');
  assert.equal(text('@@[[div]] @@'), '@@[[div]] @@');
  assert.equal(s.literal, false);
  // 未闭合的 @@ 跨行保持 literal
  const s2 = startState();
  lexLine('@@未闭合', s2);
  assert.equal(s2.literal, true);
});

test('@<…>@ HTML 实体整体作为一个 literal', () => {
  const r = lexLine('@<&nbsp;>@');
  assert.deepEqual(r.out, [ [ 'literal', '@<&nbsp;>@' ] ]);
});

test('[[[ 链接 ]] 与 ==== 标题', () => {
  assert.deepEqual(toks('[[[http://a/b]]]'), [ 'link' ]);
  assert.equal(text('[[[http://a/b]]]'), '[[[http://a/b]]]');
  const h = toks('==== 标题 ====');
  assert.equal(h[ 0 ], 'heading');
  assert.equal(h[ h.length - 1 ], 'heading');
  assert.equal(text('==== 标题 ===='), '==== 标题 ====');
});

test('行内成对记号：粗体/斜体/等宽/表格', () => {
  assert.deepEqual(toks('**粗**'), [ 'strong', null, 'strong' ]);
  assert.deepEqual(toks('//斜//'), [ 'emphasis', null, 'emphasis' ]);
  const m = toks('{{等宽}}');
  assert.equal(m[ 0 ], 'mono');
  assert.equal(m[ m.length - 1 ], 'mono');
  assert.deepEqual(toks('||表||'), [ 'table', null, 'table' ]);
});

test('宏参数：键/等号/字符串/管道一应俱全', () => {
  const { out } = lexLine('[[#if {$x} | 真 | 伪]]');
  assert.deepEqual(out.map(([ t ]) => t), [
    'macro-delim', 'macro', null, 'macro-value', null, 'macro-op', null, 'macro-value',
    null, 'macro-op', null, 'macro-value', 'macro-delim',
  ]);
  assert.ok(out.some(([ t, x ]) => t === 'macro-value' && x === '{$x}'));
});

test('容错：半截/孤立记号不抛错且文本无损', () => {
  for (const src of [ '[[', '[[div', '[[div ', '[[/', '[!--', '@@', '[[div class="x', '[[a|', ']', ']]' ]) {
    assert.equal(text(src), src, `文本应无损: ${JSON.stringify(src)}`);
  }
  assert.equal(text('[[div class="x]]'), '[[div class="x]]');
});

test('宏体内不误判行内记号：[[image https://x/y.png]]', () => {
  const { out } = lexLine('[[image https://x/y.png]]');
  assert.ok(out.some(([ t, x ]) => t === 'macro-value' && x === 'https://x/y.png'));
  assert.ok(!out.some(([ t ]) => t === 'emphasis'), '// 在宏参数里不应触发斜体');
});

test('惰性区在同行闭合时立即恢复解析', () => {
  const s = startState();
  const r = lexLine('[[code]]x[[/code]] 后 [[span]]y[[/span]]', s);
  const seq = r.out.map(([ t ]) => t);
  assert.ok(seq.includes('inert'));
  assert.ok(seq.includes('macro'), '闭标签之后的行内宏应恢复着色');
  assert.equal(s.inert, null);
});
