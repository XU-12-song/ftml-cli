/**
 * projects.ts — web 编辑器项目注册表的数据结构
 */

/** 注册表条目 */
export interface ProjectEntry {
  /** 规范化后的项目根绝对路径（天然去重） */
  id: string;
  /** 显示名（目录名） */
  name: string;
  /** 项目根绝对路径 */
  root: string;
}
