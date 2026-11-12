/**
 * config.ts — 项目配置加载
 *
 * site/page 是**项目级**配置，来源（优先级从低到高）：
 *   1. <root>/.ftml/<源文件名>.json  旧版按文件保存的元数据（仅兼容，读取时会迁移）
 *   2. ftml.config.json / .ftmlrc.json / .ftmlrc（项目根）
 *   3. 命令行选项
 *
 * 迁移后 site/page 只存在于项目配置文件；元数据仅保留 lastRev。
 *
 * 其余配置字段：
 *   source       输入 .ftml（含模板调用）
 *   output       构建产物输出路径
 *   templatesDir 模板目录（默认: ./templates）
 *   lastRev      submit 时记录的线上修订号（元数据，仅供扩展）
 */

import fs from 'node:fs';
import path from 'node:path';
import { findConfigDir, CONFIG_FILES, projectFtmlDir, projectMetaPath } from './paths.js';
import { fileURLToPath } from 'node:url';
import type {
  ConfigCliOptions,
  ProjectConfig,
  ProjectConfigFile,
  ProjectMeta,
  ProjectMetaPatch,
} from '../types/infra/config.ts';

export { findConfigDir };

/** 项目根下实际存在的配置文件（按 CONFIG_FILES 顺序），没有则 null */
export function findConfigFile(root: string): string | null {
  for (const name of CONFIG_FILES) {
    const p = path.join(root, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/** 读取项目配置文件原始字段（不合并默认值/命令行）；不存在返回 {} */
export function readProjectConfigFile(root: string): ProjectConfigFile {
  const file = findConfigFile(root);
  if (!file) return {};
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as ProjectConfigFile;
  } catch (e) {
    throw new Error(`配置文件 ${file} 解析失败: ${(e as Error).message}`);
  }
}

function normalizeTargetValue(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() || null : null;
}

export interface ProjectTarget {
  site: string | null;
  page: string | null;
  /** 实际读取到的配置文件；没有配置文件时为 null */
  file: string | null;
}

/** 读取项目级目标（会顺手完成旧元数据迁移） */
export function readProjectTarget(root: string): ProjectTarget {
  const migrated = migrateProjectTarget(root);
  const data = readProjectConfigFile(root);
  return {
    // 迁移写入失败（只读项目等）时仍返回旧元数据里的值
    site: normalizeTargetValue(data.site) ?? migrated.site,
    page: normalizeTargetValue(data.page) ?? migrated.page,
    file: findConfigFile(root),
  };
}

/**
 * 保存项目级 site/page：
 * - 写回已有配置文件；没有则创建 .ftmlrc.json
 * - 保留其它字段；空值删除对应字段（支持清空目标）
 * - 同时清除旧版元数据里的 site/page，避免清空后旧值复活
 */
export function saveProjectTarget(
  root: string,
  site?: string | null,
  page?: string | null,
): ProjectTarget & { file: string } {
  const data = { ...readProjectConfigFile(root) };
  const s = normalizeTargetValue(site);
  const p = normalizeTargetValue(page);
  if (s) data.site = s;
  else delete data.site;
  if (p) data.page = p;
  else delete data.page;

  const file = findConfigFile(root) ?? path.join(root, '.ftmlrc.json');
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
  stripTargetFieldsFromMeta(root);
  return { site: s, page: p, file };
}

/** .ftml/ 下的元数据文件（排除历史/版本清单） */
function metaPaths(root: string): string[] {
  let names: string[];
  try {
    names = fs.readdirSync(projectFtmlDir(root));
  } catch {
    return [];
  }
  return names
    .filter((n) => n.endsWith('.json') && n !== 'history.json' && n !== 'versions.json')
    .sort()
    .map((n) => path.join(projectFtmlDir(root), n));
}

function readMetaFile(file: string): ProjectMeta | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as ProjectMeta;
  } catch {
    return null;
  }
}

/** 删除所有元数据里的 site/page（保留 lastRev 等其它字段） */
function stripTargetFieldsFromMeta(root: string): void {
  for (const file of metaPaths(root)) {
    const meta = readMetaFile(file);
    if (!meta || (!('site' in meta) && !('page' in meta))) continue;
    delete meta.site;
    delete meta.page;
    try {
      fs.writeFileSync(file, JSON.stringify(meta, null, 2) + '\n', 'utf8');
    } catch {
      /* 只读/权限问题不阻断迁移 */
    }
  }
}

/**
 * 旧版 site/page 存在 <root>/.ftml/<源文件名>.json。迁移到项目配置后删除旧字段。
 *
 * 多文件冲突时：优先配置 source（默认 index.ftml）对应的元数据，其余按文件名排序，
 * site/page 各取第一个非空值。
 */
