import * as THREE from 'three'
import type { ScreenSettings } from '../../types'
import { clampVideoTime, seekVideoFrame } from '../../lib/videoSeek'

/**
 * Screen sources are redrawn into a canvas that matches the panel's aspect
 * ratio, and that canvas becomes the texture.
 *
 * Doing it this way (instead of assigning the image/video straight to
 * `material.map`) buys three things for the same code path:
 *   - `cover` / `contain` are real (crop or letterbox), not a UV trick that
 *     smears the edge pixels,
 *   - rotation is applied around the panel centre,
 *   - a video can be re-drawn per presented frame with `requestVideoFrameCallback`.
 */

interface ScreenTextureOptions {
  maxTextureSize: number
  maxAnisotropy: number
  onTextureChange: (texture: THREE.CanvasTexture) => void
}

/** Match the source's pixel density after fitting it into the panel. */
export function screenTextureSize(
  sourceWidth: number,
  sourceHeight: number,
  panelAspect: number,
  settings: Pick<ScreenSettings, 'fit' | 'rotation'>,
  maxTextureSize: number,
): { width: number; height: number } {
  const aspect = Number.isFinite(panelAspect) && panelAspect > 0 ? panelAspect : 1.6
  const quarterTurn = Math.abs(Math.round(settings.rotation / 90)) % 2 === 1
  const boxWidth = quarterTurn ? 1 : aspect
  const boxHeight = quarterTurn ? aspect : 1
  const horizontalDensity = sourceWidth / boxWidth
  const verticalDensity = sourceHeight / boxHeight
  // Cover crops the source, while contain must preserve every pixel of it.
  // Tile keeps its existing natural-pixel repeat size on the panel.
  const density = settings.fit === 'tile'
    ? 1024 / aspect
    : settings.fit === 'cover'
      ? Math.min(horizontalDensity, verticalDensity)
      : Math.max(horizontalDensity, verticalDensity)
  const width = aspect * density
  const height = density
  const scale = Math.min(1, maxTextureSize / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

export interface ScreenRuntime {
  texture: THREE.CanvasTexture
  /**
   * Put the video where the clip says it should be: `sourceTime` seconds into
   * the file, playing at `rate`. Called every frame while a clip is active, so
   * the picture follows the timeline instead of free-running.
   */
  syncVideo: (sourceTime: number, rate: number, playing: boolean) => void
  /** Loose while playing (seeking stutters), tight when freezing on a frame. */

  dispose: () => void
}

type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: () => void) => number
  cancelVideoFrameCallback?: (handle: number) => void
}

function drawRotated(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  canvasWidth: number,
  canvasHeight: number,
  settings: ScreenSettings,
): void {
  ctx.save()
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, canvasWidth, canvasHeight)

  ctx.translate(canvasWidth / 2, canvasHeight / 2)
  ctx.rotate(THREE.MathUtils.degToRad(settings.rotation))

  // A quarter turn swaps the box the image has to fit into.
  const quarterTurn = Math.abs(Math.round(settings.rotation / 90)) % 2 === 1
  const boxWidth = quarterTurn ? canvasHeight : canvasWidth
  const boxHeight = quarterTurn ? canvasWidth : canvasHeight

  if (sourceWidth > 0 && sourceHeight > 0) {
    if (settings.fit === 'fill') {
      // 填充 — stretch to fill the box exactly, distorting the source's aspect.
      ctx.drawImage(source, -boxWidth / 2, -boxHeight / 2, boxWidth, boxHeight)
    } else if (settings.fit === 'tile') {
      // 平铺 — repeat at natural size; the pattern follows the rotation above.
      const pattern = ctx.createPattern(source, 'repeat')
      if (pattern) {
        ctx.fillStyle = pattern
        ctx.fillRect(-boxWidth / 2, -boxHeight / 2, boxWidth, boxHeight)
      }
    } else {
      const scale =
        settings.fit === 'cover'
          ? Math.max(boxWidth / sourceWidth, boxHeight / sourceHeight)
          : Math.min(boxWidth / sourceWidth, boxHeight / sourceHeight)
      const drawWidth = sourceWidth * scale
      const drawHeight = sourceHeight * scale
      ctx.drawImage(source, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight)
    }
  }

  ctx.restore()
}

/* ------------------------------------------------------------ export mode -- */

/**
 * While the video is being exported the screen videos stop being *played* and
 * start being *seeked*: every frame of the film needs the source frame that
 * belongs to it, exactly, before the picture is grabbed. The plan is the same as
 * everywhere else in this codebase — deterministic evaluation instead of trusting
 * a clock.
 */
let exportMode = false
const pendingSeeks = new Set<Promise<void>>()

export function setVideoExportMode(active: boolean): void {
  exportMode = active
}

/** Resolves once every screen video has landed on the frame it was sent to. */
export async function videosSettled(): Promise<void> {
  while (pendingSeeks.size > 0) {
    await Promise.all([...pendingSeeks])
  }
}

/**
 * Start drawing `settings.src` into a canvas texture.
 *
 * The texture is immediately usable (black) and fills in as soon as the source
 * decodes, so the material can be wired up without waiting.
 */
