/**
 * Built-in screen sources, drawn on a canvas at import time.
 *
 * They exist so the display feature is testable without hunting for a file,
 * and so a scene opened on another machine still has something to show.
 */

export interface ScreenPreset {
  id: string
  name: string
  source: 'image' | 'video'
  /** Data URL produced by `drawPreset`. */
  src: string
  aspect: number
}

const PANEL_W = 1024
const PANEL_H = 642

function makeCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = PANEL_W
  canvas.height = PANEL_H
  return canvas
}

function toDataUrl(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL('image/png')
}

function drawTestCard(): string {
  const canvas = makeCanvas()
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  const bars = ['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0']
  const barWidth = PANEL_W / bars.length
  bars.forEach((color, index) => {
    ctx.fillStyle = color
    ctx.fillRect(index * barWidth, 0, barWidth + 1, PANEL_H * 0.72)
  })
  ctx.fillStyle = '#101418'
  ctx.fillRect(0, PANEL_H * 0.72, PANEL_W, PANEL_H * 0.28)
  ctx.fillStyle = '#f2f5fa'
  ctx.font = '600 54px system-ui, sans-serif'
  ctx.fillText('UAE2 STUDIO', 48, PANEL_H * 0.72 + 84)
  ctx.font = '400 30px system-ui, sans-serif'
  ctx.fillStyle = '#8ea4c8'
  ctx.fillText('屏幕贴图测试卡 · 16:10 · 1024 × 642', 48, PANEL_H * 0.72 + 132)
  return toDataUrl(canvas)
}

function drawGradient(): string {
  const canvas = makeCanvas()
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  const gradient = ctx.createLinearGradient(0, 0, PANEL_W, PANEL_H)
  gradient.addColorStop(0, '#1b2a5e')
  gradient.addColorStop(0.45, '#7c5cff')
  gradient.addColorStop(1, '#ff8a5c')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, PANEL_W, PANEL_H)
  ctx.globalAlpha = 0.22
  ctx.fillStyle = '#ffffff'
  for (let i = 0; i < 5; i += 1) {
    ctx.beginPath()
    ctx.arc(PANEL_W * (0.18 + i * 0.16), PANEL_H * (0.3 + (i % 2) * 0.35), 120 - i * 12, 0, Math.PI * 2)
    ctx.fill()
  }
  return toDataUrl(canvas)
}

function drawGrid(): string {
  const canvas = makeCanvas()
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  ctx.fillStyle = '#0b0f16'
  ctx.fillRect(0, 0, PANEL_W, PANEL_H)
  ctx.strokeStyle = '#213049'
  ctx.lineWidth = 2
  for (let x = 0; x <= PANEL_W; x += 64) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, PANEL_H)
    ctx.stroke()
  }
  for (let y = 0; y <= PANEL_H; y += 64) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(PANEL_W, y)
    ctx.stroke()
  }
  ctx.strokeStyle = '#4c8dff'
  ctx.lineWidth = 6
  ctx.strokeRect(3, 3, PANEL_W - 6, PANEL_H - 6)
  ctx.fillStyle = '#4c8dff'
  ctx.font = '600 40px ui-monospace, monospace'
  ctx.fillText('1024 × 642', 48, 96)
  ctx.fillStyle = '#98a3b8'
  ctx.font = '400 26px ui-monospace, monospace'
  ctx.fillText('安全区 / 网格', 48, 140)
  return toDataUrl(canvas)
}

let cache: ScreenPreset[] | null = null

/** Lazily drawn so the canvases are never created on a non-editor import. */
export function screenPresets(): ScreenPreset[] {
  if (cache) return cache
  cache = [
    { id: 'test-card', name: '测试卡', source: 'image', src: drawTestCard(), aspect: PANEL_W / PANEL_H },
    { id: 'gradient', name: '渐变', source: 'image', src: drawGradient(), aspect: PANEL_W / PANEL_H },
    { id: 'grid', name: '网格', source: 'image', src: drawGrid(), aspect: PANEL_W / PANEL_H },
  ]
  return cache
}
