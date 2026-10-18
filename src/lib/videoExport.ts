import { ArrayBufferTarget, Muxer } from 'mp4-muxer'
import { seekBackdropVideo } from './backdrop'
import { videosSettled, setVideoExportMode } from '../components/viewport/screenTexture'
import { requestShotFrame } from './capture'
import { lastKeyframeTime } from './keyframes'
import { ASPECT_RATIO, type EditorSnapshot } from '../types'

/**
 * 导出 MP4.
 *
 * The film is evaluated **frame by frame**, not recorded in real time: for every
 * frame the playhead is placed at `i / fps`, the screen videos are seeked to the
 * exact source frame and waited on, the shot is rendered once, and only then is
 * the picture handed to the encoder. A real-time capture (`MediaRecorder` on the
 * canvas) would drop frames the moment the machine sneezes, and would bake in
 * whatever the video elements happened to be showing.
 *
 * Encoding is WebCodecs' H.264; muxing is `mp4-muxer`. There is no audio track to
 * mux (the timeline has none).
 */

export interface VideoExportOptions {
  fps: number
  /** Long edge cap, so a big window does not produce a gigantic file. */
  maxHeight?: number
  bitrate?: number
  onProgress?: (done: number, total: number) => void
  signal?: AbortSignal
}

export interface VideoExportResult {
  blob: Blob
  frames: number
  width: number
  height: number
  /** Frames whose screen video had not decoded yet. */
  skipped: number
}

/** Wait for one painted frame of the page. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
}

const CODECS = ['avc1.640028', 'avc1.4d0028', 'avc1.42001f']

async function pickCodec(width: number, height: number, fps: number, bitrate: number): Promise<string> {
  for (const codec of CODECS) {
    try {
      const support = await VideoEncoder.isConfigSupported({
        codec,
        width,
        height,
        bitrate,
        framerate: fps,
      })
      if (support.supported) return codec
    } catch {
      /* try the next profile */
    }
  }
  throw new Error('这台浏览器没有可用的 H.264 编码器（WebCodecs）')
}

/** Even numbers only: H.264 wants them, and odd sizes fail to encode. */
const even = (value: number): number => Math.max(2, Math.round(value / 2) * 2)

export async function exportVideo(
  snapshot: EditorSnapshot,
  seek: (time: number) => void,
  options: VideoExportOptions,
): Promise<VideoExportResult> {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') {
    throw new Error('这台浏览器不支持 WebCodecs，无法导出 MP4')
  }

  const fps = Math.max(1, Math.round(options.fps))
  const duration = lastKeyframeTime(snapshot.objects, snapshot.timeline.cameraKeyframes)
  const total = Math.max(1, Math.round(duration * fps))

  // The frame the shot pass will draw: the project's aspect, capped in height.
  const ratio = ASPECT_RATIO[snapshot.project.aspect]
  /**
   * The export has its own size, so a small window still yields a 1080p film —
   * the render pass resizes itself for the capture (see `ShotPreview`).
   */
  const height = even(options.maxHeight ?? 1080)
  const width = even(height * ratio)

  const bitrate = options.bitrate ?? Math.round(width * height * fps * 0.14)
  const codec = await pickCodec(width, height, fps, bitrate)

  const target = new ArrayBufferTarget()
  const muxer = new Muxer({
    target,
    video: { codec: 'avc', width, height, frameRate: fps },
    fastStart: 'in-memory',
  })

  let failure: Error | null = null
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (error) => {
      failure = error instanceof Error ? error : new Error(String(error))
    },
  })
  encoder.configure({ codec, width, height, bitrate, framerate: fps, latencyMode: 'quality' })

  let skipped = 0
  setVideoExportMode(true)
  const wasPlaying = snapshot.timeline.playing

  try {
    for (let index = 0; index < total; index += 1) {
      if (options.signal?.aborted) throw new Error('导出已取消')
      if (failure) throw failure

      const time = index / fps
      seek(time)
      // Let the render loop push the new time into the videos, wait for their
      // seeked frames, then let the texture repaint before the shot is drawn.
      await nextFrame()
      await Promise.all([videosSettled(), seekBackdropVideo(time)])
      await nextFrame()

      const frame = await requestShotFrame(height)
      if (!frame) {
        skipped += 1
        continue
      }

      // The shot pass renders at the canvas size; scale into the output frame.
      const scaled = document.createElement('canvas')
      scaled.width = width
      scaled.height = height
      const ctx = scaled.getContext('2d')
      if (ctx) {
        ctx.drawImage(frame, 0, 0, width, height)
        const bitmap = new VideoFrame(scaled, {
          timestamp: Math.round((index * 1e6) / fps),
          duration: Math.round(1e6 / fps),
        })
        encoder.encode(bitmap, { keyFrame: index % (fps * 2) === 0 })
        bitmap.close()
      }

      options.onProgress?.(index + 1, total)
      // Keep the encoder's queue shallow: unbounded, a long piece eats all RAM.
      while (encoder.encodeQueueSize > 8 && !failure) await nextFrame()
    }

    await encoder.flush()
    if (failure) throw failure
    muxer.finalize()
    return { blob: new Blob([target.buffer], { type: 'video/mp4' }), frames: total - skipped, width, height, skipped }
  } finally {
    setVideoExportMode(false)
    if (encoder.state !== 'closed') encoder.close()
    // Put the timeline back where the artist left it.
    seek(snapshot.timeline.currentTime)
    if (wasPlaying) snapshot.timeline.playing
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 4000)
}