export function migrateProjectTarget(root: string): { site: string | null; page: string | null } {
  const data = readProjectConfigFile(root);
  let site = normalizeTargetValue(data.site);
  let page = normalizeTargetValue(data.page);
  let changed = false;

  if (!site || !page) {
    const preferred = projectMetaPath(path.resolve(root, data.source ?? 'index.ftml'), root);
    const paths = metaPaths(root);
    const ordered = paths.includes(preferred)
      ? [preferred, ...paths.filter((p) => p !== preferred)]
      : [preferred, ...paths];
    for (const file of ordered) {
      const meta = readMetaFile(file);
      if (!meta) continue;
      if (!site) {
        const v = normalizeTargetValue(meta.site);
        if (v) { site = v; changed = true; }
      }
      if (!page) {
        const v = normalizeTargetValue(meta.page);
        if (v) { page = v; changed = true; }
      }
      if (site && page) break;
    }
  }

  if (changed) {
    try {
      saveProjectTarget(root, site, page);
    } catch {
      /* 只读项目：本次仍使用迁移出的值，不阻断读取 */
    }
  } else {
    stripTargetFieldsFromMeta(root);
  }
  return { site, page };
}

/** 加载配置：无配置文件时返回默认值 */
export function loadConfig(cliOptions: ConfigCliOptions = {}): ProjectConfig {
  // 显式 root 优先（web 编辑器多项目场景）；否则从 cwd 向上查找配置文件
  const configDir = cliOptions.root || findConfigDir();
  const file: ProjectConfigFile = configDir ? readProjectConfigFile(configDir) : {};

  const config: Omit<ProjectConfig, 'sourceAbs' | 'outputAbs' | 'templatesDirAbs'> = {
    root: configDir || process.cwd(),
    source: file.source ?? 'index.ftml',
    output: file.output ?? 'dist/index.ftml',
    templatesDir: file.templatesDir ?? 'templates',
    site: file.site ?? null,
    page: file.page ?? null,
    lastRev: file.lastRev ?? null,
    watch: file.watch ?? false,
  };

  // 命令行覆盖（commander 把 --templates 解析为 cliOptions.templates）
  if (cliOptions.source) config.source = cliOptions.source;
  if (cliOptions.output) config.output = cliOptions.output;
  const cliTpl = cliOptions.templates ?? cliOptions.templatesDir;
  if (cliTpl) config.templatesDir = cliTpl;
  if (cliOptions.site) config.site = cliOptions.site;
  if (cliOptions.page) config.page = cliOptions.page;
  if (cliOptions.watch !== undefined) config.watch = cliOptions.watch;

  // 路径相对于配置所在目录解析
  const sourceAbs = path.resolve(config.root, config.source);

  // 最低优先级：旧版 .ftml/<源文件名>.json 元数据（site/page）。
  // 新目标统一存项目配置；这里只为尚未迁移的旧项目保留回退。
  const meta = loadProjectMeta(sourceAbs, config.root);
  if (meta) {
    if (!config.site) config.site = meta.site ?? null;
    if (!config.page) config.page = meta.page ?? null;
    if (config.lastRev == null) config.lastRev = meta.lastRev ?? null;
  }

  return {
    ...config,
    sourceAbs,
    outputAbs: path.resolve(config.root, config.output),
    templatesDirAbs: path.resolve(config.root, config.templatesDir),
  };
}

/** 读取 <root>/.ftml/<源文件名>.json 元数据；不存在或损坏返回 null */
export function loadProjectMeta(sourceAbs: string, root: string = process.cwd()): ProjectMeta | null {
  try {
    return JSON.parse(fs.readFileSync(projectMetaPath(sourceAbs, root), 'utf8')) as ProjectMeta;
  } catch {
    return null;
  }
}

/** 写入/更新某源文件的元数据（lastRev 等，保留已有字段；site/page 已迁到项目配置） */
export function saveProjectMeta(
  sourceAbs: string,
  fields: ProjectMetaPatch,
  root: string = process.cwd(),
): void {
  const p = projectMetaPath(sourceAbs, root);
  const prev = loadProjectMeta(sourceAbs, root) ?? {};
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ ...prev, ...fields }, null, 2) + '\n', 'utf8');
}

/** 解析模板目录：优先项目配置；回退输入文件同级 templates/；再回退内置模板 */
export default function resolveTemplatesDir(
  config: Pick<ProjectConfig, 'root' | 'templatesDir'>,
  inputFile: string,
): string {
  const projectDir = path.resolve(config.root, config.templatesDir);
  if (fs.existsSync(projectDir)) return projectDir;
  const nearInput = path.join(path.dirname(path.resolve(inputFile)), 'templates');
  if (fs.existsSync(nearInput)) return nearInput;
  return path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'templates');
}
