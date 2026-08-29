/**
 * list — 列出可用的 .ftmx 模板
 *
 *   ftml list [--templates <dir>] [--json]
 */

import { loadTemplates } from '../core/expand.js';
import { loadConfig } from '../utils/config.js';

export async function list(options) {
  const config = loadConfig(options);
  const templates = await loadTemplates(config.templatesDirAbs);
  const names = [...templates.keys()].sort();

  if (options.json) {
    console.log(
      JSON.stringify(
        names.map((n) => ({
          name: n,
          keys: templates.get(n).keys,
        })),
        null,
        2
      )
    );
    return;
  }

  if (names.length === 0) {
    console.log('没有可用模板');
    return;
  }
  console.log('可用模板:');
  for (const n of names) {
    const keys = templates.get(n).keys;
    console.log(`  ${n}${keys.length ? `  { ${keys.join(', ')} }` : ''}`);
  }
}
