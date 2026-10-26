/**
 * settings.js — web 编辑器偏好设置（用户级持久化）
 *
 *   文件：~/.ftml-cli/settings.json（FTML_CLI_HOME 可重定向，测试用）
 *
 *   {
 *     "previewIntervalMs": 600,     自动预览防抖间隔（毫秒）
 *     "autoPreview": true,          是否开启输入即预览
 *     "renderStyleMode": "inline",  预览渲染模式（inline / module）
 *     "useRemoteInclude": true,     渲染时是否联网解析远程 [[include]]
 *     "theme": "auto",              编辑器配色（auto / dark / light）
 *     "modulePlaceholders": { … }   快速预览时各 module 的占位数据
 *   }
 *
 * 读取时缺失字段用默认值补齐（老配置文件向前兼容）；写入时只接受已知字段。
 */

import fs from 'node:fs';
import path from 'node:path';
import { settingsPath } from '../infra/paths.js';

/**
 * 快速预览时各 module 的占位数据。
 * 只影响预览观感，不参与真实渲染；数值在 normalize 时收敛到安全范围。
 */
export const DEFAULT_MODULE_PLACEHOLDERS = Object.freeze({
  listPages: Object.freeze({
    count: 3,
    title: '示例页面 {n}',
    text: '这是占位正文。',
    tags: '示例 占位',
    date: '2024-01-01',
    rating: 10,
  }),
  listUsers: Object.freeze({
    count: 1,
    name: 'user-{n}',
    title: '示例用户 {n}',
  }),
  tagCloud: Object.freeze({
    count: 8,
    tags: '',
    minWeight: 1,
    maxWeight: 50,
  }),
  rate: Object.freeze({
    score: 12,
    votes: 20,
  }),
});

export const DEFAULT_SETTINGS = Object.freeze({
  previewIntervalMs: 600,
  autoPreview: true,
  renderStyleMode: 'inline',
  useRemoteInclude: true,
  theme: 'auto',
  modulePlaceholders: DEFAULT_MODULE_PLACEHOLDERS,
});

/** 预览间隔允许范围（毫秒）：过小会打爆渲染，过大失去实时感 */
export const MIN_INTERVAL_MS = 100;
export const MAX_INTERVAL_MS = 10000;

function clampInterval(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.previewIntervalMs;
  return Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, Math.round(n)));
}

function clampInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function cleanString(value, fallback, maxLen = 500) {
  if (typeof value !== 'string') return fallback;
  const s = value.trim();
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

/** `{n}` 之类的模板必须保留；只做长度限制 */
function cleanTemplate(value, fallback, maxLen = 200) {
  if (typeof value !== 'string') return fallback;
  return value.length > maxLen ? value.slice(0, maxLen) : value;
}

function normalizeDate(value, fallback) {
  if (typeof value !== 'string') return fallback;
  const s = value.trim();
  if (!s) return fallback;
  return Number.isNaN(Date.parse(s)) ? fallback : s;
}

/**
 * 逐模块深合并占位配置：只收敛已知字段，其它模块的配置不会被覆盖。
 * @param {object} [raw]
 */
export function normalizeModulePlaceholders(raw = {}) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const d = DEFAULT_MODULE_PLACEHOLDERS;

  const lp = src.listPages && typeof src.listPages === 'object' ? src.listPages : {};
  const lu = src.listUsers && typeof src.listUsers === 'object' ? src.listUsers : {};
  const tc = src.tagCloud && typeof src.tagCloud === 'object' ? src.tagCloud : {};
  const rt = src.rate && typeof src.rate === 'object' ? src.rate : {};

  const minWeight = clampInt(tc.minWeight, d.tagCloud.minWeight, 0, 100000);
  const maxWeight = clampInt(tc.maxWeight, d.tagCloud.maxWeight, 0, 100000);

  return {
    listPages: {
      count: clampInt(lp.count, d.listPages.count, 0, 50),
      title: cleanTemplate(lp.title, d.listPages.title),
      text: cleanString(lp.text, d.listPages.text),
      tags: cleanString(lp.tags, d.listPages.tags),
      date: normalizeDate(lp.date, d.listPages.date),
      rating: clampInt(lp.rating, d.listPages.rating, -1000000, 1000000),
    },
    listUsers: {
      count: clampInt(lu.count, d.listUsers.count, 0, 20),
      name: cleanTemplate(lu.name, d.listUsers.name),
      title: cleanTemplate(lu.title, d.listUsers.title),
    },
    tagCloud: {
      count: clampInt(tc.count, d.tagCloud.count, 0, 100),
      tags: cleanString(tc.tags, d.tagCloud.tags),
      minWeight,
      maxWeight: Math.max(minWeight, maxWeight),
    },
    rate: {
      score: clampInt(rt.score, d.rate.score, -1000000, 1000000),
      votes: clampInt(rt.votes, d.rate.votes, 0, 1000000),
    },
  };
}

