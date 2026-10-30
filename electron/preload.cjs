/**
 * 桌面端渲染层桥：只暴露一个「以工程文件所在目录为根」的原生导入入口。
 *
 * 渲染层拿到的是原始字节数组，自己包成 File（相对路径一并带上），走和网页版
 * 「导入文件夹」完全相同的相对路径逻辑。
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('__desktop__', {
  /** 原生选工程文件 → 读它所在目录 → 返回 { path, name, type, data }[]。 */
  pickProjectFolder: () => ipcRenderer.invoke('desktop:pick-project-folder'),
})
