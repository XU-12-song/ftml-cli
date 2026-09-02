/**
 * web.test.js — web 编辑器后端测试
 *
 * 覆盖：项目注册表（FTML_CLI_HOME 重定向）、sidebar/文件读写、
 * render/validate 端点、deploy/revert（注入 fake client 离线）、
 * 非 git 项目 deploy 报错、loadConfig({ root }) 多项目支持。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';

import { addProject, removeProject, loadProjects } from '../src/web/projects.js';
import {
  listProjects,
  createProject,
  getSidebar,
  saveProjectFile,
  readProjectFile,
  renderProjectFile,
  validateProjectFile,
  deployProject,
  revertProject,
} from '../src/web/handlers.js';
import { loadConfig } from '../src/utils/config.js';
import { init } from '../src/commands/init.js';
import { projectGit, commitAll } from '../src/utils/git.js';

function tmpdir() {
  return mkdtempSync(path.join(os.tmpdir(), 'ftml-web-'));
}

/** 构造离线 fake wikidot 客户端（deploy/revert 注入用，不做网络请求） */
function fakeClient({ pageExists = true, revisionsCount = 7 } = {}) {
  const calls = { edit: 0 };
  const page = {
    name: 'hello',
    revisionsCount,
    edit: async () => {
      calls.edit++;
      return { isOk: () => true, value: { revisionsCount } };
    },
  };
  const site = {
    unixName: 'scp-cn',
    page: {
      get: async () => ({ isOk: () => true, value: pageExists ? page : null }),
    },
  };
  const client = {
    site: { get: async () => ({ isOk: () => true, value: site }) },
    close: async () => {},
  };
  site.client = client;
  return { client, calls };
}

/** 构造带模板/组件的项目 fixture（未 init git） */
function makeFixtureProject() {
  const root = tmpdir();
  mkdirSync(path.join(root, 'templates'), { recursive: true });
  mkdirSync(path.join(root, 'components'), { recursive: true });
  writeFileSync(path.join(root, '.ftmlrc.json'), JSON.stringify({ site: 'scp-cn', page: 'hello' }));
  writeFileSync(path.join(root, 'index.ftml'), '[[card icon="★" title="Hi"]]body[[/card]]\n');
  // 模板声明键 icon/title（sidebare keys 自动补全数据源）
  writeFileSync(path.join(root, 'templates', 'card.ftmx'),
    '[[div class="card" icon title]]\n' +
    '[[strong]]{ icon } { title }[[/strong]]\n' +
    '{ children }\n' +
    '[[/div]]\n');
  writeFileSync(path.join(root, 'components', 'note.ftml'), '[[div class="note"]]note[[/div]]\n');
  return root;
}

// ---------- 项目注册表 ----------

