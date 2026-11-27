/**
 * wikidot.ts — @ukwhatn/wikidot 封装
 *
 * 提供登录客户端获取、站点/页面获取、提交、拉取版本等操作，
 * 统一把 WikidotResult 错误转成抛出的 Error（保留原始错误到 cause，
 * 供会话层识别 SessionError / LoginRequiredError 触发重登重试）。
 *
 * site/page 缓存分两层：
 *   - 会话客户端（src/infra/session.ts 的单例）：走会话级 TTL 缓存
 *     （Site 10 分钟 / Page 2 分钟），跨操作复用，edit/create 后立即失效；
 *   - 注入 / 临时客户端：按客户端实例（WeakMap）缓存，同一客户端生命周期内
 *     重复 getSite/getPage 不再发网络请求；null（页面不存在）不缓存，
 *     防止同进程建页后误判。
 *
 * 客户端生命周期统一收口在会话层（withSession）：操作结束不 close，
 * CLI 命令结束 / server 关闭 / Electron 退出时由 resetSession / disposeSession
 * 统一收尾。
 */

import type {
  Client,
  Page,
  PageRevision,
  PageRevisionCollection,
  PageSource,
  Site,
  WikidotResult,
} from '@ukwhatn/wikidot';
import { dirtToIdeal, idealToDirt } from '../compat/index.js';
import {
  invalidatePage,
  isSessionClient,
  sessionCacheGetPage,
  sessionCacheGetSite,
  sessionCacheSetPage,
  sessionCacheSetSite,
  withSession,
} from './session.js';
import type { SourceText } from '../types/common.ts';
import type {
  ClientFactory,
  EditPageOptions,
  PushPageSourceOptions,
  PushPageSourceResult,
  UpsertPageSourceOptions,
  UpsertPageSourceResult,
} from '../types/infra/wikidot.ts';

/** unwrap 包装错误：消息格式与旧实现一致，原始错误保留在 cause（会话层识别用） */
export class WikidotOperationError extends Error {
  constructor(what: string, cause: unknown) {
    super(`${what}失败: ${String(cause)}`);
    this.name = 'WikidotOperationError';
    this.cause = cause;
  }
}

function unwrap<T>(result: WikidotResult<T>, what: string): T {
  if (!result.isOk()) {
    throw new WikidotOperationError(what, result.error);
  }
  return result.value;
}

/** client -> Map<siteName, Site>；client -> Map<`site/page`, Page>（非会话客户端用） */
const siteCache = new WeakMap<Client, Map<string, Site>>();
const pageCache = new WeakMap<Client, Map<string, Page>>();

function cacheGet<T>(map: WeakMap<Client, Map<string, T>>, client: Client, key: string): T | undefined {
  const byClient = map.get(client);
  if (byClient) return byClient.get(key);
  return undefined;
}

function cacheSet<T>(map: WeakMap<Client, Map<string, T>>, client: Client, key: string, value: T): void {
  let byClient = map.get(client);
  if (!byClient) {
    byClient = new Map();
    map.set(client, byClient);
  }
  byClient.set(key, value);
}

/** 获取站点对象（会话客户端走 TTL 缓存，注入客户端按实例缓存，重复获取不发请求） */
export async function getSite(client: Client, siteName: string | null | undefined): Promise<Site> {
  if (!siteName) {
    throw new Error('缺少站点名。请在配置文件中设置 site 或使用 --site 选项');
  }
  const sessionHit = sessionCacheGetSite(client, siteName);
  if (sessionHit !== undefined) return sessionHit;
  if (!isSessionClient(client)) {
    const cached = cacheGet(siteCache, client, siteName);
    if (cached !== undefined) return cached;
  }
  const site = unwrap(await client.site.get(siteName), '获取站点');
  if (isSessionClient(client)) sessionCacheSetSite(client, siteName, site);
  else cacheSet(siteCache, client, siteName, site);
  return site;
}

/**
 * 获取页面对象（不存在时返回 null，null 不缓存）
 * 会话客户端按 `site/page` 走 TTL 缓存；注入客户端按实例缓存。
 */
export async function getPage(site: Site, pageName: string | null | undefined): Promise<Page | null> {
  if (!pageName) {
    throw new Error('缺少页面名。请在配置文件中设置 page 或使用 --page 选项');
  }
  const key = `${site.unixName}/${pageName}`;
  if (isSessionClient(site.client)) {
    const hit = sessionCacheGetPage(site.client, key);
    if (hit !== undefined) return hit;
  } else {
    const cached = cacheGet(pageCache, site.client, key);
    if (cached !== undefined) return cached;
  }
  const page = unwrap(await site.page.get(pageName), '获取页面');
  if (page) {
    if (isSessionClient(site.client)) sessionCacheSetPage(site.client, key, page);
    else cacheSet(pageCache, site.client, key, page);
  }
  return page;
}

/**
 * 并行预取多个页面（部署依赖页预取用）。
 * 会话客户端下命中 TTL 缓存则零请求；null（不存在）不进缓存。
 */
export async function prefetchPages(
  site: Site,
  pageNames: readonly string[],
): Promise<Map<string, Page | null>> {
  const entries = await Promise.all(
    pageNames.map(async (name) => [name, await getPage(site, name)] as const)
  );
  return new Map(entries);
}

