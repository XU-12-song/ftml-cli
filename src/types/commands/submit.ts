/**
 * submit.ts — submit 命令的选项、结果与历史记录条目
 */

import type { ConfigCliOptions } from '../infra/config.ts';

/** submit 命令的选项 */
export interface SubmitOptions extends ConfigCliOptions {
  message?: string;
  /** commander 的 --no-build 解析为 false */
  build?: boolean;
  /** isNegated 兼容写法 */
  noBuild?: boolean;
}

/** submit 命令的结果 */
export interface SubmitResult {
  /** 创建的小版本号 x.y */
  version: string;
  /** 本地提交 hash（无改动且空仓库时为 null） */
  hash: string | null;
  /** 是否因无文件改动而沿用已有提交 */
  skipped: boolean;
  /** 提交前规划的小版本号 */
  plannedVersion: string;
}

/** 提交历史条目类型 */
export type HistoryEntryType = 'submit' | 'major' | 'revert';

/** .ftml/history.json 中的一条记录 */
export interface HistoryEntry {
  commit_hash: string | null;
  comment: string;
  version?: string;
  wikidotVersion?: number;
  type: HistoryEntryType;
}
