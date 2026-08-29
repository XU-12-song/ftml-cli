/**
 * expand — 单文件展开（同 build，但输出到 stdout，不依赖配置）
 *
 *   ftml expand <input.ftml> [-o output] [--templates <dir>]
 *
 * 模板目录解析：--templates > 输入同级 templates/ > 内置 templates/。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expand, loadTemplates } from '../core/expand.js';

const BUILTIN = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'templates'
);

export async function expandCommand(options) {
  const input = options.source;
  if (!input) {
    throw new Error('缺少输入文件。用法: ftml expand <input.ftml> [-o output]');
  }
  const inputAbs = path.resolve(input);
  const src = fs.readFileSync(inputAbs, 'utf8');

  let templatesDir;
  const cliTpl = options.templates ?? options.templatesDir;
  if (cliTpl) {
    templatesDir = path.resolve(cliTpl);
  } else {
    const nearInput = path.join(path.dirname(inputAbs), 'templates');
    templatesDir = fs.existsSync(nearInput) ? nearInput : BUILTIN;
  }

  const templates = await loadTemplates(templatesDir);
  const result = expand(src, templates, { baseDir: path.dirname(inputAbs) });

  if (options.output) {
    const outAbs = path.resolve(options.output);
    fs.mkdirSync(path.dirname(outAbs), { recursive: true });
    fs.writeFileSync(outAbs, result, 'utf8');
    console.log(`已写入 ${outAbs}（${Buffer.byteLength(result, 'utf8')} 字节）`);
  } else {
    process.stdout.write(result + '\n');
  }

  return { bytes: Buffer.byteLength(result, 'utf8') };
}
