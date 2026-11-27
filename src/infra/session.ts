/**
 * session.ts — 进程内 Wikidot 会话复用（CLI / Web / Electron 统一语义）
 *
 * 解决的问题：此前每次 render/deploy 都 `createClient()` + 用完 `close()`，
 * close 会发 logout；site/page 缓存以 client 为键（WeakMap），client 一关缓存
 * 全失效——每次操作都重复「登录 + User.fromName + getSite + getPage」。
 *
 * 设计：
 *   - 单例：按凭证指纹（username + domain）复用同一个已登录 client，并发调用
 *     共享同一个 in-flight promise，只登录一次；
 *   - 注入：`injectClient` / `clientFactory` 绕过单例（不拥有、不关闭）；
 *     同一工厂引用的产出客户端同样复用（连续两次 deploy 第二次登录为 0）；
 *   - 缓存：Site（TTL 10 分钟）与 Page（TTL 2 分钟）随会话缓存，TTL 内重复
 *     getSite/getPage 不发请求；null（页面不存在）不缓存；edit/create 后立即失效；
 *   - 过期：操作抛出 SessionError / LoginRequiredError 时丢弃会话重新登录，
 *     只重试一次，其他错误原样抛；
 *   - 生命周期：会话只在内存中，不落盘、不持久化 cookie。CLI 命令结束可
 *     dispose 自己拥有的会话；Web/Electron 保持单例到 server 关闭 / 进程退出。
 *
 * 缓存的协作方式：wikidot.ts 的 getSite/getPage 对「会话客户端」走这里的
 * TTL 缓存，对注入/临时客户端仍走原有的按 client WeakMap 缓存，两层互不干扰。
 */

import { Client, SessionError } from '@ukwhatn/wikidot';
import type { Page, Site } from '@ukwhatn/wikidot';

import { getCredentials } from './credentials.js';
import type { Credentials } from '../types/infra/credentials.ts';
import type { ClientFactory } from '../types/infra/wikidot.ts';
import type { SessionOptions } from '../types/infra/session.ts';

/** Site 缓存 TTL（随会话，10 分钟） */
export const SITE_TTL_MS = 10 * 60_000;
/** Page 缓存 TTL（随会话，2 分钟） */
export const PAGE_TTL_MS = 2 * 60_000;

/** Client.create 未显式传 domain 时的默认站点域（与 @ukwhatn/wikidot 默认一致） */
const DEFAULT_DOMAIN = 'wikidot.com';
/** cause 链上追溯 SessionError 的最大深度（防循环引用） */
const CAUSE_CHAIN_DEPTH = 5;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/** 会话槽：整个进程复用同一份（CLI 单命令一个会话；Web/Electron 到进程退出） */
interface SessionState {
  client: Client | null;
  /** 是否拥有该 client（拥有者才会在 reset/dispose 时 close） */
  owned: boolean;
  /** 凭证指纹（`user@domain`）或工厂指纹（`factory#n`） */
  fingerprint: string | null;
  /** 产出当前 client 的工厂引用（工厂路径复用判断用） */
  factoryKey: ClientFactory | null;
  /** in-flight 登录/工厂解析（并发去重） */
  inflight: Promise<Client> | null;
  inflightFp: string | null;
  /** Site TTL 缓存：siteName -> entry */
  sites: Map<string, CacheEntry<Site>>;
  /** Page TTL 缓存：`<unixName>/<pageName>` -> entry */
  pages: Map<string, CacheEntry<Page>>;
}

function freshState(): SessionState {
  return {
    client: null,
    owned: false,
    fingerprint: null,
    factoryKey: null,
    inflight: null,
    inflightFp: null,
    sites: new Map(),
    pages: new Map(),
  };
}

let state: SessionState = freshState();

/** 时钟可注入（测试假时钟）；默认系统时间 */
let clock: () => number = () => Date.now();
/** 测试可替换单例登录步骤（返回 fake client）；默认 Client.create + 凭证 */
let loginFactoryForTests: (() => Promise<Client>) | null = null;

/** 仅供测试：注入假时钟（返回毫秒时间戳），传 null 还原系统时钟 */
export function setSessionClockForTests(fn: (() => number) | null): void {
  clock = fn ?? ((): number => Date.now());
}

