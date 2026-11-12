/**
 * module-css.ts — 把 [[module CSS]] 里的远程 @import 本地化
 *
 * Wikidot 组件常用 `[[module CSS]] @import url(...) [[/module]]` 引入组件样式。
 * 预览时如果直接把这些 @import 交给浏览器：
 *   1. 多个 module CSS 块拼接后，@import 可能落在规则之后 —— CSS 规范要求
 *      @import 必须在所有规则之前，否则整条被忽略（“有时不加载”的主因）；
 *   2. 样式表在 *.wdfiles.com，网络不可达/慢时每次打开都取不到。
 *
 * 这里复用主题缓存（theme.ts）：
 *   - 已缓存的 @import 直接展开成实际规则（离线可用）；
 *   - 未缓存的保留为 @import，并统一提升到样式表最前面（保证语法有效），
 *     同时后台抓取，下一次渲染就能内联；
 *   - 抓取失败记入 failures，由 render handler 转成 toast。
 */

import {
  getThemeRefreshFailure,
  readThemeCss,
  refreshThemeCss,
  refreshThemeCssInBackground,
} from './theme.js';
import type { FetchLike } from '../types/render/theme.ts';

const ABSOLUTE_REF = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i;
const IMPORT_RE = /@import\s+(?:url\(\s*(['"]?)([^'")]+)\1\s*\)|(['"])([^'"]+)\3)([^;]*);/gi;

export interface ModuleCssFailure {
  url: string;
  message: string;
}

export interface ModuleCssResult {
  css: string;
  failures: ModuleCssFailure[];
}

interface LocalizedOnce {
  css: string;
  pending: string[];
  failures: Map<string, string>;
}

export interface LocalizeModuleCssOptions {
  /** 相对 @import 的解析基准（一般为目标站点 origin） */
  baseUrl: string;
  fetchImpl?: FetchLike;
  /** 手动重试：忽略失败记忆，重新联网抓取 */
  force?: boolean;
  /** 首次遇到未缓存样式时最多等多久拿结果 */
  waitMs?: number;
}

function toAbsolute(ref: string, baseUrl: string): string | null {
  if (!ref) return null;
  if (ref.startsWith('//')) return `https:${ref}`;
  if (ABSOLUTE_REF.test(ref)) return ref;
  try {
    return new URL(ref, baseUrl).href;
  } catch {
    return null;
  }
}

function delay(ms: number): Promise<null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    if (typeof timer === 'object' && typeof timer.unref === 'function') timer.unref();
  });
}

/** 所有 @import 的绝对地址（去重），用于手动强制刷新 */
function collectImportUrls(blocks: string[], baseUrl: string): string[] {
  const out = new Set<string>();
  for (const block of blocks) {
    IMPORT_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = IMPORT_RE.exec(String(block ?? ''))) !== null) {
      const abs = toAbsolute((m[2] ?? m[4] ?? '').trim(), baseUrl);
      if (abs) out.add(abs);
    }
  }
  return [...out];
}

function localizeOnce(
  blocks: string[],
  baseUrl: string,
  fetchImpl: FetchLike
): LocalizedOnce {
  const imports: string[] = [];
  const bodies: string[] = [];
  const pending = new Set<string>();
  const failures = new Map<string, string>();

  for (const block of blocks) {
    const text = String(block ?? '');
    let last = 0;
    let body = '';
    IMPORT_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = IMPORT_RE.exec(text)) !== null) {
      body += text.slice(last, m.index);
      last = m.index + m[0].length;

      const ref = (m[2] ?? m[4] ?? '').trim();
      const media = (m[5] || '').trim();
      const abs = toAbsolute(ref, baseUrl);
      if (!abs) continue; // 解析不了：丢弃该条

      const cached = readThemeCss({ sources: [abs] });
      if (cached.css) {
        body += media ? `@media ${media}{${cached.css}}` : cached.css;
        if (cached.stale) refreshThemeCssInBackground({ sources: [abs], fetchImpl });
        continue;
      }

      // 未命中缓存：保留 @import，并统一提升到最前面
      imports.push(media ? `@import url("${abs}") ${media};` : `@import url("${abs}");`);
      const failure = getThemeRefreshFailure([abs]);
      if (failure) failures.set(abs, failure);
      else pending.add(abs);
    }
    body += text.slice(last);
    bodies.push(body);
  }

  // @import 必须在所有规则之前；保留的未缓存导入放最前面
  const css = [...imports, ...bodies].filter((part) => part.trim()).join('\n');
  return { css, pending: [...pending], failures };
}

/**
 * 本地化一组 module CSS 块。
 * 返回合并后的 CSS（@import 已尽量展开）与抓取失败列表。
 */
export async function localizeModuleCss(
  blocks: string[],
  { baseUrl, fetchImpl = globalThis.fetch, force = false, waitMs = 1000 }: LocalizeModuleCssOptions
): Promise<ModuleCssResult> {
  if (!blocks.length || !String(blocks.join('')).trim()) {
    return { css: '', failures: [] };
  }

  if (force) {
    // 手动重试：失败记忆会被 refreshThemeCss 覆盖，成功后下次渲染即可内联
    const urls = collectImportUrls(blocks, baseUrl);
    await Promise.all(
      urls.map(async (url) => {
        await refreshThemeCss({ sources: [url], fetchImpl });
      })
    );
  }

  let result = localizeOnce(blocks, baseUrl, fetchImpl);
  if (!force && result.pending.length) {
    const tasks: Promise<unknown>[] = [];
    for (const url of result.pending) {
      const task = refreshThemeCssInBackground({ sources: [url], fetchImpl });
      if (task) tasks.push(task);
    }
    if (tasks.length) {
      // 只等一小会儿：失败快时当场能拿到原因，慢网络则先按远程 @import 回退
      await Promise.race([ Promise.all(tasks), delay(waitMs) ]);
      result = localizeOnce(blocks, baseUrl, fetchImpl);
    }
  }

  return {
    css: result.css,
    failures: [...result.failures].map(([url, message]) => ({ url, message })),
  };
}
