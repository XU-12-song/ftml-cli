import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseFtmx } from '../src/core/parse-ftmx.js';
import { expand, MAX_DEPTH, findUnresolved } from '../src/core/expand.js';
import { escapeString } from '../src/core/escape.js';

function tpl(name, src) {
  return parseFtmx(src.trim(), name);
}

const addendum = tpl(
  'addendum',
  `[[div class="addendum" title]]
[[span class="addendum-title"]]{ title }[[/span]]
{ children }
[[/div]]`
);

const interview = tpl(
  'interview',
  `[[div class="interview" name item]]
[[strong]]{ name }[[/strong]] —— { item }
{ children }
[[/div]]`
);

function tm(ctx) {
  return new Map(ctx.map(([n, t]) => [n, t]));
}

test('基础展开：string 键 + children', () => {
  const templates = tm([['addendum', addendum]]);
  const out = expand(
    `[[addendum title='附录A']]
内容 **加粗**
[[/addendum]]`,
    templates
  );
  // 模板 body 的换行原样保留：[[span]] 与 children、children 与 [[/div]] 之间各留一个空行
  assert.equal(
    out,
    `[[div class="addendum"]]\n[[span class="addendum-title"]]附录A[[/span]]\n\n内容 **加粗**\n\n[[/div]]`
  );
});

test('string 值含 wiki 语法被转义为字面文本', () => {
  const templates = tm([['addendum', addendum]]);
  const out = expand(
    `[[addendum title='[[div]]x[[/div]]']]
ok
[[/addendum]]`,
    templates
  );
  // [[ → [[]]（wikidot 字面转义）：[[div]]x[[/div]] → [[]]div]]x[[]]/div]]
  assert.ok(out.includes('[[]]div]]x[[]]/div]]'));
  // 且不产生未转义的 [[div
  assert.ok(!out.includes(`[[div]]x`));
});

test('ftml 类型值（无引号）原样插入', () => {
  const templates = tm([
    [
      'wrap',
      tpl('wrap', `[[div]]{ content }[[/div]]`),
    ],
  ]);
  const out = expand(
    `[[wrap content=[[note]]hi[[/note]]]]
[[/wrap]]`,
    templates
  );
  assert.ok(out.includes(`[[note]]hi[[/note]]`));
});

test('children 内置键 + 嵌套模板调用', () => {
  const templates = tm([
    ['addendum', addendum],
    ['interview', interview],
  ]);
  const out = expand(
    `[[addendum title='实验']]
[[interview name='A' item='B']]
q
[[/interview]]
[[/addendum]]`,
    templates
  );
  assert.ok(out.includes(`[[strong]]A[[/strong]]`));
  assert.ok(out.includes(`[[div class="interview"]]`));
});

test('原生元素透传（div/span/include 不被当作模板）', () => {
  const templates = tm([['addendum', addendum]]);
  const out = expand(
    `[[div class="foo"]]
[[include component:box]]
[[/div]]`,
    templates
  );
  assert.equal(
    out,
    `[[div class="foo"]]\n[[include component:box]]\n[[/div]]`
  );
});

test('转义花括号 \{ \} 输出字面', () => {
  const templates = tm([
    [
      't',
      tpl('t', `[[div]]\\{ literal \\} \\\\ { x }[[/div]]`),
    ],
  ]);
  const out = expand(`[[t x='v']]x[[/t]]`, templates);
  assert.ok(out.includes(`{ literal }`));
  assert.ok(out.includes(`\\`));
  assert.ok(out.includes(`v`));
});

test('缺少必填参数报错', () => {
  const templates = tm([['addendum', addendum]]);
  assert.throws(
    () => expand(`[[addendum]]x[[/addendum]]`, templates),
    /缺少参数/
  );
});

test('未闭合的模板调用报错', () => {
  const templates = tm([['addendum', addendum]]);
  assert.throws(
    () => expand(`[[addendum title='x']]\n正文`, templates),
    /缺少闭合标签/
  );
});

