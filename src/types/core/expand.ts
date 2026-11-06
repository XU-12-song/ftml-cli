/**
 * expand.ts — 模板展开器的上下文与选项
 */

/** @description 单个 [[style]] CSS 块 */
export type CssBlock = string;

/** @description 收集到的 CSS 块列表 */
export type CssBlocks = CssBlock[];

/**
 * @description 展开操作的内置上下文对象
 */
export interface ExpandContext {
  /** 收集到的 CSS 块列表 */
  css: CssBlocks;
  /** 解析 [[component]] 相对路径的基准目录（默认 CWD） */
  baseDir: string;
  /** 源文件名（附在 FtmlError 上，供 web 端定位） */
  file: string | null;
}

/**
 * @description 展开操作的选项
 */
export interface ExpandOptions {
  /** 解析 [[component]] 相对路径的基准目录（默认 CWD） */
  baseDir?: string;
  /** 源文件名（附在 FtmlError 上） */
  file?: string;
}
