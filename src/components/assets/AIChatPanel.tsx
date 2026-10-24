import { Download, History, Plus, Send, Settings2, Sparkles, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toProjectText } from '../../lib/projectText'
import { runAgent, type ChatMessage } from '../../lib/ai'
import { PROVIDERS, loadAIConfig, saveAIConfig, type AIProvider, type AIConfig } from '../../lib/aiConfig'
import { gatherMediaContext } from '../../lib/mediaAnalysis'
import { downloadBlob } from '../../lib/videoExport'
import { useEditorStore } from '../../store/editorStore'
import { useT } from '../../lib/i18n'
import { Markdown } from './Markdown'

interface RenderedMessage {
  role: 'user' | 'assistant'
  text: string
  error?: boolean
}

interface Conversation {
  id: string
  title: string
  messages: RenderedMessage[]
  updatedAt: number
}

const CONVERSATIONS_KEY = 'uae2.ai.conversations'

function loadConversations(): Conversation[] {
  try {
    const raw = localStorage.getItem(CONVERSATIONS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as Conversation[]
    return Array.isArray(parsed)
      ? parsed
          .filter((c) => c && typeof c.id === 'string' && Array.isArray(c.messages))
          .map((c) => ({
            id: c.id,
            title: typeof c.title === 'string' ? c.title : '未命名对话',
            messages: c.messages.filter(
              (m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string',
            ),
            updatedAt: typeof c.updatedAt === 'number' ? c.updatedAt : 0,
          }))
      : []
  } catch {
    return []
  }
}

function saveConversations(list: Conversation[]): void {
  try {
    localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(list))
  } catch {
    /* localStorage unavailable — history lives only for this session */
  }
}

function newConversationId(): string {
  return `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function toMarkdown(messages: RenderedMessage[]): string {
  return messages
    .map((message) => (message.role === 'user' ? `**你**：\n${message.text}` : `**AI**：\n${message.text}`))
    .join('\n\n---\n\n')
}

type Phase = 'idle' | 'analyzing' | 'thinking'

/**
 * AI 对话：把自然语言需求变成动画。默认是全新对话；历史对话可点按钮在标签页查看，
 * 每个历史项右侧带「下载 / 删除」。
 */
export function AIChatPanel() {
  const t = useT()
  const [conversations, setConversations] = useState<Conversation[]>(() => loadConversations())
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<RenderedMessage[]>([])
  const [view, setView] = useState<'chat' | 'history'>('chat')
  const [draft, setDraft] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [config, setConfig] = useState<AIConfig>(() => loadAIConfig())
  const [configOpen, setConfigOpen] = useState(false)
  const historyRef = useRef<ChatMessage[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages, phase, view])

  // 当前对话变化就 upsert 落盘。
  useEffect(() => {
    if (activeId === null) return
    setConversations((prev) => {
      const title = messages.find((m) => m.role === 'user')?.text.slice(0, 30) ?? '未命名对话'
      const existing = prev.some((c) => c.id === activeId)
      const next = existing
        ? prev.map((c) => (c.id === activeId ? { ...c, title, messages, updatedAt: Date.now() } : c))
        : [{ id: activeId, title, messages, updatedAt: Date.now() }, ...prev]
      saveConversations(next)
      return next
    })
  }, [messages, activeId])

  const patchConfig = (patch: Partial<AIConfig>) => {
    setConfig((prev) => {
      const next = { ...prev, ...patch }
      saveAIConfig(next)
      return next
    })
  }

  const switchProvider = (provider: AIProvider) => {
    const preset = PROVIDERS[provider]
    patchConfig({ provider, model: preset.model, baseUrl: preset.baseUrl })
  }

  const startNewConversation = () => {
    historyRef.current = []
    setActiveId(null)
    setMessages([])
    setView('chat')
    setConfigOpen(false)
  }

  const openConversation = (id: string) => {
    const conv = conversations.find((c) => c.id === id)
    if (!conv) return
    setActiveId(id)
    setMessages(conv.messages)
    historyRef.current = conv.messages.map((m) => ({ role: m.role, content: m.text }))
    setView('chat')
  }

  const deleteConversation = (id: string) => {
    setConversations((prev) => {
      const next = prev.filter((c) => c.id !== id)
      saveConversations(next)
      return next
    })
    if (activeId === id) startNewConversation()
  }

  const exportConversation = (id: string) => {
    const conv = conversations.find((c) => c.id === id)
    if (!conv) return
    downloadBlob(
      new Blob([toMarkdown(conv.messages)], { type: 'text/markdown; charset=utf-8' }),
      `${conv.title || 'AI 对话记录'}.md`,
    )
  }

  const send = async () => {
    const text = draft.trim()
    if (!text || phase !== 'idle') return
    setDraft('')
    // 新对话在第一条消息时落成，避免留一堆空会话。
    if (activeId === null) setActiveId(newConversationId())

    const userMessage: ChatMessage = { role: 'user', content: text }
    historyRef.current.push(userMessage)
    setMessages((prev) => [...prev, { role: 'user', text }])

    // 1) 先自动读取本地素材，视频按长度抽帧，让模型理解素材含义。
    setPhase('analyzing')
    const media = useEditorStore.getState().media
    const includeImages = PROVIDERS[config.provider].vision
    const mediaContext = await gatherMediaContext(media, includeImages)

    // 2) 交给模型：构思分镜 → 生成工程 → 应用 → 截图迭代。
    setPhase('thinking')
    const projectText = toProjectText(useEditorStore.getState())
    const result = await runAgent(historyRef.current, projectText, config, mediaContext)

    if (result.error) {
      const errorText = result.error
      setMessages((prev) => [...prev, { role: 'assistant', text: errorText, error: true }])
    } else if (result.text) {
      setMessages((prev) => [...prev, { role: 'assistant', text: result.text }])
    }
    setPhase('idle')
  }

  const busy = phase !== 'idle'
  const sortedConversations = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt)

  return (
    <div className="ai-chat">
      <div className="ai-chat__head">
        <Sparkles size={14} />
        <span>{t('AI 动画导演')}</span>
        <div className="ai-chat__actions">
          <button
            type="button"
            className={`ai-chat__cfg${view === 'history' ? ' ai-chat__cfg--on' : ''}`}
            aria-label={t('历史对话')}
            onClick={() => setView((v) => (v === 'history' ? 'chat' : 'history'))}
          >
            <History size={13} />
          </button>
          <button type="button" className="ai-chat__cfg" aria-label={t('新建对话')} onClick={startNewConversation}>
            <Plus size={13} />
          </button>
          <button
            type="button"
            className="ai-chat__cfg"
            aria-label={t('AI 供应商设置')}
            onClick={() => setConfigOpen((open) => !open)}
          >
            <Settings2 size={13} />
          </button>
        </div>
      </div>

      {configOpen && view === 'chat' ? (
        <div className="ai-chat__config">
          <div className="ai-chat__config-row">
            <span className="ai-chat__config-label">{t('供应商')}</span>
            <select
              className="ui-select ai-chat__config-select"
              value={config.provider}
              onChange={(event) => switchProvider(event.target.value as AIProvider)}
            >
              <option value="orcarouter">OrcaRouter</option>
              <option value="deepseek">DeepSeek</option>
            </select>
          </div>
          <div className="ai-chat__config-row">
            <span className="ai-chat__config-label">API Key</span>
            <input
              type="password"
              className="ui-input ai-chat__config-input"
              value={config.apiKey}
              placeholder={PROVIDERS[config.provider].keyHint}
              onChange={(event) => patchConfig({ apiKey: event.target.value })}
            />
          </div>
          <div className="ai-chat__config-row">
            <span className="ai-chat__config-label">{t('模型')}</span>
            <input
              className="ui-input ai-chat__config-input"
              value={config.model}
              onChange={(event) => patchConfig({ model: event.target.value })}
            />
          </div>
          <div className="ai-chat__config-row">
            <span className="ai-chat__config-label">{t('接口地址')}</span>
            <input
              className="ui-input ai-chat__config-input"
              value={config.baseUrl}
              onChange={(event) => patchConfig({ baseUrl: event.target.value })}
            />
          </div>
          <p className="ai-chat__config-note">
            {config.provider === 'orcarouter' ? (
              <a href="https://www.orcarouter.ai/ref/ref_7a64f320a02958107d0b" target="_blank" rel="noreferrer">
                {t('访问OrcaRouter')}
              </a>
            ) : (
              t('DeepSeek 为纯文本模型，无法查看截图，仅用文字描述理解素材。')
            )}
          </p>
        </div>
      ) : null}

      {view === 'history' ? (
        <div className="ai-chat__history">
          <div className="ai-chat__history-head">
            <span>{t('历史对话')}</span>
            <button type="button" className="ai-chat__cfg" aria-label={t('新建对话')} onClick={startNewConversation}>
              <Plus size={13} />
            </button>
          </div>
          <div className="ai-chat__history-list">
            {sortedConversations.length === 0 ? (
              <div className="ai-chat__empty">{t('还没有历史对话。')}</div>
            ) : null}
            {sortedConversations.map((conv) => (
              <div
                key={conv.id}
                className={`ai-chat__history-item${conv.id === activeId ? ' ai-chat__history-item--active' : ''}`}
                onClick={() => openConversation(conv.id)}
              >
                <div className="ai-chat__history-main">
                  <b>{conv.title}</b>
                  <em>
                    {conv.messages.length} {t('条消息')} · {new Date(conv.updatedAt).toLocaleString()}
                  </em>
                </div>
                <div className="ai-chat__history-actions">
                  <button
                    type="button"
                    className="ai-chat__cfg"
                    aria-label={t('下载对话')}
                    onClick={(event) => {
                      event.stopPropagation()
                      exportConversation(conv.id)
                    }}
                  >
                    <Download size={13} />
                  </button>
                  <button
                    type="button"
                    className="ai-chat__cfg ai-chat__cfg--danger"
                    aria-label={t('删除对话')}
                    onClick={(event) => {
                      event.stopPropagation()
                      deleteConversation(conv.id)
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <>
          <div className="ai-chat__scroll" ref={scrollRef}>
            {messages.length === 0 ? (
              <div className="ai-chat__empty">
                {t('告诉我你想做什么动画，例如：')}
                <br />
                {t('“让 MacBook 从合上到打开，屏幕播放视频，标题淡入”')}
              </div>
            ) : null}
            {messages.map((message, index) => (
              <div
                key={index}
                className={`ai-chat__msg ai-chat__msg--${message.role}${message.error ? ' ai-chat__msg--error' : ''}`}
              >
                {message.role === 'assistant' ? <Markdown text={message.text} /> : message.text}
              </div>
            ))}
            {phase !== 'idle' ? (
              <div className="ai-chat__msg ai-chat__msg--assistant ai-chat__msg--busy">
                <span className="ai-chat__spinner" aria-hidden />
                <span>{phase === 'analyzing' ? t('正在读取素材并抽帧分析…') : t('思考中…')}</span>
              </div>
            ) : null}
          </div>

          <div className="ai-chat__input">
            <div className="ai-chat__input-box">
              <textarea
                value={draft}
                rows={2}
                placeholder={t('描述你的动画需求…')}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    void send()
                  }
                }}
              />
              <button type="button" className="ai-chat__send" disabled={busy || !draft.trim()} onClick={() => void send()}>
                <Send size={15} />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
