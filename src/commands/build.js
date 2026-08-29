/**
 * build — 构建：展开模板调用，输出纯 FTML
 *
 *   ftml build [source] [-o output] [--templates <dir>]
 *
 * 默认从配置文件读取 source/output/templatesDir。
 * 产物写入 output 所在目录（自动创建）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { expand, loadTemplates } from '../core/expand.js';
import { loadConfig } from '../utils/config.js';

export async function build(options = {}) {
  const config = loadConfig(options);

  const inputAbs = options.source
    ? path.resolve(options.source)
    : config.sourceAbs;
  const outputAbs = options.output
    ? path.resolve(options.output)
    : config.outputAbs;

  const src = fs.readFileSync(inputAbs, 'utf8');

  const templates = await loadTemplates(config.templatesDirAbs);
  const result = expand(src, templates, { baseDir: path.dirname(inputAbs) });

  fs.mkdirSync(path.dirname(outputAbs), { recursive: true });
  fs.writeFileSync(outputAbs, result, 'utf8');

  return { input: inputAbs, output: outputAbs, bytes: Buffer.byteLength(result, 'utf8') };
}
