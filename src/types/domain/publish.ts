import type { AbsolutePath, SourceText } from "../common.ts";
import type { IncludeRewriteMap } from "./include.ts";
import type { TemplatesMap } from "../core/template.ts";

/**
 * @description 构建发布计划的选项
 */
export interface BuildPublishPlanOptions {
  /** 入口构建产物（已展开模板/组件） */
  entrySource: SourceText;

  /** 镜像根（入口源文件所在目录），所有 include 都相对它解析 */
  entryDir: string;

  /** 当前站点名，用于判断同站/跨站引用 */
  currentSite: string;

  /** 入口页的线上全名；依赖与其重名时记为冲突 */
  entryName?: string;

  /** 模板目录（未传 templates 时按它加载） */
  templatesDir?: string;

  /** 已加载的模板表（复用以免重复读盘） */
  templates?: TemplatesMap;
}

/**
 * @description 一个待发布的依赖页
 */
export interface PublishPage {
  /** 线上页面全名 */
  name: string;

  /** 本地镜像文件的绝对路径 */
  file: AbsolutePath;

  /** 已展开模板/组件、尚未重写引用名的源码 */
  source: SourceText;
}

/** @description 同一文件被两种引用名指到，线上页面名无法确定 */
export interface FileAliasConflict {
  kind: "file-alias";
  file: AbsolutePath;
  names: [string, string];
}

/** @description 两个不同文件要发布成同一个线上页面名，后写入者会覆盖前者 */
export interface NameClashConflict {
  kind: "name-clash";
  name: string;
  files: [AbsolutePath, AbsolutePath];
}

/** @description 依赖页的线上名与入口页重名，依赖会覆盖入口 */
export interface EntryCycleConflict {
  kind: "entry-cycle";
  name: string;
  file: AbsolutePath;
}

/**
 * @description 本地镜像不自洽时记录的冲突
 */
export type PublishConflict =
  FileAliasConflict | NameClashConflict | EntryCycleConflict;

/**
 * @description 发布计划
 */
export interface PublishPlan {
  /** 重写引用名后的入口源码 */
  entry: SourceText;

  /** 依赖页，叶子在前（先建被引用的页，再建引用者） */
  pages: PublishPage[];

  /** 原引用名 → 线上页面全名 */
  rewrites: IncludeRewriteMap;

  /** 依赖闭包中的命名冲突 */
  conflicts: PublishConflict[];
}
