/**
 * validate — 校验源文件：
 *   - 模板调用是否缺参数 / 未闭合
 *   - div 开闭标签是否平衡
 *   - [[style]] 是否配对
 *   - code 块是否闭合
 *   - 展开后是否残留未解析模板调用
 *
 *   ftml validate [source] [--templates <dir>]
 *
 * 退出码: 0 = 通过, 1 = 有错误
 */

import fs from 'node:fs';
import path from 'node:path';
import { expand, loadTemplates, findUnresolved } from '../core/expand.js';
import { loadConfig } from '../utils/config.js';

function count(str, re) {
  return (str.match(re) ?? []).length;
}

/**
 * 校验 FTML 源码，返回错误与警告。
 * 与 validate 命令共用同一套检查逻辑；web 编辑器用它做实时诊断。
 */
export function collectProblems(src, templates, baseDir) {
  const errors = [];
  const warnings = [];

  // div 平衡（组件本身可能刻意不平衡，≤10 记为警告，超出才报错）
  const divOpen = count(src, /\[\[div(?=\s|\]|$)/g);
  const divClose = count(src, /\[\[\/div\]\]/g);
  const divDiff = divOpen - divClose;
  if (divDiff !== 0) {
    const msg = `div 不平衡: 开 ${divOpen} / 闭 ${divClose}（差 ${Math.abs(divDiff)}）`;
    if (Math.abs(divDiff) <= 10) {
      warnings.push(msg);
    } else {
      errors.push(msg);
    }
  }

  // style 配对
  const styleOpen = count(src, /\[\[style\s*\]\]/g);
  const styleClose = count(src, /\[\[\/style\]\]/g);
  if (styleOpen !== styleClose) {
    errors.push(`[[style]] 未配对: 开 ${styleOpen} / 闭 ${styleClose}`);
  }

  // code 配对
  const codeOpen = count(src, /\[\[code(?:\s|])/g);
  const codeClose = count(src, /\[\[\/code\]\]/g);
  if (codeOpen !== codeClose) {
    errors.push(`[[code]] 未配对: 开 ${codeOpen} / 闭 ${codeClose}`);
  }

  // 尝试展开，捕获缺参/未闭合/循环等错误
  let expanded = null;
  try {
    expanded = expand(src, templates, { baseDir });
  } catch (e) {
    errors.push(`展开失败: ${e.message}`);
  }

  // 展开后残留
  if (expanded !== null) {
    const unresolved = findUnresolved(expanded, templates);
    if (unresolved.length > 0) {
      errors.push(`未解析的模板调用: ${[...new Set(unresolved)].join(', ')}`);
    }
  }

  return { errors, warnings };
}

export async function validate(options) {
  const config = loadConfig(options);
  const inputAbs = options.source
    ? path.resolve(options.source)
    : config.sourceAbs;

  if (!fs.existsSync(inputAbs)) {
    console.error(`✖ 输入文件不存在: ${inputAbs}`);
    return 1;
  }
  const src = fs.readFileSync(inputAbs, 'utf8');
  const templates = await loadTemplates(config.templatesDirAbs);
  const { errors, warnings } = collectProblems(src, templates, path.dirname(inputAbs));

  for (const w of warnings) console.warn(`⚠ ${w}`);

  if (errors.length === 0) {
    console.log(`✓ ${path.basename(inputAbs)} 校验通过`);
    return 0;
  }
  for (const p of errors) console.error(`✖ ${p}`);
  return 1;
}
