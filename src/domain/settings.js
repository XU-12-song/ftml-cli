/**
 * settings.js — web 编辑器偏好设置（用户级持久化）
 *
 *   文件：~/.ftml-cli/settings.json（FTML_CLI_HOME 可重定向，测试用）
 *
 *   {
 *     "previewIntervalMs": 600,     自动预览防抖间隔（毫秒）
 *     "autoPreview": true,          是否开启输入即预览
 *     "renderStyleMode": "inline",  预览渲染模式（inline / module）
 *     "useRemoteInclude": true      渲染时是否联网解析远程 [[include]]
 *   }
 *
 * 读取时缺失字段用默认值补齐（老配置文件向前兼容）；写入时只接受已知字段。
 */

import fs from 'node:fs';
import path from 'node:path';
import { settingsPath } from '../infra/paths.js';

export const DEFAULT_SETTINGS = Object.freeze({
  previewIntervalMs: 600,
  autoPreview: true,
  renderStyleMode: 'inline',
  useRemoteInclude: true,
});

/** 预览间隔允许范围（毫秒）：过小会打爆渲染，过大失去实时感 */
export const MIN_INTERVAL_MS = 100;
export const MAX_INTERVAL_MS = 10000;

function clampInterval(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.previewIntervalMs;
  return Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, Math.round(n)));
}

/** 只保留已知字段并做类型/范围收敛 */
export function normalizeSettings(raw = {}) {
  const out = { ...DEFAULT_SETTINGS };
  if (raw.previewIntervalMs !== undefined) out.previewIntervalMs = clampInterval(raw.previewIntervalMs);
  if (raw.autoPreview !== undefined) out.autoPreview = Boolean(raw.autoPreview);
  if (raw.renderStyleMode !== undefined) {
    out.renderStyleMode = raw.renderStyleMode === 'module' ? 'module' : 'inline';
  }
  if (raw.useRemoteInclude !== undefined) out.useRemoteInclude = Boolean(raw.useRemoteInclude);
  return out;
}

/** 读取设置（默认值 + 文件覆盖）；文件缺失/损坏返回默认值 */
export function loadSettings() {
  try {
    return normalizeSettings(JSON.parse(fs.readFileSync(settingsPath(), 'utf8')));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * 合并式写入设置：只覆盖传入的已知字段，返回写入后的完整设置。
 * @param {object} patch 部分设置
 */
export function saveSettings(patch = {}) {
  const merged = normalizeSettings({ ...loadSettings(), ...patch });
  const p = settingsPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(merged, null, 2) + '\n', 'utf8');
  return merged;
}
