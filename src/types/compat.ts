/**
 * compat.ts — 理想 FTML ↔ Wikidot 兼容层的数据结构
 *
 * 分歧表、双向转换结果、词法事件与诊断形状在此收敛；
 * 实现见 src/compat/*.ts。
 */

import type { Diagnostic } from '@wdprlib/parser';

/** 转换方向 */
export type CompatDirection = 'dirt->ideal' | 'ideal->dirt';

/** 分歧性质 */
export type DivergenceVerdict = 'diverge' | 'bug' | 'unresolved';

/** 一条语言分歧记录 */
export interface Divergence {
  /** 机器标识 */
  id: string;
  /** 人类可读标题 */
  title: string;
  /** 真实 Wikidot 的行为 */
  wikidot: string;
  /** 理想 FTML 期望的行为 */
  ideal: string;
  verdict: DivergenceVerdict;
  /** 该分歧在哪些转换方向需要处理 */
  directions: CompatDirection[];
  /** 转换规则 id；无则为 null */
  rule: string | null;
  /** 相关出处（issue / 文档） */
  ref: string;
}

/** 转换规则的可选项（目前只有行内标签集合） */
export interface CompatOptions {
  inlineTags?: ReadonlySet<string>;
}

/** offset → 行/列（均 1 基） */
export interface LineColumn {
  line: number;
  column: number;
}

/** 一次闭合标签插入的记录（原坐标系） */
export interface InlineChange {
  rule: string;
  action: 'close-inline';
  tag: string;
  offset: number;
  line: number;
  column: number;
}

/** 带转换方向的修复记录 */
export interface DirectionalChange extends InlineChange {
  direction: CompatDirection;
}

/** enforceInlineScope 的返回 */
export interface EnforceInlineScopeResult {
  src: string;
  changes: InlineChange[];
  diagnostics: Diagnostic[];
}

/** 双向转换的返回 */
export interface NormalizeResult {
  src: string;
  changed: boolean;
  direction: CompatDirection;
  changes: DirectionalChange[];
  diagnostics: Diagnostic[];
}

/** 词法层解析出的元素开/闭事件 */
export interface ElementEvent {
  kind: 'open' | 'close';
  name: string;
  start: number;
  end: number;
}

/** detectEmbedStructuralEscape 的可选项 */
export interface EmbedScopeOptions {
  rawContainers?: ReadonlySet<string>;
}

/** 被空行截断的内联 HTML 开标签命中 */
export interface BlankLineSplitTagHit {
  /** 源坐标起点 */
  start: number;
  /** 源坐标终点 */
  end: number;
  tag: string;
}
