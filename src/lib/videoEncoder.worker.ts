interface InitMessage {
  type: 'init'
  config: VideoEncoderConfig
}

interface FrameMessage {
  type: 'frame'
  bitmap: ImageBitmap
  timestamp: number
  duration: number
  keyFrame: boolean
  segment: number
}

interface FlushMessage {
  type: 'flush'
}

type EncoderMessage = InitMessage | FrameMessage | FlushMessage

let config: VideoEncoderConfig | null = null
let encoder: VideoEncoder | null = null
let segment = -1
let chain = Promise.resolve()

function copyDescription(description: AllowSharedBufferSource | undefined): ArrayBuffer | undefined {
  if (!description) return undefined
  if (description instanceof ArrayBuffer) return description.slice(0)
  if (ArrayBuffer.isView(description)) {
    return new Uint8Array(
      description.buffer,
      description.byteOffset,
      description.byteLength,
    ).slice().buffer
  }
  return new Uint8Array(description).slice().buffer
}

function createEncoder(): VideoEncoder {
  if (!config) throw new Error('编码线程尚未初始化')
  const next = new VideoEncoder({
    output: (chunk, metadata) => {
      const data = new ArrayBuffer(chunk.byteLength)
      chunk.copyTo(data)
      const decoderConfig = metadata?.decoderConfig
        ? {
            ...metadata.decoderConfig,
            description: copyDescription(metadata.decoderConfig.description),
          }
        : undefined
      const transfers: Transferable[] = [data]
      if (decoderConfig?.description) transfers.push(decoderConfig.description)
      postMessage(
        {
          type: 'chunk',
          data,
          chunkType: chunk.type,
          timestamp: chunk.timestamp,
          duration: chunk.duration,
          decoderConfig,
        },
        { transfer: transfers },
      )
    },
    error: (error) => postMessage({ type: 'error', message: error.message }),
  })
  next.configure(config)
  return next
}

async function beginSegment(nextSegment: number): Promise<void> {
  if (segment === nextSegment && encoder) return
  if (encoder) {
    await encoder.flush()
    encoder.close()
  }
  segment = nextSegment
  encoder = createEncoder()
}

async function handle(message: EncoderMessage): Promise<void> {
  if (message.type === 'init') {
    config = message.config
    // Configure once during startup so unsupported worker-side encoders fail
    // before the export starts rendering hundreds of frames.
    encoder = createEncoder()
    postMessage({ type: 'ready' })
    return
  }

  if (message.type === 'frame') {
    try {
      await beginSegment(message.segment)
      const frame = new VideoFrame(message.bitmap, {
        timestamp: message.timestamp,
        duration: message.duration,
      })
      message.bitmap.close()
      encoder?.encode(frame, { keyFrame: message.keyFrame })
      frame.close()
      postMessage({ type: 'accepted' })
    } catch (error) {
      message.bitmap.close()
      throw error
    }
    return
  }

  if (encoder) await encoder.flush()
  postMessage({ type: 'flushed' })
}

globalThis.onmessage = (event: MessageEvent<EncoderMessage>) => {
  chain = chain
    .then(() => handle(event.data))
    .catch((error: unknown) => {
      postMessage({
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      })
    })
}

