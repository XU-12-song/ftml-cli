/**
 * wikidot.ts — Wikidot 客户端封装的选项与结果类型
 */

import type { Client, Site } from '@ukwhatn/wikidot';
import type { SourceText } from '../common.ts';

/** 客户端工厂（测试注入用；默认 createClient） */
export type ClientFactory = () => Client | Promise<Client>;

/** 提交/回退返回的兼容层摘要 */
export interface CompatSummary {
  changed: boolean;
  changes: unknown[];
  diagnostics: unknown[];
}

/** editPage 的选项 */
export interface EditPageOptions {
  /** 完整 FTML 源码 */
  source: SourceText;
  /** 编辑注释 */
  comment: string;
}

/** pushPageSource 的选项 */
export interface PushPageSourceOptions {
  siteName: string | null | undefined;
  pageName: string | null | undefined;
  /** 要写入的完整 FTML 源码（理想形态） */
  source: SourceText;
  comment: string;
  /** 已登录客户端（复用会话，不负责关闭） */
  client?: Client;
  /** 客户端工厂（测试注入用） */
  clientFactory?: ClientFactory;
}

/** pushPageSource 的结果 */
export interface PushPageSourceResult {
  revisionsCount: number;
  compat: CompatSummary;
}

/** upsertPageSource 的选项 */
export interface UpsertPageSourceOptions {
  /** 已获取的 Site 对象（调用方复用会话时先 getSite 一次） */
  site: Site;
  pageName: string;
  /** 完整 FTML 源码（理想形态） */
  source: SourceText;
  comment: string;
}

/** upsertPageSource 的结果 */
export interface UpsertPageSourceResult {
  created: boolean;
  revisionsCount: number;
  compat: CompatSummary;
}
