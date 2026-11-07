/**
 * window-state.ts — 窗口位置/大小持久化的类型
 */

/** 矩形区域（与 Electron Rectangle 结构兼容） */
export interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 显示器信息（只取用得到的字段） */
export interface DisplayLike {
  bounds: Rectangle;
  workArea?: Rectangle;
}

/** 持久化的窗口状态 */
export interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized?: boolean;
}

/** 窗口最小子集：BrowserWindow 满足该结构，测试可传假对象 */
export interface TrackableWindow {
  on(event: string, listener: (...args: any[]) => void): unknown;
  isDestroyed?(): boolean;
  isMaximized?(): boolean;
  getNormalBounds(): Rectangle;
  getBounds(): Rectangle;
}

/** trackWindowState 的可选参数 */
export interface TrackWindowStateOptions {
  debounceMs?: number;
}
