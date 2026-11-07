/**
 * stack.ts — 堆栈美化相关类型
 */

/** mapStack 的可选项 */
export interface StackMapOptions {
  cwd?: string;
  maxFrames?: number;
}

/** mapStack 的返回值 */
export interface StackMapResult {
  text: string;
  hasBundled: boolean;
}

/** formatFrame 的返回值；不是堆栈帧时为 null */
export interface FormattedFrame {
  text: string;
  bundled: boolean;
}
