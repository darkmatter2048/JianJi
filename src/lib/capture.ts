/**
 * Frame grabbing for the「导出当前帧」button.
 *
 * The export is the *shot* camera's frame — not the editing viewport's — and it
 * is captured with a transparent background so the PNG drops straight into a
 * compositor. The render pass (`ShotPreview`) draws that clean frame and then
 * hands the canvas back here.
 */

let capturePending = false
/** `png` hands back a data URL, `frame` hands back the cropped canvas itself. */
let captureMode: 'png' | 'frame' = 'png'
/** The height the shot should be rendered at; `null` means "whatever the window is". */
let captureHeight: number | null = null
let resolveCapture: ((value: string | null) => void) | null = null
let resolveFrame: ((value: HTMLCanvasElement | null) => void) | null = null

export function isShotCapturePending(): boolean {
  return capturePending
}

/**
 * The height the pending shot should be rendered at.
 *
 * The shot used to inherit the viewport's size, so exporting from a small window
 * produced a small film. The render pass now resizes itself for that one frame.
 */
export function shotCaptureHeight(): number | null {
  return captureHeight
}

/** Crop the canvas to `rect` (device pixels, GL orientation) into a fresh canvas. */
function cropToCanvas(
  canvas: HTMLCanvasElement,
  rect?: { x: number; y: number; width: number; height: number },
): HTMLCanvasElement {
  if (!rect) return canvas
  const out = document.createElement('canvas')
  out.width = Math.max(1, Math.round(rect.width))
  out.height = Math.max(1, Math.round(rect.height))
  const ctx = out.getContext('2d')
  if (!ctx) return canvas
  // GL's origin is bottom-left; canvas 2D's is top-left.
  const top = canvas.height - rect.y - rect.height
  ctx.drawImage(canvas, rect.x, top, rect.width, rect.height, 0, 0, out.width, out.height)
  return out
}

/**
 * Called by the render pass right after it drew a clean, overlay-free frame.
 *
 * `rect` (in device pixels, GL orientation) crops the grab to the project's
 * aspect, so the exported picture is the frame the piece was composed for rather
 * than whatever shape the editor window happened to be.
 */
export function finishShotCapture(
  canvas: HTMLCanvasElement | null,
  rect?: { x: number; y: number; width: number; height: number },
): void {
  if (!capturePending) return
  capturePending = false
  captureHeight = null
  const resolveFrameNow = resolveFrame
  const resolve = resolveCapture
  resolveCapture = null
  resolveFrame = null

  if (captureMode === 'frame') {
    try {
      resolveFrameNow?.(canvas ? cropToCanvas(canvas, rect) : null)
    } catch {
      resolveFrameNow?.(null)
    }
    return
  }

  try {
    if (!canvas) {
      resolve?.(null)
      return
    }
    if (!rect) {
      resolve?.(canvas.toDataURL('image/png'))
      return
    }
    resolve?.(cropToCanvas(canvas, rect).toDataURL('image/png'))
  } catch {
    resolve?.(null)
  }
}

/** Ask the render pass for one clean shot frame. Resolves with an image bitmap. */
export function requestShotCapture(): Promise<string | null> {
  capturePending = true
  captureMode = 'png'
  captureHeight = null
  return new Promise((resolve) => {
    resolveCapture = resolve
  })
}

/**
 * The same clean shot frame, but as a canvas instead of a PNG.
 *
 * Video export runs this hundreds of times; encoding a PNG per frame and decoding
 * it again would be a needless round trip, so the raw pixels come straight back.
 */
export function requestShotFrame(height?: number): Promise<HTMLCanvasElement | null> {
  capturePending = true
  captureMode = 'frame'
  captureHeight = height ?? null
  return new Promise((resolve) => {
    resolveFrame = resolve
  })
}

export function downloadDataUrl(dataUrl: string, filename: string): void {
  const link = document.createElement('a')
  link.href = dataUrl
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
}
