import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { createReadStream, readdirSync, statSync, writeFileSync } from 'node:fs'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { homedir } from 'node:os'
import type { ServerResponse } from 'node:http'
import aiProviders from './ai-providers.json'

type AIProviderId = keyof typeof aiProviders.providers
interface AIProviderSource {
  name: string
  base_url: string
  env_keys: string[]
  vision: boolean
  default_model: string
}

/**
 * 本地工程与素材的读盘接口.
 *
 * This editor is a *local* tool: the project — the code file — and the media it
 * names live in folders on this machine, usually inside this very repository. A
 * browser cannot open a sibling of a file the artist picked, so the dev server
 * (and `vite preview`) lend it the filesystem instead:
 *
 *   GET /__workspace                 → every project (.txt) and every media file,
 *                                      as paths relative to the repository
 *   GET /__workspace/file?path=…     → those bytes, with Range support so video
 *                                      seeking works
 *
 * Paths are forced to stay inside the repository; anything climbing out is
 * refused. In a real deployment these endpoints do not exist, and the panel says
 * so instead of offering something that cannot work.
 */

const MEDIA_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.bmp',
  '.mp4', '.webm', '.mov', '.m4v', '.ogv',
  '.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac',
])
/** Font files the editor lists automatically from `public/fonts/`. */
const FONT_EXTENSIONS = new Set(['.ttf', '.otf', '.woff', '.woff2'])
const PROJECT_EXTENSIONS = new Set(['.txt'])
/** Text files that are certainly not projects. */
const NOT_PROJECTS = new Set(['license', 'readme', 'copying', 'changelog', 'notice', 'authors'])
/**
 * 仓库自带的示例目录：它随项目一起发布，**不进导入列表**（列表只列用户自己的工程）。
 * 想打开它可以直接在面板里填路径（`promo/macbook-promo.txt`），或者选它的文件夹。
 */
const EXAMPLE_DIRECTORIES = ['promo']
const SKIP_DIRECTORIES = new Set([
  'node_modules', 'dist', 'dist-ssr', '.git', '.vite', 'tmp', 'coverage',
])

const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.txt': 'text/plain; charset=utf-8',
}

interface Found {
  projects: Array<{ path: string; name: string }>
  files: string[]
}

function walk(root: string, relative: string, out: Found, depth = 0): void {
  if (depth > 6) return
  let entries: string[]
  try {
    entries = readdirSync(join(root, relative))
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.startsWith('.')) continue
    const next = relative ? `${relative}/${entry}` : entry
    let stat
    try {
      stat = statSync(join(root, relative, entry))
    } catch {
      continue
    }
    if (stat.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry)) continue
      walk(root, next, out, depth + 1)
      continue
    }
    const extension = extname(entry).toLowerCase()
    const stem = entry.slice(0, entry.length - extension.length).toLowerCase()
    const isExample = EXAMPLE_DIRECTORIES.some(
      (dir) => next === dir || next.startsWith(`${dir}/`),
    )
    if (PROJECT_EXTENSIONS.has(extension) && !NOT_PROJECTS.has(stem) && !isExample) {
      out.projects.push({ path: next, name: entry })
    } else if (MEDIA_EXTENSIONS.has(extension)) {
      // Stills pulled out of a film are not resources of a project.
      if (!next.includes('frames/')) out.files.push(next)
    }
  }
}

/** Resolve a client-supplied path, refusing anything outside the repository. */
function insideRoot(root: string, requested: string): string | null {
  const full = resolve(root, normalize(requested))
  const withSep = root.endsWith(sep) ? root : root + sep
  if (full !== root && !full.startsWith(withSep)) return null
  return full
}

