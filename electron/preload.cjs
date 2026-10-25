/**
 * preload.cjs — 渲染进程唯一入口（sandbox + contextIsolation）
 *
 * 只暴露桌面版需要的最小能力：
 *   - pickDirectory：原生目录选择
 *   - rendererReady / onOpenFile：接收文件关联打开请求
 * 不暴露 Node、ipcRenderer 或任意通道。
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ftmlDesktop', {
  isDesktop: true,
  platform: process.platform,

  pickDirectory: (opts) => ipcRenderer.invoke('ftml:pick-directory', opts ?? {}),

  /** 渲染层完成 boot 后调用；返回启动期间积压的打开请求 */
  rendererReady: () => ipcRenderer.invoke('ftml:renderer-ready'),

  /** 运行中收到新的打开请求 */
  onOpenFile: (cb) => {
    const listener = (_event, payload) => cb(payload);
    ipcRenderer.on('ftml:open-file', listener);
    return () => ipcRenderer.removeListener('ftml:open-file', listener);
  },
});
