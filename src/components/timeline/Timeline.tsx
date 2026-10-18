import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  Brush,
  ClipboardPaste,
  Copy,
  Crosshair,
  Diamond,
  Eye,
  EyeOff,
  Film,
  Play,
  Redo2,
  Scissors,
  Trash2,
  Undo2,
  X,
  ZoomIn,
} from 'lucide-react'
import { clipDuration, lastKeyframeTime, meanSpeed } from '../../lib/keyframes'
import { useT } from '../../lib/i18n'
import { sliderToZoom, useEditorStore, zoomToSlider } from '../../store/editorStore'
import type { ObjectKeyframe, ScreenClip } from '../../types'
import { Divider, IconButton, Slider, Tip } from '../ui/kit'

/**
 * One shared progress bar, one row per object.
 *
 * The ruler and the playhead span the whole composition — that is the "global
 * progress bar" — while every object gets its own lane underneath, with its name
 * and colour on the left. Camera keyframes are not here: they live in 参数区 → 相机.
 */

/** Seconds of empty ruler kept past the last keyframe, so there is always room. */
const TAIL_SECONDS = 6
const MIN_SPAN_SECONDS = 16
const SNAP = 0.05

/** Layout constants, shared with the shell so the panel can size itself. */
/**
 * Row heights are the one number the two halves of the timeline must agree on:
 * the name column on the left and the lanes on the right are laid out
 * separately, so a mismatch walks the names out of step with their keyframes —
 * and a video's extra row makes it worse, because only some objects have one.
 * `styles/app.css` repeats these values with a comment pointing back here.
 */
export const ROW_HEIGHT = 26
export const CLIP_ROW_HEIGHT = 24
export const RULER_HEIGHT = 26
export const TRANSPORT_HEIGHT = 44
const CHROME_HEIGHT = 3

/** How tall the timeline wants to be for `rowCount` object rows. */
export function timelineHeightFor(rowCount: number, clipRowCount = 0): number {
  return (
    TRANSPORT_HEIGHT +
    RULER_HEIGHT +
    Math.max(1, rowCount) * ROW_HEIGHT +
    clipRowCount * CLIP_ROW_HEIGHT +
    CHROME_HEIGHT
  )
}

function snap(value: number): number {
  return Math.round(value / SNAP) * SNAP
}

/** Pick a ruler step that keeps labels at least ~64px apart. */
function rulerStep(zoom: number): number {
  const candidates = [0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60]
  return candidates.find((step) => step * zoom >= 64) ?? 120
}

function rulerLabel(seconds: number): string {
  if (seconds === 0) return '0s'
  if (seconds < 10) return `${Number(seconds.toFixed(2))}s`
  return `${Math.round(seconds)}s`
}

/* ----------------------------------------------------------------- ruler -- */

