/**
 * dom.js — DOM 引用与全局可变状态
 *
 * 所有前端模块共享同一份 el（元素引用）与 state（运行时状态）。模块脚本默认
 * defer，文档解析完才执行，因此这里在模块顶层取元素是安全的。
 */

export const $ = (id) => document.getElementById(id);

export const el = {
  projectSelect: $('project-select'),
  addProjectBtn: $('add-project-btn'),
  initProjectBtn: $('init-project-btn'),
  fileSelect: $('file-select'),
  siteInput: $('site-input'),
  pageInput: $('page-input'),
  saveTargetBtn: $('save-target-btn'),
  validateBtn: $('validate-btn'),
  deployBtn: $('deploy-btn'),
  versionsBtn: $('versions-btn'),
  doctorBtn: $('doctor-btn'),
  settingsBtn: $('settings-btn'),
  newRepoBtn: $('new-repo-btn'),
  authStatus: $('auth-status'),
  loginBtn: $('login-btn'),
  templateList: $('template-list'),
  componentList: $('component-list'),
  sourceList: $('source-list'),
  newTemplateBtn: $('new-template-btn'),
  newComponentBtn: $('new-component-btn'),
  newSourceBtn: $('new-source-btn'),
  editorContainer: $('editor-container'),
  editor: null, // CM6 门面，initEditor() 时创建并赋值
  autocomplete: $('autocomplete'),
  preview: $('preview'),
  statusText: $('status-text'),
  statusDiag: $('status-diagnostics'),
  statusError: $('status-error'),
  nameDialog: $('name-dialog'),
  nameDialogTitle: $('name-dialog-title'),
  nameInput: $('name-input'),
  loginDialog: $('login-dialog'),
  loginUsername: $('login-username'),
  loginPassword: $('login-password'),
  logDialog: $('log-dialog'),
  logDialogTitle: $('log-dialog-title'),
  logContent: $('log-content'),
  logClose: $('log-close'),
  saveBtn: $('save-btn'),
  addSnippetBtn: $('add-snippet-btn'),
  snippetList: $('snippet-list'),
  snippetDialog: $('snippet-dialog'),
  snippetDialogTitle: $('snippet-dialog-title'),
  snippetForm: $('snippet-form'),
  snippetDesc: $('snippet-desc'),
  snippetPrefix: $('snippet-prefix'),
  snippetTemplate: $('snippet-template'),
  snippetDel: $('snippet-del'),
  importSnippetBtn: $('import-snippet-btn'),
  exportSnippetBtn: $('export-snippet-btn'),
  snippetFile: $('snippet-file'),
  promptDialog: $('prompt-dialog'),
  promptForm: $('prompt-form'),
  promptTitle: $('prompt-title'),
  promptLabel: $('prompt-label'),
  promptInput: $('prompt-input'),
  promptOk: $('prompt-ok'),
  versionsDialog: $('versions-dialog'),
  versionsBody: $('versions-body'),
  versionsHint: $('versions-hint'),
  versionsRefresh: $('versions-refresh'),
  versionsClose: $('versions-close'),
  settingsDialog: $('settings-dialog'),
  settingsForm: $('settings-form'),
  settingsInterval: $('settings-interval'),
  settingsAutopreview: $('settings-autopreview'),
  settingsRemoteinclude: $('settings-remoteinclude'),
  settingsStylemode: $('settings-stylemode'),
  cacheInfo: $('cache-info'),
  cacheClear: $('cache-clear'),
  problemsDialog: $('problems-dialog'),
  problemsSummary: $('problems-summary'),
  problemsList: $('problems-list'),
  problemsClose: $('problems-close'),
};

export const state = {
  projects: [],
  projectId: null,   // 当前项目 id（绝对路径）
  filePath: null,    // 当前文件相对路径
  templates: new Map(), // 模板名 → keys[]
  components: [],      // 组件名[]
  sources: [],
  isRepo: false,
  saveTimer: null,
  renderAbort: null, // 在飞渲染请求的 AbortController（新渲染到来时中止旧的）
  ac: null, // 当前自动补全 { items, kind, replaceFrom, onPick }
  creatingStarter: false, // 空项目自动创建 index.ftml 的防重入锁
  snippets: [], // 自定义代码片段（服务端 ~/.ftml-cli/snippets/snippets.json）
  settings: {   // 服务端 ~/.ftml-cli/settings.json（自动预览间隔等）
    previewIntervalMs: 600,
    autoPreview: true,
    renderStyleMode: 'inline',
    useRemoteInclude: true,
  },
  lastIncludes: [], // 最近一次渲染的 include 来源（local/cache/remote/miss）
  gitEnv: null,     // 最近一次 git 环境体检结果（detectGitEnv 响应）
  problems: [],     // 最近一次渲染的统一问题列表（含行号/堆栈）
};

// 取消按钮一律 type="button"（不提交 form method="dialog"），点按后手动关闭并标记 returnValue='cancel'，
// 否则 form 的 onsubmit 会把「取消」当成「确定」处理。
for (const btn of document.querySelectorAll('dialog button[data-cancel]')) {
  btn.addEventListener('click', () => btn.closest('dialog').close('cancel'));
}
