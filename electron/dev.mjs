/**
 * 桌面端开发模式：一条命令拉起 Vite dev server（HMR + 工作区/字体/AI 中间件）
 * 和 Electron，窗口直接指向 dev server，改前端代码即时热更新。
 *
 * 用法：npm run electron:dev
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import net from 'node:net'

const require = createRequire(import.meta.url)
// `require('electron')` 在普通 Node 里返回的是 electron 可执行文件的路径。
const electronPath = require('electron')

const PORT = 5273
const DEV_URL = `http://127.0.0.1:${PORT}/`

/** 轮询等 dev server 就绪。 */
function waitForPort(port, timeoutMs = 30000) {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const socket = net.connect(port, '127.0.0.1')
      socket.once('connect', () => {
        socket.destroy()
        resolve()
      })
      socket.once('error', () => {
        socket.destroy()
        if (Date.now() - start > timeoutMs) reject(new Error(`等待 ${port} 端口超时，Vite 可能启动失败`))
        else setTimeout(tryOnce, 300)
      })
    }
    tryOnce()
  })
}

/** 整棵树杀掉子进程（npm → vite），避免关窗后 Vite 变孤儿进程、终端卡住不退。 */
function killTree(child) {
  if (!child || child.killed) return
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  } else {
    try {
      // detached 让 vite 自成进程组，这里按负 pid 杀整个组（npm + vite）。
      process.kill(-child.pid, 'SIGTERM')
    } catch {
      child.kill()
    }
  }
}

// 1) Vite dev server（Unix 下独立进程组，方便整组杀掉）
const vite = spawn('npm', ['run', 'dev'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  detached: process.platform !== 'win32',
})

let electron = null

function launchElectron() {
  // 2) Electron 指向 dev server
  electron = spawn(electronPath, ['.'], {
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_DEV_URL: DEV_URL },
  })
  // 关掉 Electron 窗口就一起退出（顺带停掉 Vite）
  electron.on('exit', () => {
    killTree(vite)
    process.exit(0)
  })
}

waitForPort(PORT)
  .then(launchElectron)
  .catch((error) => {
    console.error(String(error?.message || error))
    killTree(vite)
    process.exit(1)
  })

function cleanup() {
  if (electron) electron.kill()
  killTree(vite)
  process.exit(0)
}
process.on('SIGINT', cleanup)
process.on('SIGTERM', cleanup)
