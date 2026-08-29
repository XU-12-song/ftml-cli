/**
 * deploy — 构建 + 校验 + 提交（一步部署）
 *
 *   ftml deploy [-m "注释"] [--site <site>] [--page <page>] [--no-validate]
 *
 * 流程: build → validate（默认）→ submit。
 */

import { build } from './build.js';
import { validate } from './validate.js';
import { submit } from './submit.js';

export async function deploy(options) {
  const r = await build(options);
  console.log(`构建完成 → ${r.output}（${r.bytes} 字节）`);

  if (!options.noValidate) {
    const ok = await validate({ ...options, source: r.output, noBuild: true });
    if (ok !== 0) {
      throw new Error('校验未通过，中止部署');
    }
  }

  await submit({ ...options, noBuild: true, source: r.output });
  console.log('✓ 部署完成');
}
