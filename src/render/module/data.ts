/**
 * data.ts — 组装 module dataProvider
 *
 * 两种模式：
 *   placeholder（默认）— 纯内存合成数据，零网络，保证快速预览
 *   real               — 命令面板显式触发的一次性真实解析
 *
 * 真实解析按模块独立降级：某个模块失败只影响它自己，回退到占位数据并记 warning，
 * 不让整个预览失败。
 */

import { DEFAULT_MODULE_CAPS } from './caps.js';
import { buildPlaceholderFetchers } from './placeholders.js';
import {
  fetchRealListPages,
  fetchRealListUsers,
  fetchRealTagCloud,
  fetchRealRatings,
} from './resolve.js';
import type {
  ModuleDataProvider,
  ModuleDataProviderOptions,
  ModuleSummary,
  ModuleWarning,
  RealFetchOptions,
} from '../../types/render/module.ts';

type ModuleKind = 'listPages' | 'listUsers' | 'tagCloud' | 'rate';

const MODULE_LABELS: Record<ModuleKind, string> = {
  listPages: 'ListPages',
  listUsers: 'ListUsers',
  tagCloud: 'TagCloud',
  rate: 'Rate',
};

function pushWarningOnce(warnings: ModuleWarning[], warning: ModuleWarning): void {
  if (!warnings.some((w) => w.code === warning.code)) warnings.push(warning);
}

export function createModuleDataProvider({
  mode = 'placeholder',
  placeholders,
  page,
  client = null,
  clientError = null,
  caps = DEFAULT_MODULE_CAPS,
}: ModuleDataProviderOptions = {}): ModuleDataProvider {
  const warnings: ModuleWarning[] = [];
  const summary: ModuleSummary = { mode, fallback: false, listPages: 0, listUsers: 0, tagCloud: 0, ratings: 0 };
  // ListPages 返回的页面确实存在；交给渲染器作为 pageExists 依据，避免全部标红链。
  const knownPages = new Set<string>();

  const placeholder = buildPlaceholderFetchers({ placeholders, page, caps });
  const real = mode === 'real' && Boolean(client);

  if (mode === 'real' && !client) {
    summary.fallback = true;
    pushWarningOnce(warnings, {
      severity: 'warning',
      code: 'module-real-no-client',
      message: `无法真实解析模块：${clientError?.message || '未登录 Wikidot，请先点击账号按钮登录'}；已回退占位数据`,
      position: null,
    });
  }

  const opts: RealFetchOptions = { placeholders, page, client, clientError, caps, warnings };

  function recordPages(kind: ModuleKind, value: unknown): void {
    if (kind !== 'listPages') return;
    const pages = (value as { pages?: Array<{ fullname?: string }> } | undefined)?.pages ?? [];
    for (const p of pages) {
      if (p?.fullname) knownPages.add(p.fullname);
    }
  }

  /** 统一包装：真实模式失败 → 占位数据 + 去重 warning */
  function wrap<T>(
    kind: ModuleKind,
    realFn: (...args: any[]) => Promise<T>,
    fallbackFn: (...args: any[]) => Promise<T>
  ): (...args: any[]) => Promise<T> {
    return async (...args: any[]) => {
      const countKey = kind === 'rate' ? 'ratings' : kind;
      if (!real) {
        summary[countKey]++;
        const value = await fallbackFn(...args);
        recordPages(kind, value);
        return value;
      }
      try {
        const value = await realFn(...args, opts);
        summary[countKey]++;
        recordPages(kind, value);
        return value;
      } catch (e) {
        summary[countKey]++;
        summary.fallback = true;
        pushWarningOnce(warnings, {
          severity: 'warning',
          code: `module-real-${kind === 'listPages' ? 'listpages' : kind === 'listUsers' ? 'listusers' : kind === 'tagCloud' ? 'tagcloud' : 'rate'}-failed`,
          message: `${MODULE_LABELS[kind]} 真实解析失败，已回退占位数据: ${(e as Error).message}`,
          position: null,
        });
        const value = await fallbackFn(...args);
        recordPages(kind, value);
        return value;
      }
    };
  }

  return {
    fetchers: {
      fetchListPages: wrap('listPages', fetchRealListPages, placeholder.fetchListPages),
      fetchListUsers: wrap('listUsers', fetchRealListUsers, placeholder.fetchListUsers),
      fetchTagCloud: wrap('tagCloud', fetchRealTagCloud, placeholder.fetchTagCloud),
      fetchRatings: wrap('rate', fetchRealRatings, placeholder.fetchRatings),
    },
    warnings,
    summary,
    knownPages,
  };
}
