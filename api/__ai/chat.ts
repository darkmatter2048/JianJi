/**
 * Vercel Function → `/api/__ai/chat`，再用 vercel.json 的 rewrite 把
 * `/__ai/chat` 转发到 `/api/__ai/chat`。
 */
import { proxyAiChat, type AiChatBody } from '../../serverless/ai-proxy'

interface VercelResponseLike {
  status(code: number): VercelResponseLike
  setHeader(name: string, value: string): void
  end(data: string): void
}

export default async function handler(
  req: { body?: unknown },
  res: VercelResponseLike,
): Promise<void> {
  const response = await proxyAiChat((req.body ?? {}) as AiChatBody)
  res.status(response.status)
  res.setHeader('Content-Type', response.headers.get('Content-Type') || 'application/json; charset=utf-8')
  res.end(await response.text())
}
