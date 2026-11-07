/**
 * theme.ts — 主题样式表本地化相关类型
 */

/** 与 globalThis.fetch 对齐，便于测试注入 */
export type FetchLike = typeof fetch;

/** readThemeCss 的可选项 */
export interface ThemeCssOptions {
  sources?: string[];
  /** true 时过期缓存视为未命中 */
  requireFresh?: boolean;
}

/** readThemeCss 的返回值；css 为空串表示缓存不全 */
export interface ThemeCssResult {
  css: string;
  missing: string[];
}

/** refreshThemeCss 的可选项 */
export interface ThemeRefreshOptions {
  sources?: string[];
  fetchImpl?: FetchLike;
}

/** refreshThemeCss 的失败条目 */
export interface ThemeRefreshError {
  url: string;
  message: string;
}

/** refreshThemeCss 的返回值 */
export interface ThemeRefreshResult {
  css: string;
  fetched: string[];
  errors: ThemeRefreshError[];
}
