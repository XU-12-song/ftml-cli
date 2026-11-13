/**
 * settings.ts — web 编辑器偏好设置（用户级持久化）
 *
 *   文件：~/.ftml-cli/settings.json（FTML_CLI_HOME 可重定向，测试用）
 *
 *   {
 *     "previewIntervalMs": 600,     自动预览防抖间隔（毫秒）
 *     "autoPreview": true,          是否开启输入即预览
 *     "renderStyleMode": "inline",  预览渲染模式（inline / module）
 *     "useRemoteInclude": true,     渲染时是否联网解析远程 [[include]]
 *     "theme": "calm",              编辑器配色（calm / auto / dark / light）
 *     "modulePlaceholders": { … }   快速预览时各 module 的占位数据
 *   }
 *
 * 读取时缺失字段用默认值补齐（老配置文件向前兼容）；写入时只接受已知字段。
 */

import fs from 'node:fs';
import path from 'node:path';
import { settingsPath } from '../infra/paths.js';
import type {
  ListPagesPlaceholder,
  ListUsersPlaceholder,
  ModulePlaceholders,
  RatePlaceholder,
  ReadonlyModulePlaceholders,
  Settings,
  SettingsPatch,
  TagCloudPlaceholder,
} from '../types/domain/settings.ts';

/**
 * 快速预览时各 module 的占位数据。
 * 只影响预览观感，不参与真实渲染；数值在 normalize 时收敛到安全范围。
 */
export const DEFAULT_MODULE_PLACEHOLDERS: ReadonlyModulePlaceholders = Object.freeze({
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

/** 默认设置（模块占位数据引用上面的默认占位表） */
export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  previewIntervalMs: 600,
  autoPreview: true,
  renderStyleMode: 'inline',
  useRemoteInclude: true,
  theme: 'calm',
  modulePlaceholders: DEFAULT_MODULE_PLACEHOLDERS,
});

/** 预览间隔允许范围（毫秒）：过小会打爆渲染，过大失去实时感 */
export const MIN_INTERVAL_MS = 100;
export const MAX_INTERVAL_MS = 10000;

const MODULE_KEYS = Object.keys(DEFAULT_MODULE_PLACEHOLDERS) as (keyof ModulePlaceholders)[];

