/**
 * snippets.ts — 自定义代码片段的数据结构
 */

/** @description 已持久化的片段 */
export interface Snippet {
  name: string;
  /** 触发前缀，缺省同 name */
  prefix: string;
  description: string;
  /** 片段正文（含 Ace 制表位） */
  body: string;
  /** 来源标记（文件名 / import / user） */
  source: string;
  /** 内部字段：来源文件名，写回时按它分组 */
  _file?: string;
}

/** @description 从 Ace .snippets 文本解析出的片段（尚未补全字段） */
export interface ParsedSnippet {
  name: string;
  body: string;
}

/** @description 待写入/待导入的片段输入 */
export interface SnippetInput {
  name?: string;
  prefix?: string;
  description?: string;
  body?: string;
  source?: string;
}

/** @description 片段写入选项 */
export interface SaveSnippetsOptions {
  /** 指定单一文件名（只写这一个文件，丢弃分组） */
  file?: string;
  /** 强制按 _file 分组写回（默认行为） */
  group?: boolean;
}

/** @description 合并导入结果 */
export interface MergeSnippetsResult {
  added: number;
  updated: number;
  total: number;
  snippets: Snippet[];
}

/** @description 删除片段结果 */
export interface RemoveSnippetResult {
  removed: number;
  snippets: Snippet[];
}
