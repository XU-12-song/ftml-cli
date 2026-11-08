#!/usr/bin/env node
/**
 * ftml 启动器 —— `npm link` / 全局安装后的 `ftml` 入口。
 *
 * 源码是 TypeScript，内部按 NodeNext 习惯用 `.js` 后缀导入 `.ts` 文件
 * （如 `../web/projects.js` 实际指向 `projects.ts`）。Node 原生类型擦除只能
 * 加载真实的 `.ts` 路径，不会把 `.js` 重新映射到 `.ts`，因此直接让 bin 指向
 * `src/cli.ts` 会在第一个 import 处报 ERR_MODULE_NOT_FOUND。
 *
 * 这里先注册 tsx 的 ESM loader（tsx 是 dependencies，随包安装），再加载 CLI。
 * 这样 Windows 上由 npm 生成的 .cmd shim 也能正常工作（它只会调用 node）。
 */
import { register } from 'tsx/esm/api';

register();
await import('../src/cli.ts');