/** 只接受普通对象，其余（null / 原始值）一律视为空配置 */
function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function clampInterval(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.previewIntervalMs;
  return Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, Math.round(n)));
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function cleanString(value: unknown, fallback: string, maxLen = 500): string {
  if (typeof value !== 'string') return fallback;
  const s = value.trim();
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

/** `{n}` 之类的模板必须保留；只做长度限制 */
function cleanTemplate(value: unknown, fallback: string, maxLen = 200): string {
  if (typeof value !== 'string') return fallback;
  return value.length > maxLen ? value.slice(0, maxLen) : value;
}

function normalizeDate(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const s = value.trim();
  if (!s) return fallback;
  return Number.isNaN(Date.parse(s)) ? fallback : s;
}

/**
 * 逐模块深合并占位配置：只收敛已知字段，其它模块的配置不会被覆盖。
 */
export function normalizeModulePlaceholders(raw: unknown = {}): ModulePlaceholders {
  const src = asRecord(raw);
  const d = DEFAULT_MODULE_PLACEHOLDERS;

  const lp = asRecord(src.listPages);
  const lu = asRecord(src.listUsers);
  const tc = asRecord(src.tagCloud);
  const rt = asRecord(src.rate);

  const minWeight = clampInt(tc.minWeight, d.tagCloud.minWeight, 0, 100000);
  const maxWeight = clampInt(tc.maxWeight, d.tagCloud.maxWeight, 0, 100000);

  const listPages: ListPagesPlaceholder = {
    count: clampInt(lp.count, d.listPages.count, 0, 50),
    title: cleanTemplate(lp.title, d.listPages.title),
    text: cleanString(lp.text, d.listPages.text),
    tags: cleanString(lp.tags, d.listPages.tags),
    date: normalizeDate(lp.date, d.listPages.date),
    rating: clampInt(lp.rating, d.listPages.rating, -1000000, 1000000),
  };
  const listUsers: ListUsersPlaceholder = {
    count: clampInt(lu.count, d.listUsers.count, 0, 20),
    name: cleanTemplate(lu.name, d.listUsers.name),
    title: cleanTemplate(lu.title, d.listUsers.title),
  };
  const tagCloud: TagCloudPlaceholder = {
    count: clampInt(tc.count, d.tagCloud.count, 0, 100),
    tags: cleanString(tc.tags, d.tagCloud.tags),
    minWeight,
    maxWeight: Math.max(minWeight, maxWeight),
  };
  const rate: RatePlaceholder = {
    score: clampInt(rt.score, d.rate.score, -1000000, 1000000),
    votes: clampInt(rt.votes, d.rate.votes, 0, 1000000),
  };

  return { listPages, listUsers, tagCloud, rate };
}

/** 只保留已知字段并做类型/范围收敛 */
export function normalizeSettings(raw: unknown = {}): Settings {
  const src = asRecord(raw);
  const out: Settings = {
    ...DEFAULT_SETTINGS,
    modulePlaceholders: normalizeModulePlaceholders(DEFAULT_MODULE_PLACEHOLDERS),
  };
  if (src.previewIntervalMs !== undefined) out.previewIntervalMs = clampInterval(src.previewIntervalMs);
  if (src.autoPreview !== undefined) out.autoPreview = Boolean(src.autoPreview);
  if (src.renderStyleMode !== undefined) {
    out.renderStyleMode = src.renderStyleMode === 'module' ? 'module' : 'inline';
  }
  if (src.useRemoteInclude !== undefined) out.useRemoteInclude = Boolean(src.useRemoteInclude);
  if (src.theme !== undefined) {
    out.theme = src.theme === 'calm' || src.theme === 'dark' || src.theme === 'light'
      ? src.theme
      : 'auto';
  }
  if (src.modulePlaceholders !== undefined) {
    out.modulePlaceholders = normalizeModulePlaceholders(src.modulePlaceholders);
  }
  return out;
}

/** 读取设置（默认值 + 文件覆盖）；文件缺失/损坏返回默认值 */
export function loadSettings(): Settings {
  try {
    return normalizeSettings(JSON.parse(fs.readFileSync(settingsPath(), 'utf8')));
  } catch {
    return normalizeSettings({});
  }
}

/**
 * 合并式写入设置：只覆盖传入的已知字段，返回写入后的完整设置。
 * modulePlaceholders 按模块组深合并，避免保存一个模块时清空其它模块。
 */
export function saveSettings(patch: SettingsPatch = {}): Settings {
  const base = loadSettings();
  const raw: Record<string, unknown> = { ...base };
  if (patch.previewIntervalMs !== undefined) raw.previewIntervalMs = patch.previewIntervalMs;
  if (patch.autoPreview !== undefined) raw.autoPreview = patch.autoPreview;
  if (patch.renderStyleMode !== undefined) raw.renderStyleMode = patch.renderStyleMode;
  if (patch.useRemoteInclude !== undefined) raw.useRemoteInclude = patch.useRemoteInclude;
  if (patch.theme !== undefined) raw.theme = patch.theme;
  if (patch.modulePlaceholders !== undefined) {
    const p = asRecord(patch.modulePlaceholders);
    const merged: Record<string, unknown> = {};
    for (const key of MODULE_KEYS) {
      merged[key] = { ...asRecord(base.modulePlaceholders[key]), ...asRecord(p[key]) };
    }
    raw.modulePlaceholders = merged;
  }
  const merged = normalizeSettings(raw);
  const p = settingsPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(merged, null, 2) + '\n', 'utf8');
  return merged;
}
