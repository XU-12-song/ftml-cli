/**
 * projects.ts — 项目注册表相关 API 的类型
 */

import type { ProjectEntry } from '../projects.ts';
import type { CapturedLog } from './shared.ts';

/** listProjects 返回的条目（附带 git 状态） */
export interface ProjectListItem extends ProjectEntry {
  isRepo: boolean;
  isClean: boolean;
}

/** 注册已有目录 */
export interface CreateProjectBody {
  root?: string;
}

/** 新建 FTML 仓库 */
export interface CreateFtmlProjectBody {
  /** 仓库名（必填，单层目录名） */
  name?: string;
  /** 自定义分区目录（默认 ~/.ftml-cli/projects） */
  parent?: string;
}

/** createFtmlProject 的返回值 */
export interface CreateFtmlProjectResult {
  ok: true;
  root: string;
  name: string;
  logs: CapturedLog[];
}
