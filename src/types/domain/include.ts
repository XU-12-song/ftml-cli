import type { PageRef } from "@wdprlib/ast";
export type { PageRef } from "@wdprlib/ast";

/**
 * @description 扫描到的 `[[include]]` 引用
 */
export interface ScannedIncludeRef extends PageRef {
  /** 目标在源码中的起始位置（不含 `[[`） */
  start: number;

  /** 目标在源码中的结束位置（不含 `]]`） */
  end: number;

  /** 原始目标（`:site:page` 或 `page`） */
  target: string;

  /** 与 target 相同，保留字段名与解析器输出一致 */
  raw: string;
}

/**
 * @description 引用名重写映射：原引用名 → 线上页面全名
 */
export type IncludeRewriteMap = Map<string, string>;
