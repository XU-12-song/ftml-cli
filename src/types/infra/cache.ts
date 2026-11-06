/**
 * cache.ts — 用户级页面源码缓存类型
 */

/** listPageCache 的一条缓存记录 */
export interface PageCacheEntry {
  site: string;
  page: string;
  bytes: number;
  /** ISO 时间字符串 */
  mtime: string;
}
