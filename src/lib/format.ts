/** Formatting helpers shared by the timeline and inspector. */

/** `3.25` → `00:03.25` */
export function formatTimecode(seconds: number, fps = 30): string {
  const safe = Math.max(0, seconds)
  const whole = Math.floor(safe)
  const mm = Math.floor(whole / 60)
  const ss = whole % 60
  const frames = Math.min(fps - 1, Math.round((safe - whole) * fps))
  return `${pad(mm)}:${pad(ss)}.${pad(frames)}`
}

export function formatSeconds(seconds: number): string {
  return `${seconds.toFixed(2)}s`
}

export function pad(value: number): string {
  return value.toString().padStart(2, '0')
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function round(value: number, decimals = 3): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

/** RGB hex → `[r, g, b]` in 0..1, for three.js. */
export function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace('#', '')
  const full =
    normalized.length === 3
      ? normalized
          .split('')
          .map((c) => c + c)
          .join('')
      : normalized
  const int = Number.parseInt(full, 16)
  if (Number.isNaN(int)) return [1, 1, 1]
  return [((int >> 16) & 255) / 255, ((int >> 8) & 255) / 255, (int & 255) / 255]
}

/** CSS background for the viewport stage (the canvas itself stays transparent). */
export function backgroundCss(background: {
  type: 'solid' | 'gradient' | 'transparent' | 'media'
  color: string
  from: string
  to: string
  angle: number
}): string {
  if (background.type === 'solid') return background.color
  if (background.type === 'gradient') {
    return `linear-gradient(${background.angle}deg, ${background.from}, ${background.to})`
  }
  // `media` is painted by a DOM layer behind the transparent canvas.
  return 'transparent'
}