export function createScreenRuntime(
  settings: ScreenSettings,
  panelAspect: number,
  onError: ((message: string) => void) | undefined,
  options: ScreenTextureOptions,
): ScreenRuntime {
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const ctx = canvas.getContext('2d')

  const createTexture = () => {
    const next = new THREE.CanvasTexture(canvas)
    next.colorSpace = THREE.SRGBColorSpace
    next.anisotropy = options.maxAnisotropy
    return next
  }
  let texture = createTexture()

  // 本地 blob / data 源不需要 CORS 属性，设了反而可能加载失败；只有跨域 http(s) 才要。
  const needsCors = /^https?:/i.test(settings.src ?? '')

  let disposed = false
  let video: VideoWithFrameCallback | null = null
  let rafHandle = 0
  let videoFrameHandle = 0
  let pendingSeekTarget: number | null = null
  let cancelPendingSeek: (() => void) | null = null

  const paint = (source: CanvasImageSource, width: number, height: number) => {
    if (disposed || !ctx || width <= 0 || height <= 0) return
    const size = screenTextureSize(width, height, panelAspect, settings, options.maxTextureSize)
    if (canvas.width !== size.width || canvas.height !== size.height) {
      canvas.width = size.width
      canvas.height = size.height
      // Uploaded textures have immutable storage dimensions. Replace the GPU
      // texture when metadata arrives or an adaptive stream changes resolution.
      const previous = texture
      texture = createTexture()
      options.onTextureChange(texture)
      previous.dispose()
    }
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    drawRotated(ctx, source, width, height, canvas.width, canvas.height, settings)
    texture.needsUpdate = true
  }

  if (settings.source === 'video') {
    const element = document.createElement('video') as VideoWithFrameCallback
    video = element
    element.src = settings.src ?? ''
    element.loop = settings.loop
    element.muted = settings.muted
    element.playsInline = true
    element.playbackRate = settings.rate
    if (needsCors) element.crossOrigin = 'anonymous'
    element.addEventListener('loadeddata', () => {
      paint(element, element.videoWidth, element.videoHeight)
      schedule()
    })
    element.addEventListener('error', () => onError?.('视频解码失败：格式不受浏览器支持'))
    void element.play().catch(() => {
      /* Autoplay refused (unmuted with no gesture) — the first paint still lands. */
    })
  } else {
    const image = new Image()
    if (needsCors) image.crossOrigin = 'anonymous'
    image.onload = () => paint(image, image.naturalWidth, image.naturalHeight)
    image.onerror = () => onError?.('图片解码失败：文件可能已损坏')
    image.src = settings.src ?? ''
  }

  function schedule(): void {
    if (disposed || !video) return
    if (video.requestVideoFrameCallback) {
      videoFrameHandle = video.requestVideoFrameCallback(() => {
        if (disposed || !video) return
        paint(video, video.videoWidth, video.videoHeight)
        schedule()
      })
      return
    }
    rafHandle = requestAnimationFrame(() => {
      if (disposed || !video) return
      paint(video, video.videoWidth, video.videoHeight)
      schedule()
    })
  }

  const syncVideo = (sourceTime: number, rate: number, playing: boolean) => {
    if (disposed || !video) return

    if (exportMode) {
      // Strict: the frame must be the one the timeline asks for, so any drift at
      // all is a seek, and the caller waits on `seeked` before grabbing pixels.
      if (video.paused === false) video.pause()
      const target = clampVideoTime(sourceTime, video.duration)
      if (Math.abs(video.currentTime - target) < 1e-4) return
      if (pendingSeekTarget !== null && Math.abs(pendingSeekTarget - target) < 1e-4) return
      cancelPendingSeek?.()
      const node = video
      pendingSeekTarget = target
      const request = seekVideoFrame(node, target, () => {
        paint(node, node.videoWidth, node.videoHeight)
        pendingSeekTarget = null
        cancelPendingSeek = null
      })
      const seek = request.promise.finally(() => pendingSeeks.delete(seek))
      cancelPendingSeek = request.cancel
      pendingSeeks.add(seek)
      return
    }

    if (Math.abs(video.playbackRate - rate) > 1e-3) {
      video.playbackRate = Math.min(16, Math.max(0.0625, rate))
    }
    // Only re-seek when we have drifted: seeking every frame makes the decoder
    // stutter, and the browser's own clock is smoother than ours. A frozen frame
    // has no clock to trust, so it is held to a much tighter tolerance.
    const tolerance = playing ? 0.2 : 0.02
    if (Math.abs(video.currentTime - sourceTime) > tolerance) {
      video.currentTime = Math.max(0, sourceTime)
    }
    if (playing) {
      if (video.paused) {
        void video.play().catch(() => {
          /* Autoplay policy — the decoded frame is still drawn. */
        })
      }
    } else if (!video.paused) {
      video.pause()
    }
  }

  return {
    get texture() { return texture },
    syncVideo,
    dispose: () => {
      disposed = true
      if (rafHandle) cancelAnimationFrame(rafHandle)
      if (video) {
        cancelPendingSeek?.()
        cancelPendingSeek = null
        if (videoFrameHandle && video.cancelVideoFrameCallback) {
          video.cancelVideoFrameCallback(videoFrameHandle)
        }
        video.pause()
        video.removeAttribute('src')
        video.load()
        video = null
      }
      texture.dispose()
    },
  }
}
