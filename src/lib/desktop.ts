/**
 * 桌面端（Electron）桥的薄封装。
 *
 * 只跟 `window.__desktop__` 打交道，不 import 业务模块，避免和 editorStore 互相
 * 循环依赖。保存逻辑由调用方（main.tsx）注入进来。
 */

interface DesktopBridge {
  pickProjectFolder?: () => Promise<unknown>
  /** 渲染层把「是否有未保存改动」推给主进程。 */
  setDirty?: (dirty: boolean) => void
  /** 主进程要求「保存并关闭」时，回调渲染层。 */
  onSaveAndClose?: (callback: () => void) => void
  /** 渲染层保存完成，通知主进程可以关窗。 */
  saveAndCloseDone?: () => void
}

function bridge(): DesktopBridge | undefined {
  return (window as unknown as { __desktop__?: DesktopBridge }).__desktop__
}

export function isDesktop(): boolean {
  return !!bridge()
}

/** 未保存状态变化时通知主进程（网页版无 bridge，是 no-op）。 */
export function notifyDirty(dirty: boolean): void {
  bridge()?.setDirty?.(dirty)
}

/**
 * 注册「关闭前保存」回调：主进程弹窗选「保存」时会触发。
 * `save` 返回 true 表示保存成功，主进程随后关窗；返回 false 则窗口保持打开。
 */
export function registerSaveAndClose(save: () => Promise<boolean>): void {
  const b = bridge()
  if (!b?.onSaveAndClose) return
  b.onSaveAndClose(() => {
    void save().then((ok) => {
      if (ok) b.saveAndCloseDone?.()
      else window.alert('保存失败，窗口未关闭')
    })
  })
}
