import type { MediaAsset } from '../types'

/**
 * 素材含义分析：把素材库里的图片/视频压成小图给模型"看"。
 *
 * 图片给一张缩略图；视频按长度抽帧（时长越长抽得越多，最多 6 帧），让模型在
 * 不读全片的情况下也能理解这段素材在讲什么。
 */

export interface MediaSample {
  name: string
  /** 抽帧时刻（秒）；图片没有。 */
  time?: number
  /** 压缩后的 JPEG data URL。 */
  image: string
}

export interface MediaContext {
  /** 素材的文本摘要（名字、类型、尺寸、时长），纯文本模型也能用。 */
  text: string
  /** 压缩后的采样画面，视觉模型用。 */
  samples: MediaSample[]
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片加载失败'))
    img.src = src
  })
}

/** 等比压缩到最长边 ≤ maxEdge，输出 JPEG。 */
export async function compressImage(src: string, maxEdge = 256): Promise<string> {
  const img = await loadImage(src)
  const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight))
  const width = Math.max(1, Math.round(img.naturalWidth * scale))
  const height = Math.max(1, Math.round(img.naturalHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建画布')
  ctx.drawImage(img, 0, 0, width, height)
  return canvas.toDataURL('image/jpeg', 0.6)
}

/** 按长度抽帧：约每 3 秒一帧，1~6 帧，避开首尾黑场。 */
async function sampleVideo(src: string, duration: number): Promise<MediaSample[]> {
  const count = Math.min(6, Math.max(1, Math.round(duration / 3)))
  const video = document.createElement('video')
  video.src = src
  video.muted = true
  video.preload = 'auto'
  await new Promise<void>((resolve) => {
    const done = () => resolve()
    video.addEventListener('loadedmetadata', done, { once: true })
    video.addEventListener('error', done, { once: true })
    // 某些 object URL 的 metadata 立刻就有
    if (video.readyState >= 1) done()
  })
  const total = video.duration || duration || 1
  const times = Array.from({ length: count }, (_, i) => ((i + 0.5) / count) * total)
  const samples: MediaSample[] = []
  for (const time of times) {
    await new Promise<void>((resolve) => {
      const onSeek = () => resolve()
      video.addEventListener('seeked', onSeek, { once: true })
      video.currentTime = Math.min(time, Math.max(0, total - 0.05))
      // 兜底：个别浏览器不派发 seeked
      setTimeout(resolve, 1500)
    })
    if (video.videoWidth <= 0) continue
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) continue
    ctx.drawImage(video, 0, 0)
    samples.push({ name: '', time, image: canvas.toDataURL('image/jpeg', 0.6) })
  }
  video.removeAttribute('src')
  video.load()
  return samples
}

/**
 * 汇总素材库：给模型一份"现在我手里有哪些素材、它们是什么"的上下文。
 * `includeImages` 为 false 时只给文本（纯文本供应商如 DeepSeek 用）。
 */
export async function gatherMediaContext(
  media: MediaAsset[],
  includeImages: boolean,
): Promise<MediaContext> {
  const lines: string[] = []
  const samples: MediaSample[] = []
  const label = (kind: MediaAsset['kind']) =>
    kind === 'image' ? '图片' : kind === 'video' ? '视频' : '音频'

  for (const asset of media) {
    const dims = asset.width > 0 ? `${asset.width}×${asset.height}` : ''
    const dur = asset.duration > 0 ? `${Math.round(asset.duration * 10) / 10} 秒` : ''
    const meta = [label(asset.kind), dims, dur].filter(Boolean).join('，')
    lines.push(`- ${asset.name}（${meta}）`)

    if (!includeImages) continue
    if (asset.kind === 'image') {
      try {
        const image = await compressImage(asset.src, 256)
        samples.push({ name: asset.name, image })
      } catch {
        /* 读不了的图就只留文本 */
      }
    } else if (asset.kind === 'video') {
      try {
        const frames = await sampleVideo(asset.src, asset.duration)
        for (const frame of frames) {
          samples.push({ name: asset.name, time: frame.time, image: frame.image })
        }
      } catch {
        /* 抽帧失败就只留文本 */
      }
    }
  }

  return {
    text: media.length > 0 ? lines.join('\n') : '（素材区是空的）',
    samples,
  }
}
