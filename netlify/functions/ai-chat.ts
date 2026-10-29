/**
 * Netlify Function → `/.netlify/functions/ai-chat`，再用 netlify.toml 的 redirect
 * 把 `/__ai/chat` 重写到这个地址。
 */
import { proxyAiChat, type AiChatBody } from '../../serverless/ai-proxy'

export default async function handler(event: { body?: string }): Promise<Response> {
  let body: AiChatBody = {}
  try {
    body = JSON.parse(event.body || '{}') as AiChatBody
  } catch {
    /* 空 body / 非法 JSON */
  }
  return proxyAiChat(body)
}
