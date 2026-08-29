/**
 * parse-ftmx.mjs — 解析 .ftmx 模板文件
 *
 * 语法（来自 SCPack README 的虚构规格）：
 *   - 整个文件必须被单个元素包裹（多元素需用 [[]] ... [[/]] 空名根包裹）
 *   - 开标签第一 token = 包裹元素名
 *   - 含 "=" 的 token（如 class="x"）= 元素字面属性，展开时原样输出
 *   - 裸 token（如 prop）= 声明的自定义键；调用方传入同名属性
 *   - body 内 { 键名 } 为占位符，children 为内置键（调用时的子内容）
 *   - 转义：\{ \} \\ 输出字面字符
 */

/** 把元素名从标签内 token 中提取出来，返回 { element, literalAttrs, declaredKeys } */
function splitTagTokens(inner) {
  const tokens = [];
  // 按空格切分，尊重单/双引号
  const re = /"[^"]*"|'[^']*'|\S+/g;
  let m;
  while ((m = re.exec(inner)) !== null) tokens.push(m[0]);

  if (tokens.length === 0) {
    return { element: null, literalAttrs: [], declaredKeys: [] };
  }

  const element = tokens[0];
  const literalAttrs = [];
  const declaredKeys = [];
  for (const t of tokens.slice(1)) {
    // 去掉包裹引号判断：带 = 且等号前无空白 → 字面属性（保留原文，含引号）
    if (/^\S+=/.test(t) && !/^=[^=]/.test(t)) {
      literalAttrs.push(t);
    } else {
      declaredKeys.push(t);
    }
  }
  return { element, literalAttrs, declaredKeys };
}

/**
 * 解析 .ftmx 源码
 * @param {string} src .ftmx 文件内容
 * @param {string} name 模板名（用于报错信息）
 * @returns {{ name, element, literalAttrs: string[], keys: string[], body: string }}
 */
export function parseFtmx(src, name) {
  const text = src.trim();

  // 找开标签：[[ 元素名 ... ]]
  const openMatch = text.match(/^\[\[([^\]\[]*?)\]\]/);
  if (!openMatch) {
    throw new Error(`[${name}] .ftmx 必须以 [[元素 ...]] 开头`);
  }

  const openInner = openMatch[1].trim();
  const { element, literalAttrs, declaredKeys } = splitTagTokens(openInner);

  // 空名根 [[]] 表示 body-only（多元素模板）
  let closeTag;
  if (element === null) {
    closeTag = '[[/]]';
  } else {
    closeTag = `[[/${element}]]`;
  }

  const closeIdx = text.lastIndexOf(closeTag);
  if (closeIdx === -1) {
    throw new Error(`[${name}] 缺少闭合标签 ${closeTag}`);
  }

  // 开标签后到闭合标签前的部分即 body
  const body = text.slice(openMatch[0].length, closeIdx);

  // 校验：闭合标签之后不应再有内容（除非只剩空白）
  const after = text.slice(closeIdx + closeTag.length).trim();
  if (after.length > 0) {
    throw new Error(
      `[${name}] 模板必须由单个元素包裹，闭合标签后存在多余内容: ${after.slice(0, 40)}`
    );
  }

  // 校验：开标签内容必须是合法的元素标签（含 == 之类特殊情况不允许元素名带空格）
  if (element !== null && /[^A-Za-z0-9_-]/.test(element)) {
    throw new Error(`[${name}] 非法元素名: ${JSON.stringify(element)}`);
  }

  // 校验声明的键名合法
  for (const k of declaredKeys) {
    if (!/^[A-Za-z0-9_-]+$/.test(k)) {
      throw new Error(`[${name}] 非法键名: ${JSON.stringify(k)}`);
    }
  }

  return { name, element, literalAttrs, keys: declaredKeys, body };
}
