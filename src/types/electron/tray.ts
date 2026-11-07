/**
 * tray.ts — 托盘图标与菜单的类型
 */

import type { ProjectEntry } from '../web/projects.ts';

/** 托盘菜单动作 */
export interface TrayHandlers {
  /** 最近项目（取前 5 个） */
  recentProjects?: ProjectEntry[];
  onOpen?: () => void;
  onOpenProject?: () => void;
  onOpenRecent?: (root: string) => void;
  onQuit?: () => void;
}

/** createTray 的参数 */
export interface CreateTrayOptions extends TrayHandlers {
  iconPath: string;
  tooltip?: string;
}
