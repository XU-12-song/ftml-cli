/**
 * session.test.js — 进程内 Wikidot 会话复用 / 缓存 / 部署并发
 *
 * 全部使用注入 fake client + 假时钟，不发任何网络请求：
 *   - 工厂注入路径：getClient({ clientFactory })，同一工厂只调用一次（一次「登录」）；
 *   - 凭证单例路径：环境变量凭证 + setLoginFactoryForTests 替换真实登录；
 *   - TTL 边界：正好到 TTL 视为过期（clock() >= expiresAt）。
 */

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { LoginRequiredError } from '@ukwhatn/wikidot';

import {
  getClient,
  withSession,
  resetSession,
  disposeSession,
  invalidateSite,
  invalidatePage,
  SITE_TTL_MS,
  PAGE_TTL_MS,
  setSessionClockForTests,
  setLoginFactoryForTests,
} from '../src/infra/session.js';
import { getSite, getPage, editPage } from '../src/infra/wikidot.js';
import { deploy } from '../src/commands/deploy.js';
import { init } from '../src/commands/init.js';
import { projectGit, commitAll } from '../src/infra/git.js';
import { makeTmpDir, cleanup, withHome } from './helpers/fixtures.js';

// ---------- 每个用例独立的会话与环境 ----------

let savedEnv;
beforeEach(async () => {
  await resetSession();
  savedEnv = {
    u: process.env.WIKIDOT_USERNAME,
    p: process.env.WIKIDOT_PASSWORD,
  };
});

afterEach(async () => {
  setSessionClockForTests(null);
  setLoginFactoryForTests(null);
  if (savedEnv.u === undefined) delete process.env.WIKIDOT_USERNAME;
  else process.env.WIKIDOT_USERNAME = savedEnv.u;
  if (savedEnv.p === undefined) delete process.env.WIKIDOT_PASSWORD;
  else process.env.WIKIDOT_PASSWORD = savedEnv.p;
  await resetSession();
});

// ---------- fake client ----------

const ok = (value = undefined) => ({ isOk: () => true, value });
const err = (e) => ({ isOk: () => false, error: e });

/**
 * 可计数的假客户端：site.get / page.get / page.edit / page.create / close 全部计数，
 * 页面对象带 site 反向引用（edit 后的缓存失效依赖它）。
 */
function makeClient({ pages = {} } = {}) {
  const counts = { site: 0, pageGet: 0, edit: [], create: [], close: 0 };
  const store = new Map(Object.entries(pages));

  const site = {
    unixName: 'scp-cn',
    client: null, // 下面回填
    page: {
      get: async (name) => {
        counts.pageGet++;
        return ok(store.has(name) ? makePage(name) : null);
      },
      create: async (name, { source } = {}) => {
        counts.create.push(name);
        store.set(name, source ?? '');
        return ok();
      },
    },
  };

  const makePage = (name) => ({
    name,
    fullname: name,
    site, // 真实 Page 带 site 引用；缓存失效要用
    revisionsCount: 1,
    edit: async ({ source } = {}) => {
      counts.edit.push(name);
      store.set(name, source);
      return ok();
    },
  });

  const client = {
    site: {
      get: async () => {
        counts.site++;
        return ok(site);
      },
    },
    close: async () => {
      counts.close++;
      return ok();
    },
  };
  site.client = client;
  return { client, site, counts, store };
}

/** 带编辑并发统计 / 指定页编辑失败的假客户端（部署并发测试用） */
function makeDeployClient({ pages = {}, failEditFor = null, editDelayMs = 5 } = {}) {
  const base = makeClient({ pages });
  const counts = base.counts;
  const store = base.store;
  let active = 0;
  let maxActive = 0;
  const editPromises = [];

  const site = base.site;
  site.page = {
    get: async (name) => {
      counts.pageGet++;
      return ok(store.has(name) ? makePage(name) : null);
    },
    create: async (name, { source } = {}) => {
      counts.create.push(name);
      store.set(name, source ?? '');
      return ok();
    },
  };

  const makePage = (name) => ({
    name,
    fullname: name,
    site,
    revisionsCount: 1,
    edit: async ({ source } = {}) => {
      const p = (async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        try {
          await new Promise((resolve) => setTimeout(resolve, editDelayMs));
          if (failEditFor === name) throw new Error(`boom editing ${name}`);
          counts.edit.push(name);
          store.set(name, source);
          return ok();
        } finally {
          active--;
        }
      })();
      // 占住引用并吞掉失败副本：避免 deploy 中止后仍在跑的编辑成为
      // 未处理拒绝；settled() 供测试等待所有编辑落定
      editPromises.push(p.catch(() => {}));
      return p;
    },
  });

  return {
    ...base,
    stats: () => ({ maxActive }),
    /** 等待所有已发起的 edit（含失败的）全部落定 */
    settled: async () => {
      await Promise.all(editPromises);
    },
  };
}

