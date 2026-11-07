/**
 * window-state.ts — 窗口位置/大小持久化（不依赖 Electron，可单测）
 *
 * 文件存放在 ~/.ftml-cli/window-state.json。读取时做可见性校验：
 * 保存的位置如果完全落在所有显示器之外（拔掉外接屏等），回退为居中默认尺寸。
 */

import fs from "node:fs";
import path from "node:path";
import type {
  DisplayLike,
  Rectangle,
  TrackableWindow,
  TrackWindowStateOptions,
  WindowState,
} from "../src/types/electron/window-state.ts";
import { isFinite } from "../src/shared/guards.ts";

export const DEFAULT_BOUNDS: { width: number; height: number } = {
  width: 1280,
  height: 860,
};

function intersects(
  a: { x?: number; y?: number; width: number; height: number },
  b: Rectangle,
): boolean {
  return isFinite(a.x) && isFinite(a.y)
    ? a.x < b.x + b.width &&
        a.x + a.width > b.x &&
        a.y < b.y + b.height &&
        a.y + a.height > b.y
    : false;
}

function visibleOnDisplays(
  bounds: WindowState,
  displays: DisplayLike[],
): boolean {
  if (!Array.isArray(displays) || displays.length === 0) return true;
  return displays.some((d) => intersects(bounds, d.workArea ?? d.bounds));
}

export function loadWindowState(
  filePath: string,
  displays: DisplayLike[] = [],
): WindowState {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const width = Number(raw.width);
    const height = Number(raw.height);
    if (
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width < 480 ||
      height < 360
    ) {
      return { ...DEFAULT_BOUNDS };
    }
    const bounds = { x: Number(raw.x), y: Number(raw.y), width, height };
    if (
      !Number.isFinite(bounds.x) ||
      !Number.isFinite(bounds.y) ||
      !visibleOnDisplays(bounds, displays)
    ) {
      return { ...DEFAULT_BOUNDS, maximized: !!raw.maximized };
    }
    return { ...bounds, maximized: !!raw.maximized };
  } catch {
    return { ...DEFAULT_BOUNDS };
  }
}

/** 监听窗口移动/缩放并防抖写盘；关闭时同步写一次 */
export function trackWindowState(
  win: TrackableWindow,
  filePath: string,
  { debounceMs = 300 }: TrackWindowStateOptions = {},
): void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const save = () => {
    try {
      if (win.isDestroyed?.()) return;
      const maximized = !!win.isMaximized?.();
      const bounds = maximized ? win.getNormalBounds() : win.getBounds();
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(
        filePath,
        JSON.stringify({ ...bounds, maximized }, null, 2) + "\n",
        "utf8",
      );
    } catch {
      /* 写失败不影响使用 */
    }
  };

  const debounced = () => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(save, debounceMs);
  };

  win.on("resize", debounced);
  win.on("move", debounced);
  win.on("maximize", debounced);
  win.on("unmaximize", debounced);
  win.on("close", save);
}
