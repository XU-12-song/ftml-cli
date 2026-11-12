/**
 * paths.ts — 路径与项目结构抽象
 *
 * 项目级隐藏数据目录（init 建立，结构按 init.js）：
 *   <项目根>/.ftml/
 *     history.json              提交历史（submit/revert 追加，JSON 数组）
 *     versions.json             版本清单（大版本 x / 小版本 x.y，见 versions.js）
 *     <源文件名>.json           lastRev 等元数据（index.json ↔ index.ftml）；
 *                               旧版 site/page 会在读取时迁移到项目配置
 *
 * 用户级共享目录（跨 ftml 项目共用）：
 *   ~/.ftml-cli/
 *     credentials.json          登录凭证（0600）
 *     cache/<site>/<page>.ftml  远程拉取的页面源码缓存
 *     settings.json             web 编辑器偏好（自动预览间隔等）
 *     snippets/                 自定义代码片段存储
 *
 * 测试可用环境变量 FTML_CLI_HOME 重定向用户级目录（避免污染真实家目录）。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const CONFIG_FILES: readonly string[] = [ 'ftml.config.json', '.ftmlrc.json', '.ftmlrc' ];

/** 向上查找配置文件所在目录（即项目根）；找不到返回 null */
export function findConfigDir(start: string = process.cwd()): string | null {
  let dir = path.resolve(start);
  for (; ;) {
    for (const name of CONFIG_FILES) {
      if (fs.existsSync(path.join(dir, name))) return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** 项目根：配置文件所在目录，否则 cwd */
export function projectRoot(start: string = process.cwd()): string {
  return findConfigDir(start) ?? path.resolve(start);
}

/** 项目级隐藏数据目录：<root>/.ftml */
export function projectFtmlDir(root: string = projectRoot()): string {
  return path.join(root, '.ftml');
}

/** 某源文件对应的元数据文件：<root>/.ftml/<basename>.json */
export function projectMetaPath(sourceAbs: string, root: string = projectRoot()): string {
  const base = path.basename(sourceAbs).replace(/\.[^.]+$/, '');
  return path.join(projectFtmlDir(root), `${base}.json`);
}

/** 提交历史文件：<root>/.ftml/history.json */
export function historyPath(root: string = projectRoot()): string {
  return path.join(projectFtmlDir(root), 'history.json');
}

/** 版本清单文件：<root>/.ftml/versions.json */
export function versionsPath(root: string = projectRoot()): string {
  return path.join(projectFtmlDir(root), 'versions.json');
}

/** 用户级目录：FTML_CLI_HOME 覆盖（测试用），否则 ~/.ftml-cli */
export function homeFtmlCliDir(): string {
  return process.env.FTML_CLI_HOME || path.join(os.homedir(), '.ftml-cli');
}

/** 凭证文件路径 */
export function credentialsPath(): string {
  return path.join(homeFtmlCliDir(), 'credentials.json');
}

/** 共享缓存目录 */
export function homeCacheDir(): string {
  return path.join(homeFtmlCliDir(), 'cache');
}

/** web 编辑器偏好设置文件 */
export function settingsPath(): string {
  return path.join(homeFtmlCliDir(), 'settings.json');
}

/** 自定义代码片段存储目录 */
export function snippetsDir(): string {
  return path.join(homeFtmlCliDir(), 'snippets');
}

/**
 * web 端「新建 ftml 仓库」的默认分区目录：~/.ftml-cli/projects/<仓库名>
 * 与已有项目物理隔离，避免新建的仓库散落在任意路径。
 * FTML_PROJECTS_DIR 可覆盖（测试/自定义分区用）。
 */
export function projectsBaseDir(): string {
  return process.env.FTML_PROJECTS_DIR || path.join(homeFtmlCliDir(), 'projects');
}