// ---------- 对外契约 ----------

test('对外契约：session.ts 导出齐全，TTL 常量正确', () => {
  const mod = { getClient, withSession, resetSession, disposeSession, invalidateSite, invalidatePage };
  for (const name of Object.keys(mod)) {
    assert.equal(typeof mod[name], 'function', `缺少导出: ${name}`);
  }
  assert.equal(SITE_TTL_MS, 10 * 60_000);
  assert.equal(PAGE_TTL_MS, 2 * 60_000);
});

// ---------- getClient：并发去重 / 指纹单例 ----------

test('并发两次 getClient（工厂注入）只调用工厂一次，拿到同一客户端', async () => {
  let logins = 0;
  const { client } = makeClient();
  const factory = async () => {
    logins++;
    return client;
  };
  const [a, b] = await Promise.all([
    getClient({ clientFactory: factory }),
    getClient({ clientFactory: factory }),
  ]);
  assert.equal(logins, 1);
  assert.equal(a, client);
  assert.equal(b, client);
});

test('并发两次 getClient（凭证单例）只登录一次', async () => {
  process.env.WIKIDOT_USERNAME = 'alice';
  process.env.WIKIDOT_PASSWORD = 'pw';
  let logins = 0;
  setLoginFactoryForTests(async () => {
    logins++;
    return makeClient().client;
  });
  const [a, b] = await Promise.all([getClient(), getClient()]);
  assert.equal(logins, 1);
  assert.equal(a, b);
});

test('凭证变化（指纹不同）→ 旧会话作废，重新登录', async () => {
  process.env.WIKIDOT_USERNAME = 'alice';
  process.env.WIKIDOT_PASSWORD = 'pw';
  let logins = 0;
  const clients = [];
  setLoginFactoryForTests(async () => {
    logins++;
    const c = makeClient().client;
    clients.push(c);
    return c;
  });
  const first = await getClient();
  assert.equal(logins, 1);

  process.env.WIKIDOT_USERNAME = 'bob';
  const second = await getClient();
  assert.equal(logins, 2);
  assert.notEqual(second, first);
});

test('disposeSession 关闭自己拥有的会话；注入/工厂客户端不拥有、不关闭', async () => {
  // 凭证单例：拥有 → dispose 时 close
  process.env.WIKIDOT_USERNAME = 'alice';
  process.env.WIKIDOT_PASSWORD = 'pw';
  let ownedCloses = 0;
  setLoginFactoryForTests(async () => {
    const { client } = makeClient();
    const orig = client.close;
    client.close = async () => {
      ownedCloses++;
      return orig();
    };
    return client;
  });
  await getClient();
  await disposeSession();
  assert.equal(ownedCloses, 1);

  // 工厂注入：不拥有 → dispose 不 close
  let factoryCloses = 0;
  const { client: fake } = makeClient();
  fake.close = async () => {
    factoryCloses++;
    return ok();
  };
  await getClient({ clientFactory: () => fake });
  await disposeSession();
  assert.equal(factoryCloses, 0);

  // injectClient：一次性直用，完全不进会话槽
  const { client: injected } = makeClient();
  let injectedCloses = 0;
  injected.close = async () => {
    injectedCloses++;
    return ok();
  };
  assert.equal(await getClient({ injectClient: injected }), injected);
  await disposeSession();
  assert.equal(injectedCloses, 0);
});

// ---------- TTL 缓存（假时钟） ----------

test('Site 随会话缓存：TTL 10 分钟内零请求，过期重取，可手动失效', async () => {
  let now = 1_000_000;
  setSessionClockForTests(() => now);
  const { client, counts } = makeClient();
  await getClient({ clientFactory: () => client });

  const s1 = await getSite(client, 'scp-cn');
  const s2 = await getSite(client, 'scp-cn');
  assert.equal(s1, s2);
  assert.equal(counts.site, 1);

  now += SITE_TTL_MS - 1; // 还差 1ms 到期 → 仍命中
  await getSite(client, 'scp-cn');
  assert.equal(counts.site, 1);

  now += 1; // 正好到 TTL → 过期重取
  await getSite(client, 'scp-cn');
  assert.equal(counts.site, 2);

  invalidateSite('scp-cn'); // 手动失效
  await getSite(client, 'scp-cn');
  assert.equal(counts.site, 3);
});

