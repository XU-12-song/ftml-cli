/**
 * projects.js — web 编辑器项目注册表
 *
 * 多项目 + 切换器：注册表存于用户级目录 ~/.ftml-cli/projects.json
 * （跨 ftml 项目共享；测试用 FTML_CLI_HOME 重定向）。
 *
 * 条目: { id, name, root }，id = 规范化后的项目根绝对路径（天然去重）。
 * 只记录"加入了哪些目录"，不持有文件内容。
 */

import fs from 'node:fs';
import path from 'node:path';
import { homeFtmlCliDir } from '../utils/paths.js';

function registryPath() {
  return path.join(homeFtmlCliDir(), 'projects.json');
}

/** 读取注册表；文件缺失/损坏返回 [] */
export function loadProjects() {
  try {
    const arr = JSON.parse(fs.readFileSync(registryPath(), 'utf8'));
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveProjects(list) {
  fs.mkdirSync(path.dirname(registryPath()), { recursive: true });
  fs.writeFileSync(registryPath(), JSON.stringify(list, null, 2) + '\n', 'utf8');
}

/** 添加项目（必须存在且是目录；已存在则返回原列表） */
export function addProject(root) {
  const abs = path.resolve(root);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
    throw new Error(`目录不存在或不是文件夹: ${abs}`);
  }
  const list = loadProjects();
  if (!list.some((p) => p.root === abs)) {
    list.push({ id: abs, name: path.basename(abs), root: abs });
    saveProjects(list);
  }
  return list;
}

/** 移除项目注册（不删除任何文件） */
export function removeProject(id) {
  const list = loadProjects().filter((p) => p.id !== id);
  saveProjects(list);
  return list;
}
