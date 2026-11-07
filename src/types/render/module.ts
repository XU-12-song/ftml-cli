/**
 * module.ts — render/module 子系统的数据类型
 *
 * 覆盖两种数据来源（占位 / 真实）共用的抓取上限、告警、组装结果，
 * 以及各 fetcher 的入参形状。fetcher 本体与 @wdprlib/parser 的
 * dataProvider hook 签名对齐，类型在此收敛。
 */

import type { Client } from '@ukwhatn/wikidot';
import type {
  ListPagesDataRequirement,
  ListUsersDataRequirement,
  TagCloudDataRequirement,
  NormalizedListPagesQuery,
  ListPagesExternalData,
  ListUsersExternalData,
  TagCloudExternalData,
  Diagnostic,
  PageData,
} from '@wdprlib/parser';
import type {
  RatingRef,
  RatingState,
  WikitextPageContext,
} from '@wdprlib/ast';
import type { ReadonlyModulePlaceholders } from '../domain/settings.ts';

/** 真实解析 module 时的抓取上限 */
export interface ModuleCaps {
  /** ListPages 单次最多渲染多少行 */
  listPagesMaxRows: number;
  /** 需要正文时最多补取多少页源码 */
  listPagesSourceMax: number;
  /** TagCloud 最多取多少个标签 */
  tagCloudMaxTags: number;
}

/** 模块数据模式：占位（默认）/ 一次性真实解析 */
export type ModuleMode = 'placeholder' | 'real';

/** module 子系统产生的告警诊断（position 允许为空） */
export type ModuleWarning = Omit<Diagnostic, 'position'> & {
  position: Diagnostic['position'] | null;
};

/** 各模块的真实解析调用次数与降级状态 */
export interface ModuleSummary {
  mode: ModuleMode;
  fallback: boolean;
  listPages: number;
  listUsers: number;
  tagCloud: number;
  ratings: number;
}

/** 占位 fetcher 的构造参数 */
export interface PlaceholderFetcherOptions {
  placeholders?: ReadonlyModulePlaceholders;
  page?: WikitextPageContext;
  caps?: ModuleCaps;
}

/** 占位 fetcher 内部共享的上下文 */
export interface PlaceholderContext {
  placeholders: ReadonlyModulePlaceholders;
  page?: WikitextPageContext;
  caps?: ModuleCaps;
}

/** 与 dataProvider hook 对齐的占位 fetcher 集合 */
export interface PlaceholderFetchers {
  fetchListPages: (query: NormalizedListPagesQuery) => Promise<ListPagesExternalData>;
  fetchListUsers: (requirement: ListUsersDataRequirement) => Promise<ListUsersExternalData>;
  fetchTagCloud: (requirement: TagCloudDataRequirement) => Promise<TagCloudExternalData>;
  fetchRatings: (refs: readonly RatingRef[]) => Promise<RatingState[]>;
}

/** 真实 fetcher 的附加参数（由 module-data 统一注入） */
export interface RealFetchOptions {
  placeholders?: ReadonlyModulePlaceholders;
  page?: WikitextPageContext;
  client: Client | null;
  clientError?: Error | null;
  caps: ModuleCaps;
  warnings: ModuleWarning[];
}

/** 交给 parser 的 module dataProvider */
export interface ModuleFetchers {
  fetchListPages: (
    query: NormalizedListPagesQuery,
    requirement: ListPagesDataRequirement,
    context: unknown
  ) => Promise<ListPagesExternalData>;
  fetchListUsers: (
    requirement: ListUsersDataRequirement,
    context: unknown
  ) => Promise<ListUsersExternalData>;
  fetchTagCloud: (
    requirement: TagCloudDataRequirement,
    context: unknown
  ) => Promise<TagCloudExternalData>;
  fetchRatings: (
    refs: readonly RatingRef[],
    context: unknown
  ) => Promise<RatingState[]>;
}

/** createModuleDataProvider 的参数 */
export interface ModuleDataProviderOptions {
  mode?: ModuleMode;
  placeholders?: ReadonlyModulePlaceholders;
  page?: WikitextPageContext;
  client?: Client | null;
  clientError?: Error | null;
  caps?: ModuleCaps;
}

/** createModuleDataProvider 的返回值 */
export interface ModuleDataProvider {
  fetchers: ModuleFetchers;
  warnings: ModuleWarning[];
  summary: ModuleSummary;
  /** ListPages 返回的已知页面全名（真实/占位都算） */
  knownPages: Set<string>;
}

/** ListPages 占位/真实数据共用的页面形状 */
export type ModulePageData = PageData;

/** preview 结果里 moduleResolution 字段的形状 */
export interface ModuleResolutionSummary {
  mode: ModuleMode;
  fallback: boolean;
  warnings: ModuleWarning[];
  summary: ModuleSummary;
}
