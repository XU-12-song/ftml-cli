/**
 * config.js — 项目配置加载
 *
 * site/page 来源（优先级从低到高）：
 *   1. <root>/.ftml/<源文件名>.json  元数据（submit/revert 时写入）
 *   2. ftml.config.json / .ftmlrc.json / .ftmlrc（项目根）
 *   3. 命令行选项
 *
 * 其余配置字段：
 *   source       输入 .ftml（含模板调用）
 *   output       构建产物输出路径
 *   templatesDir 模板目录（默认: ./templates）
 *   lastRev      submit 时记录的线上修订号（元数据，仅供扩展）
 */

import fs from 'node:fs';
import path from 'node:path';
import { findConfigDir, CONFIG_FILES, projectMetaPath } from './paths.js';
import { fileURLToPath } from 'node:url';

export { findConfigDir };

/** 加载配置：无配置文件时返回默认值 */
export function loadConfig(cliOptions = {}) {
  const configDir = findConfigDir();
  let file = {};
  if (configDir) {
    for (const name of CONFIG_FILES) {
      const p = path.join(configDir, name);
      if (fs.existsSync(p)) {
        try {
          file = JSON.parse(fs.readFileSync(p, 'utf8'));
        } catch (e) {
          throw new Error(`配置文件 ${p} 解析失败: ${e.message}`);
        }
        break;
      }
    }
  }

  const config = {
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
  config.sourceAbs = path.resolve(config.root, config.source);
  config.outputAbs = path.resolve(config.root, config.output);
  config.templatesDirAbs = path.resolve(config.root, config.templatesDir);

  // 最低优先级：.ftml/<源文件名>.json 元数据（site/page）
  const meta = loadProjectMeta(config.sourceAbs, config.root);
  if (meta) {
    if (!config.site) config.site = meta.site ?? null;
    if (!config.page) config.page = meta.page ?? null;
    if (config.lastRev == null) config.lastRev = meta.lastRev ?? null;
  }

  return config;
}

/** 读取 <root>/.ftml/<源文件名>.json 元数据；不存在或损坏返回 null */
export function loadProjectMeta(sourceAbs, root = process.cwd()) {
  try {
    return JSON.parse(fs.readFileSync(projectMetaPath(sourceAbs, root), 'utf8'));
  } catch {
    return null;
  }
}

/** 写入/更新某源文件的元数据（site/page/lastRev 合并，保留已有字段） */
export function saveProjectMeta(sourceAbs, fields, root = process.cwd()) {
  const p = projectMetaPath(sourceAbs, root);
  const prev = loadProjectMeta(sourceAbs, root) ?? {};
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ ...prev, ...fields }, null, 2) + '\n', 'utf8');
}

/** 解析模板目录：优先项目配置；回退输入文件同级 templates/；再回退内置模板 */
export default function resolveTemplatesDir(config, inputFile) {
  const projectDir = path.resolve(config.root, config.templatesDir);
  if (fs.existsSync(projectDir)) return projectDir;
  const nearInput = path.join(path.dirname(path.resolve(inputFile)), 'templates');
  if (fs.existsSync(nearInput)) return nearInput;
  return path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'templates');
}