/** 只保留已知字段并做类型/范围收敛 */
export function normalizeSettings(raw = {}) {
  const out = {
    ...DEFAULT_SETTINGS,
    modulePlaceholders: normalizeModulePlaceholders(DEFAULT_MODULE_PLACEHOLDERS),
  };
  if (raw.previewIntervalMs !== undefined) out.previewIntervalMs = clampInterval(raw.previewIntervalMs);
  if (raw.autoPreview !== undefined) out.autoPreview = Boolean(raw.autoPreview);
  if (raw.renderStyleMode !== undefined) {
    out.renderStyleMode = raw.renderStyleMode === 'module' ? 'module' : 'inline';
  }
  if (raw.useRemoteInclude !== undefined) out.useRemoteInclude = Boolean(raw.useRemoteInclude);
  if (raw.theme !== undefined) {
    out.theme = raw.theme === 'dark' || raw.theme === 'light' ? raw.theme : 'auto';
  }
  if (raw.modulePlaceholders !== undefined) {
    out.modulePlaceholders = normalizeModulePlaceholders(raw.modulePlaceholders);
  }
  return out;
}

/** 读取设置（默认值 + 文件覆盖）；文件缺失/损坏返回默认值 */
export function loadSettings() {
  try {
    return normalizeSettings(JSON.parse(fs.readFileSync(settingsPath(), 'utf8')));
  } catch {
    return normalizeSettings({});
  }
}

/**
 * 合并式写入设置：只覆盖传入的已知字段，返回写入后的完整设置。
 * modulePlaceholders 按模块组深合并，避免保存一个模块时清空其它模块。
 * @param {object} patch 部分设置
 */
export function saveSettings(patch = {}) {
  const base = loadSettings();
  const next = { ...base };
  if (patch.previewIntervalMs !== undefined) next.previewIntervalMs = patch.previewIntervalMs;
  if (patch.autoPreview !== undefined) next.autoPreview = patch.autoPreview;
  if (patch.renderStyleMode !== undefined) next.renderStyleMode = patch.renderStyleMode;
  if (patch.useRemoteInclude !== undefined) next.useRemoteInclude = patch.useRemoteInclude;
  if (patch.theme !== undefined) next.theme = patch.theme;
  if (patch.modulePlaceholders !== undefined) {
    const p = patch.modulePlaceholders && typeof patch.modulePlaceholders === 'object'
      ? patch.modulePlaceholders
      : {};
    next.modulePlaceholders = {};
    for (const key of Object.keys(DEFAULT_MODULE_PLACEHOLDERS)) {
      const baseGroup = base.modulePlaceholders[key] ?? {};
      const patchGroup = p[key] && typeof p[key] === 'object' ? p[key] : {};
      next.modulePlaceholders[key] = { ...baseGroup, ...patchGroup };
    }
  }
  const merged = normalizeSettings(next);
  const p = settingsPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(merged, null, 2) + '\n', 'utf8');
  return merged;
}
