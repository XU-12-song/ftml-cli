/**
 * build-web.mjs — 把 web 编辑器前端（src/web/public/js/*.js）打成一个 ESM：
 * src/web/public/dist/app.js
 *
 * CodeMirror 6 仍是单独构建的 vendor/cm6/cm6.js（见 build-cm6.mjs）：
 * 它体量大、更新少，单独缓存；这里标记为 external，不重复内联。
 * 注意 outfile 必须与 js/ 同深度（dist/ 与 js/ 都在 public/ 下），
 * 否则产物里 `../vendor/cm6/cm6.js` 的相对路径会指错。
 *
 * 产物与 sourcemap 提交进仓库：用户机器无需 esbuild / npm 即可直接运行编辑器。
 * 改动前端源码后需重新构建（或开发时用 watch）。
 *
 *   npm run build:web          构建一次
 *   npm run build:web:watch    监听改动并重建
 */
import { build, context } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entry = path.join(root, 'src/web/public/js/main.js');
const outfile = path.join(root, 'src/web/public/dist/app.js');
const watch = process.argv.includes('--watch');

const banner = '/*! ftml web editor bundle. Do not edit — run `npm run build:web`. */';

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: [entry],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2020'],
  minify: false, // 本地服务，保留可读堆栈
  sourcemap: true, // dist/app.js.map：devtools 里映射回原始模块
  legalComments: 'none',
  banner: { js: banner },
  external: ['*/vendor/cm6/cm6.js'],
  logLevel: 'info',
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log('[build:web] watching src/web/public/js …');
} else {
  await build(options);
}