test('Page 2 分钟过期；edit 后立即失效；null 不缓存', async () => {
  let now = 2_000_000;
  setSessionClockForTests(() => now);
  const { client, site, counts, store } = makeClient({ pages: { a: 'old' } });
  await getClient({ clientFactory: () => client });

  const p1 = await getPage(site, 'a');
  const p2 = await getPage(site, 'a');
  assert.equal(p1, p2);
  assert.equal(counts.pageGet, 1);

  now += PAGE_TTL_MS - 1;
  await getPage(site, 'a');
  assert.equal(counts.pageGet, 1); // 仍在 TTL 内

  now += 1;
  const p3 = await getPage(site, 'a');
  assert.equal(counts.pageGet, 2); // 正好 2 分钟 → 过期重取

  // edit 后立即失效（无需等 TTL）
  await editPage(p3, { source: 'new', comment: 'c' });
  assert.equal(store.get('a'), 'new');
  await getPage(site, 'a');
  assert.equal(counts.pageGet, 3);

  // null（页面不存在）不缓存：两次都发请求
  assert.equal(await getPage(site, 'missing'), null);
  assert.equal(await getPage(site, 'missing'), null);
  assert.equal(counts.pageGet, 5);
});

test('invalidatePage 手动失效（对象与字符串两种形态）', async () => {
  const { client, site, counts } = makeClient({ pages: { a: 'x' } });
  await getClient({ clientFactory: () => client });

  await getPage(site, 'a');
  assert.equal(counts.pageGet, 1);

  invalidatePage('scp-cn', 'a'); // 字符串形态
  await getPage(site, 'a');
  assert.equal(counts.pageGet, 2);

  await getPage(site, 'a');
  assert.equal(counts.pageGet, 2); // 又进了缓存

  invalidatePage(site, 'a'); // Site 对象形态 + 页名
  await getPage(site, 'a');
  assert.equal(counts.pageGet, 3);

  invalidatePage(site, { name: 'a' }); // Page 对象形态
  await getPage(site, 'a');
  assert.equal(counts.pageGet, 4);
});

// ---------- 会话过期重试 ----------

test('会话过期：重登并只重试一次（第二次成功）', async () => {
  const stale = makeClient();
  const fresh = makeClient({ pages: { p: 'remote' } });
  // 旧客户端的 page.get 返回登录过期错误（WikidotResult 形态）
  stale.site.page.get = async () => err(new LoginRequiredError('需要登录'));

  let logins = 0;
  const clients = [stale.client, fresh.client];
  const factory = () => clients[logins++] ?? fresh.client;

  const page = await withSession(async (client) => {
    const site = await getSite(client, 'scp-cn');
    return getPage(site, 'p');
  }, { clientFactory: factory });

  assert.equal(logins, 2); // 第一次 + 过期后重登一次
  assert.equal(page.fullname, 'p');
});

test('会话过期：重试一次后仍失败 → 错误原样抛（不再重试）', async () => {
  let logins = 0;
  const factory = () => {
    logins++;
    const c = makeClient();
    c.site.page.get = async () => err(new LoginRequiredError('需要登录'));
    return c.client;
  };

  await assert.rejects(
    () => withSession(async (client) => {
      const site = await getSite(client, 'scp-cn');
      return getPage(site, 'p');
    }, { clientFactory: factory }),
    /获取页面失败/
  );
  assert.equal(logins, 2); // 初次 + 一次重试，不多不少
});

test('非会话错误：原样抛，不重登', async () => {
  let logins = 0;
  const factory = () => {
    logins++;
    const c = makeClient();
    c.client.site.get = async () => err(new Error('网络炸了'));
    return c.client;
  };
  await assert.rejects(
    () => withSession(async (client) => getSite(client, 'scp-cn'), { clientFactory: factory }),
    /获取站点失败/
  );
  assert.equal(logins, 1);
});

// ---------- 部署端到端 ----------

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

/** deploy 会打一堆进度日志，测试里静音 */
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

const rc = { source: 'index.ftml', templatesDir: 'templates', site: 'scp-cn', page: 'hello' };

test('连续两次 deploy：第二次 login 为 0、site 查询为 0、edit 为 0', async () => {
  const root = await makeGitFixture({
    '.ftmlrc.json': JSON.stringify(rc),
    'index.ftml': 'main\n',
  });
  try {
    await withHome(async () => {
      let logins = 0;
      const { client, counts } = makeClient({ pages: { hello: 'old' } });
      const factory = () => {
        logins++;
        return client;
      };

      await quiet(() => deploy(opts(root, { deps: false, clientFactory: factory })));
      const siteAfter1 = counts.site;
      const editCountAfter1 = counts.edit.length;
      assert.equal(logins, 1);
      assert.equal(editCountAfter1, 1);

      await quiet(() => deploy(opts(root, { deps: false, clientFactory: factory })));

      assert.equal(logins, 1);                       // 第二次 login 为 0
      assert.equal(counts.site, siteAfter1);         // 第二次 site 查询为 0
      assert.equal(counts.edit.length, editCountAfter1); // 内容未变化 → 不再 edit

      // publish-state.json 结构符合契约
      const state = JSON.parse(fs.readFileSync(path.join(root, '.ftml', 'publish-state.json'), 'utf8'));
      assert.equal(state.version, 1);
      const rec = state.pages['scp-cn:hello'];
      assert.ok(rec && typeof rec.hash === 'string' && rec.hash.length > 0);
      assert.equal(rec.revision, 1);
    });
  } finally {
    cleanup(root);
  }
});

