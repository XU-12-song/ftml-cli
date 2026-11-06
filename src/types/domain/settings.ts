/**
 * settings.ts — web 编辑器偏好设置的数据结构
 */

/** @description 编辑器配色 */
export type Theme = "auto" | "dark" | "light";

/** @description 预览渲染模式 */
export type RenderStyleMode = "inline" | "module";

/** @description ListPages module 的占位数据 */
export interface ListPagesPlaceholder {
  count: number;
  title: string;
  text: string;
  tags: string;
  date: string;
  rating: number;
}

/** @description ListUsers module 的占位数据 */
export interface ListUsersPlaceholder {
  count: number;
  name: string;
  title: string;
}

/** @description TagCloud module 的占位数据 */
export interface TagCloudPlaceholder {
  count: number;
  tags: string;
  minWeight: number;
  maxWeight: number;
}

/** @description Rate module 的占位数据 */
export interface RatePlaceholder {
  score: number;
  votes: number;
}

/**
 * @description 快速预览时各 module 的占位数据
 */
export interface ModulePlaceholders {
  listPages: ListPagesPlaceholder;
  listUsers: ListUsersPlaceholder;
  tagCloud: TagCloudPlaceholder;
  rate: RatePlaceholder;
}

/** @description 各占位数据组均只读 */
export type ReadonlyModulePlaceholders = {
  readonly [K in keyof ModulePlaceholders]: Readonly<ModulePlaceholders[K]>;
};

/**
 * @description 用户设置（已归一化）
 */
export interface Settings {
  /** 自动预览防抖间隔（毫秒） */
  previewIntervalMs: number;
  /** 是否开启输入即预览 */
  autoPreview: boolean;
  /** 预览渲染模式 */
  renderStyleMode: RenderStyleMode;
  /** 渲染时是否联网解析远程 [[include]] */
  useRemoteInclude: boolean;
  /** 编辑器配色 */
  theme: Theme;
  /** 快速预览时各 module 的占位数据 */
  modulePlaceholders: ModulePlaceholders;
}

/**
 * @description 占位数据的部分更新，按模块深合并
 */
export type ModulePlaceholdersPatch = {
  [K in keyof ModulePlaceholders]?: Partial<ModulePlaceholders[K]>;
};

/**
 * @description 设置的部分更新
 */
export interface SettingsPatch {
  previewIntervalMs?: number;
  autoPreview?: boolean;
  renderStyleMode?: RenderStyleMode;
  useRemoteInclude?: boolean;
  theme?: Theme;
  modulePlaceholders?: ModulePlaceholdersPatch;
}
