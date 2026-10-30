/**
 * 简辑 (UAE2 Studio) Electron 主进程。
 *
 * 桌面端 = 内置一个极小的本地 HTTP 服务（复用网页版 dev server 的语义）：
 *   - 静态托管 `dist/`（含 public/fonts 里打包进去的字体）
 *   - GET  /__workspace         → 工作区里的工程与素材列表
 *   - GET  /__workspace/file    → 读文件（带 Range，视频可拖进度条）
 *   - POST /__workspace/save    → 保存工程
 *   - GET  /__fonts             → 字体目录（内置 + 系统字体）
 *   - GET  /__fonts/file        → 读系统字体
 *   - POST /__ai/chat           → OrcaRouter / DeepSeek 代理
 *
 * 另通过 IPC 暴露「以工程文件所在目录为根」的导入：原生文件对话框选出
 * .txt/.uae2，读出它所在目录里工程点名的素材，交给渲染层按相对路径导入。
 */
const { app, BrowserWindow, shell, dialog, ipcMain } = require('electron')
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { Readable } = require('node:stream')

const MEDIA_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.bmp',
  '.mp4', '.webm', '.mov', '.m4v', '.ogv',
  '.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac',
])
const FONT_EXTENSIONS = new Set(['.ttf', '.otf', '.woff', '.woff2'])
const PROJECT_EXTENSIONS = new Set(['.txt', '.uae2'])
const NOT_PROJECTS = new Set(['license', 'readme', 'copying', 'changelog', 'notice', 'authors'])
const EXAMPLE_DIRECTORIES = ['promo']
const SKIP_DIRECTORIES = new Set(['node_modules', 'dist', 'dist-ssr', '.git', '.vite', 'tmp', 'coverage'])

const CONTENT_TYPES = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.avif': 'image/avif', '.bmp': 'image/bmp',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.ogv': 'video/ogg',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac',
  '.txt': 'text/plain; charset=utf-8',
  // 网页静态资源 + 字体：缺了这些会把 index.html / JS / CSS / 字体当 octet-stream
  // 下载，Electron 会弹「保存文件」对话框、窗口一片空白。
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

let AI_PROVIDERS = {}
try {
  AI_PROVIDERS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'ai-providers.json'), 'utf8'))
} catch {
  /* AI 配置可选 */
}

function contentType(name) {
  return CONTENT_TYPES[path.extname(name).toLowerCase()] || 'application/octet-stream'
}

/* --------------------------------------------------------------- workspace */

function walk(root, relative, out, depth = 0) {
  if (depth > 6) return
  let entries
  try {
    entries = fs.readdirSync(path.join(root, relative))
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.startsWith('.')) continue
    const next = relative ? `${relative}/${entry}` : entry
    let stat
    try {
      stat = fs.statSync(path.join(root, relative, entry))
    } catch {
      continue
    }
    if (stat.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry)) continue
      walk(root, next, out, depth + 1)
      continue
    }
    const ext = path.extname(entry).toLowerCase()
    const stem = entry.slice(0, entry.length - ext.length).toLowerCase()
    const isExample = EXAMPLE_DIRECTORIES.some((dir) => next === dir || next.startsWith(dir + '/'))
    if (PROJECT_EXTENSIONS.has(ext) && !NOT_PROJECTS.has(stem) && !isExample) {
      out.projects.push({ path: next, name: entry.replace(/\.[^.]+$/, '') })
    }
    if (MEDIA_EXTENSIONS.has(ext)) out.files.push(next)
  }
}

