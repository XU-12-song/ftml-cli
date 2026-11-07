/**
 * preview.ts — renderPreview 及其内部 fetcher 的类型
 */

import type { Client } from '@ukwhatn/wikidot';
import type {
  Diagnostic,
  IncludeDependency,
  PageRef,
} from '@wdprlib/parser';
import type { WikitextPageContext } from '@wdprlib/ast';
import type { RenderedHtmlBlock } from '@wdprlib/render';
import type { TemplatesMap } from '../core/template.ts';
import type { ReadonlyModulePlaceholders } from '../domain/settings.ts';
import type { ModuleCaps, ModuleMode, ModuleResolutionSummary } from './module.ts';
import type { RenderDiagnostic } from './diagnostics.ts';

/** include 来源 */
export type IncludeSource = 'local' | 'cache' | 'remote' | 'miss';

/** 本次渲染解析到的 [[include]] 条目 */
export interface IncludeResolutionEntry {
  site: string | null;
  page: string;
  from: IncludeSource;
  path?: string;
}

/** fetchRemoteInclude 的返回值 */
export interface RemoteIncludeResult {
  source: string | null;
  from: 'cache' | 'remote' | 'miss';
}

/** fetchRemoteInclude 的可选项 */
export interface FetchRemoteIncludeOptions {
  page?: WikitextPageContext;
  client?: Client | null;
  warnings: RenderDiagnostic[];
  allowNetwork?: boolean;
  clientError?: Error | null;
}

/** renderPreview 的可选项 */
export interface RenderPreviewOptions {
  page?: WikitextPageContext;
  styleMode?: 'inline' | 'separate';
  includeBaseDir?: string;
  includeTemplates?: TemplatesMap;
  client?: Client | null;
  allowNetwork?: boolean;
  clientError?: Error | null;
  moduleMode?: ModuleMode;
  modulePlaceholders?: ReadonlyModulePlaceholders;
  moduleCaps?: ModuleCaps;
}

/** renderPreview 的返回值 */
export interface RenderPreviewResult {
  html: string;
  htmlBlocks: RenderedHtmlBlock[];
  styles: string[];
  diagnostics: RenderDiagnostic[];
  includes: IncludeResolutionEntry[];
  dependencies: IncludeDependency[];
  moduleResolution: ModuleResolutionSummary;
}

/** buildPreviewDocument 的入参 */
export interface PreviewDocumentOptions {
  /** @wdprlib/render 输出的正文 fragment */
  html: string;
  htmlBlocks?: RenderedHtmlBlock[];
  styles?: string[];
  title?: string;
  themeCss?: string;
}

/** include fetcher 收到的目标 */
export type IncludePageRef = PageRef;

/** 诊断数组兼容 wdpr 原始 Diagnostic 与放宽后的 RenderDiagnostic */
export type PreviewDiagnostic = Diagnostic | RenderDiagnostic;
