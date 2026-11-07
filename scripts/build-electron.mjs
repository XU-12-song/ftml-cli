/**
 * build-electron.mjs — 把主进程与 src/ 的 TS 编译成可被 Electron 直接运行的 JS。
 *
 * 开发/测试用 tsx 解析 .ts；打包后的应用没有 tsx，所以必须先编译：
 *   electron/main.ts      -> build/electron/main.js
 *   electron/preload.cjs  -> build/electron/preload.cjs（原样复制）
 *   src 下的 TS           -> build/src 下同结构的 JS
 * 前端静态资源（含 build:web 产物 dist/）整体复制到 build/src/web/public，
 * 保证 server.ts 里的 `__dirname/public` 在打包后仍然成立。
 *
 *   npm run build:electron
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = path.join(root, 'build');
const tsc = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');

fs.rmSync(buildDir, { recursive: true, force: true });

const result = spawnSync(process.execPath, [tsc, '-p', path.join(root, 'tsconfig.build.json')], {
  cwd: root,
  stdio: 'inherit',
});
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

fs.mkdirSync(path.join(buildDir, 'electron'), { recursive: true });
fs.copyFileSync(
  path.join(root, 'electron', 'preload.cjs'),
  path.join(buildDir, 'electron', 'preload.cjs'),
);

const publicDir = path.join(root, 'src', 'web', 'public');
if (!fs.existsSync(path.join(publicDir, 'dist', 'app.js'))) {
  console.warn('[build:electron] 警告：缺少 src/web/public/dist/app.js，请先运行 npm run build:web');
}
fs.cpSync(publicDir, path.join(buildDir, 'src', 'web', 'public'), { recursive: true });

console.log('[build:electron] 输出目录 build/');
