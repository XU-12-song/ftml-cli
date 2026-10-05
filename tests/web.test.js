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
import path from 'node:path';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';

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
  latestOnly,
} from '../src/web/handlers/index.js';
import { loadConfig } from '../src/infra/config.js';
import { saveSettings } from '../src/domain/settings.js';
import { init } from '../src/commands/init.js';
import { projectGit, commitAll } from '../src/infra/git.js';
import { makeTmpDir, cleanup, withHome } from './helpers/fixtures.js';
import { fakeDeployClient as fakeClient, fakeRemoteClient } from './helpers/fake-wikidot.js';

/** 供 fakeRemoteClient 使用的页面桩：getSource 返回固定源码 */
const remotePage = (src) => ({ getSource: async () => ({ isOk: () => true, value: src }) });

const tmpdir = () => makeTmpDir({}, { prefix: 'ftml-web-' });

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

test('项目注册表：add/remove/load 尊重 FTML_CLI_HOME 且去重', async () => {
  const root = tmpdir();
  try {
    await withHome(async () => {
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
    });
  } finally {
    cleanup(root);
  }
});

// ---------- sidebar / 文件读写 ----------

test('sidebar：模板 keys（自动补全数据源）+ 组件 + 源文件', async () => {
  const root = makeFixtureProject();
  try {
    await withHome(async () => {
      addProject(root);
      const sb = await getSidebar(root);
      assert.deepEqual(sb.templates.map((t) => t.name), ['card']);
      assert.deepEqual(sb.templates[0].keys, ['icon', 'title']);
      assert.deepEqual(sb.components.map((c) => c.name), ['note']);
      assert.ok(sb.sources.includes('index.ftml'));
    });
  } finally {
    cleanup(root);
  }
});

test('sidebar：多模板 / 多组件项目 fixture（2 模板 / 10 组件 / 已是 git 仓库）', async () => {
  const root = tmpdir();
  const templateNames = ['file-item', 'gh-empty'];
  try {
    mkdirSync(path.join(root, 'templates'), { recursive: true });
    mkdirSync(path.join(root, 'components'), { recursive: true });
    writeFileSync(path.join(root, 'index.ftml'), '[[div]]x[[/div]]\n');
    for (const name of templateNames) {
      writeFileSync(path.join(root, 'templates', `${name}.ftmx`), '[[div]]{ children }[[/div]]\n');
    }
    for (let i = 0; i < 10; i++) {
      writeFileSync(path.join(root, 'components', `c${i}.ftml`), `[[div]]c${i}[[/div]]\n`);
    }
    await init({ cwd: root }); // 已是 git 仓库但可能无提交（isRepo 应为 true）

    await withHome(async () => {
      addProject(root);
      const sb = await getSidebar(root);
      assert.deepEqual(sb.templates.map((t) => t.name).sort(), templateNames);
      assert.equal(sb.components.length, 10);
      assert.ok(sb.sources.includes('index.ftml'));
      assert.equal(sb.isRepo, true);
    });
  } finally {
    cleanup(root);
  }
});

test('listProjects：注册表含失效目录条目时跳过（simple-git 对不存在目录会抛错）', async () => {
  const root = makeFixtureProject();
  const ghost = tmpdir();
  try {
    await withHome(async () => {
      // 先注册 ghost，再删掉它的目录 → 变成一个"幽灵"条目
      addProject(ghost);
      addProject(root);
      cleanup(ghost);

      const list = await listProjects();
      const ids = list.map((p) => p.id);
      assert.ok(!ids.includes(ghost), '失效目录不应出现在列表');
      assert.ok(ids.includes(root), '正常项目应保留');
      const live = list.find((p) => p.id === root);
      assert.equal(live.isRepo, false);
    });
  } finally {
    cleanup(root);
  }
});

test('getSidebar：目录已被删除的项目返回 410 提示，而不是 simple-git 崩溃', async () => {
  const ghost = makeFixtureProject();
  try {
    await withHome(async () => {
      addProject(ghost);
      cleanup(ghost);
      await assert.rejects(() => getSidebar(ghost), /项目目录不存在，请在列表中移除/);
    });
  } finally {
    cleanup(ghost);
  }
});

test('save/read 文件往返 + 路径越界拒绝', async () => {
  const root = makeFixtureProject();
  try {
    await withHome(async () => {
      addProject(root);
      saveProjectFile(root, { path: 'pages/extra.ftml', source: '[[div]]x[[/div]]' });
      assert.equal(readProjectFile(root, 'pages/extra.ftml').source, '[[div]]x[[/div]]');

      // 目录穿越：../ 越界拒绝
      assert.throws(() => saveProjectFile(root, { path: '../evil.txt', source: 'x' }), /路径越界/);
      assert.throws(() => readProjectFile(root, '..%2Fetc%2Fpasswd'), /路径越界|不存在/);
    });
  } finally {
    cleanup(root);
  }
});

// ---------- render / validate ----------

