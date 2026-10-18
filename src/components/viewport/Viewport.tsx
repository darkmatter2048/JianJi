import { useProgress } from '@react-three/drei'
import { Focus, Grid2x2, Undo2, Video } from 'lucide-react'
import { Canvas } from '@react-three/fiber'
import { Suspense, useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { resolveCameraAt } from '../../lib/animation'
import { resolveSceneFrame, resolveSceneState } from '../../lib/keyframes'
import { backdropVideoTime } from '../../lib/backdrop'
import { useT } from '../../lib/i18n'
import { backgroundCss, clamp } from '../../lib/format'
import { cameraHint } from '../../lib/hudBridge'
import { DEFAULT_VIEW } from '../../lib/presets'
import { useEditorStore } from '../../store/editorStore'
import type { BackgroundSettings, Vec3 } from '../../types'
import { IconButton, Tip } from '../ui/kit'
import { SceneRoot } from './SceneRoot'
import { ShotPreview } from './ShotPreview'

/**
 * A thin frame around the editing viewport while looking through the shot
 * camera, so it is obvious the picture is the shot and not the free view.
 */
function ShotFrame({ mode }: { mode: 'free' | 'scene' }) {
  if (mode !== 'scene') return null
  return <div className="viewport__shot-frame" aria-hidden />
}

/** A veil over the stage while the model loads, so the first frames are not a flash. */
function LoadingVeil() {
  const { active, progress } = useProgress()
  if (!active) return null
  return (
    <div className="viewport__loading">
      正在载入模型 {Math.round(progress)}%
    </div>
  )
}

/**
 * Custom background media, drawn as a DOM layer *behind* the transparent
 * canvas.
 *
 * A video background has to keep playing while the WebGL tree stays still, and
 * the browser already has a decoder wired to an element — pushing it through a
 * texture would cost a copy per frame for no gain.
 */
function BackdropLayer({ background }: { background: BackgroundSettings }) {
  const videoRef = useRef<HTMLVideoElement>(null)

  /**
   * A backdrop video belongs to the film, so its clock is the playhead, not its
   * own: it starts at the top of the piece and loops. Live playback only corrects
   * a real drift — seeking every frame would stutter the decoder — while export
   * seeks it exactly (`seekBackdropVideo`).
   */
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const sync = () => {
      const state = useEditorStore.getState()
      if (state.ui.previewOpen) return
      const duration = video.duration
      if (!(duration > 0)) return
      const target = backdropVideoTime(state.timeline.currentTime, duration)
      if (state.timeline.playing) {
        if (video.paused) void video.play().catch(() => undefined)
        if (Math.abs(video.currentTime - target) > 0.25) video.currentTime = target
      } else {
        if (!video.paused) video.pause()
        if (Math.abs(video.currentTime - target) > 0.02) video.currentTime = target
      }
    }
    // A freshly mounted element has no `duration` yet, and no store change is
    // guaranteed to arrive afterwards — so the metadata is a sync trigger too.
    const onMeta = () => sync()
    video.addEventListener('loadedmetadata', onMeta)
    video.addEventListener('durationchange', onMeta)
    sync()
    const unsubscribe = useEditorStore.subscribe(sync)
    return () => {
      video.removeEventListener('loadedmetadata', onMeta)
      video.removeEventListener('durationchange', onMeta)
      unsubscribe()
    }
  }, [background.src])

  if (background.type !== 'media' || !background.src) return null
  const style = {
    objectFit: background.fit,
    filter: background.blur > 0 ? `blur(${background.blur}px)` : undefined,
    transform: background.blur > 0 ? 'scale(1.06)' : undefined,
  } as const

  return (
    <div className="viewport__backdrop">
      {background.source === 'video' ? (
        <video ref={videoRef} src={background.src} loop muted playsInline style={style} />
      ) : (
        <img src={background.src} alt="" style={style} />
      )}
      <div className="viewport__backdrop-overlay" style={{ opacity: background.overlay }} />
    </div>
  )
}