function insideRoot(root, requested) {
  const rel = path.relative(root, requested)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

function sendFile(full, res, range) {
  let stat
  try {
    stat = fs.statSync(full)
  } catch {
    res.statusCode = 404
    res.end('not found')
    return
  }
  const size = stat.size
  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range)
    if (match) {
      const start = match[1] ? parseInt(match[1], 10) : 0
      const end = match[2] ? parseInt(match[2], 10) : size - 1
      res.statusCode = 206
      res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`)
      res.setHeader('Accept-Ranges', 'bytes')
      res.setHeader('Content-Length', String(end - start + 1))
      fs.createReadStream(full, { start, end }).pipe(res)
      return
    }
  }
  res.setHeader('Content-Length', String(size))
  res.setHeader('Accept-Ranges', 'bytes')
  fs.createReadStream(full).pipe(res)
}

/* ------------------------------------------------------------------- fonts */

function systemFontDirs() {
  const home = os.homedir()
  const dirs = [
    '/usr/share/fonts', '/usr/local/share/fonts', `${home}/.fonts`, `${home}/.local/share/fonts`,
    '/System/Library/Fonts', '/Library/Fonts', `${home}/Library/Fonts`,
    'C:\\Windows\\Fonts',
  ]
  return dirs.filter((dir) => {
    try {
      return fs.statSync(dir).isDirectory()
    } catch {
      return false
    }
  })
}

function collectFontFiles(dir, out, depth = 0) {
  if (depth > 4) return
  let entries
  try {
    entries = fs.readdirSync(dir)
  } catch {
    return
  }
  for (const entry of entries) {
    const full = path.join(dir, entry)
    let stat
    try {
      stat = fs.statSync(full)
    } catch {
      continue
    }
    if (stat.isDirectory()) collectFontFiles(full, out, depth + 1)
    else if (FONT_EXTENSIONS.has(path.extname(entry).toLowerCase())) out.push(full)
  }
}

/* --------------------------------------------------------------- AI proxy */

function aiChat(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405
    res.end('POST only')
    return
  }
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', async () => {
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      const providerIds = Object.keys(AI_PROVIDERS.providers || {})
      const provider = providerIds.includes(body.provider) ? body.provider : AI_PROVIDERS.default_provider
      const source = AI_PROVIDERS.providers[provider] || {}
      const envKey = (source.env_keys || []).map((k) => process.env[k]).find((v) => !!v)
      const apiKey = (body.apiKey || '').trim() || envKey || ''
      const baseUrl = ((body.baseUrl || '').trim() || source.base_url || '').replace(/\/+$/, '')
      const model = (body.model || '').trim() || source.default_model || ''

      if (!apiKey) {
        res.statusCode = 502
        res.end(JSON.stringify({ error: `未配置 ${source.name || provider} API Key` }))
        return
      }
      let upstream
      let lastError = null
      for (let attempt = 0; attempt < 3 && !upstream; attempt++) {
        try {
          upstream = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`,
              'HTTP-Referer': 'https://github.com/darkmatter2048/JianJi',
              'X-Title': 'JianJi (UAE2 Studio)',
            },
            body: JSON.stringify({
              model,
              messages: body.messages,
              tools: body.tools,
              tool_choice: 'auto',
            }),
          })
        } catch (error) {
          lastError = error
          if (attempt < 2) await new Promise((r) => setTimeout(r, 400 * (attempt + 1)))
        }
      }
      if (!upstream) throw lastError
      res.statusCode = upstream.status
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      if (upstream.body) Readable.fromWeb(upstream.body).pipe(res)
      else res.end(await upstream.text())
    } catch (error) {
      res.statusCode = 502
      res.end(JSON.stringify({ error: `网络连接失败（${error?.message || error}）` }))
    }
  })
}

/* --------------------------------------------------------------- handler */

function handleLocal(req, res, root, fontsDir) {
  const url = new URL(req.url || '/', 'http://127.0.0.1')

  if (url.pathname === '/__workspace') {
    const found = { projects: [], files: [] }
    walk(root, '', found)
    found.projects.sort((a, b) => a.path.localeCompare(b.path))
    found.files.sort()
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    res.end(JSON.stringify(found))
    return true
  }
  if (url.pathname === '/__workspace/file') {
    const p = url.searchParams.get('path')
    if (!p) {
      res.statusCode = 400
      res.end('path is required')
      return true
    }
    const full = path.resolve(root, p)
    if (!insideRoot(root, full)) {
      res.statusCode = 403
      res.end('forbidden')
      return true
    }
    res.setHeader('Content-Type', contentType(full))
    sendFile(full, res, req.headers.range)
    return true
  }
  if (url.pathname === '/__workspace/save') {
    if (req.method !== 'POST') {
      res.statusCode = 405
      res.end('POST only')
      return true
    }
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        const name = (body.name || '未命名项目').replace(/[\\/:*?"<>|]/g, '_').trim() || '未命名项目'
        const target = path.join(root, `${name}.txt`)
        fs.writeFileSync(target, body.text ?? '', 'utf8')
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ ok: true, path: `${name}.txt` }))
      } catch (error) {
        res.statusCode = 500
        res.end(`save failed: ${error?.message || error}`)
      }
    })
    return true
  }
  if (url.pathname === '/__fonts') {
    const fonts = []
    const seen = new Set()
    // 内置字体（随 dist 一起打包）
    let local = []
    try {
      local = fs.readdirSync(fontsDir).filter((n) => FONT_EXTENSIONS.has(path.extname(n).toLowerCase()))
    } catch { /* no bundled fonts */ }
    for (const name of local) {
      const key = name.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      fonts.push({ file: name, name: name.replace(/\.[^.]+$/, ''), url: `/fonts/${encodeURIComponent(name)}`, size: 0 })
    }
    // 系统字体
    const systemFiles = []
    for (const dir of systemFontDirs()) collectFontFiles(dir, systemFiles)
    for (const full of systemFiles) {
      const name = path.basename(full)
      const key = name.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      fonts.push({ file: name, name: name.replace(/\.[^.]+$/, ''), url: `/__fonts/file?path=${encodeURIComponent(full)}`, size: 0 })
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    res.end(JSON.stringify(fonts))
    return true
  }
  if (url.pathname === '/__fonts/file') {
    const p = url.searchParams.get('path')
    if (!p) {
      res.statusCode = 400
      res.end('path is required')
      return true
    }
    const allowed = systemFontDirs().some((dir) => p === dir || p.startsWith(dir + path.sep))
    if (!allowed) {
      res.statusCode = 403
      res.end('not a system font')
      return true
    }
    res.setHeader('Content-Type', contentType(p))
    res.setHeader('Cache-Control', 'no-store')
    sendFile(p, res)
    return true
  }
  if (url.pathname === '/__ai/chat') {
    aiChat(req, res)
    return true
  }
  return false
}