test('render 端点：展开模板并返回完整文档（沙盒 XHTML 外壳 + 内联 runtime + script 平衡）', async () => {
  const root = makeFixtureProject();
  try {
    await withHome(async () => {
      addProject(root);
      const { client } = fakeClient();
      const r = await renderProjectFile(root, { path: 'index.ftml', site: 'scp-cn', page: 'hello' }, { injectClient: client });
      assert.ok(r.html.startsWith('<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN"'));
      assert.ok(r.html.includes('initWdprRuntime'));
      // 内联 runtime 里的 </script 序列已转义，script 标签必须配对
      const opens = (r.html.match(/<script/g) ?? []).length;
      const closes = (r.html.match(/<\/script>/g) ?? []).length;
      assert.equal(opens, closes);
      // 模板键值已渲染进正文
      assert.ok(r.html.includes('★ Hi'));
      assert.ok(Array.isArray(r.diagnostics));
    });
  } finally {
    cleanup(root);
  }
});

test('render 端点：展开失败不抛 500，返回 problems（带行号 + 堆栈）', async () => {
  const root = makeFixtureProject();
  try {
    await withHome(async () => {
      addProject(root);
      // card 模板调用缺闭合标签 → expand 抛 FtmlError（unclosed-template-call，offset=0）
      saveProjectFile(root, { path: 'bad.ftml', source: '[[card icon="x" title="y"]]body' });
      const { client } = fakeClient();
      const r = await renderProjectFile(root, { path: 'bad.ftml' }, { injectClient: client });
      assert.equal(r.html, null);
      assert.equal(r.problems.length, 1);
      const p = r.problems[0];
      assert.equal(p.severity, 'error');
      assert.equal(p.code, 'unclosed-template-call');
      assert.equal(p.file, 'bad.ftml');
      assert.equal(p.position.start.line, 1);
      assert.equal(p.position.start.offset, 0);
      assert.ok(typeof p.stack === 'string' && p.stack.length > 0);
    });
  } finally {
    cleanup(root);
  }
});

test('render 端点：成功时附带 problems（wdpr 诊断归一，位置可用）', async () => {
  const root = makeFixtureProject();
  try {
    await withHome(async () => {
      addProject(root);
      const { client } = fakeClient();
      const r = await renderProjectFile(root, { path: 'index.ftml' }, { injectClient: client });
      assert.ok(r.html);
      assert.ok(Array.isArray(r.problems));
      for (const p of r.problems) {
        assert.ok(['error', 'warning', 'info'].includes(p.severity));
        assert.equal(typeof p.code, 'string');
      }
    });
  } finally {
    cleanup(root);
  }
});

test('render：编辑态默认不联网；allowNetwork 才补拉远程 include；useRemoteInclude 总开关可拦截', async () => {
  const root = makeFixtureProject();
  try {
    await withHome(async () => {
      addProject(root);
      saveProjectFile(root, { path: 'a.ftml', source: '[[include r-auto]]\n' });
      saveProjectFile(root, { path: 'b.ftml', source: '[[include r-net]]\n' });
      saveProjectFile(root, { path: 'c.ftml', source: '[[include r-off]]\n' });
      // 三个不同页名，避免磁盘 include 缓存互相串扰
      const client = fakeRemoteClient({
        'r-auto': remotePage('REMOTE-AUTO'),
        'r-net': remotePage('REMOTE-NET'),
        'r-off': remotePage('REMOTE-OFF'),
      });

      // (a) 自动预览（body 无 allowNetwork）→ 不联网，include 记为 miss
      const a = await renderProjectFile(root, { path: 'a.ftml', site: 'scp-cn', page: 'hello' }, { injectClient: client });
      assert.ok(a.html);
      assert.ok(a.includes.some((i) => i.page === 'r-auto' && i.from === 'miss'));
      assert.ok(!a.html.includes('REMOTE-AUTO'));

      // (b) 手动刷新 allowNetwork:true + 默认 useRemoteInclude:true → 远程拉取并渲染
      const b = await renderProjectFile(root, { path: 'b.ftml', site: 'scp-cn', page: 'hello', allowNetwork: true }, { injectClient: client });
      assert.ok(b.includes.some((i) => i.page === 'r-net' && i.from === 'remote'));
      assert.ok(b.html.includes('REMOTE-NET'));

      // (c) 总开关关闭 → 即便 allowNetwork:true 也不联网
      saveSettings({ useRemoteInclude: false });
      const c = await renderProjectFile(root, { path: 'c.ftml', site: 'scp-cn', page: 'hello', allowNetwork: true }, { injectClient: client });
      assert.ok(c.includes.some((i) => i.page === 'r-off' && i.from === 'miss'));
      assert.ok(!c.html.includes('REMOTE-OFF'));
    });
  } finally {
    cleanup(root);
  }
});

