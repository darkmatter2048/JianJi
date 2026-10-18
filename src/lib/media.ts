import type { MediaKind } from '../types'

/**
 * Client-side validation *and* measurement for imported media.
 *
 * Decoding is checked before the file reaches the store: a black panel with no
 * explanation is the worst possible failure, and browsers hide codec problems
 * until the element actually plays. The object URL used for probing is always
 * released — the store creates its own.
 */

/** 512 MB: comfortably above any clip a browser will decode smoothly. */
const MAX_BYTES = 512 * 1024 * 1024

const TIMEOUT_MS = 8000

export interface MediaInfo {
  kind: MediaKind
  /** Intrinsic pixel size; 0 for audio. */
  width: number
  height: number
  /** Seconds for video/audio; 0 for stills. */
  duration: number
}

export type MediaProbe = { ok: true; info: MediaInfo } | { ok: false; message: string }

function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(bytes > 100 * 1024 * 1024 ? 0 : 1)} MB`
}

export function formatBytes(bytes: number): string {
  return formatMb(bytes)
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—'
  const whole = Math.floor(seconds)
  const mm = Math.floor(whole / 60)
  const ss = whole % 60
  return `${mm}:${ss.toString().padStart(2, '0')}`
}

export function kindOf(file: File): MediaKind | null {
  if (file.type.startsWith('video/')) return 'video'
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('audio/')) return 'audio'
  return null
}

function probeImage(url: string, kind: MediaKind): Promise<MediaProbe> {
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () =>
      resolve({
        ok: true,
        info: { kind, width: image.naturalWidth, height: image.naturalHeight, duration: 0 },
      })
    image.onerror = () => resolve({ ok: false, message: '图片解码失败：文件可能已损坏' })
    image.src = url
  })
}

function probeVideo(url: string, kind: MediaKind): Promise<MediaProbe> {
  return new Promise((resolve) => {
    const video = document.createElement('video')
    let settled = false
    const finish = (result: MediaProbe) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      video.removeAttribute('src')
      video.load()
      resolve(result)
    }
    const timer = window.setTimeout(
      () => finish({ ok: false, message: '读取超时：可能是浏览器不支持的编码（如 HEVC）' }),
      TIMEOUT_MS,
    )
    video.preload = 'metadata'
    video.muted = true
    video.onloadedmetadata = () =>
      finish(
        video.videoWidth > 0
          ? {
              ok: true,
              info: {
                kind,
                width: video.videoWidth,
                height: video.videoHeight,
                duration: Number.isFinite(video.duration) ? video.duration : 0,
              },
            }
          : { ok: false, message: '文件没有可用的画面轨道' },
      )
    video.onerror = () => finish({ ok: false, message: '解码失败：浏览器不支持该编码或封装格式' })
    video.src = url
  })
}

function probeAudio(url: string): Promise<MediaProbe> {
  return new Promise((resolve) => {
    const audio = document.createElement('audio')
    let settled = false
    const finish = (result: MediaProbe) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      audio.removeAttribute('src')
      audio.load()
      resolve(result)
    }
    const timer = window.setTimeout(
      () => finish({ ok: false, message: '音频读取超时：可能是浏览器不支持的编码' }),
      TIMEOUT_MS,
    )
    audio.preload = 'metadata'
    audio.onloadedmetadata = () =>
      finish({
        ok: true,
        info: {
          kind: 'audio',
          width: 0,
          height: 0,
          duration: Number.isFinite(audio.duration) ? audio.duration : 0,
        },
      })
    audio.onerror = () => finish({ ok: false, message: '音频解码失败：浏览器不支持该格式' })
    audio.src = url
  })
}

/** Validate + measure a picked file. Never throws, never keeps a URL alive. */
export async function probeMediaFile(file: File): Promise<MediaProbe> {
  if (file.size > MAX_BYTES) {
    return { ok: false, message: `文件过大（${formatMb(file.size)}，上限 ${formatMb(MAX_BYTES)}）` }
  }
  const kind = kindOf(file)
  if (!kind) return { ok: false, message: `不支持的文件类型：${file.type || '未知'}` }

  const url = URL.createObjectURL(file)
  try {
    if (kind === 'image') return await probeImage(url, kind)
    if (kind === 'video') return await probeVideo(url, kind)
    return await probeAudio(url)
  } finally {
    URL.revokeObjectURL(url)
  }
}
