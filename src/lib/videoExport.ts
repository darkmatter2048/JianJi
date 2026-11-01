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
  /** Number of independent Web Worker H.264 encoders. */
  threads?: number
  onEncoderReady?: (threads: number) => void
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
  /** Encoder workers used. A value of 1 may be the main-thread fallback. */
  threads: number
}

/** Wait for one painted frame of the page. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
}

const CODECS = ['avc1.640028', 'avc1.4d0028', 'avc1.42001f']

const MAX_ENCODER_THREADS = 4
const MAX_PENDING_FRAMES = 6

export function recommendedEncoderThreads(
  hardwareConcurrency = typeof navigator === 'undefined' ? 1 : navigator.hardwareConcurrency,
): number {
  if (!Number.isFinite(hardwareConcurrency)) return 1
  return Math.max(1, Math.min(MAX_ENCODER_THREADS, Math.floor(hardwareConcurrency / 2)))
}

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

interface EncodedChunk {
  data: ArrayBuffer
  chunkType: EncodedVideoChunkType
  timestamp: number
  duration: number | null
  decoderConfig?: VideoDecoderConfig
}

interface WorkerState {
  worker: Worker
  pending: number
  ready: Promise<void>
  resolveReady: () => void
  flush: Promise<void> | null
  resolveFlush: (() => void) | null
  capacityWaiters: Array<() => void>
}

class WorkerEncoderPool {
  readonly threads: number
  private readonly workers: WorkerState[] = []
  private readonly chunks = new Map<number, EncodedChunk | null>()
  private nextChunk = 0
  private totalFrames = 0
  private decoderConfigWritten = false
  private failure: Error | null = null

  constructor(
    count: number,
    private readonly config: VideoEncoderConfig,
    private readonly fps: number,
    private readonly muxer: Muxer<ArrayBufferTarget>,
  ) {
    this.threads = count
    try {
      for (let index = 0; index < count; index += 1) {
        let resolveReady = () => {}
        const ready = new Promise<void>((resolve) => {
          resolveReady = resolve
        })
        const state: WorkerState = {
          worker: new Worker(new URL('./videoEncoder.worker.ts', import.meta.url), { type: 'module' }),
          pending: 0,
          ready,
          resolveReady,
          flush: null,
          resolveFlush: null,
          capacityWaiters: [],
        }
        state.worker.onmessage = (event: MessageEvent<Record<string, unknown>>) => {
          const message = event.data
          if (message.type === 'ready') {
            state.resolveReady()
            return
          }
          if (message.type === 'flushed') {
            state.resolveFlush?.()
            return
          }
          if (message.type === 'accepted') {
            state.pending = Math.max(0, state.pending - 1)
            state.capacityWaiters.splice(0).forEach((resolve) => resolve())
            return
          }
          if (message.type === 'error') {
            this.fail(new Error(String(message.message || '编码线程失败')))
            return
          }
          if (message.type !== 'chunk') return
          const chunk = message as unknown as EncodedChunk
          const frameIndex = Math.round((chunk.timestamp * this.fps) / 1e6)
          this.chunks.set(frameIndex, chunk)
          this.drain()
        }
        state.worker.onerror = (event) => this.fail(new Error(event.message || '编码线程失败'))
        state.worker.postMessage({ type: 'init', config })
        this.workers.push(state)
      }
    } catch (error) {
      this.close()
      throw error
    }
  }

  async ready(): Promise<void> {
    await Promise.all(this.workers.map((state) => state.ready))
    this.throwIfFailed()
  }

  async encode(canvas: HTMLCanvasElement, index: number, segmentFrames: number): Promise<void> {
    this.throwIfFailed()
    const segment = Math.floor(index / segmentFrames)
    this.totalFrames = Math.max(this.totalFrames, index + 1)
    const state = this.workers[segment % this.workers.length]
    while (state.pending >= MAX_PENDING_FRAMES) {
      await new Promise<void>((resolve) => state.capacityWaiters.push(resolve))
      this.throwIfFailed()
    }
    const bitmap = await createImageBitmap(canvas, 0, 0, canvas.width, canvas.height, {
      resizeWidth: this.config.width,
      resizeHeight: this.config.height,
      resizeQuality: 'high',
    })
    state.pending += 1
    state.worker.postMessage(
      {
        type: 'frame',
        bitmap,
        timestamp: Math.round((index * 1e6) / this.fps),
        duration: Math.round(1e6 / this.fps),
        keyFrame: index % segmentFrames === 0,
        segment,
      },
      [bitmap],
    )
  }

  skip(index: number): void {
    this.totalFrames = Math.max(this.totalFrames, index + 1)
    this.chunks.set(index, null)
    this.drain()
  }

  async finish(): Promise<void> {
    this.throwIfFailed()
    await Promise.all(this.workers.map((state) => {
      state.flush = new Promise<void>((resolve) => {
        state.resolveFlush = resolve
      })
      state.worker.postMessage({ type: 'flush' })
      return state.flush
    }))
    this.throwIfFailed()
    this.drain()
    if (this.nextChunk !== this.totalFrames) {
      throw new Error(`编码结果不完整：需要 ${this.totalFrames} 帧，收到 ${this.nextChunk} 帧`)
    }
  }

  close(): void {
    for (const state of this.workers) state.worker.terminate()
  }

  private drain(): void {
    while (this.chunks.has(this.nextChunk)) {
      const chunk = this.chunks.get(this.nextChunk)
      this.chunks.delete(this.nextChunk)
      this.nextChunk += 1
      if (!chunk) continue
      const metadata = !this.decoderConfigWritten && chunk.decoderConfig
        ? { decoderConfig: chunk.decoderConfig }
        : undefined
      if (metadata) this.decoderConfigWritten = true
      this.muxer.addVideoChunkRaw(
        new Uint8Array(chunk.data),
        chunk.chunkType,
        chunk.timestamp,
        chunk.duration ?? Math.round(1e6 / this.fps),
        metadata,
      )
    }
  }

  private fail(error: Error): void {
    if (this.failure) return
    this.failure = error
    for (const state of this.workers) {
      state.resolveReady()
      state.resolveFlush?.()
      state.capacityWaiters.splice(0).forEach((resolve) => resolve())
    }
  }

  private throwIfFailed(): void {
    if (this.failure) throw this.failure
  }
}

class MainThreadEncoder {
  readonly threads = 1
  private failure: Error | null = null
  private readonly encoder: VideoEncoder
  private readonly width: number
  private readonly height: number

  constructor(
    config: VideoEncoderConfig,
    private readonly fps: number,
    muxer: Muxer<ArrayBufferTarget>,
  ) {
    this.width = config.width
    this.height = config.height
    this.encoder = new VideoEncoder({
      output: (chunk, metadata) => muxer.addVideoChunk(chunk, metadata),
      error: (error) => {
        this.failure = error instanceof Error ? error : new Error(String(error))
      },
    })
    this.encoder.configure(config)
  }

  async encode(canvas: HTMLCanvasElement, index: number, segmentFrames: number): Promise<void> {
    if (this.failure) throw this.failure
    let source: CanvasImageSource = canvas
    if (canvas.width !== this.width || canvas.height !== this.height) {
      const scaled = document.createElement('canvas')
      scaled.width = this.width
      scaled.height = this.height
      const context = scaled.getContext('2d')
      if (!context) throw new Error('无法创建视频缩放画布')
      context.drawImage(canvas, 0, 0, this.width, this.height)
      source = scaled
    }
    const frame = new VideoFrame(source, {
      timestamp: Math.round((index * 1e6) / this.fps),
      duration: Math.round(1e6 / this.fps),
    })
    this.encoder.encode(frame, { keyFrame: index % segmentFrames === 0 })
    frame.close()
    while (this.encoder.encodeQueueSize > MAX_PENDING_FRAMES) await nextFrame()
  }

  skip(): void {}

  async finish(): Promise<void> {
    await this.encoder.flush()
    if (this.failure) throw this.failure
  }

  close(): void {
    if (this.encoder.state !== 'closed') this.encoder.close()
  }
}

type EncoderPipeline = WorkerEncoderPool | MainThreadEncoder

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
  const config: VideoEncoderConfig = {
    codec,
    width,
    height,
    bitrate,
    framerate: fps,
    latencyMode: 'quality',
    avc: { format: 'avc' },
  }

  const target = new ArrayBufferTarget()
  const muxer = new Muxer({
    target,
    video: { codec: 'avc', width, height, frameRate: fps },
    fastStart: 'in-memory',
  })

  const requestedThreads = Math.max(
    1,
    Math.min(MAX_ENCODER_THREADS, Math.round(options.threads ?? recommendedEncoderThreads())),
  )
  let pipeline: EncoderPipeline
  if (requestedThreads > 1 && typeof Worker !== 'undefined' && typeof createImageBitmap !== 'undefined') {
    let pool: WorkerEncoderPool | null = null
    try {
      pool = new WorkerEncoderPool(requestedThreads, config, fps, muxer)
      await pool.ready()
      pipeline = pool
    } catch {
      pool?.close()
      pipeline = new MainThreadEncoder(config, fps, muxer)
    }
  } else {
    pipeline = new MainThreadEncoder(config, fps, muxer)
  }
  options.onEncoderReady?.(pipeline.threads)

  let skipped = 0
  // Every segment is independently decodable and can therefore be assigned to
  // any worker. One-second GOPs keep seeking responsive without bloating files.
  const segmentFrames = Math.max(8, fps)
  setVideoExportMode(true)
  const wasPlaying = snapshot.timeline.playing

  try {
    for (let index = 0; index < total; index += 1) {
      if (options.signal?.aborted) throw new Error('导出已取消')

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
        pipeline.skip(index)
        options.onProgress?.(index + 1, total)
        continue
      }

      await pipeline.encode(frame, index, segmentFrames)

      options.onProgress?.(index + 1, total)
    }

    await pipeline.finish()
    muxer.finalize()
    return {
      blob: new Blob([target.buffer], { type: 'video/mp4' }),
      frames: total - skipped,
      width,
      height,
      skipped,
      threads: pipeline.threads,
    }
  } finally {
    setVideoExportMode(false)
    pipeline.close()
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
