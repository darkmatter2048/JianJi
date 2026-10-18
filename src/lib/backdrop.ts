import * as THREE from 'three'
import type { BackgroundSettings } from '../types'

/**
 * The composition's background, as something three.js can draw behind the scene.
 *
 * The editing viewport leaves the canvas transparent on purpose: the backdrop is
 * a DOM layer, because a video backdrop has to keep playing while the WebGL tree
 * stands still. But the *shot* — the picture-in-picture and the exported frame —
 * is a picture, and a picture has to carry its own background. So the shot passes
 * get a `scene.background`.
 */

/** Height of the gradient strip; a background is stretched over the frame anyway. */
const GRADIENT_STEPS = 256

interface MediaEntry {
  canvas: HTMLCanvasElement
  texture: THREE.CanvasTexture
  width: number
  height: number
}

/**
 * Backdrops are **cached and never disposed**.
 *
 * They used to be created per shot and disposed right after, which is fine for a
 * gradient but fatal for a media backdrop: the texture *is* a long-lived canvas
 * that gets re-drawn, so disposing it every frame left the GPU side reallocating
 * from a stale upload — the picture came out as tiled patches. The cache is keyed
 * by what makes the picture different, so nothing is re-created per frame.
 */
const mediaCache = new Map<string, MediaEntry>()
const gradientCache = new Map<string, THREE.CanvasTexture>()

/** Draw `source` into `ctx` the way `object-fit` would. */
/** A video mid-seek has no frame to give; drawing it would blank the canvas. */
function mediaReady(source: HTMLImageElement | HTMLVideoElement): boolean {
  return source instanceof HTMLVideoElement
    ? source.readyState >= 2 && source.videoWidth > 0
    : source.complete && source.naturalWidth > 0
}

function drawFit(
  ctx: CanvasRenderingContext2D,
  source: HTMLImageElement | HTMLVideoElement,
  sourceWidth: number,
  sourceHeight: number,
  width: number,
  height: number,
  fit: BackgroundSettings['fit'],
): void {
  const scale =
    fit === 'contain'
      ? Math.min(width / sourceWidth, height / sourceHeight)
      : Math.max(width / sourceWidth, height / sourceHeight)
  const drawWidth = sourceWidth * scale
  const drawHeight = sourceHeight * scale
  ctx.clearRect(0, 0, width, height)
  ctx.drawImage(source, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight)
}

/**
 * A media backdrop is normally a DOM layer *behind* the transparent canvas, so
 * the picture-in-picture and the player see it through the glass for free — but
 * an export reads the canvas pixels, and it would come out with a hole. Drawing
 * the very DOM element that is already showing into a texture closes that gap:
 * the shot is then self-contained.
 */
function createMediaBackdrop(background: BackgroundSettings): THREE.Texture | null {
  const source = document.querySelector<HTMLImageElement | HTMLVideoElement>(
    '.viewport__backdrop img, .viewport__backdrop video',
  )
  if (!source) return null
  const key = background.src ?? ''
  const width = source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth
  const height = source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight
  // Nothing decoded yet: hand back whatever we have (possibly nothing) rather
  // than uploading a blank of the wrong size.
  if (width < 2 || height < 2) return mediaCache.get(key)?.texture ?? null

  let entry = mediaCache.get(key)
  if (!entry || entry.width !== width || entry.height !== height) {
    if (entry) entry.texture.dispose()
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    entry = { canvas, texture, width, height }
    mediaCache.set(key, entry)
  }

  const ctx = entry.canvas.getContext('2d')
  if (!ctx) return entry.texture
  // Keep the last good frame rather than clearing to nothing: a frame grabbed
  // mid-seek would otherwise export a hole.
  if (!mediaReady(source)) return entry.texture
  try {
    drawFit(ctx, source, width, height, entry.width, entry.height, background.fit)
    entry.texture.needsUpdate = true
  } catch {
    /* A frame that went away between the check and the draw. */
  }
  return entry.texture
}

