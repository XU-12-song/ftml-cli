/**
 * prompt.ts — 命令行交互（仅在 TTY 下使用）
 *
 * 部署 / 回退这类会改动远端或历史的操作，在交互式终端里先展示计划并确认；
 * 非交互环境（脚本、CI、web 服务）不会阻塞，直接按默认行为执行。
 */

import { createInterface } from 'node:readline/promises';

/**
 * 当前是否处于可交互终端。
 * web 服务即使从终端启动也必须视为非交互：请求来自浏览器，阻塞在 stdin
 * 会让浏览器操作一直等终端输入。
 */
export function isInteractive(): boolean {
  if (process.env.FTML_NONINTERACTIVE === '1') return false;
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

/** 读取一行；直接回车返回 defaultValue */
export async function promptLine(question: string, defaultValue = ''): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(question)).trim();
    return answer || defaultValue;
  } finally {
    rl.close();
  }
}

/** 是 / 否确认；直接回车采用 defaultYes */
export async function confirm(question: string, defaultYes = true): Promise<boolean> {
  const suffix = defaultYes ? ' [Y/n] ' : ' [y/N] ';
  const answer = (await promptLine(question + suffix, defaultYes ? 'y' : 'n')).toLowerCase();
  if (answer === 'y' || answer === 'yes') return true;
  if (answer === 'n' || answer === 'no') return false;
  return defaultYes;
}