function Ruler({
  spanSeconds,
  zoom,
  contentSeconds,
  onScrub,
}: {
  spanSeconds: number
  zoom: number
  contentSeconds: number
  onScrub: (clientX: number) => void
}) {
  const step = rulerStep(zoom)
  const ticks: number[] = []
  for (let t = 0; t <= spanSeconds + 1e-6; t += step) ticks.push(Number(t.toFixed(3)))

  return (
    <div
      className="ruler"
      style={{ width: spanSeconds * zoom }}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        onScrub(event.clientX)
      }}
      onPointerMove={(event) => {
        if (event.buttons === 1) onScrub(event.clientX)
      }}
    >
      {/* How far the composition actually runs. */}
      <div className="ruler__content" style={{ width: contentSeconds * zoom }} />
      {ticks.map((tick) => (
        <span key={tick} className="ruler__tick" style={{ left: tick * zoom }}>
          {rulerLabel(tick)}
        </span>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------- keyframe --- */

function KeyframeMarker({
  time,
  zoom,
  color,
  label,
  selected,
  chained,
  hidden,
  onSelect,
  onMove,
  onContextMenu,
}: {
  time: number
  zoom: number
  color: string
  label: string
  selected: boolean
  /** Still ahead of us on the redraw chain — drawn white. */
  chained: boolean
  /** 隐藏 at this frame — drawn hollow, so a 消失 / 出现 pair is visible at a glance. */
  hidden: boolean
  onSelect: () => void
  onMove: (time: number) => void
  onContextMenu: (event: ReactMouseEvent<HTMLElement>) => void
}) {
  const beginDrag = (event: ReactPointerEvent<HTMLElement>) => {
    event.stopPropagation()
    event.preventDefault()
    onSelect()
    const startX = event.clientX
    const startTime = time

    const onPointerMove = (move: PointerEvent) => {
      onMove(Math.max(0, snap(startTime + (move.clientX - startX) / zoom)))
    }
    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
    }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
  }

  return (
    <button
      type="button"
      className={`keymark${selected ? ' keymark--selected' : ''}${
        chained ? ' keymark--chained' : ''
      }${hidden ? ' keymark--hidden' : ''}`}
      style={{ left: time * zoom, background: color }}
      onPointerDown={beginDrag}
      onContextMenu={onContextMenu}
      title={`${label} · 关键帧 ${time.toFixed(2)}s${
        chained ? ' · 重绘链上，切到下一帧会把这一帧的状态带过去' : ''
      }（右键：从此处重绘）`}
    />
  )
}

/* ------------------------------------------------------------ video clip -- */

/**
 * One video clip on an object's video row: drag the body to move it, drag either
 * edge to trim, right-click for 复制/粘贴/删除.
 */
function ClipBlock({
  clip,
  zoom,
  color,
  selected,
  onSelect,
  onMove,
  onTrim,
  onContextMenu,
}: {
  clip: ScreenClip
  zoom: number
  color: string
  selected: boolean
  onSelect: () => void
  onMove: (start: number) => void
  onTrim: (edge: 'start' | 'end', time: number) => void
  onContextMenu: (event: ReactMouseEvent<HTMLElement>) => void
}) {
  const duration = clipDuration(clip)
  const span = Math.max(0.1, clip.outPoint - clip.inPoint)

  const beginDrag = (event: ReactPointerEvent<HTMLElement>, mode: 'move' | 'start' | 'end') => {
    event.stopPropagation()
    event.preventDefault()
    onSelect()
    const startX = event.clientX
    const startTime = mode === 'end' ? clip.start + duration : clip.start
    let moved = false

    const onPointerMove = (move: PointerEvent) => {
      if (!moved && Math.abs(move.clientX - startX) < 2) return
      moved = true
      const time = Math.max(0, snap(startTime + (move.clientX - startX) / zoom))
      if (mode === 'move') onMove(time)
      else onTrim(mode, time)
    }
    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
    }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
  }

  return (
    <div
      className={`vclip${selected ? ' vclip--selected' : ''}`}
      style={{ left: clip.start * zoom, width: Math.max(6, duration * zoom), borderColor: color }}
      onPointerDown={(event) => beginDrag(event, 'move')}
      onContextMenu={onContextMenu}
      title={`${clip.name} · ${clip.inPoint.toFixed(2)}s–${clip.outPoint.toFixed(2)}s（源长 ${span.toFixed(2)}s）`}
    >
      <span className="vclip__label">{clip.name}</span>
      <span className="vclip__handle vclip__handle--start" onPointerDown={(event) => beginDrag(event, 'start')} />
      <span className="vclip__handle vclip__handle--end" onPointerDown={(event) => beginDrag(event, 'end')} />
    </div>
  )
}

/* --------------------------------------------------------- context menu -- */

/**
 * Right-click a keyframe. "从此处重绘" is scoped to that one object: its frames
 * from here on go on the chain, and stepping forward carries the pose along.
 */
function KeyframeMenu({
  menu,
  onClose,
  onRedraw,
}: {
  menu: { x: number; y: number; time: number; objectId: string; label: string }
  onClose: () => void
  onRedraw: () => void
}) {
  useEffect(() => {
    const close = () => onClose()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const object = useEditorStore((state) =>
    state.objects.find((entry) => entry.id === menu.objectId),
  )
  const laterCount = (object?.keyframes ?? []).filter(
    (frame) => frame.time > menu.time + 1e-3,
  ).length

  return (
    <div
      className="ctxmenu"
      style={{ left: menu.x, top: menu.y }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="ctxmenu__head">
        {menu.label} · {menu.time.toFixed(2)}s
      </div>
      <button
        type="button"
        className="ctxmenu__item"
        disabled={laterCount === 0}
        onClick={onRedraw}
        title="把这一帧的状态写进这个对象后面所有关键帧"
      >
        <Brush size={13} />
        从此处重绘
        <span className="ctxmenu__note">
          {laterCount === 0 ? '后面没有关键帧' : `这个对象的后续 ${laterCount} 帧跟随这一帧`}
        </span>
      </button>
      <button
        type="button"
        className="ctxmenu__item"
        onClick={() => {
          useEditorStore.getState().seek(menu.time)
          onClose()
        }}
      >
        <Crosshair size={13} />
        跳到这一帧
      </button>
    </div>
  )
}

/* -------------------------------------------------------------- timeline -- */

export function Timeline() {
  const t = useT()
  const objects = useEditorStore((state) => state.objects)
  const cameraKeyframes = useEditorStore((state) => state.timeline.cameraKeyframes)
  const zoom = useEditorStore((state) => state.timeline.zoom)
  const canUndo = useEditorStore((state) => state.past.length > 0)
  const canRedo = useEditorStore((state) => state.future.length > 0)
  /**
   * What the trash would remove: the selected video clip if there is one,
   * otherwise the selected keyframe — the same order the action itself uses.
   */
  const deletable = useEditorStore((state) => {
    if (state.timeline.selectedClipId) {
      const clip = state.objects.some((object) =>
        object.screenClips.some((entry) => entry.id === state.timeline.selectedClipId),
      )
      if (clip) return 'clip' as const
    }
    if (state.timeline.selectedKeyframeId) return 'keyframe' as const
    return null
  })

  /** Splitting means: a clip is selected, and the playhead is inside it. */
  const canSplit = useEditorStore((state) => {
    const id = state.timeline.selectedClipId
    if (!id) return false
    for (const object of state.objects) {
      const clip = object.screenClips.find((entry) => entry.id === id)
      if (!clip) continue
      const end = clip.start + clipDuration(clip)
      return (
        state.timeline.currentTime > clip.start + 0.05 &&
        state.timeline.currentTime < end - 0.05
      )
    }
    return false
  })
  const selectedKeyframeId = useEditorStore((state) => state.timeline.selectedKeyframeId)
  const selectedObjectId = useEditorStore((state) => state.selectedObjectId)
  const anchor = useEditorStore((state) => state.timeline.redrawAnchor)
  const selectedClipId = useEditorStore((state) => state.timeline.selectedClipId)
  const clipboard = useEditorStore((state) => state.clipboard)
  const scrollRef = useRef<HTMLDivElement>(null)
  const headsRef = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<{
    x: number
    y: number
    time: number
    objectId: string
    label: string
  } | null>(null)
  const [clipMenu, setClipMenu] = useState<{
    x: number
    y: number
    objectId: string
    clipId: string
  } | null>(null)
  const currentTime = useEditorStore((state) => state.timeline.currentTime)
  const clipUnderMenu = useEditorStore((state) => {
    if (!state.timeline.selectedClipId) return null
    for (const object of state.objects) {
      const found = object.screenClips.find(
        (clip) => clip.id === state.timeline.selectedClipId,
      )
      if (found) return found
    }
    return null
  })

  useEffect(() => {
    if (!clipMenu) return
    const close = () => setClipMenu(null)
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [clipMenu])

  const end = lastKeyframeTime(objects, cameraKeyframes)
  const spanSeconds = Math.max(end + TAIL_SECONDS, MIN_SPAN_SECONDS)
  const contentWidth = spanSeconds * zoom
  /**
   * Whiteness is the *remaining* chain, not the whole chain: once you walk past a
   * frame it goes back to its object colour, so white always means "still to come".
   */
  const anchorTime = (() => {
    if (!anchor) return Number.POSITIVE_INFINITY
    const object = objects.find((entry) => entry.id === anchor.objectId)
    const frame = object?.keyframes.find((entry) => entry.id === anchor.keyframeId)
    return frame ? frame.time : Number.POSITIVE_INFINITY
  })()

  const timeFromClientX = (clientX: number): number => {
    const element = scrollRef.current
    if (!element) return 0
    const rect = element.getBoundingClientRect()
    return Math.max(0, (clientX - rect.left + element.scrollLeft) / zoom)
  }

  const objectKeyCount = objects.reduce((total, object) => total + object.keyframes.length, 0)

  const markers = (objectId: string, color: string, label: string, frames: ObjectKeyframe[]) =>
    frames.map((frame) => (
      <KeyframeMarker
        key={frame.id}
        time={frame.time}
        zoom={zoom}
        color={color}
        label={label}
        selected={frame.id === selectedKeyframeId}
        hidden={frame.pose.hidden === true}
        chained={
          Boolean(anchor) &&
          anchor?.objectId === objectId &&
          frame.chained &&
          frame.time >= anchorTime - 1e-3
        }
        onSelect={() => useEditorStore.getState().selectKeyframe(frame.id)}
        onMove={(time) => {
          const store = useEditorStore.getState()
          store.moveObjectKeyframe(objectId, frame.id, time)
          // Keep the scene on the frame being dragged.
          store.seek(time)
        }}
        onContextMenu={(event) => {
          event.preventDefault()
          event.stopPropagation()
          useEditorStore.getState().selectKeyframe(frame.id)
          setMenu({ x: event.clientX, y: event.clientY, time: frame.time, objectId, label })
        }}
      />
    ))

  return (
    <div className="timeline">
      <div className="timeline__transport">
        <div className="timeline__transport-side">
          <Tip label={t('撤回上一步 · Ctrl+Z')}>
            <IconButton
              label={t('撤回')}
              variant="ghost"
              disabled={!canUndo}
              onClick={() => useEditorStore.getState().undo()}
            >
              <Undo2 size={15} />
            </IconButton>
          </Tip>
          <Tip label={t('重做下一步 · Ctrl+Y')}>
            <IconButton
              label={t('重做')}
              variant="ghost"
              disabled={!canRedo}
              onClick={() => useEditorStore.getState().redo()}
            >
              <Redo2 size={15} />
            </IconButton>
          </Tip>
          <Divider />
          <Tip
            label={
              canSplit
                ? t('在播放头剪开选中的视频 · X')
                : t('先选中一段视频，并把播放头移到它中间')
            }
          >
            <IconButton
              label={t('剪切')}
              variant="ghost"
              disabled={!canSplit}
              onClick={() => useEditorStore.getState().splitClipHere()}
            >
              <Scissors size={14} />
            </IconButton>
          </Tip>
          <Tip
            label={
              deletable === 'clip'
                ? t('删除选中的视频片段 · Del')
                : deletable === 'keyframe'
                  ? t('删除选中的关键帧 · Del')
                  : t('先选中一个关键帧或一段视频')
            }
          >
            <IconButton
              label={t('删除')}
              variant="ghost"
              disabled={deletable === null}
              onClick={() => useEditorStore.getState().deleteSelection()}
            >
              <Trash2 size={14} />
            </IconButton>
          </Tip>
        </div>

        <Tip label={t('播放效果视频')}>
          <button
            type="button"
            className="ui-play"
            aria-label={t('播放效果视频')}
            onClick={() => useEditorStore.getState().setPreviewOpen(true)}
          >
            <Play size={15} fill="currentColor" />
          </button>
        </Tip>

        <div className="timeline__transport-side timeline__transport-side--end">
          <label className="timeline__zoom">
            <ZoomIn size={13} style={{ color: 'var(--text-2)' }} />
            <Slider
              // Logarithmic, so 8 px/s and 160 px/s are both comfortable to hit.
              value={zoomToSlider(zoom)}
              min={0}
              max={1}
              // 1% of the log range per step: ~4% zoom per arrow press at any scale.
              step={0.01}
              onChange={(value) => useEditorStore.getState().setZoom(sliderToZoom(value))}
              ariaLabel="时间轴缩放"
            />
          </label>
        </div>
      </div>

      <div className="timeline__main">
        <div className="timeline__heads" ref={headsRef}>
          <div className="timeline__heads-spacer">{t('时间轴')}</div>
          {objects.map((object) => (
            // One block per object, in the same order and with the same heights as
            // the lanes beside it — that is what keeps names and clips in step. The
            // video row lives *inside* the block, next to the object it belongs to.
            <div className="timeline__head-block" key={object.id}>
              <div
                className={`timeline__track-head${
                  object.id === selectedObjectId ? ' is-selected' : ''
                }`}
              >
                <Tip label={object.visible ? '隐藏这个对象' : '显示这个对象'}>
                  <button
                    type="button"
                    className={`mini-toggle${object.visible ? '' : ' mini-toggle--off'}`}
                    aria-label={object.visible ? '隐藏这个对象' : '显示这个对象'}
                    onClick={() => useEditorStore.getState().setObjectVisible(object.id, !object.visible)}
                  >
                    {object.visible ? <Eye size={12} /> : <EyeOff size={12} />}
                  </button>
                </Tip>
                <button
                  type="button"
                  className="timeline__track-name as-button"
                  title={object.name}
                  onClick={() => useEditorStore.getState().selectObject(object.id)}
                >
                  {object.name}
                </button>
                {/* The colour marker sits *after* the name, matching its keyframes. */}
                <span className="timeline__track-color" style={{ background: object.color }} />
                <Tip label="在播放头打关键帧">
                  <button
                    type="button"
                    className="mini-toggle"
                    aria-label="在播放头打关键帧"
                    onClick={() => useEditorStore.getState().keyframeObject(object.id)}
                  >
                    <Diamond size={12} />
                  </button>
                </Tip>
                <Tip label={t('删除对象')}>
                  <button
                    type="button"
                    className="mini-toggle"
                    aria-label={t('删除对象')}
                    onClick={() => useEditorStore.getState().removeObject(object.id)}
                  >
                    <X size={12} />
                  </button>
                </Tip>
              </div>

              {object.screenClips.length > 0 ? (
                <div className="timeline__clip-head">
                  <Film size={11} />
                  <span className="timeline__clip-name">
                    {object.screenClips.length > 1
                      ? `${object.screenClips.length} 段`
                      : object.screenClips[0].name}
                  </span>
                </div>
              ) : null}
            </div>
          ))}
        </div>

        <div
          className="timeline__scroll"
          ref={scrollRef}
          onScroll={(event) => {
            // With more rows than fit, the names must ride along with the lanes.
            if (headsRef.current) {
              headsRef.current.scrollTop = event.currentTarget.scrollTop
            }
          }}
        >
          <div className="timeline__content" style={{ width: contentWidth }}>
            <Ruler
              spanSeconds={spanSeconds}
              zoom={zoom}
              contentSeconds={end}
              onScrub={(clientX) => useEditorStore.getState().seek(timeFromClientX(clientX))}
            />

            {objects.map((object) => (
              <div key={object.id}>
                <div className="track-lane" style={{ backgroundSize: `${zoom}px 100%` }}>
                  {markers(object.id, object.color, object.name, object.keyframes)}
                </div>
                {object.screenClips.length > 0 ? (
                  <div className="track-lane track-lane--clips">
                    {object.screenClips.map((clip) => (
                      <ClipBlock
                        key={clip.id}
                        clip={clip}
                        zoom={zoom}
                        color={object.color}
                        selected={clip.id === selectedClipId}
                        onSelect={() => useEditorStore.getState().selectScreenClip(clip.id)}
                        onMove={(start) =>
                          useEditorStore.getState().moveScreenClip(object.id, clip.id, start)
                        }
                        onTrim={(edge, time) =>
                          useEditorStore.getState().trimScreenClip(object.id, clip.id, edge, time)
                        }
                        onContextMenu={(event) => {
                          event.preventDefault()
                          event.stopPropagation()
                          useEditorStore.getState().selectScreenClip(clip.id)
                          setClipMenu({
                            x: event.clientX,
                            y: event.clientY,
                            objectId: object.id,
                            clipId: clip.id,
                          })
                        }}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            ))}

            <Playhead zoom={zoom} />
          </div>
        </div>

        {clipMenu ? (
          <div
            className="ctxmenu"
            style={{ left: clipMenu.x, top: clipMenu.y }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="ctxmenu__head">
              <Film size={11} /> 视频片段
            </div>
            <button
              type="button"
              className="ctxmenu__item"
              disabled={
                !clipUnderMenu ||
                currentTime <= clipUnderMenu.start + 0.05 ||
                currentTime >=
                  clipUnderMenu.start +
                    (clipUnderMenu.outPoint - clipUnderMenu.inPoint) /
                      meanSpeed(clipUnderMenu.speed) -
                    0.05
              }
              onClick={() => {
                useEditorStore
                  .getState()
                  .splitScreenClip(clipMenu.objectId, clipMenu.clipId, currentTime)
                setClipMenu(null)
              }}
              title="把播放头处的这一帧当作剪口，切成两段"
            >
              <Scissors size={13} />
              从此处剪开
              <span className="ctxmenu__note">
                {clipUnderMenu ? 'X · 每段各自变速' : '先选中片段'}
              </span>
            </button>
            <button
              type="button"
              className="ctxmenu__item"
              onClick={() => {
                useEditorStore
                  .getState()
                  .copyScreenClip(clipMenu.objectId, clipMenu.clipId)
                setClipMenu(null)
              }}
            >
              <Copy size={13} />
              复制
              <span className="ctxmenu__note">⌘/Ctrl + C</span>
            </button>
            <button
              type="button"
              className="ctxmenu__item"
              disabled={!clipboard}
              onClick={() => {
                useEditorStore.getState().pasteScreenClip(clipMenu.objectId)
                setClipMenu(null)
              }}
            >
              <ClipboardPaste size={13} />
              粘贴到播放头
              <span className="ctxmenu__note">
                {clipboard ? '⌘/Ctrl + V' : '剪贴板是空的'}
              </span>
            </button>
            <button
              type="button"
              className="ctxmenu__item"
              onClick={() => {
                useEditorStore.getState().removeScreenClip(clipMenu.objectId, clipMenu.clipId)
                setClipMenu(null)
              }}
            >
              <Trash2 size={13} />
              删除
            </button>
          </div>
        ) : null}

        {clipMenu ? (
          <div className="ctxmenu__shade" onPointerDown={() => setClipMenu(null)} />
        ) : null}

        {menu ? (
          <KeyframeMenu
            menu={menu}
            onClose={() => setMenu(null)}
            onRedraw={() => {
              useEditorStore.getState().redrawFrom(menu.objectId, menu.time)
              setMenu(null)
            }}
          />
        ) : null}

        {objectKeyCount <= 1 ? (
          <div className="timeline__hint">
            {objectKeyCount === 0 ? (
              <>
                {t('还没有任何关键帧。选中一个对象，把播放头移到位置，按')} <b>D</b> {t('打一帧。')}
                <br />
                {t('摄像机的关键帧不在这里 —— 在参数区「相机」栏里打。')}
              </>
            ) : (
              <>
                {t('只有起始帧，所以视频时长为')}
                <b>0</b>
                {t('。把播放头移到后面、动一下对象或机位，再按')} <b>D</b> {t('打第二帧，片子就有长度了。')}
              </>
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}

/**
 * Its own component so a playing timeline only re-renders this 1px line.
 *
 * The line itself is `pointer-events: none` — it crosses every lane and must not
 * swallow clicks meant for a keyframe — but the head is a real grab handle: a
 * keyframe sits at exactly the same x right after you key one, so scrubbing from
 * the head has to work or the only thing you can grab there is the keyframe.
 */
function Playhead({ zoom }: { zoom: number }) {
  const currentTime = useEditorStore((state) => state.timeline.currentTime)

  const beginScrub = (event: ReactPointerEvent<HTMLElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const scroller = event.currentTarget.closest('.timeline__scroll') as HTMLElement | null
    if (!scroller) return
    const rect = scroller.getBoundingClientRect()
    const toTime = (clientX: number) =>
      Math.max(0, (clientX - rect.left + scroller.scrollLeft) / zoom)

    useEditorStore.getState().seek(toTime(event.clientX))
    document.body.style.cursor = 'ew-resize'

    const onMove = (move: PointerEvent) => useEditorStore.getState().seek(toTime(move.clientX))
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      document.body.style.cursor = 'auto'
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  return (
    <div className="playhead" style={{ left: currentTime * zoom }}>
      <div className="playhead__head" onPointerDown={beginScrub} title="拖动播放头" />
    </div>
  )
}
