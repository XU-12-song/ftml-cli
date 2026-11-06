/**
 * git.ts — git 封装的结果与选项类型
 */

/** commitAll 的结果；无改动时 skipped=true，hash 为当前 HEAD（可能为 null） */
export interface CommitOutcome {
  hash: string | null;
  skipped: boolean;
}

/** gitRevert 的选项 */
export interface GitRevertOptions {
  /** 反向提交说明 */
  message?: string;
  /** 回退前的提交：从它取回 keepPaths，覆盖 revert 的影响 */
  keepFrom?: string;
  /** 不参与回退的路径（版本账本等），需配 keepFrom */
  keepPaths?: string[];
}

/** 最近提交记录（新→旧） */
export interface RecentCommit {
  hash: string;
  message: string;
  date: string;
}

/** pushCurrent 的选项 */
export interface PushCurrentOptions {
  remote?: string;
  branch?: string;
}

/**
 * pushCurrent 的结果。
 * 未配置远端/推送失败时 pushed=false 并给出 reason，而不是抛错。
 */
export interface PushOutcome {
  pushed: boolean;
  reason?: string;
  remote?: string;
  branch?: string | null;
}
