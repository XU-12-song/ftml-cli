/**
 * watch.ts — watch 命令的选项
 */

import type { ConfigCliOptions } from '../infra/config.ts';

/** watch 命令的选项 */
export interface WatchOptions extends ConfigCliOptions {
  /** 防抖毫秒数（默认 300） */
  debounce?: number;
}