/** 仅供测试：替换单例的登录步骤（返回假客户端），传 null 还原真实登录 */
export function setLoginFactoryForTests(fn: (() => Promise<Client>) | null): void {
  loginFactoryForTests = fn;
}

const factoryIds = new WeakMap<ClientFactory, string>();
let factorySeq = 0;

/** 工厂指纹：同一函数引用 → 同一 id，用于「同一工厂只解析一次」 */
function factoryFingerprint(factory: ClientFactory): string {
  let id = factoryIds.get(factory);
  if (!id) {
    id = `factory#${++factorySeq}`;
    factoryIds.set(factory, id);
  }
  return id;
}

function credentialsFingerprint(creds: Credentials): string {
  return `${creds.username}@${DEFAULT_DOMAIN}`;
}

/** 换绑客户端：同一 client 对象仅更新元数据（保留缓存）；换了对象则清缓存 */
function setSessionClient(
  client: Client,
  meta: { owned: boolean; fingerprint: string; factoryKey: ClientFactory | null },
): void {
  if (state.client === client) {
    state.owned = meta.owned;
    state.fingerprint = meta.fingerprint;
    state.factoryKey = meta.factoryKey;
    return;
  }
  if (state.client && state.owned) {
    // 旧会话是自己登录的才 logout；注入/工厂来的客户端不拥有、不关闭
    void Promise.resolve(state.client.close?.()).catch(() => {});
  }
  state.client = client;
  state.owned = meta.owned;
  state.fingerprint = meta.fingerprint;
  state.factoryKey = meta.factoryKey;
  state.sites.clear();
  state.pages.clear();
}

function clearInflight(fp: string): void {
  if (state.inflightFp === fp) {
    state.inflight = null;
    state.inflightFp = null;
  }
}

/** 工厂路径：调用工厂产出客户端（并发共享同一 in-flight），不拥有、不关闭 */
function resolveFactory(factory: ClientFactory, fp: string): Promise<Client> {
  const p = (async (): Promise<Client> => {
    try {
      const client = await factory();
      clearInflight(fp);
      setSessionClient(client, { owned: false, fingerprint: fp, factoryKey: factory });
      return client;
    } catch (e) {
      clearInflight(fp);
      throw e;
    }
  })();
  state.inflight = p;
  state.inflightFp = fp;
  return p;
}

/** 凭证路径：登录一次（并发共享同一 in-flight），client 由会话层拥有 */
function loginWithCredentials(creds: Credentials, fp: string): Promise<Client> {
  const p = (async (): Promise<Client> => {
    try {
      let client: Client;
      if (loginFactoryForTests) {
        client = await loginFactoryForTests();
      } else {
        const result = await Client.create({ username: creds.username, password: creds.password });
        if (!result.isOk()) throw new Error(`登录失败: ${result.error}`);
        client = result.value;
      }
      clearInflight(fp);
      setSessionClient(client, { owned: true, fingerprint: fp, factoryKey: null });
      return client;
    } catch (e) {
      clearInflight(fp);
      throw e;
    }
  })();
  state.inflight = p;
  state.inflightFp = fp;
  return p;
}

/**
 * 取当前会话客户端。
 *   - injectClient：直接返回（绕过单例与缓存，不拥有、不关闭）；
 *   - clientFactory：按工厂指纹复用（同一工厂只调用一次，并发共享 in-flight）；
 *   - 都不传：按凭证指纹（username + domain）单例，登录只发生一次；
 *     凭证变化（指纹不同）时自动重建会话。
 */
export async function getClient(opts: SessionOptions = {}): Promise<Client> {
  if (opts.injectClient) return opts.injectClient;

  if (opts.clientFactory) {
    const fp = factoryFingerprint(opts.clientFactory);
    if (state.client && state.fingerprint === fp) return state.client;
    if (state.inflight && state.inflightFp === fp) return state.inflight;
    return resolveFactory(opts.clientFactory, fp);
  }

  const creds = getCredentials();
  if (!creds) {
    throw new Error(
      '未找到 Wikidot 凭证。请先运行 `ftml login` 或设置环境变量 WIKIDOT_USERNAME / WIKIDOT_PASSWORD'
    );
  }
  const fp = credentialsFingerprint(creds);
  if (state.client && state.fingerprint === fp) return state.client;
  if (state.inflight && state.inflightFp === fp) return state.inflight;
  return loginWithCredentials(creds, fp);
}

