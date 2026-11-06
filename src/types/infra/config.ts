/**
 * config.ts — 项目配置（ftml.config.json / .ftmlrc）相关类型
 */

import type { AbsolutePath } from '../common.ts';

/** 命令行覆盖项（commander 解析出的选项） */
export interface ConfigCliOptions {
  /** 显式项目根（web 多项目场景）；省略则从 cwd 向上查找 */
  root?: string;
  source?: string;
  output?: string;
  /** commander 把 --templates 解析到 templates */
  templates?: string;
  templatesDir?: string;
  site?: string | null;
  page?: string | null;
  watch?: boolean;
}

/** 配置文件字段（全部可选） */
export interface ProjectConfigFile {
  source?: string;
  output?: string;
  templatesDir?: string;
  site?: string | null;
  page?: string | null;
  lastRev?: number | null;
  watch?: boolean;
}

/** <root>/.ftml/<源文件名>.json 元数据 */
export interface ProjectMeta {
  site?: string | null;
  page?: string | null;
  lastRev?: number | null;
  [key: string]: unknown;
}

/** saveProjectMeta 的增量字段（与已有元数据合并） */
export interface ProjectMetaPatch {
  site?: string | null;
  page?: string | null;
  lastRev?: number | null;
}

/** loadConfig 的完整结果（相对路径已解析为绝对路径） */
export interface ProjectConfig {
  root: string;
  source: string;
  output: string;
  templatesDir: string;
  site: string | null;
  page: string | null;
  lastRev: number | null;
  watch: boolean;
  sourceAbs: AbsolutePath;
  outputAbs: AbsolutePath;
  templatesDirAbs: AbsolutePath;
}
