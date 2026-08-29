/**
 * config.js — 项目配置加载
 *
 * 配置来源（优先级从低到高）：
 *   - ftml.config.json / .ftmlrc.json（项目根目录）
 *   - 命令行选项
 *
 * 配置字段：
 *   source       输入 .ftml（含模板调用）
 *   output       构建产物输出路径
 *   templatesDir 模板目录（默认: ./templates）
 *   site         Wikidot 站点名（如 scpsandboxcn）
 *   page         Wikidot 页面名
 *   deploy.watch watch 默认开关
 */

import fs from 'node:fs';
import path from 'node:path';

export const CONFIG_FILES = ['ftml.config.json', '.ftmlrc.json', '.ftmlrc'];

export function findConfigDir(start = process.cwd()) {
  let dir = path.resolve(start);
  for (;;) {
    for (const name of CONFIG_FILES) {
      if (fs.existsSync(path.join(dir, name))) return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

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

  return config;
}

/** 解析模板目录：优先项目配置；回退输入文件同级 templates/；再回退内置模板 */
export function resolveTemplatesDir(config, inputFile) {
  const projectDir = path.resolve(config.root, config.templatesDir);
  if (fs.existsSync(projectDir)) return projectDir;
  const nearInput = path.join(path.dirname(path.resolve(inputFile)), 'templates');
  if (fs.existsSync(nearInput)) return nearInput;
  return path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'templates');
}

import { fileURLToPath } from 'node:url';
