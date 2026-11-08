/**
 * deploy.ts — deploy 命令的选项与结果
 */

import type { ConfigCliOptions } from '../infra/config.ts';
import type { ClientFactory } from '../infra/wikidot.ts';

/** deploy 命令的选项 */
export interface DeployOptions extends ConfigCliOptions {
  message?: string;
  /** commander 的 --no-validate 解析为 false */
  validate?: boolean;
  /** isNegated 兼容写法 */
  noValidate?: boolean;
  /** commander 的 --no-push 解析为 false */
  push?: boolean;
  /** isNegated 兼容写法 */
  noPush?: boolean;
  /** commander 的 --no-deps 解析为 false */
  deps?: boolean;
  /** isNegated 兼容写法 */
  noDeps?: boolean;
  /** 跳过交互式确认（脚本 / CI） */
  yes?: boolean;
  clientFactory?: ClientFactory;
}

/** deploy 命令的结果 */
export interface DeployResult {
  /** 大版本号（数字字符串） */
  majorVersion: string;
  /** 部署后创建的小版本号 x.y */
  minorVersion: string;
  /** 本地提交 hash（空仓库时为 null） */
  hash: string | null;
  /** 发布后线上修订号 */
  revisionsCount: number;
}
