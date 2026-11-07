/**
 * render.ts — 渲染与校验 API 的类型
 */

import type { RenderedHtmlBlock } from '@wdprlib/render';
import type { Settings } from '../../domain/settings.ts';
import type { RenderStyleMode } from '../../domain/settings.ts';
import type { IncludeResolutionEntry } from '../../render/preview.ts';
import type { ModuleResolutionSummary } from '../../render/module.ts';
import type { RenderDiagnostic } from '../../render/diagnostics.ts';
import type { Problem } from '../../render/problems.ts';

/** renderProjectFile 的请求体 */
export interface RenderBody {
  path?: string;
  site?: string;
  page?: string;
  /** 显式请求联网解析远程 [[include]] */
  allowNetwork?: boolean;
  /** 一次性真实解析 module */
  resolveModules?: boolean;
  /** 渲染样式模式（前端可覆盖设置） */
  styleMode?: RenderStyleMode | 'separate';
  /** false = 只回正文片段（前端原地补丁） */
  full?: boolean;
}

/** renderProjectFile 的返回值（失败时 html/fragment/styles 为 null） */
export interface RenderResult {
  html: string | null;
  fragment: string | null;
  htmlBlocks?: RenderedHtmlBlock[];
  styles: string[] | null;
  title?: string;
  diagnostics: RenderDiagnostic[];
  diagnosticReport: string;
  includes: IncludeResolutionEntry[];
  settings: Settings;
  moduleResolution?: ModuleResolutionSummary;
  problems: Problem[];
}

/** validateProjectFile 的请求体 */
export interface ValidateBody {
  path?: string;
}
