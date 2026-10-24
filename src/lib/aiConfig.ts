/**
 * AI 供应商配置：OrcaRouter（默认，支持自适应路由与视觉）或 DeepSeek（纯文本）。
 *
 * 供应商的**唯一来源**是仓库根目录的 `ai-providers.json`——加一个供应商 = 在 JSON
 * 里加一条，这里和 `vite.config.ts` 都从它派生，不会各写一套造成漂移。
 * 运行时配置（选哪个、key、model、baseUrl）存在 localStorage，方便图形化改。
 */
import registry from '../../ai-providers.json'

export type AIProvider = keyof typeof registry.providers

interface ProviderSource {
  name: string
  base_url: string
  env_keys: string[]
  vision: boolean
  default_model: string
}

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

const PROVIDER_IDS = Object.keys(registry.providers) as AIProvider[]

export const PROVIDERS = Object.fromEntries(
  PROVIDER_IDS.map((id) => {
    const p = registry.providers[id] as ProviderSource
    return [
      id,
      {
        label: p.name,
        baseUrl: p.base_url,
        model: p.default_model,
        vision: p.vision,
        keyHint: p.env_keys[0],
      },
    ]
  }),
) as Record<AIProvider, ProviderPreset>

export const DEFAULT_PROVIDER = (registry.default_provider as AIProvider) ?? PROVIDER_IDS[0]

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
      const provider: AIProvider = PROVIDER_IDS.includes(parsed.provider as AIProvider)
        ? (parsed.provider as AIProvider)
        : DEFAULT_PROVIDER
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
  return defaultConfig(DEFAULT_PROVIDER)
}

export function saveAIConfig(config: AIConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  } catch {
    /* localStorage unavailable (private mode) — the config just lives for this session */
  }
}
