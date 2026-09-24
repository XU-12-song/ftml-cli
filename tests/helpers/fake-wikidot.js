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
