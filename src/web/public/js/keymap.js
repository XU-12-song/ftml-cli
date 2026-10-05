/**
 * keymap.js — 全局快捷键：集中解析 commands.js 里注册的 key 并分发
 *
 * key 格式：'Ctrl+S' / 'Ctrl+Shift+R' / 'Ctrl+Alt+N' / 'Ctrl+,'
 *   - Ctrl 在 macOS 上同时接受 Cmd（metaKey）
 *   - 修饰键按精确匹配，Ctrl+S 不会误触 Ctrl+Shift+S
 *
 * 生效条件：没有对话框打开时。弹窗（含命令面板）打开期间一律不派发，
 * 否则会在输入框里误触发命令；面板自身的开关由 palette.js 处理。
 */
import { COMMANDS } from './commands.js';
import { setError, setStatus } from './api.js';

/** 'Ctrl+Alt+N' → { key:'n', ctrl:true, shift:false, alt:true } */
function parse(spec) {
  const parts = spec.split('+').map((p) => p.trim());
  return {
    key: parts.pop().toLowerCase(),
    ctrl: parts.some((p) => /^(ctrl|cmd|meta)$/i.test(p)),
    shift: parts.includes('Shift'),
    alt: parts.includes('Alt'),
  };
}

function matches(b, e) {
  return b.ctrl === (e.ctrlKey || e.metaKey)
    && b.shift === e.shiftKey
    && b.alt === e.altKey
    && e.key.toLowerCase() === b.key;
}

function title(c) {
  return typeof c.title === 'function' ? c.title() : c.title;
}

function isEnabled(c) {
  if (!c.enabled) return true;
  try { return !!c.enabled(); } catch { return false; }
}

// 注册表是静态的，模块加载时解析一次
const bindings = COMMANDS.filter((c) => c.key).map((c) => ({ ...parse(c.key), cmd: c }));

export function initKeymap() {
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return; // 长按不重复触发
    if (document.querySelector('dialog[open]')) return;
    for (const b of bindings) {
      if (!matches(b, e)) continue;
      e.preventDefault();
      if (!isEnabled(b.cmd)) {
        setStatus(`「${title(b.cmd)}」当前不可用`); // 原因见命令面板置灰项
        return;
      }
      setError('');
      Promise.resolve()
        .then(() => b.cmd.run())
        .catch((err) => setError(err.message));
      return;
    }
  });
}
