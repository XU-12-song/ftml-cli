/**
 * flags.test.js — 否定式开关（`--no-xxx`）真的生效
 *
 * commander 把 `--no-validate` 解析成 `{ validate: false }`（未传时默认 `true`），
 * 而命令内部转调与 web 调用方沿用的是 `{ noValidate: true }`。两套写法必须同时认，
 * 否则 CLI 上传了 `--no-xxx` 却照常执行被否定的那一步（静默失效）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { isNegated } from '../src/infra/flags.js';
import { deploy } from '../src/commands/deploy.js';
import { init } from '../src/commands/init.js';
import { projectGit, commitAll } from '../src/infra/git.js';
import { makeTmpDir, cleanup, withHome } from './helpers/fixtures.js';
import { fakeMultiPageClient } from './helpers/fake-wikidot.js';

// ---------- isNegated ----------

test('isNegated：认 commander 的 `xxx:false` 与 API 的 `noXxx:true` 两种写法', () => {
  // commander：--no-validate 传了 → validate:false；没传 → validate:true
  assert.equal(isNegated({ validate: false }, 'validate'), true);
  assert.equal(isNegated({ validate: true }, 'validate'), false);
  // API 写法
  assert.equal(isNegated({ noValidate: true }, 'validate'), true);
  assert.equal(isNegated({ noValidate: false }, 'validate'), false);
  // 缺省（既没传 flag 也不是 commander 产出）不视为关闭
  assert.equal(isNegated({}, 'validate'), false);
  assert.equal(isNegated(undefined, 'validate'), false);
  // 驼峰拼接：no + 首字母大写
  assert.equal(isNegated({ noWikidot: true }, 'wikidot'), true);
  assert.equal(isNegated({ noPush: true }, 'push'), true);
});

// ---------- deploy 端到端：开关确实改变了行为 ----------

/** 建一个已 init + 已配 git 身份 + 已提交初始版本的项目 */
async function makeGitFixture(files) {
  const root = makeTmpDir(files);
  await init({ cwd: root });
  const git = projectGit(root);
  await git.addConfig('user.name', 'ftml test');
  await git.addConfig('user.email', 'test@ftml');
  await commitAll(git, 'v1');
  return root;
}

/** deploy 会打一堆进度日志，测试里静音（node:test 同文件内顺序执行，替换是安全的） */
async function quiet(fn) {
  const { log, warn, error } = console;
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.log = log;
    console.warn = warn;
    console.error = error;
  }
}

/**
 * deploy 的选项。`source` 必须是绝对路径——底层命令对相对 source 是相对 **cwd**
 * 解析的（web 侧同样先按项目根 resolve），而测试的 cwd 是整个仓库。
 */
const opts = (root, extra = {}) => ({
  root,
  source: path.join(root, 'index.ftml'),
  site: 'scp-cn',
  page: 'hello',
  message: 'm',
  validate: false,
  push: false,
  ...extra,
});

/** 项目根要有 `.ftmlrc.json` 提供 templatesDir / site / page 等配置 */
const rc = { source: 'index.ftml', templatesDir: 'templates', site: 'scp-cn', page: 'hello' };

test('deploy：validate:false（commander 形态）跳过校验，校验不过的文件也能部署', async () => {
  // div 差 11 → validate 报错，但 build 通过
  const bad = `${Array.from({ length: 11 }, () => '[[div]]x').join('\n')}\n`;
  const root = await makeGitFixture({
    '.ftmlrc.json': JSON.stringify(rc),
    'index.ftml': bad,
  });
  try {
    await withHome(async () => {
      // 默认（不传开关）→ 校验拦下
      const { client } = fakeMultiPageClient({ hello: 'old' });
      await quiet(() => assert.rejects(
        () => deploy(opts(root, { validate: true, deps: false, clientFactory: () => client })),
        /校验未通过/,
      ));

      // --no-validate → 放行
      const { client: c2, calls } = fakeMultiPageClient({ hello: 'old' });
      await quiet(() => deploy(opts(root, { deps: false, clientFactory: () => c2 })));
      assert.deepEqual(calls.edit, ['hello']);
    });
  } finally {
    cleanup(root);
  }
});

test('deploy：deps:false（commander 形态）只发入口页，不发布依赖、不改写引用名', async () => {
  const root = await makeGitFixture({
    '.ftmlrc.json': JSON.stringify(rc),
    'index.ftml': '[[include components/box]]\nmain\n',
    'components/box.ftml': 'box\n',
  });
  try {
    await withHome(async () => {
      const { client, calls, store } = fakeMultiPageClient({ hello: 'old' });
      await quiet(() => deploy(
        opts(root, { deps: false, clientFactory: () => client }),
      ));
      assert.deepEqual(calls.create, [], '不建依赖页');
      assert.deepEqual(calls.edit, ['hello']);
      // 引用名原样（未归一到 components:box）
      assert.equal(store.get('hello'), '[[include components/box]]\nmain\n');
    });
  } finally {
    cleanup(root);
  }
});

test('deploy：noDeps:true（API 形态）与 deps:false 等效', async () => {
  const root = await makeGitFixture({
    '.ftmlrc.json': JSON.stringify(rc),
    'index.ftml': '[[include components/box]]\nmain\n',
    'components/box.ftml': 'box\n',
  });
  try {
    await withHome(async () => {
      const { client, calls, store } = fakeMultiPageClient({ hello: 'old' });
      await quiet(() => deploy(
        opts(root, { noDeps: true, clientFactory: () => client }),
      ));
      assert.deepEqual(calls.create, []);
      assert.equal(store.get('hello'), '[[include components/box]]\nmain\n');
    });
  } finally {
    cleanup(root);
  }
});

test('deploy：默认（不传开关）发布依赖闭包并重写引用名', async () => {
  const root = await makeGitFixture({
    '.ftmlrc.json': JSON.stringify(rc),
    'index.ftml': '[[include components/box]]\nmain\n',
    'components/box.ftml': 'box\n',
  });
  try {
    await withHome(async () => {
      const { client, calls, store } = fakeMultiPageClient({ hello: 'old' });
      await quiet(() => deploy(
        opts(root, { clientFactory: () => client }),
      ));
      assert.deepEqual(calls.create, ['components:box']);
      assert.equal(store.get('components:box'), 'box\n');
      assert.equal(store.get('hello'), '[[include components:box]]\nmain\n');
    });
  } finally {
    cleanup(root);
  }
});
