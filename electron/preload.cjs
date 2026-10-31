/**
 * 桌面端渲染层桥：
 * - pickProjectFolder：以工程文件所在目录为根的原生导入
 * - setDirty / onSaveAndClose / saveAndCloseDone：关闭前的「是否保存」保护
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('__desktop__', {
  /** 原生选工程文件 → 读它所在目录 → 返回 { path, name, type, data }[]。 */
  pickProjectFolder: () => ipcRenderer.invoke('desktop:pick-project-folder'),

  /** 渲染层把「是否有未保存改动」推给主进程。 */
  setDirty: (dirty) => ipcRenderer.send('desktop:set-dirty', !!dirty),

  /** 主进程要求「保存并关闭」时，回调渲染层执行保存。 */
  onSaveAndClose: (callback) => {
    ipcRenderer.on('desktop:save-and-close', () => callback())
  },

  /** 渲染层保存完成，通知主进程可以关窗。 */
  saveAndCloseDone: () => ipcRenderer.send('desktop:save-and-close-done'),
})