/* ------------------------------------------------------------- static ---- */

function serveStatic(req, res, dist) {
  const url = new URL(req.url || '/', 'http://127.0.0.1')
  let pathname = decodeURIComponent(url.pathname)
  if (pathname === '/') pathname = '/index.html'
  const full = path.join(dist, pathname)
  if (!insideRoot(dist, full)) {
    res.statusCode = 403
    res.end('forbidden')
    return
  }
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
    // SPA 兜底
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    sendFile(path.join(dist, 'index.html'), res)
    return
  }
  res.setHeader('Content-Type', contentType(full))
  sendFile(full, res, req.headers.range)
}

/* ---------------------------------------------------------------- app ---- */

let mainWindow = null

function startServer(root, dist, fontsDir) {
  const server = http.createServer((req, res) => {
    try {
      if (!handleLocal(req, res, root, fontsDir)) serveStatic(req, res, dist)
    } catch (error) {
      res.statusCode = 500
      res.end(String(error?.message || error))
    }
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  })
}

function createWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#0b0f16',
    title: '简辑',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  })
  mainWindow.loadURL(url)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

/* --------------------------------------------------- 原生工程文件导入 ---- */

/**
 * 递归读出 `dir` 里工程可能用到的文件：工程文本（.txt/.uae2）和图片/视频/音频。
 * 其它文件（渲染产物、笔记等）不读，避免把整个目录塞进内存。
 */
function readDirectoryForImport(dir, prefix = '', out = [], depth = 0) {
  if (depth > 8) return out
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue
      readDirectoryForImport(full, rel, out, depth + 1)
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase()
      if (!MEDIA_EXTENSIONS.has(ext) && !PROJECT_EXTENSIONS.has(ext)) continue
      try {
        const data = fs.readFileSync(full)
        out.push({ path: rel, name: entry.name, type: contentType(entry.name), data })
      } catch {
        /* 读不到就跳过 */
      }
    }
  }
  return out
}

ipcMain.handle('desktop:pick-project-folder', async () => {
  const options = {
    title: '选择工程文件',
    properties: ['openFile'],
    filters: [{ name: '工程文件', extensions: ['txt', 'uae2'] }],
  }
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options)
  if (result.canceled || result.filePaths.length === 0) return null
  const projectPath = result.filePaths[0]
  const dir = path.dirname(projectPath)
  // 工程文件本身也在 entries 里（path=文件名），渲染层用它定位工程并算相对路径。
  return { projectPath, entries: readDirectoryForImport(dir) }
})

app.whenReady().then(async () => {
  // 开发模式（electron .）：root 是项目根、dist 是 vite 输出。
  // 打包后：root 是 app 目录，dist 是随包一起的 dist。
  const root = app.getAppPath()
  const dist = app.isPackaged
    ? path.join(process.resourcesPath, 'dist')
    : path.join(root, 'dist')
  const fontsDir = path.join(dist, 'fonts')

  const port = await startServer(root, dist, fontsDir)
  createWindow(`http://127.0.0.1:${port}/`)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(`http://127.0.0.1:${port}/`)
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
