/**
 * AI 供应商配置：OrcaRouter（默认，支持自适应路由与视觉）或 DeepSeek（纯文本）。
 *
 * 存在 localStorage，方便在设置面板里图形化改，不用动环境变量。OrcaRouter 走
 * https://api.orcarouter.ai/v1 + ORCAROUTER_API_KEY；DeepSeek 走
 * https://api.deepseek.com + DEEPSEEK_API_KEY（OpenAI 兼容）。
 */

export type AIProvider = 'orcarouter' | 'deepseek'

export interface AIConfig {
  provider: AIProvider
  apiKey: string
  model: string
  baseUrl: string
}

export interface ProviderPreset {
  label: string
  baseUrl: string
  model: string
  /** 该供应商是否支持图像输入（视觉）。 */
  vision: boolean
  keyHint: string
}

export const PROVIDERS: Record<AIProvider, ProviderPreset> = {
  orcarouter: {
    label: 'OrcaRouter',
    baseUrl: 'https://api.orcarouter.ai/v1',
    model: 'orcarouter/auto',
    vision: true,
    keyHint: 'ORCAROUTER_API_KEY',
  },
  deepseek: {
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    vision: false,
    keyHint: 'DEEPSEEK_API_KEY',
  },
}

const STORAGE_KEY = 'uae2.ai.config'

export function defaultConfig(provider: AIProvider): AIConfig {
  const preset = PROVIDERS[provider]
  return { provider, apiKey: '', model: preset.model, baseUrl: preset.baseUrl }
}

export function loadAIConfig(): AIConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AIConfig>
      const provider: AIProvider = parsed.provider === 'deepseek' ? 'deepseek' : 'orcarouter'
      const preset = PROVIDERS[provider]
      return {
        provider,
        apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
        model: parsed.model?.trim() || preset.model,
        baseUrl: parsed.baseUrl?.trim() || preset.baseUrl,
      }
    }
  } catch {
    /* fall through to default */
  }
  return defaultConfig('orcarouter')
}

export function saveAIConfig(config: AIConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  } catch {
    /* localStorage unavailable (private mode) — the config just lives for this session */
  }
}
