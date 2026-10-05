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
 *   compat    理想 FTML ↔ Wikidot 兼容转换（--list 查看语言分歧表）
 *   revert    git revert 并回推 Wikidot（撤销提交 + 线上同步回退）
 *   init      初始化 ftml 项目（.ftml/ 结构）
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
import { compat } from './commands/compat.js';
import { init } from './commands/init.js';
import { web } from './commands/web.js';
import { detectGitEnv } from './infra/gitenv.js';

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
  .description('本地提交：git commit + 创建小版本号（不发线上）')
  .option('-m, --message <text>', '提交说明（必填）')
  .option('--site <site>', '站点名（覆盖配置）')
  .option('--page <page>', '页面名（覆盖配置）')
  .option('-s, --source <file>', '要提交的源文件（默认配置的 source）')
  .option('--no-build', '不构建，直接使用现有产物')
  .action(async (opts) => {
    await run(() => submit(opts));
  });

// ---- deploy ----
program
  .command('deploy')
  .description('创建大版本 + 推送远端 + 发布 Wikidot + submit')
  .option('-m, --message <text>', '部署说明（必填）')
  .option('--site <site>', '站点名（覆盖配置）')
  .option('--page <page>', '页面名（覆盖配置）')
  .option('--no-validate', '跳过校验')
  .option('--no-push', '不推送 git 远端')
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

// ---- compat ----
program
  .command('compat')
  .description('理想 FTML ↔ Wikidot 兼容转换（--list 查看分歧表）')
  .option('-s, --source <file>', '输入文件')
  .option('-o, --output <file>', '输出文件（默认 stdout）')
  .option('--to-ideal', 'Wikidot 源码 → 理想 FTML')
  .option('--to-dirt', '理想 FTML → Wikidot 兼容源码')
  .option('--list', '列出语言分歧表')
  .action(async (opts) => {
    const code = await run(() => compat(opts));
    process.exitCode = code ?? 0;
  });

// ---- revert ----
program
  .command('revert')
  .description('按版本号回退（本地 git revert + 线上回到对应版本）')
  .option('--list', '列出可回退的版本（含 commit message）')
  .option('--site <site>', '站点名（覆盖配置）')
  .option('--page <page>', '页面名（覆盖配置）')
  .option('--to <version>', '版本号 x / x.y，或 git 提交（hash / HEAD~n，默认 HEAD）')
  .option('--no-wikidot', '只做本地 git revert，不回退线上')
  .option('--auto-commit', '工作区有未提交改动时先自动提交再 revert')
  .option('--rebuild', 'git revert 后重新构建产物再回退线上（dist/ 被 gitignore 忽略）')
  .action(async (opts) => {
    await run(() => revert(opts));
  });

// ---- doctor ----
program
  .command('doctor')
  .description('检测 git 环境（是否安装、是否配置 user.name/user.email）')
  .action(async () => {
    await run(async () => {
      const env = await detectGitEnv({ root: process.cwd() });
      console.log(`git: ${env.installed ? `已安装（${env.version}）` : '未安装'}`);
      if (env.installed) {
        console.log(`user.name: ${env.userName ?? '（未配置）'}`);
        console.log(`user.email: ${env.userEmail ?? '（未配置）'}`);
        console.log(`当前目录是 git 仓库: ${env.isRepo ? '是' : '否'}`);
      }
      for (const p of env.problems) console.log(`✗ ${p}`);
      for (const h of env.hints) console.log(`  → ${h}`);
      if (!env.problems.length) console.log('✓ git 环境就绪');
    });
  });

// ---- init ----
program
  .command('init')
  .description('初始化 ftml 项目')
  .action(async () => {
    await run(() => init());
  });

// ---- web ----
program
  .command('web')
  .description('启动本地 web 编辑器（编辑 + 实时预览 + 自动补全）')
  .option('--root <dir>', '默认打开的项目目录（并注册到项目列表）')
  .option('--port <n>', '监听端口（默认 3000）')
  .option('--host <addr>', '监听地址（默认 127.0.0.1）')
  .option('--open', '启动后用系统浏览器打开')
  .action(async (opts) => {
    await run(() => web(opts));
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
