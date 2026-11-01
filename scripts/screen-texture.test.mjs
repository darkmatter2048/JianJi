import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { rolldown } from 'rolldown'

globalThis.window = globalThis

const bundle = await rolldown({
  input: fileURLToPath(new URL('../src/components/viewport/screenTexture.ts', import.meta.url)),
})
const { output } = await bundle.generate({ format: 'esm' })
await bundle.close()
const compiled = output[0].code
const { screenTextureSize, createScreenRuntime, setVideoExportMode, videosSettled } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
)

const settings = { fit: 'contain', rotation: 0 }

test('preserves native 1080p, 4K and portrait detail', () => {
  for (const [width, height] of [[1920, 1080], [3840, 2160], [2160, 3840], [640, 360]]) {
    assert.deepEqual(screenTextureSize(width, height, width / height, settings, 8192), { width, height })
  }
})

test('accounts for fitting, rotation and GPU limits', () => {
  assert.deepEqual(screenTextureSize(1920, 1080, 1, settings, 8192), { width: 1920, height: 1920 })
  assert.deepEqual(screenTextureSize(1920, 1080, 1, { ...settings, fit: 'cover' }, 8192), { width: 1080, height: 1080 })
  assert.deepEqual(screenTextureSize(1920, 1080, 1, { ...settings, fit: 'fill' }, 8192), { width: 1920, height: 1920 })
  for (const rotation of [90, -90, 270]) {
    assert.deepEqual(screenTextureSize(3840, 2160, 9 / 16, { ...settings, rotation }, 8192), { width: 2160, height: 3840 })
  }
  assert.deepEqual(screenTextureSize(7680, 4320, 16 / 9, settings, 4096), { width: 4096, height: 2304 })
  assert.deepEqual(screenTextureSize(3840, 2160, 16 / 9, { ...settings, fit: 'tile' }, 8192), { width: 1024, height: 576 })
})

test('replaces textures, releases them, and settles end-of-video export seeks', async () => {
  const draws = []
  const context = {
    save() {}, restore() {}, fillRect() {}, translate() {}, rotate() {},
    drawImage(...args) { draws.push(args) },
  }
  const canvas = { width: 0, height: 0, getContext: () => context }
  let frameCallback
  const handlers = new Map()
  const video = {
    videoWidth: 3840, videoHeight: 2160,
    duration: 10, currentTime: 0, seeking: false, paused: true,
    play: () => Promise.resolve(), pause() {}, load() {}, removeAttribute() {},
    addEventListener: (event, handler) => handlers.set(event, handler),
    removeEventListener: (event, handler) => {
      if (handlers.get(event) === handler) handlers.delete(event)
    },
    requestVideoFrameCallback: (callback) => { frameCallback = callback; return 1 },
    cancelVideoFrameCallback() {},
  }
  const originalDocument = globalThis.document
  globalThis.document = { createElement: (tag) => tag === 'canvas' ? canvas : video }
  try {
    const replacements = []
    const runtime = createScreenRuntime(
      { ...settings, source: 'video', src: 'blob:test', loop: false, muted: true, rate: 1 },
      16 / 9,
      undefined,
      { maxTextureSize: 8192, maxAnisotropy: 16, onTextureChange: (texture) => replacements.push(texture) },
    )
    const placeholder = runtime.texture
    let disposed = 0
    placeholder.addEventListener('dispose', () => disposed++)
    handlers.get('loadeddata')()
    assert.equal(canvas.width, 3840)
    assert.equal(canvas.height, 2160)
    assert.equal(disposed, 1)
    assert.equal(runtime.texture, replacements[0])
    assert.equal(runtime.texture.anisotropy, 16)
    assert.equal(context.imageSmoothingQuality, 'high')
    frameCallback()
    assert.equal(replacements.length, 1)
    runtime.texture.addEventListener('dispose', () => disposed++)
    video.videoWidth = 1920
    video.videoHeight = 1080
    frameCallback()
    assert.equal(replacements.length, 2)
    assert.equal(disposed, 2)
    assert.equal(canvas.width, 1920)
    assert.equal(canvas.height, 1080)
    setVideoExportMode(true)
    runtime.syncVideo(10, 1, false)
    await videosSettled()
    assert.equal(video.currentTime, 9.999)
    // Repeating the clamped final frame must not create an unresolved seek.
    runtime.syncVideo(10, 1, false)
    await videosSettled()
    setVideoExportMode(false)
    runtime.texture.addEventListener('dispose', () => disposed++)
    runtime.dispose()
    assert.equal(disposed, 3)
    const drawCount = draws.length
    frameCallback()
    assert.equal(draws.length, drawCount)
  } finally {
    setVideoExportMode(false)
    globalThis.document = originalDocument
  }
})
