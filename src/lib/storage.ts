/**
 * 渲染层本地存储：桌面端（Electron）走 userData 文件（与端口无关），网页版走
 * localStorage。对调用方是同步的 drop-in 替代。
 */

interface DesktopStorageBridge {
  storageGet?: (key: string) => string | null
  storageSet?: (key: string, value: string) => void
}

function bridge(): DesktopStorageBridge | undefined {
  return (window as unknown as { __desktop__?: DesktopStorageBridge }).__desktop__
}

export function storageGet(key: string): string | null {
  const b = bridge()
  if (b?.storageGet) {
    try {
      return b.storageGet(key)
    } catch {
      /* 桥挂了就退回 localStorage */
    }
  }
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function storageSet(key: string, value: string): void {
  const b = bridge()
  if (b?.storageSet) {
    try {
      b.storageSet(key, value)
      return
    } catch {
      /* 退回 localStorage */
    }
  }
  try {
    localStorage.setItem(key, value)
  } catch {
    /* 不可用（隐私模式等）——只存活于本次会话 */
  }
}
