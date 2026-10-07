/**
 * flags.js — 读「否定式开关」的统一口径
 *
 * commander 的 `--no-xxx` 把选项解析成**正向键取 false**（`validate: false`），
 * 而不是 `noValidate: true`；未传时正向键默认为 `true`。API 调用方（web handlers、
 * 命令内部转调）沿用的是另一种写法：`{ noValidate: true }`。
 *
 * 两套写法必须同时认，否则 CLI 上的 `--no-xxx` 会静默失效（命令照常执行被否定的那一步）。
 * 判定写在一处，避免各个命令各写一份容易退化的条件。
 *
 * @param {object} options 命令选项对象
 * @param {string} name 正向名，如 'validate' / 'push' / 'deps' / 'build' / 'wikidot'
 * @returns {boolean} 该功能是否被显式关闭
 */
export function isNegated(options, name) {
  if (!options) return false;
  return options[name] === false || options[`no${name[0].toUpperCase()}${name.slice(1)}`] === true;
}
