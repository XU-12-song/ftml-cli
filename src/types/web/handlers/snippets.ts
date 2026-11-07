/**
 * snippets.ts — 代码片段与 include 缓存 API 的类型
 */

import type { Snippet } from '../../domain/snippets.ts';
import type { PageCacheEntry } from '../../infra/cache.ts';

/** listSnippets 的返回值 */
export interface ListSnippetsResult {
  snippets: Snippet[];
}

/** 导入片段的请求体（text 直接给内容，或 file 给磁盘路径） */
export interface ImportSnippetsBody {
  text?: unknown;
  file?: unknown;
  source?: string;
}

/** exportSnippets 的返回值 */
export interface ExportSnippetsResult {
  text: string;
}

/** listIncludeCache 的返回值 */
export interface IncludeCacheListResult {
  entries: PageCacheEntry[];
}

/** clearIncludeCache 的返回值 */
export interface IncludeCacheClearResult {
  removed: number;
}
