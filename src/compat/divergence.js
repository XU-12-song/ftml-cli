/**
 * divergence.js — Wikidot ↔ 理想 FTML 语言分歧表的唯一真相源
 *
 * 背景：ftml（由 @wdprlib 解析）与真实 Wikidot 的 wikitext 表面同形，
 * 语义却不完全一致；加上本项目自定义的宏（.ftmx 模板 / [[component]] /
 * [[style]]），实际存在三种语言。凡是"某个写法在两边行为不同"的知识，
 * 都必须落在这张表里，而不是散落在代码注释或人的记忆里。
 *
 * 每条记录描述：
 *   id         机器标识
 *   title      人类可读标题
 *   wikidot    真实 Wikidot 的行为
 *   ideal      理想 FTML 期望的行为
 *   verdict    diverge（语义确实不同，需转换）/ bug（wdpr 实现缺陷）/ unresolved（待对照实验）
 *   directions 该分歧在哪些转换方向需要处理
 *   rule       转换规则 id（见 inline-scope.js 等实现），无则为 null
 *   ref        相关出处（issue / 文档）
 *
 * 表只会由"对照真实 Wikidot 的 fixture 实验"来增改，不凭推测。
 */

/** 分歧性质 */
export const VERDICT = {
  /** 两种语言语义确实不同，需要转换 */
  DIVERGE: 'diverge',
  /** wdpr 实现缺陷（上游 issue），不是语言差异 */
  BUG: 'bug',
  /** 尚未对照真实 Wikidot 验证 */
  UNRESOLVED: 'unresolved',
};

/** 转换方向 */
export const DIRECTION = {
  /** Wikidot 脏源码 → 理想 FTML（导入/拉取时规范化） */
  DIRT_TO_IDEAL: 'dirt->ideal',
  /** 理想 FTML → Wikidot 兼容源码（部署/提交前保证可解析） */
  IDEAL_TO_DIRT: 'ideal->dirt',
};

/**
 * 行内标签：不构成块，必须在所属块内显式闭合。
 * 词法器是 context-free 的（[[span]] 与 [[div]] 记号完全一致），
 * 这个集合是区分二者的唯一依据。
 */
export const INLINE_TAGS = new Set([
  'span', 'size', 'color', 'u', 's', 'sup', 'sub', 'tt',
  'em', 'strong', 'mark', 'ruby', 'del', 'ins',
]);

export const DIVERGENCES = [
  {
    id: 'inline-scope-cross-block',
    title: '未闭合的行内标签跨越块边界',
    wikidot: '行内标签未闭合时继续吞掉后续文本，可越过 [[/div]] 等块闭标签',
    ideal: '行内标签必须在其所属块内显式闭合，不越界',
    verdict: VERDICT.DIVERGE,
    directions: [DIRECTION.DIRT_TO_IDEAL, DIRECTION.IDEAL_TO_DIRT],
    rule: 'close-inline-at-block-end',
    ref: 'https://github.com/r74tech/wdpr/issues/78',
  },
  {
    id: 'embed-structural-escape',
    title: '[[embed]]/[[html]] 体内的块闭合记号突破 HTML 收容',
    wikidot:
      '分阶段处理：[[collapsible]]/[[div]] 等模块先展开，[[embed]]/内联 HTML 后处理；' +
      'body 内裸露的 [[/…]] 会提前闭合外层结构，embed 再吞掉下半截，' +
      '浏览器向下自动补标签后折叠块吞掉其后全部内容',
    ideal: 'embed/html 的 body 原样保留，不参与外层结构配对',
    verdict: VERDICT.DIVERGE,
    // 不是转换能修复的：依赖服务端处理顺序 + 浏览器修复，客户端渲染器无法复现
    directions: [],
    rule: 'warn-embed-structural-escape',
    ref: 'https://scp-wiki-cn.wikidot.com/forum/t-17416385/wikidot-embed-html',
  },
  {
    id: 'diagnostic-position-offset-drift',
    title: '诊断 position.line/column 与 offset 相互矛盾（大文件）',
    wikidot: '—',
    ideal: '—',
    verdict: VERDICT.BUG,
    directions: [],
    rule: null,
    ref: 'https://github.com/r74tech/wdpr/issues/78',
  },
];

/** 按 id 取一条分歧；不存在返回 null */
export function getDivergence(id) {
  return DIVERGENCES.find((d) => d.id === id) ?? null;
}

/** 取在某个方向需要处理的分歧 */
export function divergencesFor(direction) {
  return DIVERGENCES.filter((d) => d.directions.includes(direction));
}

/** 把分歧表渲染为可读文本，供 `ftml compat --list` 输出 */
export function describeTable() {
  const lines = ['语言分歧表（Wikidot / 理想 FTML）', ''];
  for (const d of DIVERGENCES) {
    lines.push(`● ${d.id}  [${d.verdict}]`);
    lines.push(`  ${d.title}`);
    lines.push(`  Wikidot : ${d.wikidot}`);
    lines.push(`  理想 FTML: ${d.ideal}`);
    lines.push(`  方向    : ${d.directions.length ? d.directions.join(', ') : '（无需转换）'}`);
    lines.push(`  规则    : ${d.rule ?? '（无）'}`);
    lines.push(`  出处    : ${d.ref}`);
    lines.push('');
  }
  return lines.join('\n');
}