export function Viewport() {
  const t = useT()
  /**
   * The background is painted by a DOM layer behind the transparent canvas (a
   * video backdrop has to keep playing while the WebGL tree stands still). Its
   * colour now *blends* between keyframes, so it is written straight onto the
   * element whenever the store changes — which, while playing, is every frame —
   * instead of going through a re-render.
   */
  const stageRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const paint = () => {
      const stage = stageRef.current
      if (!stage) return
      const state = useEditorStore.getState()
      const background = resolveSceneState(
        state.objects,
        state.timeline.currentTime,
        state.scene,
      ).background
      const transparent = background.type === 'transparent'
      stage.classList.toggle('viewport__stage--checker', transparent)
      stage.style.background = transparent ? '' : backgroundCss(background)
    }
    paint()
    return useEditorStore.subscribe(paint)
  }, [])
  /** A *stable* background for the media layer: it steps, so React is happy. */
  const mediaBackground = useEditorStore(
    (state) =>
      resolveSceneFrame(state.objects, state.timeline.currentTime, state.scene).background,
  )
  const showGrid = useEditorStore((state) => state.ui.showGrid)
  const mode = useEditorStore((state) => state.ui.viewportCamera)
  const hasSelection = useEditorStore((state) => state.selectedObjectId !== null)
  const playing = useEditorStore((state) => state.timeline.playing)
  const toggleGrid = useEditorStore((state) => state.toggleGrid)
  const selectObject = useEditorStore((state) => state.selectObject)
  const currentTime = useEditorStore((state) => state.timeline.currentTime)
  // The HUD reads the *shot* camera — the one the preview window shows — not the
  // stored framing, which is only the rest pose once the camera is keyed.
  // Memoised over stable references on purpose: a selector returning a fresh
  // object would loop the store subscription.
  const storedCamera = useEditorStore((state) => state.camera)
  const shotCameraKeys = useEditorStore((state) => state.timeline.cameraKeyframes)
  const shot = useMemo(
    () => resolveCameraAt(storedCamera, shotCameraKeys, currentTime),
    [storedCamera, shotCameraKeys, currentTime],
  )
  const view = useEditorStore((state) => state.view)


  /**
   * The wheel belongs to whatever is selected: a device scales under it, and
   * with nothing selected it dollies the view. `Shift` always keeps the camera.
   */
  const onWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    const store = useEditorStore.getState()
    const selected = store.objects.find((object) => object.id === store.selectedObjectId)
    if (selected && !event.shiftKey) {
      const factor = event.deltaY > 0 ? 1 / 1.05 : 1.05
      const scale = selected.transform.scale.map((value) =>
        clamp(value * factor, 0.05, 12),
      ) as Vec3
      store.setObjectTransform(selected.id, { scale })
      return
    }
    const factor = event.deltaY > 0 ? 1.06 : 1 / 1.06
    if (mode === 'scene') {
      // Looking through the shot: the wheel frames the shot.
      store.updateCamera({ distance: clamp(shot.distance * factor, 1.2, 18) })
    } else {
      store.updateViewCamera({ distance: clamp(view.distance * factor, 1.2, 18) })
    }
  }


  return (
    <div className="viewport">
      <div
        className="viewport__stage"
        ref={stageRef}
        onWheel={onWheel}
      >
        <BackdropLayer background={mediaBackground} />

        <Canvas
          className="viewport__canvas"
          shadows
          dpr={[1, 2]}
          gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}
          camera={{ position: [3.4, 2.2, 4.4], fov: 30, near: 0.05, far: 200 }}
          onCreated={(state) => {
            state.gl.toneMapping = THREE.ACESFilmicToneMapping
            if (import.meta.env.DEV) {
              // `get()` reaches the *live* root state, including the default
              // controls instance — useful when driving the viewport from a
              // test.
              ;(window as unknown as Record<string, unknown>).__UAE2_VIEW__ = {
                gl: state.gl,
                camera: state.camera,
                scene: state.scene,
                get: state.get,
              }
            }
          }}
          onPointerMissed={() => selectObject(null)}
        >
          <Suspense fallback={null}>
            <SceneRoot />
          </Suspense>
          <ShotPreview />
        </Canvas>

        <ShotFrame mode={mode} />

        {/*
          One chip, two jobs. In the free view it rides the screen edge pointing
          at the shot camera; looking through the camera it parks at a fixed spot
          and becomes the way back out. It lives in both modes on purpose — while
          it only existed in the free view, clicking it once was a one-way trip.
        */}
        <button
          type="button"
          className="viewport__camera-hint"
          data-mode={mode}
          ref={(element) => {
            cameraHint.el = element
          }}
          onClick={() =>
            useEditorStore.getState().setViewportCamera(mode === 'scene' ? 'free' : 'scene')
          }
          title={mode === 'scene' ? t('回到自由视角') : t('切到摄像机视角')}
        >
          <span className="viewport__camera-hint-arrow">
            {mode === 'scene' ? <Undo2 size={11} /> : <Video size={11} />}
          </span>
          <span className="viewport__camera-hint-label">
            {mode === 'scene' ? t('退出摄像机视角') : t('摄像机')}
          </span>
        </button>

        <div className="viewport__toolbar">
          <Tip label={t('网格 · G')}>
            <IconButton label={t('网格')} variant="ghost" active={showGrid} onClick={toggleGrid}>
              <Grid2x2 size={15} />
            </IconButton>
          </Tip>
          <Tip label={t('复位到三视图机位')}>
            <IconButton
              label={t('复位视角')}
              variant="ghost"
              onClick={() => useEditorStore.getState().updateViewCamera({ ...DEFAULT_VIEW })}
            >
              <Focus size={15} />
            </IconButton>
          </Tip>
        </div>

        <div className="viewport__caption">
          {playing
              ? t('预览播放中：不能标记对象 —— 暂停后才能拖动 / 打帧 / 换贴图')
              : hasSelection
                ? t('已选中：拖动移动 · 拖圆环旋转 · 滚轮缩放 · 有动画时编辑会自动打在当前帧')
                : t('未选中：拖动旋转 · 滚轮缩放视角 · 点击设备选中')}
          {' · '}
          {mode === 'scene'
            ? t('摄像机视角：拖动即回到自由视角并继续旋转 · 滚轮推拉镜头')
            : t('Shift+滚轮 缩放视角')}
        </div>
        <LoadingVeil />
      </div>
    </div>
  )
}