test('循环模板调用检测', () => {
  const a = tpl('a', `[[div]]{ children }[[/div]]`);
  const b = tpl('b', `[[div]]{ children }[[/div]]`);
  const templates = tm([
    ['a', a],
    ['b', b],
  ]);
  assert.throws(
    () =>
      expand(
        `[[a]]
[[b]]
[[a]]
[[/a]]
[[/b]]
[[/a]]`,
        templates
      ),
    /循环调用检测到/
  );
});

test('嵌套深度超限报错（不同名链，非循环）', () => {
  const templates = new Map();
  const N = MAX_DEPTH + 5;
  for (let i = 0; i < N; i++) {
    templates.set(`t${i}`, tpl(`t${i}`, `[[div]]{ children }[[/div]]`));
  }
  let src = '';
  for (let i = 0; i < N; i++) src += `[[t${i}]]`;
  src += 'end';
  for (let i = N - 1; i >= 0; i--) src += `[[/t${i}]]`;
  assert.throws(() => expand(src, templates), /最大深度/);
});

test('escapeString 转义 [[', () => {
  assert.equal(escapeString('a[[b'), 'a[[]]b');
  assert.equal(escapeString('[[div]]x[[/div]]'), '[[]]div]]x[[]]/div]]');
  assert.equal(escapeString('无特殊字符'), '无特殊字符');
});

// ---------- [[style]] → [[module CSS]] ----------

test('顶层 [[style]] 收集为开头的 [[module CSS]]，正文无残留', () => {
  const out = expand(
    `[[style]]
p { color: red; }
[[/style]]

正文`,
    new Map()
  );
  assert.ok(
    out.startsWith(`[[module CSS]]\np { color: red; }\n[[/module]]`)
  );
  assert.ok(!out.includes('[[style]]'));
  assert.ok(out.includes('正文'));
});

test('无 [[style]] 时不输出 [[module CSS]]', () => {
  const out = expand(`[[div]]x[[/div]]`, new Map());
  assert.equal(out, `[[div]]x[[/div]]`);
});

test('模板 body 内 [[style]] 占位符替换为调用参数', () => {
  const templates = tm([
    [
      'card',
      tpl(
        'card',
        `[[div class="card" accent]]
[[style]]
.card { border-color: { accent }; }
[[/style]]
{ children }
[[/div]]`
      ),
    ],
  ]);
  const out = expand(`[[card accent='#f00']]x[[/card]]`, templates);
  assert.ok(out.includes('.card { border-color: #f00; }'));
  assert.ok(!out.includes('[[style]]'));
});

test('CSS 普通花括号（{ color: red } 等）不被误作占位符', () => {
  const templates = tm([
    [
      'card',
      tpl(
        'card',
        `[[div class="card" accent]]
[[style]]
.card { border-color: { accent }; }
.content::before { content: "x"; }
@supports (display: grid) { .card { display: grid; } }
[[/style]]
[[/div]]`
      ),
    ],
  ]);
  const out = expand(`[[card accent='#f00']]x[[/card]]`, templates);
  assert.ok(out.includes('.content::before { content: "x"; }'));
  assert.ok(out.includes('@supports (display: grid) { .card { display: grid; } }'));
  assert.ok(out.includes('.card { border-color: #f00; }'));
});

test('多个 [[style]] 块按出现顺序合并', () => {
  const out = expand(
    `[[style]]a{}[[/style]]
正文
[[style]]b{}[[/style]]`,
    new Map()
  );
  assert.ok(out.startsWith(`[[module CSS]]\na{}\n\nb{}\n[[/module]]`));
});

test('children 内的 [[style]] 也收集', () => {
  const templates = tm([
    ['wrap', tpl('wrap', `[[div]]{ children }[[/div]]`)],
  ]);
  const out = expand(
    `[[wrap]]
[[style]]x{}[[/style]]
[[/wrap]]`,
    templates
  );
  assert.ok(out.startsWith('[[module CSS]]'));
  assert.ok(!out.includes('[[style]]'));
  assert.ok(out.includes('[[div]]'));
});

