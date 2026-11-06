/**
 * wikidot.ts — @ukwhatn/wikidot 封装
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
import type {
  Page,
  PageRevision,
  PageRevisionCollection,
  PageSource,
  Site,
  WikidotResult,
} from '@ukwhatn/wikidot';
import { getCredentials } from './credentials.js';
import { dirtToIdeal, idealToDirt } from '../compat/index.js';
import type { SourceText } from '../types/common.ts';
import type {
  ClientFactory,
  EditPageOptions,
  PushPageSourceOptions,
  PushPageSourceResult,
  UpsertPageSourceOptions,
  UpsertPageSourceResult,
} from '../types/infra/wikidot.ts';

function unwrap<T>(result: WikidotResult<T>, what: string): T {
  if (!result.isOk()) {
    throw new Error(`${what}失败: ${result.error}`);
  }
  return result.value;
}

/** client -> Map<siteName, Site>；client -> Map<`site/page`, Page> */
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

/** 创建已登录客户端（凭证来自 env 或 credentials 文件） */
export async function createClient(): Promise<Client> {
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
export async function getSite(client: Client, siteName: string | null | undefined): Promise<Site> {
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
export async function getPage(site: Site, pageName: string | null | undefined): Promise<Page | null> {
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
export async function editPage(page: Page, { source, comment }: EditPageOptions): Promise<void> {
  return unwrap(await page.edit({ source, comment }), '提交');
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

/**
 * 在同一登录会话里跑一组操作，最后统一关闭客户端。
 *
 * 发布依赖 + 入口页要依次写多个页面，若每个都自建客户端就会重复登录 N 次；
 * 这里把生命周期收拢到一处（注入的 clientFactory 产出的客户端同样关闭，
 * web 测试注入的 fake client 的 close 是空实现）。
 *
 * @param clientFactory 客户端工厂（测试注入用）
 * @param fn
 */
export async function withClient<T>(
  clientFactory: ClientFactory | undefined,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const client = await (clientFactory || createClient)();
  try {
    return await fn(client);
  } finally {
    await client.close?.();
  }
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
 * 客户端生命周期：传了 `client` 就用调用方的（不关闭，便于一次登录写多个页面）；
 * 否则自建（或走 clientFactory）用完即关。
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
  return withClient(clientFactory, (c) => pushWithClient(c, args));
}

/**
 * 写一个页面：存在则覆盖，不存在则**新建**（发布依赖页用）。
 *
 * 与 pushPageSource 的区别只在「页面不存在」的处理：pushPageSource 直接报错
 * （避免误建正页），这里则建页——依赖页第一次发布时线上通常还不存在。
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
  return {
    created: true,
    revisionsCount: 1,
    compat: { changed: compat.changed, changes: compat.changes, diagnostics: compat.diagnostics },
  };
}
