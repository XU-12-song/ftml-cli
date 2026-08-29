import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFtmx } from '../src/core/parse-ftmx.js';

test('基本解析：元素名 + 字面属性 + 声明键', () => {
  const src = `[[div class="addendum" title]]
{ children } { title }
[[/div]]`;
  const t = parseFtmx(src, 'addendum');
  assert.equal(t.element, 'div');
  assert.deepEqual(t.literalAttrs, ['class="addendum"']);
  assert.deepEqual(t.keys, ['title']);
  assert.ok(t.body.includes('{ title }'));
});

test('多键声明与引号属性区分', () => {
  const src = `[[div prop content class="x" id='y']]
{ prop } { content } { children }
[[/div]]`;
  const t = parseFtmx(src, 't');
  assert.deepEqual(t.keys, ['prop', 'content']);
  assert.deepEqual(t.literalAttrs, ['class="x"', "id='y'"]);
});

test('空名根 [[]] 包裹多元素', () => {
  const src = `[[ ]]
[[div]]a[[/div]]
[[div]]b[[/div]]
[[/]]`;
  const t = parseFtmx(src, 'multi');
  assert.equal(t.element, null);
  assert.deepEqual(t.keys, []);
  assert.ok(t.body.includes('[[div]]a[[/div]]'));
});

test('缺少闭合标签报错', () => {
  const src = `[[div class="x"]]
{ children }
`;
  assert.throws(() => parseFtmx(src, 'bad'), /缺少闭合标签/);
});

test('闭合标签后有多余内容报错', () => {
  const src = `[[div]]x[[/div]]
extra content`;
  assert.throws(() => parseFtmx(src, 'bad'), /必须由单个元素包裹/);
});

test('非法键名报错', () => {
  const src = `[[div foo bar-baz!]]
{ foo }
[[/div]]`;
  assert.throws(() => parseFtmx(src, 'bad'), /非法键名/);
});
