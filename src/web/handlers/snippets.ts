/**
 * handlers/snippets.js — 代码片段（用户级持久化）+ 远程 include 磁盘缓存
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  loadSnippets,
  upsertSnippet,
  removeSnippet,
  importSnippetsText,
  exportSnippetsText,
} from '../../domain/snippets.js';
import { listPageCache, clearPageCache } from '../../infra/cache.js';
import { HttpError } from './shared.js';
import type {
  MergeSnippetsResult,
  RemoveSnippetResult,
  SnippetInput,
} from '../../types/domain/snippets.ts';
import type {
  ExportSnippetsResult,
  ImportSnippetsBody,
  IncludeCacheClearResult,
  IncludeCacheListResult,
  ListSnippetsResult,
} from '../../types/web/handlers/snippets.ts';

export function listSnippets(): ListSnippetsResult {
  return { snippets: loadSnippets() };
}

export function saveSnippet(body: SnippetInput): MergeSnippetsResult {
  if (!body?.name) throw new HttpError(400, '缺少片段名称');
  return upsertSnippet(body);
}

export function deleteSnippet(name: string): RemoveSnippetResult {
  try {
    return removeSnippet(decodeURIComponent(name));
  } catch (e) {
    throw new HttpError(404, e.message);
  }
}

/** 导入 Ace .snippets：body.text 直接给内容，或 body.file 给磁盘路径 */
export function importSnippets(body: ImportSnippetsBody): MergeSnippetsResult {
  if (typeof body?.text === 'string' && body.text.trim()) {
    return importSnippetsText(body.text, body.source || 'web-import');
  }
  if (typeof body?.file === 'string' && body.file.trim()) {
    const abs = path.resolve(body.file);
    if (!fs.existsSync(abs)) throw new HttpError(404, `文件不存在: ${abs}`);
    return importSnippetsText(fs.readFileSync(abs, 'utf8'), path.basename(abs));
  }
  throw new HttpError(400, '缺少导入内容（text 或 file）');
}

/** 导出全部片段为 Ace .snippets 文本 */
export function exportSnippets(): ExportSnippetsResult {
  return { text: exportSnippetsText() };
}

// ---------------- include 缓存 ----------------

/** 列出远程 include 的磁盘缓存条目 */
export function listIncludeCache(): IncludeCacheListResult {
  return { entries: listPageCache() };
}

/** 清空远程 include 缓存 */
export function clearIncludeCache(): IncludeCacheClearResult {
  return { removed: clearPageCache() };
}
