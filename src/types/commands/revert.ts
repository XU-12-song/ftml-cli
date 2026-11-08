/**
 * revert.ts — revert 命令的选项与结果
 */

import type { ConfigCliOptions } from '../infra/config.ts';
import type { ClientFactory } from '../infra/wikidot.ts';
import type { VersionRow } from '../domain/versions.ts';

/** revert 命令的选项 */
export interface RevertOptions extends ConfigCliOptions {
  /** 列出可回退的版本 */
  list?: boolean;
  /** 版本号 x / x.y，或 git 修订（hash / HEAD~n，默认 HEAD） */
  to?: string;
  /** commander 的 --no-wikidot 解析为 false */
  wikidot?: boolean;
  /** isNegated 兼容写法 */
  noWikidot?: boolean;
  /** 工作区有未提交改动时先自动提交 */
  autoCommit?: boolean;
  /** git revert 后重新构建产物 */
  rebuild?: boolean;
  /** 跳过交互式确认（脚本 / CI） */
  yes?: boolean;
  clientFactory?: ClientFactory;
}

/** revert 命令的结果 */
export interface RevertResult {
  /** 本地回退产生的提交；--list 与 --no-wikidot 分支可能没有 */
  hash?: string | null;
  /** 回退后的版本清单 */
  versions: VersionRow[];
}
