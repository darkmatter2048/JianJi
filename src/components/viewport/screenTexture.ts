import * as THREE from 'three'
import type { ScreenSettings } from '../../types'

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

/** Width of the drawing buffer. Taller panels just get a taller canvas. */
const PANEL_WIDTH = 1024

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
  onError?: (message: string) => void,
): ScreenRuntime {
  const canvas = document.createElement('canvas')
  canvas.width = PANEL_WIDTH
  canvas.height = Math.max(2, Math.round(PANEL_WIDTH / (panelAspect || 1.6)))
  const ctx = canvas.getContext('2d')

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4

  let disposed = false
  let video: VideoWithFrameCallback | null = null
  let rafHandle = 0
  let videoFrameHandle = 0

  const paint = (source: CanvasImageSource, width: number, height: number) => {
    if (disposed || !ctx) return
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
    element.crossOrigin = 'anonymous'
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
    image.crossOrigin = 'anonymous'
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
      const target = Math.max(0, sourceTime)
      if (Math.abs(video.currentTime - target) < 1e-4) return
      const node = video
      const seek = new Promise<void>((resolve) => {
        const done = () => {
          node.removeEventListener('seeked', done)
          node.removeEventListener('error', done)
          pendingSeeks.delete(seek)
          resolve()
        }
        node.addEventListener('seeked', done)
        node.addEventListener('error', done)
        // A decoded frame is painted as soon as it lands, so the texture is ready
        // by the time the seek resolves.
        node.addEventListener(
          'seeked',
          () => paint(node, node.videoWidth, node.videoHeight),
          { once: true },
        )
      })
      pendingSeeks.add(seek)
      node.currentTime = target
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
    texture,
    syncVideo,
    dispose: () => {
      disposed = true
      if (rafHandle) cancelAnimationFrame(rafHandle)
      if (video) {
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
