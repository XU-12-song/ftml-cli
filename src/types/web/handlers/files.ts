/**
 * files.ts — 项目作用域文件读写 API 的类型
 */

import type { ProjectConfig } from '../../infra/config.ts';

/** 侧边栏中的模板条目（自动补全数据源） */
export interface SidebarTemplate {
  name: string;
  keys: string[];
  path: string;
}

/** 侧边栏中的组件条目 */
export interface SidebarComponent {
  name: string;
  path: string;
}

/** getSidebar 的返回值 */
export interface Sidebar {
  root: string;
  name: string;
  templates: SidebarTemplate[];
  components: SidebarComponent[];
  sources: string[];
  isRepo: boolean;
  isClean: boolean;
}

/** 读取源文件的结果 */
export interface ReadFileResult {
  path: string;
  source: string;
}

/** 保存源文件的请求体 */
export interface SaveFileBody {
  path?: string;
  source?: unknown;
}

/** 保存源文件的结果 */
export interface SaveFileResult {
  path: string;
}

/** 保存 site/page 元数据的请求体 */
export interface SaveTargetBody {
  path?: string;
  site?: string | null;
  page?: string | null;
  lastRev?: number | null;
}

/** saveTargetPage 的返回值 */
export type SaveTargetResult = ProjectConfig;
