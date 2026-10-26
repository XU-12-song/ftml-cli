/**
 * module-data.js — 组装 module dataProvider
 *
 * 两种模式：
 *   placeholder（默认）— 纯内存合成数据，零网络，保证快速预览
 *   real               — 命令面板显式触发的一次性真实解析
 *
 * 真实解析按模块独立降级：某个模块失败只影响它自己，回退到占位数据并记 warning，
 * 不让整个预览失败。
 */

import { DEFAULT_MODULE_CAPS } from './module-caps.js';
import { buildPlaceholderFetchers } from './module-placeholders.js';
import {
  fetchRealListPages,
  fetchRealListUsers,
  fetchRealTagCloud,
  fetchRealRatings,
} from './module-resolve.js';

const MODULE_LABELS = {
  listPages: 'ListPages',
  listUsers: 'ListUsers',
  tagCloud: 'TagCloud',
  rate: 'Rate',
};

function pushWarningOnce(warnings, warning) {
  if (!warnings.some((w) => w.code === warning.code)) warnings.push(warning);
}

/**
 * @param {object} opts
 * @param {'placeholder'|'real'} [opts.mode]
 * @param {object} [opts.placeholders] settings.modulePlaceholders
 * @param {object} [opts.page] 页面上下文
 * @param {object|null} [opts.client] 已登录 Wikidot 客户端
 * @param {Error|null} [opts.clientError] 客户端创建失败原因
 * @param {object} [opts.caps]
 * @returns {{ fetchers: object, warnings: Array, summary: object }}
 */
export function createModuleDataProvider({
  mode = 'placeholder',
  placeholders,
  page,
  client = null,
  clientError = null,
  caps = DEFAULT_MODULE_CAPS,
} = {}) {
  const warnings = [];
  const summary = { mode, fallback: false, listPages: 0, listUsers: 0, tagCloud: 0, ratings: 0 };

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

  const opts = { placeholders, page, client, clientError, caps, warnings };

  /** 统一包装：真实模式失败 → 占位数据 + 去重 warning */
  function wrap(kind, realFn, fallbackFn) {
    return async (...args) => {
      const countKey = kind === 'rate' ? 'ratings' : kind;
      if (!real) {
        summary[countKey]++;
        return fallbackFn(...args);
      }
      try {
        const value = await realFn(...args, opts);
        summary[countKey]++;
        return value;
      } catch (e) {
        summary[countKey]++;
        summary.fallback = true;
        pushWarningOnce(warnings, {
          severity: 'warning',
          code: `module-real-${kind === 'listPages' ? 'listpages' : kind === 'listUsers' ? 'listusers' : kind === 'tagCloud' ? 'tagcloud' : 'rate'}-failed`,
          message: `${MODULE_LABELS[kind]} 真实解析失败，已回退占位数据: ${e.message}`,
          position: null,
        });
        return fallbackFn(...args);
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
  };
}
