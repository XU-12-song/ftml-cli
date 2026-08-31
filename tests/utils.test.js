import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { homeFtmlCliDir, credentialsPath, homeCacheDir, projectMetaPath } from '../src/utils/paths.js';
import { cacheFilePath, readPageCache, writePageCache } from '../src/utils/cache.js';
import { loadConfig, loadProjectMeta, saveProjectMeta } from '../src/utils/config.js';
import { init } from '../src/commands/init.js';
import { projectGit, commitAll, gitRevert, isClean, isRepo } from '../src/utils/git.js';

function tmpdir() {
  return mkdtempSync(path.join(os.tmpdir(), 'ftml-ut-'));
}

// ---------- 用户级目录（FTML_CLI_HOME 隔离，不碰真实家目录） ----------

test('homeFtmlCliDir/credentialsPath/homeCacheDir 尊重 FTML_CLI_HOME', () => {
  process.env.FTML_CLI_HOME = '/tmp/ftml-cli-test-home';
  try {
    assert.equal(homeFtmlCliDir(), '/tmp/ftml-cli-test-home');
    assert.equal(credentialsPath(), '/tmp/ftml-cli-test-home/credentials.json');
    assert.equal(homeCacheDir(), '/tmp/ftml-cli-test-home/cache');
  } finally {
    delete process.env.FTML_CLI_HOME;
  }
});

// ---------- 磁盘缓存（跨项目共享的远程页面源码） ----------

test('writePageCache/readPageCache 按 site/page 落盘，冒号斜杠化', () => {
  const home = tmpdir();
  process.env.FTML_CLI_HOME = home;
  try {
    const p = cacheFilePath('scp-wiki-cn', 'theme:parallel');
    assert.equal(p, path.join(home, 'cache', 'scp-wiki-cn', 'theme', 'parallel.ftml'));

    assert.equal(readPageCache('scp-wiki-cn', 'theme:parallel'), null);
    writePageCache('scp-wiki-cn', 'theme:parallel', '源码[[include x]]');
    assert.equal(readPageCache('scp-wiki-cn', 'theme:parallel'), '源码[[include x]]');
    assert.equal(readPageCache('scp-wiki-cn', 'other'), null); // 站点内互不干扰
  } finally {
    rmSync(home, { recursive: true, force: true });
    delete process.env.FTML_CLI_HOME;
  }
});

// ---------- 项目级元数据：.ftml/<源文件名>.json ----------

test('saveProjectMeta/loadProjectMeta 合并写入，保留已有字段', () => {
  const root = tmpdir();
  const sourceAbs = path.join(root, 'pages', 'repo.ftml');
  try {
    assert.equal(loadProjectMeta(sourceAbs, root), null);
    saveProjectMeta(sourceAbs, { site: 'mysite', page: 'repo' }, root);
    const p = projectMetaPath(sourceAbs, root);
    assert.equal(p, path.join(root, '.ftml', 'repo.json'));
    assert.ok(existsSync(p));
    assert.deepEqual(loadProjectMeta(sourceAbs, root), { site: 'mysite', page: 'repo' });

    // 再次写入合并（lastRev 追加，site 保留）
    saveProjectMeta(sourceAbs, { lastRev: 42 }, root);
    assert.deepEqual(loadProjectMeta(sourceAbs, root), { site: 'mysite', page: 'repo', lastRev: 42 });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('loadConfig：site/page 优先级 元数据 < 配置文件 < 命令行', () => {
  const root = tmpdir();
  const cwd = process.cwd();
  try {
    mkdirSync(path.join(root, '.ftml'), { recursive: true });
    writeFileSync(path.join(root, '.ftmlrc.json'), JSON.stringify({ site: 'cfg-site', page: 'cfg-page' }));
    saveProjectMeta(path.join(root, 'index.ftml'), { site: 'meta-site', page: 'meta-page', lastRev: 7 }, root);

    // 元数据最低：配置文件有 site/page 时取配置
    process.chdir(root);
    let c = loadConfig();
    assert.equal(c.site, 'cfg-site');
    assert.equal(c.page, 'cfg-page');
    assert.equal(c.lastRev, 7); // lastRev 仅来自元数据

    // 命令行最高
    c = loadConfig({ site: 'cli-site', page: 'cli-page' });
    assert.equal(c.site, 'cli-site');
    assert.equal(c.page, 'cli-page');

    // 配置文件缺 site/page 时回退元数据
    writeFileSync(path.join(root, '.ftmlrc.json'), JSON.stringify({}));
    c = loadConfig();
    assert.equal(c.site, 'meta-site');
    assert.equal(c.page, 'meta-page');
  } finally {
    process.chdir(cwd);
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------- init：项目结构建立（幂等） ----------

test('init 建立项目结构且可重复执行', async () => {
  const root = tmpdir();
  try {
    await init({ cwd: root });

    // .ftml/history.json / components / templates / .gitignore / .ftmlrc.json
    assert.ok(existsSync(path.join(root, '.ftml', 'history.json')));
    assert.deepEqual(JSON.parse(readFileSync(path.join(root, '.ftml', 'history.json'), 'utf8')), []);
    assert.ok(existsSync(path.join(root, 'components')));
    assert.ok(existsSync(path.join(root, 'templates')));
    assert.ok(JSON.parse(readFileSync(path.join(root, '.ftmlrc.json'), 'utf8')).constructor === Object);
    const gi = readFileSync(path.join(root, '.gitignore'), 'utf8');
    assert.ok(gi.includes('dist/'));
    assert.ok(gi.includes('.ftml/'));

    // git 仓库已初始化
    const git = projectGit(root);
    assert.equal(await isRepo(git), true);

    // 幂等：重复执行不报错、不重复 .gitignore 条目
    await init({ cwd: root });
    const gi2 = readFileSync(path.join(root, '.gitignore'), 'utf8');
    assert.equal(gi2.split('\n').filter((l) => l.trim() === 'dist/').length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------- git 封装：commit / revert ----------

test('git 封装：commitAll 提交，gitRevert 生成反向提交', async () => {
  const root = tmpdir();
  try {
    const git = projectGit(root);
    await git.init();
    await git.addConfig('user.name', 'ftml test');
    await git.addConfig('user.email', 'test@ftml');
    assert.equal(await isClean(git), true);

    writeFileSync(path.join(root, 'a.txt'), 'v1');
    let { hash } = await commitAll(git, 'first');
    assert.ok(hash);

    writeFileSync(path.join(root, 'a.txt'), 'v2');
    await commitAll(git, 'second');

    // revert 第二笔提交 → a.txt 恢复为 v1
    const revertHash = await gitRevert(git, 'HEAD');
    assert.ok(revertHash);
    assert.equal(readFileSync(path.join(root, 'a.txt'), 'utf8'), 'v1');
    assert.equal(await isClean(git), true); // revert 本身是提交，工作区干净
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
