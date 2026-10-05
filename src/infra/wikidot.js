/**
 * wikidot.js — @ukwhatn/wikidot 封装
 *
 * 提供登录客户端创建、站点/页面获取、提交、拉取版本等操作，
 * 统一把 WikidotResult 错误转成抛出的 Error。
 *
 * site/page 缓存：按客户端实例（WeakMap）缓存已获取的 Site / Page 对象，
 * 同一客户端生命周期内重复 getSite/getPage 不再发网络请求（submit/deploy
 * 在同一进程里多次提交时直接复用）。以客户端为键而非全局，避免 client.close()
 * 登出后复用旧会话对象；null（页面不存在）不缓存，防止同进程建页后误判。
 */

import { Client } from '@ukwhatn/wikidot';
import { getCredentials } from './credentials.js';
import { dirtToIdeal, idealToDirt } from '../compat/index.js';

function unwrap(result, what) {
  if (!result.isOk()) {
    throw new Error(`${what}失败: ${result.error}`);
  }
  return result.value;
}

/** client -> Map<siteName, Site>；client -> Map<`site/page`, Page> */
const siteCache = new WeakMap();
const pageCache = new WeakMap();

function cacheGet(map, client, key) {
  const byClient = map.get(client);
  if (byClient) return byClient.get(key);
  return undefined;
}

function cacheSet(map, client, key, value) {
  let byClient = map.get(client);
  if (!byClient) {
    byClient = new Map();
    map.set(client, byClient);
  }
  byClient.set(key, value);
}

/** 创建已登录客户端（凭证来自 env 或 credentials 文件） */
export async function createClient() {
  const creds = getCredentials();
  if (!creds) {
    throw new Error(
      '未找到 Wikidot 凭证。请先运行 `ftml login` 或设置环境变量 WIKIDOT_USERNAME / WIKIDOT_PASSWORD'
    );
  }
  const result = await Client.create({
    username: creds.username,
    password: creds.password,
  });
  if (!result.isOk()) {
    throw new Error(`登录失败: ${result.error}`);
  }
  return result.value;
}

/** 获取站点对象（同一客户端内缓存，重复获取不发请求） */
export async function getSite(client, siteName) {
  if (!siteName) {
    throw new Error('缺少站点名。请在配置文件中设置 site 或使用 --site 选项');
  }
  const cached = cacheGet(siteCache, client, siteName);
  if (cached !== undefined) return cached;
  const site = unwrap(await client.site.get(siteName), '获取站点');
  cacheSet(siteCache, client, siteName, site);
  return site;
}

/**
 * 获取页面对象（不存在时返回 null，null 不缓存）
 * 同一客户端内按 `site/page` 缓存。
 */
export async function getPage(site, pageName) {
  if (!pageName) {
    throw new Error('缺少页面名。请在配置文件中设置 page 或使用 --page 选项');
  }
  const key = `${site.unixName}/${pageName}`;
  const cached = cacheGet(pageCache, site.client, key);
  if (cached !== undefined) return cached;
  const page = unwrap(await site.page.get(pageName), '获取页面');
  if (page) cacheSet(pageCache, site.client, key, page);
  return page;
}

/** 编辑页面：source 为完整 FTML 源码，comment 为编辑注释 */
export async function editPage(page, { source, comment }) {
  return unwrap(await page.edit({ source, comment }), '提交');
}

/**
 * 拉取页面当前源码（读取边界：Wikidot 脏源码 → 理想 FTML）。
 * 线上源码是 Wikidot 宽松语法，进入本地管线前先规范化，避免 wdpr 误判未闭合块。
 */
export async function fetchPageSource(page) {
  const src = unwrap(await page.getSource(), '读取页面源码');
  const raw = typeof src === 'string' ? src : src.wikiText ?? ''; // PageSource 对象：源码在 wikiText 字段
  return dirtToIdeal(raw).src;
}

/** 列出页面修订历史（最新在前） */
export async function fetchRevisions(page) {
  const coll = unwrap(await page.getRevisions(), '获取修订历史');
  return coll.items ?? coll ?? [];
}

/** 拉取某个修订的源码（读取边界，同样规范化为理想 FTML） */
export async function fetchRevisionSource(rev) {
  const src = unwrap(await rev.getSource(), '读取修订源码');
  const raw = typeof src === 'string' ? src : src.wikiText ?? '';
  return dirtToIdeal(raw).src;
}

/** 把页面回退到某个修订 */
export async function revertPage(rev) {
  return unwrap(await rev.revert(), '回退');
}

/**
 * 用源码覆盖线上页面（提交/部署/回退共用）。
 *
 * 写入边界：入库的源码是理想 FTML，提交前经 idealToDirt 保证 Wikidot 可解析
 * （合法理想源上是恒等变换；只有未闭合行内标签会被补全）。修复记录随返回值
 * 一并给出，供上层提示。
 *
 * 负责客户端生命周期：自己创建的客户端自己关闭；注入的 clientFactory
 * 产生的客户端同样关闭（web 测试注入的 fake client 的 close 是空实现）。
 *
 * @param {object} opts
 * @param {string} opts.siteName
 * @param {string} opts.pageName
 * @param {string} opts.source 要写入的完整 FTML 源码（理想形态）
 * @param {string} opts.comment 编辑注释
 * @param {Function} [opts.clientFactory] 客户端工厂（测试注入用）
 * @returns {Promise<{ revisionsCount: number, compat: { changed: boolean, changes: Array, diagnostics: Array } }>}
 */
export async function pushPageSource({ siteName, pageName, source, comment, clientFactory }) {
  if (!siteName || !pageName) {
    throw new Error('缺少 site/page，无法提交 Wikidot。请配置或在命令行指定 --site/--page');
  }
  const compat = idealToDirt(source);
  const client = await (clientFactory || createClient)();
  try {
    const site = await getSite(client, siteName);
    const page = await getPage(site, pageName);
    if (!page) {
      throw new Error(`页面不存在: ${pageName}。请先创建页面再提交`);
    }
    await editPage(page, { source: compat.src, comment });
    return { revisionsCount: page.revisionsCount, compat: { changed: compat.changed, changes: compat.changes, diagnostics: compat.diagnostics } };
  } finally {
    await client.close?.();
  }
}