test('项目注册表：add/remove/load 尊重 FTML_CLI_HOME 且去重', () => {
  const home = tmpdir();
  const root = tmpdir();
  process.env.FTML_CLI_HOME = home;
  try {
    assert.deepEqual(loadProjects(), []);
    const list = addProject(root);
    assert.equal(list.length, 1);
    assert.equal(list[0].root, root);
    assert.equal(list[0].name, path.basename(root));

    addProject(root); // 重复添加去重
    assert.equal(loadProjects().length, 1);

    assert.throws(() => addProject(path.join(root, 'nope')), /目录不存在/);

    removeProject(root);
    assert.deepEqual(loadProjects(), []);
  } finally {
    delete process.env.FTML_CLI_HOME;
    rmSync(home, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------- sidebar / 文件读写（fixture + 真实 drafts 只读断言） ----------

test('sidebar：模板 keys（自动补全数据源）+ 组件 + 源文件', async () => {
  const home = tmpdir();
  const root = makeFixtureProject();
  process.env.FTML_CLI_HOME = home;
  try {
    addProject(root);
    const sb = await getSidebar(root);
    assert.deepEqual(sb.templates.map((t) => t.name), ['card']);
    assert.deepEqual(sb.templates[0].keys, ['icon', 'title']);
    assert.deepEqual(sb.components.map((c) => c.name), ['note']);
    assert.ok(sb.sources.includes('index.ftml'));
  } finally {
    delete process.env.FTML_CLI_HOME;
    rmSync(home, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test('sidebar：真实 drafts 项目只读断言（2 模板 / 10 组件）', async () => {
  const home = tmpdir();
  const root = '/public/drafts';
  process.env.FTML_CLI_HOME = home;
  try {
    addProject(root);
    const sb = await getSidebar(root);
    assert.deepEqual(sb.templates.map((t) => t.name).sort(), ['file-item', 'gh-empty']);
    assert.equal(sb.components.length, 10);
    assert.ok(sb.sources.includes('index.ftml'));
    assert.equal(sb.isRepo, true); // /public/drafts 已是 git 仓库（早前 web init 过，空仓库无提交）
  } finally {
    delete process.env.FTML_CLI_HOME;
    rmSync(home, { recursive: true, force: true });
  }
});

test('listProjects：注册表含失效目录条目时跳过（simple-git 对不存在目录会抛错）', async () => {
  const home = tmpdir();
  const root = makeFixtureProject();
  const ghost = tmpdir();
  process.env.FTML_CLI_HOME = home;
  try {
    // 先注册 ghost，再删掉它的目录 → 变成一个"幽灵"条目
    addProject(ghost);
    addProject(root);
    rmSync(ghost, { recursive: true, force: true });

    const list = await listProjects();
    const ids = list.map((p) => p.id);
    assert.ok(!ids.includes(ghost), '失效目录不应出现在列表');
    assert.ok(ids.includes(root), '正常项目应保留');
    const live = list.find((p) => p.id === root);
    assert.equal(live.isRepo, false);
  } finally {
    delete process.env.FTML_CLI_HOME;
    rmSync(home, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test('getSidebar：目录已被删除的项目返回 410 提示，而不是 simple-git 崩溃', async () => {
  const home = tmpdir();
  const ghost = tmpdir();
  process.env.FTML_CLI_HOME = home;
  try {
    addProject(ghost);
    rmSync(ghost, { recursive: true, force: true });
    await assert.rejects(() => getSidebar(ghost), /项目目录不存在，请在列表中移除/);
  } finally {
    delete process.env.FTML_CLI_HOME;
    rmSync(home, { recursive: true, force: true });
  }
});

test('save/read 文件往返 + 路径越界拒绝', () => {
  const home = tmpdir();
  const root = makeFixtureProject();
  process.env.FTML_CLI_HOME = home;
  try {
    addProject(root);
    saveProjectFile(root, { path: 'pages/extra.ftml', source: '[[div]]x[[/div]]' });
    assert.equal(readProjectFile(root, 'pages/extra.ftml').source, '[[div]]x[[/div]]');

    // 目录穿越：../ 越界拒绝
    assert.throws(() => saveProjectFile(root, { path: '../evil.txt', source: 'x' }), /路径越界/);
    assert.throws(() => readProjectFile(root, '..%2Fetc%2Fpasswd'), /路径越界|不存在/);
  } finally {
    delete process.env.FTML_CLI_HOME;
    rmSync(home, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------- render / validate ----------

test('render 端点：展开模板并返回完整文档（DOCTYPE + 内联 runtime + script 平衡）', async () => {
  const home = tmpdir();
  const root = makeFixtureProject();
  process.env.FTML_CLI_HOME = home;
  try {
    addProject(root);
    const { client } = fakeClient();
    const r = await renderProjectFile(root, { path: 'index.ftml', site: 'scp-cn', page: 'hello' }, { injectClient: client });
    assert.ok(r.html.startsWith('<!DOCTYPE html>'));
    assert.ok(r.html.includes('initWdprRuntime'));
    // 内联 runtime 里的 </script 序列已转义，script 标签必须配对
    const opens = (r.html.match(/<script/g) ?? []).length;
    const closes = (r.html.match(/<\/script>/g) ?? []).length;
    assert.equal(opens, closes);
    // 模板键值已渲染进正文
    assert.ok(r.html.includes('★ Hi'));
    assert.ok(Array.isArray(r.diagnostics));
  } finally {
    delete process.env.FTML_CLI_HOME;
    rmSync(home, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test('validate 端点：干净文件无错误，坏文件报错', async () => {
  const home = tmpdir();
  const root = makeFixtureProject();
  process.env.FTML_CLI_HOME = home;
  try {
    addProject(root);
    const clean = await validateProjectFile(root, { path: 'index.ftml' });
    assert.equal(clean.errors.length, 0);

    saveProjectFile(root, { path: 'bad.ftml', source: '[[div]]开而不闭\n[[card heading="x"]]' });
    const bad = await validateProjectFile(root, { path: 'bad.ftml' });
    assert.ok(bad.errors.length > 0, '缺参数/未闭合应报错');
  } finally {
    delete process.env.FTML_CLI_HOME;
    rmSync(home, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------- deploy / revert（fake client 离线） ----------

/** init + 建 git 仓库并配置 user，提交初始版本 */
async function makeGitFixture() {
  const root = makeFixtureProject();
  await init({ cwd: root });
  const git = projectGit(root);
  await git.addConfig('user.name', 'ftml test');
  await git.addConfig('user.email', 'test@ftml');
  await commitAll(git, 'v1');
  return { root, git };
}

test('deploy：构建 + 校验 + 提交 Wikidot + git 提交 + history/元数据', async () => {
  const home = tmpdir();
  const { root } = await makeGitFixture();
  process.env.FTML_CLI_HOME = home;
  try {
    addProject(root);
    const { client, calls } = fakeClient();
    const r = await deployProject(root, {
      path: 'index.ftml', site: 'scp-cn', page: 'hello', message: 'web deploy',
    }, { injectClient: client });

    assert.equal(r.ok, true);
    assert.equal(calls.edit, 1); // editPage 只调一次
    assert.ok(r.logs.some((l) => l.msg.includes('构建完成')));
    assert.ok(r.logs.some((l) => l.msg.includes('部署完成')));

    // dist 产物 + history + 元数据
    assert.ok(fs.existsSync(path.join(root, 'dist', 'index.ftml')));
    const history = JSON.parse(readFileSync(path.join(root, '.ftml', 'history.json'), 'utf8'));
    assert.equal(history.length, 1);
    assert.equal(history[0].comment, 'web deploy');
    const meta = JSON.parse(readFileSync(path.join(root, '.ftml', 'index.json'), 'utf8'));
    assert.equal(meta.site, 'scp-cn');
    assert.equal(meta.lastRev, 7);
  } finally {
    delete process.env.FTML_CLI_HOME;
    rmSync(home, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test('revert：自动提交 + 真 git revert + rebuild + 回推 Wikidot', async () => {
  const home = tmpdir();
  const { root, git } = await makeGitFixture();
  // 第二版提交（revert 目标 = HEAD）
  writeFileSync(path.join(root, 'index.ftml'), '[[card icon="◎" title="V2"]]v2[[/card]]\n');
  await commitAll(git, 'v2');
  process.env.FTML_CLI_HOME = home;
  try {
    addProject(root);
    const { client, calls } = fakeClient();
    const r = await revertProject(root, {
      path: 'index.ftml', site: 'scp-cn', page: 'hello', to: 'HEAD',
    }, { injectClient: client });

    assert.equal(r.ok, true);
    assert.equal(calls.edit, 1);
    assert.ok(r.logs.some((l) => l.msg.includes('git revert')));

    // 源文件恢复为 v1（icon 值 ★）
    assert.ok(readFileSync(path.join(root, 'index.ftml'), 'utf8').includes('icon="★"'));
    // rebuild 后产物存在且为 v1 内容（模板展开后 ★ Hi）
    assert.ok(fs.existsSync(path.join(root, 'dist', 'index.ftml')));
    assert.ok(readFileSync(path.join(root, 'dist', 'index.ftml'), 'utf8').includes('★ Hi'));
  } finally {
    delete process.env.FTML_CLI_HOME;
    rmSync(home, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test('deploy：非 git 项目报错（提示先 init）', async () => {
  const home = tmpdir();
  const root = makeFixtureProject();
  process.env.FTML_CLI_HOME = home;
  try {
    addProject(root);
    const { client } = fakeClient();
    await assert.rejects(
      () => deployProject(root, { path: 'index.ftml', site: 'scp-cn', page: 'hello' }, { injectClient: client }),
      (err) => /git/i.test(err.message)
    );
  } finally {
    delete process.env.FTML_CLI_HOME;
    rmSync(home, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------- loadConfig({ root }) 多项目支持 ----------

test('loadConfig({ root })：任意目录解析 site/page 优先级（命令行 > 配置 > 元数据）', () => {
  const root = makeFixtureProject();
  try {
    mkdirSync(path.join(root, '.ftml'), { recursive: true });
    writeFileSync(path.join(root, '.ftml', 'index.json'),
      JSON.stringify({ site: 'meta-site', page: 'meta-page', lastRev: 3 }), 'utf8');

    // 无命令行覆盖：取配置文件（scp-cn/hello）
    let c = loadConfig({ root });
    assert.equal(c.site, 'scp-cn');
    assert.equal(c.page, 'hello');
    assert.equal(c.lastRev, 3); // lastRev 仅来自元数据

    // 命令行覆盖最高
    c = loadConfig({ root, site: 'cli-site', page: 'cli-page' });
    assert.equal(c.site, 'cli-site');
    assert.equal(c.page, 'cli-page');

    // 配置去掉 site/page → 回退元数据
    writeFileSync(path.join(root, '.ftmlrc.json'), '{}');
    c = loadConfig({ root });
    assert.equal(c.site, 'meta-site');
    assert.equal(c.page, 'meta-page');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