export function createBackdrop(background: BackgroundSettings): THREE.Color | THREE.Texture | null {
  if (background.type === 'solid') return new THREE.Color(background.color)
  if (background.type === 'media') return createMediaBackdrop(background)
  if (background.type !== 'gradient') return null
  const key = `${background.from}|${background.to}|${background.angle}`
  const cached = gradientCache.get(key)
  if (cached) return cached
  const texture = createGradientTexture(background)
  gradientCache.set(key, texture)
  return texture
}

/**
 * The backdrop video is part of the film, so it is locked to the timeline: its
 * clock is the playhead, and it loops from the top of the piece. Live playback
 * only corrects a real drift (seeking every frame would stutter the decoder);
 * export seeks it exactly, like the screen videos.
 */
export function backdropVideo(): HTMLVideoElement | null {
  return document.querySelector<HTMLVideoElement>('.viewport__backdrop video')
}

export function backdropVideoTime(time: number, duration: number): number {
  if (!(duration > 0)) return 0
  return Math.max(0, time % duration)
}

/** Wait until the element knows how long it is, so a seek has something to hit. */
function whenMetadata(video: HTMLVideoElement): Promise<void> {
  if (video.duration > 0) return Promise.resolve()
  return new Promise<void>((resolve) => {
    const done = () => {
      video.removeEventListener('loadedmetadata', done)
      video.removeEventListener('error', done)
      resolve()
    }
    video.addEventListener('loadedmetadata', done)
    video.addEventListener('error', done)
    // A backdrop beat can start before the file is even fetched; giving up after
    // a moment beats stalling the whole export.
    window.setTimeout(done, 3000)
  })
}

/** Seek the backdrop video to `time` and resolve once the frame has landed. */
export async function seekBackdropVideo(time: number): Promise<void> {
  const video = backdropVideo()
  if (!video) return
  await whenMetadata(video)
  if (!(video.duration > 0)) return
  const target = backdropVideoTime(time, video.duration)
  if (Math.abs(video.currentTime - target) < 1e-4) return
  if (!video.paused) video.pause()
  await new Promise<void>((resolve) => {
    const done = () => {
      video.removeEventListener('seeked', done)
      video.removeEventListener('error', done)
      resolve()
    }
    video.addEventListener('seeked', done)
    video.addEventListener('error', done)
    video.currentTime = target
  })
}

/**
 * A two-pixel-wide strip is enough: `scene.background` is stretched over the
 * frame, so only the vertical profile matters. The strip therefore reads the
 * CSS gradient the same way the eye does — `0deg` runs upwards, `180deg`
 * downwards — by projecting the angle onto the vertical axis.
 */
function createGradientTexture(background: BackgroundSettings): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 2
  canvas.height = GRADIENT_STEPS
  const ctx = canvas.getContext('2d')

  if (ctx) {
    const radians = (background.angle * Math.PI) / 180
    const direction = Math.cos(radians) // +1 → the gradient points up
    // A shallow angle spreads the ramp far beyond the box, so the middle of the
    // strip is all you see of it; `reach` keeps that from running off the ends.
    const reach = Math.max(0.08, Math.min(1, Math.abs(direction)))
    const half = Math.min(1, 0.5 / reach)
    const near = Math.max(0, 0.5 - half)
    const far = Math.min(1, 0.5 + half)

    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height)
    // Canvas y grows downwards, so `near` is the top of the strip.
    const stops: Array<[number, string]> =
      direction > 0
        ? [
            [near, background.to],
            [far, background.from],
          ]
        : [
            [near, background.from],
            [far, background.to],
          ]
    for (const [position, color] of stops) gradient.addColorStop(position, color)
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  return texture
}

/**
 * Paint `background` behind the scene for the duration of one shot, then put the
 * previous backdrop back. Returns a restore function.
 */
export function withBackdrop(
  scene: THREE.Scene,
  background: BackgroundSettings,
): () => void {
  const previous = scene.background
  scene.background = createBackdrop(background)
  return () => {
    // Nothing is disposed: backdrops come from a cache and are reused.
    scene.background = previous
  }
}