function sendFile(
  root: string,
  requested: string,
  range: string | undefined,
  res: ServerResponse,
): void {
  const full = insideRoot(root, requested)
  if (!full) {
    res.statusCode = 403
    res.end('outside the workspace')
    return
  }
  let size: number
  try {
    size = statSync(full).size
  } catch {
    res.statusCode = 404
    res.end('not found')
    return
  }

  const type = CONTENT_TYPES[extname(full).toLowerCase()] ?? 'application/octet-stream'
  res.setHeader('Content-Type', type)
  res.setHeader('Accept-Ranges', 'bytes')
  res.setHeader('Cache-Control', 'no-store')

  const match = range ? /bytes=(\d*)-(\d*)/.exec(range) : null
  if (match) {
    const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2] || 0))
    const end = match[1] && match[2] ? Number(match[2]) : size - 1
    if (Number.isFinite(start) && start < size && end >= start) {
      res.statusCode = 206
      res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`)
      res.setHeader('Content-Length', String(end - start + 1))
      createReadStream(full, { start, end }).pipe(res)
      return
    }
  }
  res.setHeader('Content-Length', String(size))
  createReadStream(full).pipe(res)
}

/** The OS font directories the local server may list for the picker. */
function systemFontDirs(): string[] {
  const home = homedir()
  const dirs = [
    '/usr/share/fonts',
    '/usr/local/share/fonts',
    `${home}/.fonts`,
    `${home}/.local/share/fonts`,
    '/System/Library/Fonts',
    '/Library/Fonts',
    `${home}/Library/Fonts`,
    'C:\\Windows\\Fonts',
  ]
  return dirs.filter((dir) => {
    try {
      return statSync(dir).isDirectory()
    } catch {
      return false
    }
  })
}

/** Recursively collect every font file under `dir`. */
function collectFontFiles(dir: string, out: string[], depth = 0): void {
  if (depth > 4) return
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const entry of entries) {
    const full = join(dir, entry)
    let stat
    try {
      stat = statSync(full)
    } catch {
      continue
    }
    if (stat.isDirectory()) collectFontFiles(full, out, depth + 1)
    else if (FONT_EXTENSIONS.has(extname(entry).toLowerCase())) out.push(full)
  }
}

function workspace(): Plugin {
  let root = process.cwd()

  const handler = (
    req: import('node:http').IncomingMessage,
    res: ServerResponse,
    next: () => void,
  ): void => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (url.pathname === '/__workspace') {
      const found: Found = { projects: [], files: [] }
      walk(root, '', found)
      found.projects.sort((a, b) => a.path.localeCompare(b.path))
      found.files.sort()
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.setHeader('Cache-Control', 'no-store')
      res.end(JSON.stringify(found))
      return
    }
    if (url.pathname === '/__workspace/file') {
      const path = url.searchParams.get('path')
      if (!path) {
        res.statusCode = 400
        res.end('path is required')
        return
      }
      sendFile(root, path, req.headers.range as string | undefined, res)
      return
    }
    if (url.pathname === '/__fonts') {
      // List the fonts in `public/fonts/` AND the OS's own font directories, so
      // a local deployment can use a face the user already has installed — no
      // copy, no code edit.
      const builtin: Array<{ file: string; name: string; url: string; size: number }> = []
      const system: Array<{ file: string; name: string; url: string; size: number }> = []
      const seen = new Set<string>()

      const localDir = join(root, 'public', 'fonts')
      let local: string[] = []
      try {
        local = readdirSync(localDir).filter((name) => FONT_EXTENSIONS.has(extname(name).toLowerCase()))
      } catch {
        /* no local fonts */
      }
      local.sort((a, b) => a.localeCompare(b))
      for (const name of local) {
        const key = name.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        let size = 0
        try {
          size = statSync(join(localDir, name)).size
        } catch {
          /* keep 0 */
        }
        builtin.push({
          file: name,
          name: name.replace(/\.[^.]+$/, ''),
          url: `/fonts/${encodeURIComponent(name)}`,
          size,
        })
      }

      const systemFiles: string[] = []
      for (const dir of systemFontDirs()) collectFontFiles(dir, systemFiles)
      systemFiles.sort((a, b) => a.localeCompare(b))
      for (const full of systemFiles) {
        const name = full.split(sep).pop() ?? full
        const key = name.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        let size = 0
        try {
          size = statSync(full).size
        } catch {
          /* keep 0 */
        }
        system.push({
          file: name,
          name: name.replace(/\.[^.]+$/, ''),
          url: `/__fonts/file?path=${encodeURIComponent(full)}`,
          size,
        })
      }

      // 内置字体在前，系统字体在后，各自按名字排序。
      const fonts = [...builtin, ...system]
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.setHeader('Cache-Control', 'no-store')
      res.end(JSON.stringify(fonts))
      return
    }
    if (url.pathname === '/__fonts/file') {
      const path = url.searchParams.get('path')
      if (!path) {
        res.statusCode = 400
        res.end('path is required')
        return
      }
      // Only serve a font from the OS directories, never an arbitrary path.
      const allowed = systemFontDirs().some((dir) => path === dir || path.startsWith(dir + sep))
      if (!allowed) {
        res.statusCode = 403
        res.end('not a system font')
        return
      }
      let size: number
      try {
        size = statSync(path).size
      } catch {
        res.statusCode = 404
        res.end('not found')
        return
      }
      const type =
        extname(path).toLowerCase() === '.woff2'
          ? 'font/woff2'
          : extname(path).toLowerCase() === '.woff'
            ? 'font/woff'
            : extname(path).toLowerCase() === '.otf'
              ? 'font/otf'
              : 'font/ttf'
      res.setHeader('Content-Type', type)
      res.setHeader('Content-Length', String(size))
      res.setHeader('Cache-Control', 'no-store')
      createReadStream(path).pipe(res)
      return
    }
    if (url.pathname === '/__workspace/save') {
      if (req.method !== 'POST') {
        res.statusCode = 405
        res.end('POST only')
        return
      }
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
            name?: string
            text?: string
          }
          const name = (body.name || '未命名项目').replace(/[\\/:*?"<>|]/g, '_').trim() || '未命名项目'
          const file = `${name}.txt`
          const target = join(root, file)
          writeFileSync(target, body.text ?? '', 'utf8')
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ ok: true, path: file }))
        } catch (error) {
          res.statusCode = 500
          res.end(`save failed: ${error instanceof Error ? error.message : String(error)}`)
        }
      })
      return
    }
    if (url.pathname === '/__ai/chat') {
      if (req.method !== 'POST') {
        res.statusCode = 405
        res.end('POST only')
        return
      }
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', () => {
        void (async () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
              provider?: string
              baseUrl?: string
              apiKey?: string
              model?: string
              messages?: unknown
              tools?: unknown
            }
            // 客户端图形化配置优先；没给时从 ai-providers.json 派生
            // （name / base_url / env_keys / default_model），不硬编码供应商。
            const providerIds = Object.keys(aiProviders.providers) as AIProviderId[]
            const provider = providerIds.includes(body.provider as AIProviderId)
              ? (body.provider as AIProviderId)
              : (aiProviders.default_provider as AIProviderId)
            const source = aiProviders.providers[provider] as AIProviderSource
            const envKey = source.env_keys.map((key) => process.env[key]).find((value) => !!value) ?? ''
            const apiKey = body.apiKey?.trim() || envKey || ''
            const baseUrl = (body.baseUrl?.trim() || source.base_url).replace(/\/+$/, '')
            const model = body.model?.trim() || source.default_model

            if (!apiKey) {
              res.statusCode = 502
              res.end(
                JSON.stringify({
                  error: `未配置 ${source.name} API Key（设置环境变量 ${source.env_keys.join(' 或 ')}，或在设置面板里填入）`,
                }),
              )
              return
            }
            const controller = new AbortController()
            const timer = setTimeout(() => controller.abort(), 60_000)
            let upstream: Response
            try {
              upstream = await fetch(`${baseUrl}/chat/completions`, {
                method: 'POST',
                signal: controller.signal,
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${apiKey}`,
                  // OpenRouter / OrcaRouter 归属约定：让上游识别这是本 OSS 应用带来的流量。
                  // 头值必须为 ASCII（ByteString），中文标题不能直接写。
                  'HTTP-Referer': 'https://github.com/UAE2/uae2-studio',
                  'X-Title': 'UAE2 Studio',
                },
                body: JSON.stringify({
                  model,
                  messages: body.messages,
                  tools: body.tools,
                  tool_choice: 'auto',
                }),
              })
            } finally {
              clearTimeout(timer)
            }
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.statusCode = upstream.status
            const text = await upstream.text()
            res.end(text)
          } catch (error) {
            res.statusCode = 502
            const cause = error instanceof Error && error.name === 'AbortError'
              ? '请求超时（60 秒无响应）'
              : '网络连接失败，无法访问上游'
            res.end(
              JSON.stringify({
                error: `${cause}。这是网络层错误，不是额度用尽——额度/鉴权问题会以 HTTP 402/401/429 返回。若持续出现，请检查网络、代理或上游服务状态。`,
              }),
            )
          }
        })()
      })
      return
    }
    next()
  }

  return {
    name: 'uae2-workspace',
    configResolved(config) {
      root = config.root
    },
    configureServer(server) {
      server.middlewares.use(handler)
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler)
    },
  }
}

export default defineConfig({
  plugins: [react(), workspace()],
  server: {
    host: '127.0.0.1',
    port: 5273,
    // 绝不允许端口被占用时悄悄漂到 5274：那会让"一个固定 URL"变成两个不同的服务，
    // 浏览器缓存里就永远有一份旧页面。宁可启动失败，也不能换个端口。
    strictPort: true,
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2500,
  },
})
