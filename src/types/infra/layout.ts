/**
 * layout.ts — 站点页面结构（`_template`）的类型
 */

/** @description 站点的页面结构 */
export interface SiteLayout {
  /** 归一化后的站点名，如 scp-cn */
  site: string;
  /** `#container` 的内部 HTML（正文/标题位置用 marker 占位） */
  containerStructure: string;
  /** 主题 `@import` 的绝对 URL */
  themes: string[];
}

/** 磁盘缓存条目（v 用于淘汰旧格式） */
export interface LayoutCacheEntry extends SiteLayout {
  v: 3;
  fetchedAt: number;
}

/** 布局获取选项 */
export interface SiteLayoutOptions {
  /** 测试注入；默认 globalThis.fetch */
  fetchImpl?: typeof fetch;
  /** false 时只读缓存，绝不联网（默认 true） */
  allowNetwork?: boolean;
  /** true 时忽略缓存强制联网 */
  refresh?: boolean;
  /** 缓存过期阈值（毫秒）；默认 30 天，仅测试需要覆盖 */
  maxAgeMs?: number;
}

/** 强制刷新的结果；失败时 layout 为旧缓存（可能为 null） */
export interface SiteLayoutRefreshResult {
  layout: SiteLayout | null;
  error?: string;
}
