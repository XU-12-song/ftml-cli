/**
 * gitenv.js — git 环境检测（安装情况 + 身份配置）
 *
 * 用途：CLI 与 web 编辑器在提交/部署/回退前做前置体检，
 * 缺 git 或缺 user.name / user.email 时给出可执行的修复提示。
 *
 * 检测项：
 *   installed      git 可执行文件是否可用（execFile git --version）
 *   version        git 版本（如 "2.47.3"）
 *   isRepo         目标目录是否已是 git 仓库
 *   userName       生效的 user.name（本地 > 全局）
 *   userEmail      生效的 user.email
 *   configured     身份是否齐全（userName && userEmail）
 *   problems       人类可读的问题列表
 *   hints          对应的修复命令列表
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** 平台相关的安装提示 */
const INSTALL_HINTS = {
  darwin: 'brew install git  或  xcode-select --install',
  win32: 'winget install --id Git.Git  或到 https://git-scm.com/download/win 下载安装',
  linux: 'sudo apt install git（Debian/Ubuntu） 或 sudo dnf install git（Fedora）',
};

/**
 * 执行 git 子命令（不依赖 simple-git，git 缺失时也能给出明确错误）
 * @returns {Promise<string>} stdout（已 trim）
 */
async function gitRaw(args, cwd) {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    windowsHide: true,
    timeout: 10_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  return stdout.trim();
}

/** git --version 探测：返回版本号字符串，未安装返回 null */
export async function detectGitBinary() {
  try {
    const out = await gitRaw([ '--version' ]);
    return out.replace(/^git version\s*/i, '') || out;
  } catch {
    return null;
  }
}

/** 读取生效的 git 配置项（未设置返回 null） */
export async function readGitConfig(key, cwd) {
  try {
    const v = await gitRaw([ 'config', '--get', key ], cwd);
    return v || null;
  } catch {
    return null; // 未设置时 git 退出码非 0
  }
}

/**
 * 体检 git 环境。
 *
 * 返回的 problems/hints 按"先装 git、再配身份"的顺序排列，
 * 前端可直接逐条展示并给出对应命令。
 *
 * @param {object} [options]
 * @param {string} [options.root] 项目目录（判断 isRepo；目录不存在时跳过）
 * @returns {Promise<object>}
 */
export async function detectGitEnv({ root } = {}) {
  const version = await detectGitBinary();
  const installed = version != null;
  const cwd = root && root.length ? root : process.cwd();

  if (!installed) {
    return {
      installed: false,
      version: null,
      isRepo: false,
      userName: null,
      userEmail: null,
      configured: false,
      problems: [ '未检测到 git：本机没有安装或不在 PATH 中' ],
      hints: [ INSTALL_HINTS[process.platform] ?? INSTALL_HINTS.linux ],
    };
  }

  let isRepo = false;
  try {
    isRepo = (await gitRaw([ 'rev-parse', '--is-inside-work-tree' ], cwd)) === 'true';
  } catch {
    isRepo = false;
  }

  const [ userName, userEmail ] = await Promise.all([
    readGitConfig('user.name', cwd),
    readGitConfig('user.email', cwd),
  ]);

  const problems = [];
  const hints = [];
  if (!userName) {
    problems.push('未配置 git 用户名（user.name）');
    hints.push('git config --global user.name "你的名字"');
  }
  if (!userEmail) {
    problems.push('未配置 git 邮箱（user.email）');
    hints.push('git config --global user.email "you@example.com"');
  }

  return {
    installed: true,
    version,
    isRepo,
    userName,
    userEmail,
    configured: Boolean(userName && userEmail),
    problems,
    hints,
  };
}

/**
 * 校验环境是否可用于提交；不满足时抛出带修复提示的错误。
 * @param {object} [options] 透传给 detectGitEnv
 */
export async function assertGitReady(options = {}) {
  const env = await detectGitEnv(options);
  if (env.problems.length) {
    throw new Error(`${env.problems.join('；')}。修复：${env.hints.join(' && ')}`);
  }
  return env;
}
