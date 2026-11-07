/**
 * file-open.ts — 文件关联参数解析的类型
 */

/** 向上查找得到的项目根 */
export interface FtmlProjectRoot {
  root: string;
  /** 是否命中项目标记（配置 / .ftml / templates+components） */
  isProject: boolean;
}

/** 一次打开请求的目标 */
export interface OpenTarget {
  /** 项目根绝对路径 */
  project: string;
  /** 项目内相对路径（斜杠分隔）；仅打开项目时为 null */
  file: string | null;
}

/** .ftml 文件解析出的完整目标 */
export interface ResolvedOpenTarget extends OpenTarget {
  file: string;
  /** false = 松散文件，注册为工作区前需要询问 */
  isProject: boolean;
}
