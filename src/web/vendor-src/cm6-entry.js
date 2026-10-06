/**
 * cm6-entry.js — CodeMirror 6 前端打包入口（构建期专用，不直接进浏览器）
 *
 * 只 re-export ftml web 编辑器需要的 API 子集，esbuild 据此 tree-shake。
 * 产物：src/web/public/vendor/cm6/cm6.js（ESM），前端用 `../vendor/cm6/cm6.js` 导入。
 *
 * 用 `npm run build:cm6` 重新生成。改了这里的导出或升级 CM6 都要重新构建。
 */

export {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
  highlightSpecialChars,
  placeholder,
  Decoration,
  ViewPlugin,
  WidgetType,
  GutterMarker,
  gutter,
} from '@codemirror/view';

export {
  EditorState,
  StateField,
  StateEffect,
  RangeSet,
  RangeSetBuilder,
  Compartment,
  Text,
  Prec,
} from '@codemirror/state';

export {
  StreamLanguage,
  LanguageSupport,
  syntaxHighlighting,
  HighlightStyle,
  defaultHighlightStyle,
  bracketMatching,
  indentOnInput,
  indentUnit,
  foldGutter,
  foldKeymap,
  syntaxTree,
} from '@codemirror/language';

export {
  history,
  historyKeymap,
  defaultKeymap,
  indentWithTab,
  undo,
  redo,
  selectAll,
} from '@codemirror/commands';

export {
  autocompletion,
  completionKeymap,
  completeFromList,
  snippet,
  snippetCompletion,
  CompletionContext,
  ifNotIn,
  startCompletion,
  acceptCompletion,
} from '@codemirror/autocomplete';

export { tags } from '@lezer/highlight';
