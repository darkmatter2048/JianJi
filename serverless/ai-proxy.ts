/**
 * 网页版 AI 代理的共享逻辑。
 *
 * 纯静态部署（Vercel / Netlify / Cloudflare Pages）没有 dev server，也没有
 * 桌面端内置的本地服务；这份代码被三个平台的 Serverless Function 复用，
 * 充当 `/__ai/chat` 的后端转发：浏览器把用户自己的 baseUrl / apiKey / model
 * 发上来，这里转发到上游 LLM，绕开浏览器的 CORS 限制。
 *
 * 只用 Web 标准 API（fetch / Response），三个运行时都能跑。
 */

export interface AiChatBody {
  provider?: string
  baseUrl?: string
  apiKey?: string
  model?: string
  messages?: unknown[]
  tools?: unknown[]
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })
}

export async function proxyAiChat(body: AiChatBody): Promise<Response> {
  const baseUrl = (body.baseUrl || '').trim().replace(/\/+$/, '')
  const apiKey = (body.apiKey || '').trim()
  const model = (body.model || '').trim()
  const messages = body.messages ?? []
  const tools = body.tools ?? undefined

  if (!baseUrl || !model) {
    return json(400, { error: '缺少 baseUrl 或 model' })
  }
  if (!apiKey) {
    return json(401, { error: '请在 AI 面板里填写 API Key' })
  }

  let upstream: Response | null = null
  let lastError: unknown = null
  for (let attempt = 0; attempt < 3 && !upstream; attempt += 1) {
    try {
      upstream = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://github.com/darkmatter2048/JianJi',
          'X-Title': 'JianJi (UAE2 Studio)',
        },
        body: JSON.stringify({ model, messages, tools, tool_choice: 'auto' }),
      })
    } catch (error) {
      lastError = error
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)))
    }
  }

  if (!upstream) {
    const detail = lastError instanceof Error ? lastError.message : String(lastError)
    return json(502, { error: `网络连接失败（${detail}）` })
  }

  // 原样回传上游的 JSON（含正确的 HTTP 状态码），客户端会读 response.json()。
  return upstream
}
