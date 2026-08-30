#!/usr/bin/env node
/**
 * ftml — FTML 工作流 CLI
 *
 * 命令:
 *   login     登录 Wikidot（凭证存 ~/.ftml-cli/credentials.json，或读环境变量）
 *   build     构建：展开模板调用 → 纯 FTML（配置驱动）
 *   expand    单文件展开（stdout 或 -o 输出）
 *   list      列出可用模板
 *   validate  校验源文件（div/style/code 配对、模板调用、残留）
 *   watch     监听源文件/模板变化，自动重新构建
 *   submit    构建并提交到 Wikidot 页面（-m 编辑注释）
 *   deploy    构建 + 校验 + 提交（一步部署）
 *   revert    从 Wikidot 拉取线上/历史版本覆盖本地
 */

import { Command } from 'commander';
import { login } from './commands/login.js';
import { build } from './commands/build.js';
import { expandCommand } from './commands/expand.js';
import { list } from './commands/list.js';
import { validate } from './commands/validate.js';
import { watch } from './commands/watch.js';
import { submit } from './commands/submit.js';
import { deploy } from './commands/deploy.js';
import { revert } from './commands/revert.js';
import { preview } from './commands/preview.js';

const program = new Command();

program
  .name('ftml')
  .description('FTML 工作流 CLI：模板展开、构建、校验、监听、Wikidot 提交/部署/回退')
  .version('0.1.0');

// ---- login ----
program
  .command('login')
  .description('登录 Wikidot 并保存凭证到 ~/.ftml-cli/credentials.json')
  .option('--env', '从环境变量 WIKIDOT_USERNAME / WIKIDOT_PASSWORD 读取并保存')
  .action(async (opts) => {
    await run(() => login(opts));
  });

// ---- build ----
program
  .command('build')
  .description('构建：展开模板调用，输出纯 FTML（默认读配置）')
  .option('-s, --source <file>', '输入源文件')
  .option('-o, --output <file>', '输出文件')
  .option('-t, --templates <dir>', '模板目录')
  .action(async (opts) => {
    await run(async () => {
      const r = await build(opts);
      console.log(`✓ 构建完成 → ${r.output}（${r.bytes} 字节）`);
    });
  });

// ---- expand ----
program
  .command('expand')
  .description('单文件展开（输出到 stdout 或 -o 文件）')
  .argument('<source>', '输入 .ftml 文件')
  .option('-o, --output <file>', '输出文件')
  .option('-t, --templates <dir>', '模板目录')
  .action(async (source, opts) => {
    await run(() => expandCommand({ ...opts, source }));
  });

// ---- list ----
program
  .command('list')
  .description('列出可用模板')
  .option('-t, --templates <dir>', '模板目录')
  .option('--json', 'JSON 输出')
  .action(async (opts) => {
    await run(() => list(opts));
  });

// ---- validate ----
program
  .command('validate')
  .description('校验源文件（div/style/code 配对、模板调用、残留）')
  .option('-s, --source <file>', '输入源文件')
  .option('-t, --templates <dir>', '模板目录')
  .action(async (opts) => {
    const code = await run(() => validate(opts));
    process.exitCode = code ?? 0;
  });

// ---- watch ----
program
  .command('watch')
  .description('监听源文件/模板变化，自动重新构建')
  .option('-s, --source <file>', '输入源文件')
  .option('-o, --output <file>', '输出文件')
  .option('-t, --templates <dir>', '模板目录')
  .option('--debounce <ms>', '防抖毫秒', '300')
  .action(async (opts) => {
    await run(() => watch({ ...opts, debounce: Number(opts.debounce) }));
  });

// ---- submit ----
program
  .command('submit')
  .description('构建并提交到 Wikidot 页面')
  .option('-m, --message <text>', '编辑注释', 'ftml-cli 提交')
  .option('--site <site>', '站点名（覆盖配置）')
  .option('--page <page>', '页面名（覆盖配置）')
  .option('-s, --source <file>', '要提交的文件（默认构建产物）')
  .option('--no-build', '不构建，直接提交指定文件')
  .action(async (opts) => {
    await run(() => submit(opts));
  });

// ---- deploy ----
program
  .command('deploy')
  .description('构建 + 校验 + 提交（一步部署）')
  .option('-m, --message <text>', '编辑注释', 'ftml-cli 部署')
  .option('--site <site>', '站点名（覆盖配置）')
  .option('--page <page>', '页面名（覆盖配置）')
  .option('--no-validate', '跳过校验')
  .action(async (opts) => {
    await run(() => deploy(opts));
  });

// ---- preview ----
program
  .command('preview')
  .description('构建并渲染为 HTML 预览（@wdprlib/render）')
  .option('-s, --source <file>', '输入源文件')
  .option('-o, --output <file>', 'HTML 输出文件（默认 build 产物同名 .html）')
  .option('-t, --templates <dir>', '模板目录')
  .option('--site <site>', '站点名（用于解析站内引用）')
  .option('--page <page>', '页面名（用于解析站内引用）')
  .option('--open', '生成后用系统浏览器打开')
  .action(async (opts) => {
    await run(() => preview(opts));
  });

// ---- revert ----
program
  .command('revert')
  .description('从 Wikidot 拉取线上/历史版本覆盖本地')
  .option('--site <site>', '站点名（覆盖配置）')
  .option('--page <page>', '页面名（覆盖配置）')
  .option('--to <rev>', '历史修订号（revNo 或 id）')
  .option('--output <file>', '写入指定文件而不是覆盖本地 source')
  .action(async (opts) => {
    await run(() => revert(opts));
  });

/** 统一错误处理与退出码 */
async function run(fn) {
  try {
    return await fn();
  } catch (e) {
    console.error(`错误: ${e.message}`);
    process.exitCode = 1;
  }
}

program.parse(process.argv);
