/**
 * template.ts — .ftmx 模板解析与调用的数据结构
 */

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
export interface TagCall {
  name: string;
  attrs: TagAttr[];
}

/**
 * @description 模板开标签的解析结果
 */
export interface TemplateHeader {
  /** 包裹模板内容的根元素（如 div、span 等）；空名根为 null */
  element: string | null;
  /** 直接透传的原始字面量属性 */
  literalAttrs: string[];
  /** 模板声明的占位符键名列表 */
  declaredKeys: string[];
}

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