test('未变化依赖页不产生 edit / create', async () => {
  const root = await makeGitFixture({
    '.ftmlrc.json': JSON.stringify(rc),
    'index.ftml': '[[include components/box]]\nmain\n',
    'components/box.ftml': 'box\n',
  });
  try {
    await withHome(async () => {
      const { client, counts, store } = makeClient({ pages: { hello: 'old' } });
      const factory = () => client;

      await quiet(() => deploy(opts(root, { clientFactory: factory })));
      assert.deepEqual(counts.create, ['components:box']);
      assert.deepEqual(counts.edit, ['hello']);

      await quiet(() => deploy(opts(root, { clientFactory: factory })));
      assert.deepEqual(counts.create, ['components:box'], '依赖页未变化不再建页');
      assert.deepEqual(counts.edit, ['hello'], '依赖页与入口页未变化不再 edit');
      assert.equal(store.get('components:box'), 'box\n');
      assert.equal(store.get('hello'), '[[include components:box]]\nmain\n');
    });
  } finally {
    cleanup(root);
  }
});

test('依赖页 edit 并发上限 3，写入不交叉', async () => {
  const files = {
    '.ftmlrc.json': JSON.stringify(rc),
    'index.ftml': '',
  };
  for (let i = 1; i <= 6; i++) {
    files['index.ftml'] += `[[include components/box-${i}]]\n`;
    files[`components/box-${i}.ftml`] = `box-${i}\n`;
  }
  files['index.ftml'] += 'main\n';
  const root = await makeGitFixture(files);
  try {
    await withHome(async () => {
      // 依赖页线上已存在 → upsert 走 edit 分支，才能测出 edit 并发；
      // （首次部署时依赖页不存在走 create，create 无延迟叠加不出并发）
      const remotePages = { hello: 'old' };
      for (let i = 1; i <= 6; i++) remotePages[`components:box-${i}`] = 'old';
      const { client, counts, store, stats } = makeDeployClient({ pages: remotePages });
      const factory = () => client;

      await quiet(() => deploy(opts(root, { clientFactory: factory })));

      assert.equal(stats().maxActive, 3, '并发上限正好是 3');
      assert.equal(counts.edit.length, 7, '6 个依赖页 + 1 个入口页都编辑了');
      for (let i = 1; i <= 6; i++) {
        assert.equal(store.get(`components:box-${i}`), `box-${i}\n`, '各页写入自己的源码，不交叉');
      }
      assert.equal(store.get('hello').includes('[[include components:box-1]]'), true);
    });
  } finally {
    cleanup(root);
  }
});

test('并发部署中某页编辑失败：错误原样上抛（不吞）', async () => {
  const files = {
    '.ftmlrc.json': JSON.stringify(rc),
    'index.ftml': '[[include components/box-1]]\n[[include components/box-2]]\n[[include components/box-3]]\nmain\n',
    'components/box-1.ftml': 'b1\n',
    'components/box-2.ftml': 'b2\n',
    'components/box-3.ftml': 'b3\n',
  };
  const root = await makeGitFixture(files);
  try {
    await withHome(async () => {
      // 依赖页线上已存在 → 走 edit 分支，box-2 的 edit 才会失败
      const remotePages = { hello: 'old', 'components:box-1': 'x', 'components:box-2': 'x', 'components:box-3': 'x' };
      const { client, settled } = makeDeployClient({ pages: remotePages, failEditFor: 'components:box-2' });
      const factory = () => client;

      // 整个用例（含收尾）都在静音作用域内：deploy 中止后池里在跑的编辑
      // 仍会落定并打日志，必须等它们结束、console 恢复之前收干——否则
      // 测试结束后的裸 stdout 写入会污染 node:test 父进程的报告帧，
      // CI 上表现为文件级 "Unable to deserialize cloned data due to
      // invalid or unsupported version"（uncaughtException）。
      await quiet(async () => {
        await assert.rejects(
          () => deploy(opts(root, { clientFactory: factory })),
          /boom editing components:box-2/
        );
        await settled();
        // edit 落定后，deploy 池任务还要经过数跳微任务（editPage →
        // upsertPageSource → 池函数）才打出「↑更新依赖页」日志，会比
        // settled() 的完成更晚；再让出一个宏任务，把这条微任务链整个
        // 冲进静音窗口，杜绝测试结束后的裸 stdout 写入。
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
    });
  } finally {
    cleanup(root);
  }
});
