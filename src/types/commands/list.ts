/**
 * list.ts — list 命令的选项
 */

import type { ConfigCliOptions } from '../infra/config.ts';

/** list 命令的选项 */
export interface ListOptions extends ConfigCliOptions {
  /** 以 JSON 输出模板名与参数键 */
  json?: boolean;
}
