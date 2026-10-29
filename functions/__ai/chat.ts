/**
 * Cloudflare Pages Function → 路由 `/__ai/chat`。
 * `functions/__ai/chat.ts` 直接对应这个路径，无需 rewrite。
 */
import { proxyAiChat, type AiChatBody } from '../../serverless/ai-proxy'

export async function onRequestPost({ request }: { request: Request }): Promise<Response> {
  let body: AiChatBody = {}
  try {
    body = (await request.json()) as AiChatBody
  } catch {
    /* 空 body / 非法 JSON → 走默认空对象，交给 proxy 报参数错误 */
  }
  return proxyAiChat(body)
}
