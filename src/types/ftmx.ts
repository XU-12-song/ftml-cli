export type srcSource = string;

/**
 * @description 在源码中收集的 [[style]] CSS 块
 */
export type cssBlocks = string[];

/**
 * @description 源码位置信息
 */
export interface TemplateLocation {
  offset: number | null;
  file: string | null;
}

/**
 * @description 标签属性值的解析类型
 * - `ftml`: 原样插入，可包含 wiki 语法
 * - `string`: 作为字面文本插入，FTML 转义后使用
 */
export type TagValueType = "ftml" | "string";

/**
 * @description 解析后的标签属性
 */
export interface TagAttr {
  key: string;
  value: string;
  type: TagValueType;
}

/**
 * @description 解析后的标签调用结构
 */
export type TagCall = {
  name: string;
  attrs: TagAttr[];
};

/**
 * @description 完整的 FTML 模板解析结果
 */
export interface ParsedTemplate {
  /** 模板名字 */
  name: string;
  /** 包裹模板内容的根元素（如 div、span 等） */
  element: string;
  /** 直接透传的原始字面量属性 */
  literalAttrs: string[];
  /** 模板声明的占位符键名列表 */
  keys: string[];
  /** 模板的主体内容 */
  body: string;
}

/**
 * @description 模板表，键为模板名，值为解析后的模板结构
 */
export type TemplatesMap = Map<string, ParsedTemplate>;

/**
 * @description 展开操作的内置上下文对象
 */
export interface Context {
  /** 收集到的 CSS 块列表 */
  css: cssBlocks;
  /** 解析 [[component]] 相对路径的基准目录（默认 CWD） */
  baseDir: string;
  /** 源文件名（附在 FtmlError 上，供 web 端定位） */
  file: string | null;
}

/**
 * @description 用于获取模板/组件内容路径的选项
 */
export interface expandOptions {
  /** 解析 [[component]] 相对路径的基准目录（默认 CWD） */
  baseDir?: string;
  /** 源文件名（附在 FtmlError 上，供 web 端定位） */
  file?: string;
}

/**
 * @description 基础模板结构（用于其他未完全解析的上下文）
 */
export interface Template {
  element: string | null;
  literalAttrs: string[];
  declaredKeys: string[];
}
