/**
 * files.ts — 项目作用域文件读写 API 的类型
 */

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

/** 保存项目级 site/page 的请求体 */
export interface SaveTargetBody {
  site?: string | null;
  page?: string | null;
}

/** 项目级目标（读取/保存共用） */
export interface SaveTargetResult {
  site: string | null;
  page: string | null;
  /** 实际写入的配置文件；读取时不存在则为 null */
  file: string | null;
}
