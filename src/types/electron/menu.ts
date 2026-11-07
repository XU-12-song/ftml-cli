/**
 * menu.ts — 原生应用菜单的类型
 */

/** buildAppMenu 的回调集合 */
export interface AppMenuOptions {
  /** 开发模式：多出「开发者工具」 */
  isDev?: boolean;
  onOpenProject?: () => void;
  onOpenFile?: () => void;
  onHide?: () => void;
  onQuit?: () => void;
  onReload?: () => void;
  onToggleDevTools?: () => void;
  onOpenDataDir?: () => void;
  onAbout?: () => void;
}
