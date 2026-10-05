/**
 * build-cm6.mjs — 把 CodeMirror 6 打成前端可直接 <script type=module> 导入的
 * 单文件 ESM 包，输出到 src/web/public/vendor/cm6/cm6.js。
 *
 * 产物是提交进仓库的（用户机器上不需要 esbuild / node_modules 就能跑编辑器）。
 * 升级 CM6 或改动 vendor-src/cm6-entry.js 的导出后，重跑 `npm run build:cm6`。
 */
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

const entry = path.join(root, 'src/web/vendor-src/cm6-entry.js');
const outDir = path.join(root, 'src/web/public/vendor/cm6');
const outfile = path.join(outDir, 'cm6.js');

const PKGS = [
  '@codemirror/state',
  '@codemirror/view',
  '@codemirror/language',
  '@codemirror/commands',
  '@lezer/highlight',
];

/** 读各包 package.json 的版本 + license，生成随产物提交的许可清单 */
function licenseManifest() {
  const lines = [
    'ftml web 编辑器内置的 CodeMirror 6 前端产物（vendor/cm6/cm6.js）。',
    '以下第三方包均以 MIT 许可分发，版权归各自作者所有。',
    '',
  ];
  for (const pkg of PKGS) {
    let pj;
    try {
      pj = JSON.parse(readFileSync(require.resolve(`${pkg}/package.json`), 'utf8'));
    } catch {
      pj = { name: pkg, version: '?', license: 'MIT' };
    }
    lines.push(`${pj.name}@${pj.version} — ${pj.license || 'MIT'} — ${pj.homepage || ''}`.trimEnd());
  }
  return lines.join('\n') + '\n';
}

const banner = `/*! CodeMirror 6 bundle for ftml web editor. MIT licensed; see cm6.LICENSE.txt. Do not edit — run \`npm run build:cm6\`. */`;

await build({
  entryPoints: [entry],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2020'],
  minify: true,
  legalComments: 'none',
  sourcemap: false,
  banner: { js: banner },
  outfile,
});

writeFileSync(path.join(outDir, 'cm6.LICENSE.txt'), licenseManifest());

const kb = (readFileSync(outfile).length / 1024).toFixed(1);
console.log(`built ${path.relative(root, outfile)} (${kb} KB)`);
