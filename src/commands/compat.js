/**
 * compat — 理想 FTML ↔ Wikidot(脏) 双向兼容转换
 *
 *   ftml compat --list                         查看语言分歧表
 *   ftml compat -s <file> --to-ideal [-o <out>] Wikidot 源码 → 理想 FTML
 *   ftml compat -s <file> --to-dirt  [-o <out>] 理想 FTML → Wikidot 兼容源码
 *
 * 结果写 -o 文件（省略则写 stdout）；修复记录与诊断写 stderr，
 * 因此 stdout 可直接管道给下一个命令。
 * 退出码: 0 = 无错误级诊断, 1 = 有
 */

import fs from 'node:fs';
import path from 'node:path';
import { dirtToIdeal, idealToDirt, describeTable } from '../compat/index.js';
import { formatDiagnostics } from '../render/diagnostics.js';

export function compat(options) {
  if (options.list) {
    console.log(describeTable());
    return 0;
  }

  const toIdeal = Boolean(options.toIdeal);
  const toDirt = Boolean(options.toDirt);
  if (toIdeal === toDirt) {
    throw new Error('请用 --to-ideal 或 --to-dirt 指定转换方向（二选一）');
  }
  if (!options.source) {
    throw new Error('缺少输入文件，请用 -s <file> 指定');
  }

  const inputAbs = path.resolve(options.source);
  const original = fs.readFileSync(inputAbs, 'utf8');
  const result = toIdeal ? dirtToIdeal(original) : idealToDirt(original);

  if (options.output) {
    fs.writeFileSync(path.resolve(options.output), result.src, 'utf8');
  } else {
    process.stdout.write(result.src);
  }

  const file = path.relative(process.cwd(), inputAbs);
  for (const c of result.changes) {
    console.error(`~ 补全 [[/${c.tag}]] @ ${file}:${c.line}:${c.column}（${c.action}）`);
  }
  const report = formatDiagnostics(result.diagnostics, original, { file });
  if (report) console.error(report);
  if (!result.changed && result.diagnostics.length === 0) {
    console.error(`✓ ${file} 无需转换`);
  }

  return result.diagnostics.some((d) => d.severity === 'error') ? 1 : 0;
}
