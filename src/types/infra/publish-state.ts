/**
 * publish-state.ts — 部署发布状态类型（.ftml/publish-state.json）
 */

/** 单个页面的发布记录 */
export interface PublishStatePage {
  /** 最终提交源码（依赖页引用名重写后）的 sha256（hex） */
  hash: string;
  /** 该页发布后的线上修订号 */
  revision: number;
}

/** publish-state.json 的结构；pages 键为 `<site>:<page>` */
export interface PublishState {
  version: 1;
  pages: Record<string, PublishStatePage>;
}