test('validate 端点：干净文件无错误，坏文件报错', async () => {
  const root = makeFixtureProject();
  try {
    await withHome(async () => {
      addProject(root);
      const clean = await validateProjectFile(root, { path: 'index.ftml' });
      assert.equal(clean.errors.length, 0);

      saveProjectFile(root, { path: 'bad.ftml', source: '[[div]]开而不闭\n[[card heading="x"]]' });
      const bad = await validateProjectFile(root, { path: 'bad.ftml' });
      assert.ok(bad.errors.length > 0, '缺参数/未闭合应报错');
    });
  } finally {
    cleanup(root);
  }
});

test('validate 端点：[[embed]] 体内裸闭标签给出结构逃逸告警（非错误）', async () => {
  const root = makeFixtureProject();
  try {
    await withHome(async () => {
      addProject(root);
      const src = '[[collapsible show="a" hide="b"]]\n[[embed]]\n<iframe src="[[/collapsible]]"></iframe>\n[[/embed]]\n';
      saveProjectFile(root, { path: 'escape.ftml', source: src });
      const r = await validateProjectFile(root, { path: 'escape.ftml' });
      assert.equal(r.errors.length, 0, '结构逃逸只告警不报错');
      assert.ok(r.warnings.some((w) => w.includes('3:14') && w.includes('[[/collapsible]]')));
    });
  } finally {
    cleanup(root);
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
  const { root } = await makeGitFixture();
  try {
    await withHome(async () => {
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
      // deploy = 大版本一条 + 后续 submit 一条
      assert.equal(history.length, 2);
      assert.equal(history[0].comment, 'web deploy');
      assert.equal(history[0].type, 'major');
      assert.equal(history[1].type, 'submit');
      const meta = JSON.parse(readFileSync(path.join(root, '.ftml', 'index.json'), 'utf8'));
      assert.equal(meta.site, 'scp-cn');
      assert.equal(meta.lastRev, 7);

      // 版本清单：1 个大版本 + 其下 1 个小版本 + 大版本快照
      const versions = JSON.parse(readFileSync(path.join(root, '.ftml', 'versions.json'), 'utf8'));
      assert.equal(versions.major.length, 1);
      assert.equal(versions.major[0].version, '1');
      assert.equal(versions.minor.length, 1);
      assert.equal(versions.minor[0].version, '1.1');
      assert.ok(fs.existsSync(path.join(root, '.ftml', 'versions', '1.ftml')));
    });
  } finally {
    cleanup(root);
  }
});

test('revert：自动提交 + 真 git revert + rebuild + 回推 Wikidot', async () => {
  const { root, git } = await makeGitFixture();
  try {
    // 第二版提交（revert 目标 = HEAD）
    writeFileSync(path.join(root, 'index.ftml'), '[[card icon="◎" title="V2"]]v2[[/card]]\n');
    await commitAll(git, 'v2');

    await withHome(async () => {
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
    });
  } finally {
    cleanup(root);
  }
});

test('deploy：非 git 项目报错（提示先 init）', async () => {
  const root = makeFixtureProject();
  try {
    await withHome(async () => {
      addProject(root);
      const { client } = fakeClient();
      await assert.rejects(
        () => deployProject(root, {
          path: 'index.ftml', site: 'scp-cn', page: 'hello', message: 'web deploy',
        }, { injectClient: client }),
        (err) => /git/i.test(err.message)
      );
    });
  } finally {
    cleanup(root);
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
    cleanup(root);
  }
});

// ---------- latestOnly：渲染请求“最新者胜”串行门 ----------

const tick = () => new Promise((r) => setTimeout(r, 0));

test('latestOnly：排队中的中间请求被最新请求取代，不做无用功', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const ran = [];
  const a = latestOnly('k-mid', async () => { ran.push('A'); await gate; return 'A'; });
  await tick(); // 让 A 先跑起来
  const b = latestOnly('k-mid', async () => { ran.push('B'); return 'B'; });
  const c = latestOnly('k-mid', async () => { ran.push('C'); return 'C'; });
  release();

  await assert.rejects(() => b, (e) => e.superseded === true);
  assert.equal(await a, 'A');
  assert.equal(await c, 'C'); // 只有最新的排队请求执行
  assert.deepEqual(ran, ['A', 'C']);
});

test('latestOnly：checkpoint 在执行途中发现更新的请求即放弃', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const ran = [];
  const a = latestOnly('k-ck', async (checkpoint) => {
    ran.push('A-start');
    await gate;
    checkpoint(); // 此时已有 B → 抛 SupersededError
    ran.push('A-end');
    return 'A';
  });
  await tick();
  const b = latestOnly('k-ck', async () => { ran.push('B'); return 'B'; });
  release();

  await assert.rejects(() => a, (e) => e.superseded === true);
  assert.equal(await b, 'B');
  assert.deepEqual(ran, ['A-start', 'B']);
});

test('latestOnly：顺序调用共享同一 key 正常完成（gate 回收）', async () => {
  assert.equal(await latestOnly('k-seq', async () => 1), 1);
  assert.equal(await latestOnly('k-seq', async () => 2), 2);
});
