import { Maximize, Pause, Play, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useEditorStore } from '../../store/editorStore'
import { lastKeyframeTime } from '../../lib/keyframes'
import { ASPECT_RATIO } from '../../types'
import { Button, IconButton, Slider, Tip } from '../ui/kit'

/** The player's picture is resampled to this long edge, then CSS fits it. */
const LONG_EDGE = 1400

/**
 * The player: the piece, full frame, with a transport.
 *
 * There is no encoded file — the "video" is the WebGL frame itself. While this is
 * open, `ShotPreview` renders the shot across the whole canvas at the project's
 * aspect, and the canvas below copies that frame every tick. One renderer, one
 * scene, no second copy of anything.
 */
export function PreviewPlayer() {
  const open = useEditorStore((state) => state.ui.previewOpen)
  const aspect = useEditorStore((state) => state.project.aspect)
  const playing = useEditorStore((state) => state.timeline.playing)
  const currentTime = useEditorStore((state) => state.timeline.currentTime)
  const end = useEditorStore((state) =>
    lastKeyframeTime(state.objects, state.timeline.cameraKeyframes),
  )
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)

  /** Copy the live WebGL frame into the modal every tick. */
  useEffect(() => {
    if (!open) return
    let raf = 0
    const draw = () => {
      raf = requestAnimationFrame(draw)
      const target = canvasRef.current
      // `className` on <Canvas> lands on drei's wrapper, so reach for the canvas
      // the renderer actually draws into.
      const source =
        document.querySelector<HTMLCanvasElement>('.viewport__canvas canvas') ??
        document.querySelector<HTMLCanvasElement>('.viewport canvas')
      if (!target || !source) return
      const ctx = target.getContext('2d')
      if (!ctx) return
      const ratio = ASPECT_RATIO[aspect]
      // The shot pass letterboxes the frame inside the canvas with exactly this
      // math, so the band *is* the picture — no cropping, no stretching.
      const frameWidth = Math.min(source.width, source.height * ratio)
      const frameHeight = frameWidth / ratio
      const sx = Math.round((source.width - frameWidth) / 2)
      const sy = Math.round((source.height - frameHeight) / 2)
      const scale = Math.min(2, Math.max(1, LONG_EDGE / Math.max(frameWidth, frameHeight)))
      target.width = Math.round(frameWidth * scale)
      target.height = Math.round(frameHeight * scale)
      ctx.drawImage(source, sx, sy, frameWidth, frameHeight, 0, 0, target.width, target.height)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [open, aspect])

  /** Space toggles, Escape leaves — the shortcuts a player should have. */
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') useEditorStore.getState().setPreviewOpen(false)
      if (event.key === ' ') {
        event.preventDefault()
        const store = useEditorStore.getState()
        if (store.timeline.playing) store.pause()
        else store.play()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!open) return null

  const total = end > 0 ? end : 1
  const store = useEditorStore.getState

  return (
    <div className="player">
      <div className="player__backdrop" onClick={() => store().setPreviewOpen(false)} />
      <div
        className="player__stage"
        ref={stageRef}
        style={{
          aspectRatio: `${ASPECT_RATIO[aspect]}`,
          width: `min(100%, calc((100vh - 210px) * ${ASPECT_RATIO[aspect]}))`,
        }}
      >
        <canvas className="player__canvas" ref={canvasRef} />
      </div>
      <div className="player__bar">
        <IconButton
          label={playing ? '暂停' : '播放'}
          variant={playing ? 'default' : 'primary'}
          onClick={() => (playing ? store().pause() : store().play())}
        >
          {playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
        </IconButton>
        <span className="player__time">{currentTime.toFixed(2)}s</span>
        <Slider
          value={currentTime}
          min={0}
          max={total}
          step={0.01}
          onChange={(value) => store().seek(value)}
          ariaLabel="播放进度"
        />
        <span className="player__time">{end.toFixed(2)}s</span>
        <Tip label="全屏">
          <IconButton
            label="全屏"
            variant="ghost"
            onClick={() => {
              const stage = stageRef.current
              if (!stage) return
              if (document.fullscreenElement) void document.exitFullscreen()
              else void stage.requestFullscreen()
            }}
          >
            <Maximize size={15} />
          </IconButton>
        </Tip>
        <Button variant="ghost" icon={<X size={14} />} onClick={() => store().setPreviewOpen(false)}>
          退出
        </Button>
      </div>
    </div>
  )
}