test('[[style]] 缺少闭合标签报错', () => {
  assert.throws(() => expand(`[[style]]p{}`, new Map()), /缺少闭合标签/);
});

// ---------- [[component src="..."]][[/component]] ----------

/** 建临时目录并写入文件（自动创建子目录），返回目录路径 */
function tmpdir(files) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ftml-t-'));
  for (const [name, content] of Object.entries(files)) {
    const p = path.join(dir, name);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, content);
  }
  return dir;
}

test('组件基本展开：内容替换为文件内容', () => {
  const dir = tmpdir({ 'a.ftml': '你好，组件' });
  try {
    const out = expand(`[[component src="a.ftml"]][[/component]]`, new Map(), {
      baseDir: dir,
    });
    assert.equal(out, '你好，组件');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('children 非空报错', () => {
  const dir = tmpdir({ 'a.ftml': 'x' });
  try {
    assert.throws(
      () => expand(`[[component src="a.ftml"]]子内容[[/component]]`, new Map(), { baseDir: dir }),
      /children 必须为空/
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('多余参数或缺少 src 报错', () => {
  const dir = tmpdir({ 'a.ftml': 'x' });
  try {
    assert.throws(
      () => expand(`[[component src="a.ftml" foo="1"]][[/component]]`, new Map(), { baseDir: dir }),
      /只接受一个 src/
    );
    assert.throws(
      () => expand(`[[component]][[/component]]`, new Map(), { baseDir: dir }),
      /只接受一个 src/
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('依赖链 a→b→c 递归展开', () => {
  const dir = tmpdir({
    'a.ftml': `[[component src="b.ftml"]][[/component]]`,
    'b.ftml': `[[component src="c.ftml"]][[/component]]`,
    'c.ftml': 'deep',
  });
  try {
    const out = expand(`[[component src="a.ftml"]][[/component]]`, new Map(), {
      baseDir: dir,
    });
    assert.equal(out, 'deep');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('循环依赖检测（a→b→a）', () => {
  const dir = tmpdir({
    'a.ftml': `[[component src="b.ftml"]][[/component]]`,
    'b.ftml': `[[component src="a.ftml"]][[/component]]`,
  });
  try {
    assert.throws(
      () => expand(`[[component src="a.ftml"]][[/component]]`, new Map(), { baseDir: dir }),
      /循环依赖/
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('组件内可调用模板', () => {
  const dir = tmpdir({
    'a.ftml': `[[addendum title='t']]内容[[/addendum]]`,
  });
  try {
    const out = expand(`[[component src="a.ftml"]][[/component]]`, tm([['addendum', addendum]]), {
      baseDir: dir,
    });
    assert.ok(out.includes(`[[div class="addendum"]]`));
    assert.ok(out.includes('内容'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('组件内的 [[style]] 收集进 [[module CSS]]', () => {
  const dir = tmpdir({
    'a.ftml': `[[style]]p { color: red; }[[/style]]`,
  });
  try {
    const out = expand(`[[component src="a.ftml"]][[/component]]`, new Map(), {
      baseDir: dir,
    });
    assert.ok(out.startsWith(`[[module CSS]]\np { color: red; }`));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('相对路径基于组件所在目录（嵌套目录）', () => {
  const dir = tmpdir({
    'a.ftml': `[[component src="sub/b.ftml"]][[/component]]`,
    'sub/b.ftml': `[[component src="c.ftml"]][[/component]]`,
    'sub/c.ftml': 'nested-ok',
  });
  try {
    const out = expand(`[[component src="a.ftml"]][[/component]]`, new Map(), {
      baseDir: dir,
    });
    assert.equal(out, 'nested-ok');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('模板 body 内不允许 component', () => {
  const templates = tm([
    ['t', tpl('t', `[[div]][[component src="x.ftml"]][[/component]][[/div]]`)],
  ]);
  assert.throws(() => expand(`[[t]]x[[/t]]`, templates), /不允许使用 \[\[component\]\]/);
});

// ---------- 模板 body 内嵌套模板调用 ----------

test('模板 body 内嵌套的模板调用被展开', () => {
  const card = tpl('card', `[[div class="card"]]{ children }[[/div]]`);
  const t = tpl('t', `[[div]]\n[[card]]inner[[/card]]\n{ children }\n[[/div]]`);
  const templates = tm([['card', card], ['t', t]]);
  const out = expand(`[[t]]hi[[/t]]`, templates);
  assert.ok(out.includes(`[[div class="card"]]inner[[/div]]`), out);
  assert.ok(!out.includes(`[[card]]`));
});

test('组件内模板 body 的嵌套调用也展开', () => {
  const card = tpl('card', `[[div class="card"]]{ children }[[/div]]`);
  const t = tpl('t', `[[div]]\n[[card]]inner[[/card]]\n{ children }\n[[/div]]`);
  const dir = tmpdir({
    'a.ftml': `[[t]]hi[[/t]]`,
  });
  try {
    const out = expand(`[[component src="a.ftml"]][[/component]]`, tm([['card', card], ['t', t]]), {
      baseDir: dir,
    });
    assert.ok(out.includes(`[[div class="card"]]inner[[/div]]`), out);
    assert.ok(!out.includes(`[[card]]`));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('模板 body 内嵌套调用可用外层参数（先替换占位符再展开）', () => {
  const inner = tpl('inner', `[[span]]{ label }[[/span]]`);
  const t = tpl(
    't',
    `[[div]]\n[[inner label='{ title }']]\nx[[/inner]]\n{ children }\n[[/div]]`
  );
  const templates = tm([['inner', inner], ['t', t]]);
  const out = expand(`[[t title='标题']]hi[[/t]]`, templates);
  assert.ok(out.includes(`[[span]]标题[[/span]]`), out);
});

test('模板 body 内循环嵌套调用被检测', () => {
  const a = tpl('a', `[[div]][[b]][[/b]][[/div]]`);
  const b = tpl('b', `[[div]][[a]][[/a]][[/div]]`);
  const templates = tm([['a', a], ['b', b]]);
  assert.throws(() => expand(`[[a]][[/a]]`, templates), /循环调用检测到/);
});

// ---------- [[code]] 代码块原样透传 ----------

test('code 块内的模板调用不展开（原样透传）', () => {
  const templates = tm([['addendum', addendum]]);
  const src = `[[code]]
[[addendum title='示例']]
正文
[[/addendum]]
[[/code]]`;
  const out = expand(src, templates);
  assert.equal(out, src);
  assert.ok(out.includes(`[[addendum title='示例']]`));
});

test('code 带属性（[[code type="ftml"]]）也原样透传', () => {
  const templates = tm([['addendum', addendum]]);
  const src = `[[code type="ftml"]]
[[addendum title='x']]y[[/addendum]]
[[/code]]`;
  assert.equal(expand(src, templates), src);
});

test('code 块内的 [[style]] 不被收集为 CSS', () => {
  const src = `[[code]]
[[style]]p { color: red; }[[/style]]
[[/code]]
正文`;
  const out = expand(src, new Map());
  assert.equal(out, src);
});

test('code 块未闭合报错', () => {
  assert.throws(() => expand(`[[code]]x`, new Map()), /缺少闭合标签/);
});

test('findUnresolved 跳过 code 块内的模板调用', () => {
  const templates = tm([['addendum', addendum]]);
  const out = expand(
    `[[addendum title='真调用']]a[[/addendum]]
[[code]]
[[addendum title='示例']]b[[/addendum]]
[[/code]]`,
    templates
  );
  const unresolved = findUnresolved(out, templates);
  assert.deepEqual(unresolved, []);
});