/** 编辑页面：source 为完整 FTML 源码，comment 为编辑注释；成功后立即失效该页缓存 */
export async function editPage(page: Page, { source, comment }: EditPageOptions): Promise<void> {
  await unwrap(await page.edit({ source, comment }), '提交');
  // Page.edit 不会更新 revisionsCount（库实现如此），缓存里的旧对象已不可信。
  // site 引用缺失（测试桩页面）时跳过失效——那只影响缓存新鲜度，不影响正确性。
  const siteUnixName = page.site?.unixName;
  if (siteUnixName) invalidatePage(siteUnixName, page.name);
}

/**
 * 拉取页面当前源码（读取边界：Wikidot 脏源码 → 理想 FTML）。
 * 线上源码是 Wikidot 宽松语法，进入本地管线前先规范化，避免 wdpr 误判未闭合块。
 */
export async function fetchPageSource(page: Page): Promise<string> {
  const src = unwrap<PageSource | string>(await page.getSource(), '读取页面源码');
  const raw = typeof src === 'string' ? src : src.wikiText ?? ''; // PageSource 对象：源码在 wikiText 字段
  return dirtToIdeal(raw).src;
}

/** 列出页面修订历史（最新在前） */
export async function fetchRevisions(page: Page): Promise<PageRevision[]> {
  const coll = unwrap<PageRevisionCollection>(await page.getRevisions(), '获取修订历史');
  // 兼容旧版 WikidotResultCollection 形状（带 items 字段）
  return (coll as PageRevisionCollection & { items?: PageRevision[] }).items ?? coll ?? [];
}

/** 拉取某个修订的源码（读取边界，同样规范化为理想 FTML） */
export async function fetchRevisionSource(rev: PageRevision): Promise<string> {
  const src = unwrap<PageSource | string>(await rev.getSource(), '读取修订源码');
  const raw = typeof src === 'string' ? src : src.wikiText ?? '';
  return dirtToIdeal(raw).src;
}

/** 把页面回退到某个修订 */
export async function revertPage(rev: PageRevision): Promise<Record<string, unknown>> {
  return unwrap(await rev.revert(), '回退');
}

interface PushWithClientArgs {
  siteName: string;
  pageName: string;
  source: SourceText;
  comment: string;
}

/** 用源码覆盖线上页面（提交/部署/回退共用）。client 由调用方提供，不负责关闭。 */
async function pushWithClient(client: Client, { siteName, pageName, source, comment }: PushWithClientArgs): Promise<PushPageSourceResult> {
  const compat = idealToDirt(source);
  const site = await getSite(client, siteName);
  const page = await getPage(site, pageName);
  if (!page) {
    throw new Error(`页面不存在: ${pageName}。请先创建页面再提交`);
  }
  await editPage(page, { source: compat.src, comment });
  return {
    revisionsCount: page.revisionsCount,
    compat: { changed: compat.changed, changes: compat.changes, diagnostics: compat.diagnostics },
  };
}

/**
 * 用源码覆盖线上页面（提交/部署/回退共用）。
 *
 * 写入边界：入库的源码是理想 FTML，提交前经 idealToDirt 保证 Wikidot 可解析
 * （合法理想源上是恒等变换；只有未闭合行内标签会被补全）。修复记录随返回值
 * 一并给出，供上层提示。
 *
 * 客户端生命周期：传了 `client` 就用调用方的（不关闭）；否则走会话层
 * （withSession：凭证单例或注入的 clientFactory，操作结束不 close，
 * 会话过期自动重登并只重试一次）。
 */
export async function pushPageSource({
  siteName,
  pageName,
  source,
  comment,
  client,
  clientFactory,
}: PushPageSourceOptions): Promise<PushPageSourceResult> {
  if (!siteName || !pageName) {
    throw new Error('缺少 site/page，无法提交 Wikidot。请配置或在命令行指定 --site/--page');
  }
  const args: PushWithClientArgs = { siteName, pageName, source, comment };
  if (client) return pushWithClient(client, args);
  return withSession((c) => pushWithClient(c, args), { clientFactory });
}

/**
 * 写一个页面：存在则覆盖，不存在则**新建**（发布依赖页用）。
 *
 * 与 pushPageSource 的区别只在「页面不存在」的处理：pushPageSource 直接报错
 * （避免误建正页），这里则建页——依赖页第一次发布时线上通常还不存在。
 * 写入成功后立即失效该页缓存。
 */
export async function upsertPageSource({
  site,
  pageName,
  source,
  comment,
}: UpsertPageSourceOptions): Promise<UpsertPageSourceResult> {
  const compat = idealToDirt(source);
  const page = await getPage(site, pageName);
  if (page) {
    await editPage(page, { source: compat.src, comment });
    return {
      created: false,
      revisionsCount: page.revisionsCount,
      compat: { changed: compat.changed, changes: compat.changes, diagnostics: compat.diagnostics },
    };
  }
  // 建页：createOrEdit 未带 pageId，对已存在页面会报错——这里已确认不存在，正合适
  unwrap(await site.page.create(pageName, { source: compat.src, comment }), '创建页面');
  invalidatePage(site.unixName, pageName);
  return {
    created: true,
    revisionsCount: 1,
    compat: { changed: compat.changed, changes: compat.changes, diagnostics: compat.diagnostics },
  };
}