/** 判断 e（沿 cause 链）是否为会话过期类错误（SessionError / LoginRequiredError） */
export function isSessionError(e: unknown): boolean {
  for (
    let cur: unknown = e, depth = 0;
    cur != null && typeof cur === 'object' && depth < CAUSE_CHAIN_DEPTH;
    cur = (cur as { cause?: unknown }).cause, depth++
  ) {
    if (cur instanceof SessionError) return true;
  }
  return false;
}

/**
 * 在同一会话里跑一组操作，操作结束不 close。
 *
 * 会话过期（SessionError / LoginRequiredError）：丢弃当前会话与缓存、重新登录
 * （工厂路径即重新调用工厂）并只重试一次；再失败或非会话错误原样抛。
 * injectClient 无法重登，会话错误也原样抛。
 */
export async function withSession<T>(
  fn: (client: Client) => Promise<T>,
  opts: SessionOptions = {},
): Promise<T> {
  const client = await getClient(opts);
  try {
    return await fn(client);
  } catch (e) {
    if (opts.injectClient || !isSessionError(e)) throw e;
    dropSession();
    const fresh = await getClient(opts);
    return await fn(fresh); // 只重试一次
  }
}

/** 丢弃当前会话与全部缓存；自己拥有的 client 才 close（尽力而为，不阻断） */
function dropSession(): void {
  if (state.client && state.owned) {
    void Promise.resolve(state.client.close?.()).catch(() => {});
  }
  state = freshState();
}

/**
 * 重置会话：登录命令、凭证变化时调用。
 * 关闭自己拥有的客户端（logout），丢弃 site/page 缓存；工厂/注入的客户端不动。
 */
export async function resetSession(): Promise<void> {
  dropSession();
}

/**
 * 释放会话：server 关闭 / Electron 退出时调用（CLI 亦可在命令结束时调用）。
 * 与 resetSession 的差异只在语义：这是进程收尾，不等待 logout 完成。
 */
export async function disposeSession(): Promise<void> {
  dropSession();
}

function cacheGet<T>(map: Map<string, CacheEntry<T>>, key: string): T | undefined {
  const hit = map.get(key);
  if (!hit) return undefined;
  if (clock() >= hit.expiresAt) {
    map.delete(key);
    return undefined;
  }
  return hit.value;
}

function cacheSet<T>(map: Map<string, CacheEntry<T>>, key: string, value: T, ttl: number): void {
  map.set(key, { value, expiresAt: clock() + ttl });
}

/** 该 client 是否为当前会话客户端（只有它享受会话级 TTL 缓存） */
export function isSessionClient(client: Client): boolean {
  return state.client === client && client != null;
}

export function sessionCacheGetSite(client: Client, siteName: string): Site | undefined {
  if (!isSessionClient(client)) return undefined;
  return cacheGet(state.sites, siteName);
}

export function sessionCacheSetSite(client: Client, siteName: string, site: Site): void {
  if (!isSessionClient(client)) return;
  cacheSet(state.sites, siteName, site, SITE_TTL_MS);
}

/** key 与 wikidot.getPage 一致：`<unixName>/<pageName>` */
export function sessionCacheGetPage(client: Client, key: string): Page | undefined {
  if (!isSessionClient(client)) return undefined;
  return cacheGet(state.pages, key);
}

export function sessionCacheSetPage(client: Client, key: string, page: Page): void {
  if (!isSessionClient(client)) return;
  cacheSet(state.pages, key, page, PAGE_TTL_MS);
}

/** 手动失效一个 Site 的会话缓存（site 可传站名或 Site 对象） */
export function invalidateSite(site: string | { readonly unixName: string }): void {
  const name = typeof site === 'string' ? site : site.unixName;
  state.sites.delete(name);
}

/** 手动失效一个 Page 的会话缓存（edit / create 后由 wikidot 层自动调用） */
export function invalidatePage(
  site: string | { readonly unixName: string },
  page: string | { readonly name: string },
): void {
  const s = typeof site === 'string' ? site : site.unixName;
  const p = typeof page === 'string' ? page : page.name;
  state.pages.delete(`${s}/${p}`);
}
