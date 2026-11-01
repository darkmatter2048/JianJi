const SEEK_TIMEOUT_MS = 5000
const END_EPSILON_SECONDS = 0.001

/** Keep source seeks inside the range where a decodable frame exists. */
export function clampVideoTime(time: number, duration: number): number {
  const safeTime = Number.isFinite(time) ? Math.max(0, time) : 0
  if (!Number.isFinite(duration) || duration <= 0) return safeTime
  return Math.min(safeTime, Math.max(0, duration - END_EPSILON_SECONDS))
}

/**
 * Seek without allowing a missing browser event to stall an export forever.
 * The caller may paint the current frame in `onSettled`; timeout is deliberately
 * a success path because one stale frame is preferable to losing a long export.
 */
export function seekVideoFrame(
  video: HTMLVideoElement,
  target: number,
  onSettled?: () => void,
  timeoutMs = SEEK_TIMEOUT_MS,
): { promise: Promise<void>; cancel: () => void } {
  let resolveSeek = () => {}
  const promise = new Promise<void>((resolve) => {
    resolveSeek = resolve
  })
  let settled = false
  const done = () => {
    if (settled) return
    settled = true
    window.clearTimeout(timer)
    video.removeEventListener('seeked', done)
    video.removeEventListener('error', done)
    try {
      onSettled?.()
    } finally {
      resolveSeek()
    }
  }
  const timer = window.setTimeout(done, timeoutMs)
  video.addEventListener('seeked', done)
  video.addEventListener('error', done)
  try {
    video.currentTime = target
    // Assigning the already-clamped end time can be a no-op in Chromium, which
    // means no seeked event will follow even though the requested frame is ready.
    if (!video.seeking && Math.abs(video.currentTime - target) < 1e-4) {
      queueMicrotask(done)
    }
  } catch {
    queueMicrotask(done)
  }
  return { promise, cancel: done }
}

