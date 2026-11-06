/**
 * gitenv.ts — git 环境体检类型
 */

/** detectGitEnv / assertGitReady 的选项 */
export interface GitEnvOptions {
  /** 项目目录（判断 isRepo；目录不存在时跳过） */
  root?: string;
}

/** 体检结果 */
export interface GitEnv {
  installed: boolean;
  /** git 版本号（如 "2.47.3"），未安装为 null */
  version: string | null;
  isRepo: boolean;
  userName: string | null;
  userEmail: string | null;
  configured: boolean;
  /** 人类可读的问题列表 */
  problems: string[];
  /** 对应的修复命令列表 */
  hints: string[];
}
