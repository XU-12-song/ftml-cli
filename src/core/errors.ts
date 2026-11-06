/**
 * errors.js — 带源码位置的 FTML 错误
 *
 * 展开器 / 模板解析抛出的错误原本只有 message，web 端只能显示一行文字。
 * FtmlError 额外携带 `code` / `offset` / `file` / `cause`，让上层（render handler）
 * 能把错误转成与 @wdprlib 诊断同一形状的 problem（含 line:column）并在前端跳转。
 *
 * offset 是「file 源码里的绝对字符偏移」，由抛出点就近的 openIdx / tagEnd 等给出；
 * 若错误发生在模板 body（偏移相对模板自身而非调用方源文件）则不设 offset，
 * 由 message 里的模板名定位。
 */
import type {FtmlErrorOptions} from "../types/core/errors.ts";

export class FtmlError extends Error {
  constructor(
    message: string,
    {
      code = "ftml-error",
      offset = null,
      file = null,
      cause = null,
    }: FtmlErrorOptions = {}
  ) {
    super(message, { cause: cause ?? undefined });
    this.name = "FtmlError";
    this.code = code;
    this.offset = Number.isFinite(offset) ? offset : null; // 仍然需要处理
    this.file = file;
  }
  
  // 显式声明类属性（搭配 constructor 里的同名参数，TS 会自动合并）
  public readonly code: string;
  public readonly offset: number | null;
  public readonly file: string | null;
}


/**
 * 绝对偏移 → {line, column, offset}（line/column 从 1 起，与 @wdprlib 的 Position 同口径）。
 * 越界偏移会被夹到 [0, source.length]。
 */
export function offsetToPosition(source:any, offset:number) {
  const text = String(source ?? "");
  const off = Math.max(0, Math.min(text.length, Math.trunc(offset) || 0));
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < off; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, column: off - lineStart + 1, offset: off };
}


/** [from, to] → wdprlib 形状的 Position；to 缺省等于 from */
export function positionRange(source:any, from:number, to = from) {
  return {
    start: offsetToPosition(source, from),
    end: offsetToPosition(source, Math.max(from, to ?? from)),
  };
}
