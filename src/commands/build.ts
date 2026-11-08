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
import { loadConfig } from '../infra/config.js';
import type { BuildOptions, BuildResult } from '../types/commands/build.ts';

export async function build(options: BuildOptions = {}): Promise<BuildResult> {
  const config = loadConfig(options);

  const inputAbs = options.source
    ? path.resolve(options.source)
    : config.sourceAbs;
  const outputAbs = options.output
    ? path.resolve(options.output)
    : config.outputAbs;

  let src: string;
  try {
    src = fs.readFileSync(inputAbs, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        `找不到源文件: ${inputAbs}\n` +
        '当前目录可能还不是 ftml 项目。运行 `ftml init` 初始化，或用 -s <文件> 指定源文件。'
      );
    }
    throw e;
  }

  const templates = await loadTemplates(config.templatesDirAbs);
  const result = expand(src, templates, { baseDir: path.dirname(inputAbs) });

  fs.mkdirSync(path.dirname(outputAbs), { recursive: true });
  fs.writeFileSync(outputAbs, result, 'utf8');

  return { input: inputAbs, output: outputAbs, bytes: Buffer.byteLength(result, 'utf8') };
}
