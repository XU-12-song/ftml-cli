/**
 * watch — 监听源文件 / 模板 / 组件变化，自动重新构建
 *
 *   ftml watch [source] [--templates <dir>] [--debounce <ms>]
 *
 * 监听范围：输入源文件、templatesDir 下所有 .ftmx、源文件同目录下所有 .ftml 组件。
 */

import fs from 'node:fs';
import path from 'node:path';
import chokidar from 'chokidar';
import { build } from './build.js';
import { loadConfig } from '../utils/config.js';

export async function watch(options) {
  const config = loadConfig(options);
  const debounce = options.debounce ?? 300;

  // 监听目标
  const targets = [config.sourceAbs];
  const tplDir = config.templatesDirAbs;
  if (fs.existsSync(tplDir)) targets.push(tplDir);

  // 源文件同目录的组件
  const srcDir = path.dirname(config.sourceAbs);
  targets.push(path.join(srcDir, '**/*.ftml'));

  console.log(`监听中（${config.sourceAbs}），Ctrl+C 停止…`);

  let building = false;
  let pending = false;

  async function runBuild() {
    if (building) {
      pending = true;
      return;
    }
    building = true;
    const t0 = Date.now();
    try {
      const r = await build(options);
      console.log(`构建完成 → ${r.output}（${r.bytes} 字节，${Date.now() - t0}ms）`);
    } catch (e) {
      console.error(`构建失败: ${e.message}`);
    } finally {
      building = false;
      if (pending) {
        pending = false;
        runBuild();
      }
    }
  }

  await runBuild();

  const watcher = chokidar.watch(targets, { ignoreInitial: true });
  watcher.on('all', (_event, file) => {
    if (file.includes('node_modules')) return;
    console.log(`变化: ${file}`);
    setTimeout(runBuild, debounce);
  });
}
