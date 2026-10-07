/**
 * helpers/fake-wikidot.js — 离线假 Wikidot 客户端
 *
 * @ukwhatn/wikidot 的返回值统一是 { isOk(), value | error }，这里按同样的形状
 * 造桩，把 deploy/revert/render 的远程分支从网络里解放出来。
 */

/**
 * 可远程取页面的 client（render 的 include 回退用）。
 * @param {Record<string, { getSource: () => Promise<{isOk: () => boolean, value: string}> }>} pages
 */
export function fakeRemoteClient(pages) {
  const site = {
    unixName: 'remote',
    client: null,
    page: {
      get: async (name) => {
        const p = pages[name];
        return { isOk: () => true, value: p ?? null };
      },
    },
  };
  const client = {
    site: {
      get: async () => ({ isOk: () => true, value: site }),
    },
  };
  site.client = client;
  return client;
}

/** 可计数的 client/site/page，用于验证 getSite/getPage 按客户端复用缓存 */
export function fakeWorld() {
  let siteCalls = 0;
  let pageCalls = 0;
  const page = { name: 'test', fullname: 'test', title: 'T' };
  const site = {
    unixName: 'mysite',
    client: null, // 下面填
    page: {
      get: async () => {
        pageCalls++;
        return { isOk: () => true, value: page };
      },
    },
  };
  const client = {
    site: {
      get: async () => {
        siteCalls++;
        return { isOk: () => true, value: site };
      },
    },
  };
  site.client = client;
  return { client, site, counts: () => ({ siteCalls, pageCalls }) };
}

/**
 * deploy/revert 注入用的客户端：page.edit 只计数不发请求。
 * @param {{ pageExists?: boolean, revisionsCount?: number }} [opts]
 */
export function fakeDeployClient({ pageExists = true, revisionsCount = 7 } = {}) {
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

/**
 * 多页面假站点：按页名 get、支持 create（建页），记录 edit/create 的页名顺序。
 *
 * 发布依赖闭包要在一次会话里写多个页面，且首次发布时依赖页线上通常还不存在
 * （走 upsertPageSource 的建页分支）。fakeDeployClient 只会返回同一个页，
 * 覆盖不了这两点，故单独造一个。
 *
 * @param {Record<string, string>} [pages] 初始线上源码（页名 → 源码）
 * @returns {{ client, site, calls: { edit: string[], create: string[] }, store: Map<string,string> }}
 */
export function fakeMultiPageClient(pages = {}) {
  const store = new Map(Object.entries(pages));
  const calls = { edit: [], create: [] };

  const makePage = (name) => ({
    name,
    fullname: name,
    revisionsCount: 1,
    edit: async ({ source } = {}) => {
      calls.edit.push(name);
      store.set(name, source);
      return { isOk: () => true, value: { revisionsCount: 1 } };
    },
  });

  const site = {
    unixName: 'scp-cn',
    client: null,
    page: {
      get: async (name) => ({ isOk: () => true, value: store.has(name) ? makePage(name) : null }),
      create: async (name, { source } = {}) => {
        calls.create.push(name);
        store.set(name, source ?? '');
        return { isOk: () => true, value: undefined };
      },
    },
  };
  const client = {
    site: { get: async () => ({ isOk: () => true, value: site }) },
    close: async () => {},
  };
  site.client = client;
  return { client, site, calls, store };
}
