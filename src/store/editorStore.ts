import { create } from 'zustand'
import { DEFAULT_ASSET_ID, findHinge, findScreen } from '../lib/assets'
import { DEFAULT_FONT_ID } from '../lib/fonts'
import { clamp } from '../lib/format'
import { probeMediaFile } from '../lib/media'
import { onGesture } from '../lib/gesture'
import { applyParsedProject, parseProjectText, toProjectText } from '../lib/projectText'
import { uid } from '../lib/ids'
import {
  CAMERA_PRESETS,
  DEFAULT_CAMERA,
  DEFAULT_VIEW,
  FRAMING_PRESETS,
  MATERIAL_PRESETS,
  nextObjectColor,
} from '../lib/presets'
import { evaluateFrame, resolveCamera, timelineEnd } from '../lib/animation'
import {
  KEYFRAME_EPSILON,
  createCameraKeyframe,
  createObjectKeyframe,
  findKeyframeAt,
  moveKeyframe,
  putCameraKeyframe,
  putObjectKeyframe,
  meanSpeed,
  relayoutFrom,
  removeKeyframe,
  segmentProgress,
  resyncSpans,
  resolveSceneState,
  resolveScreenState,
  sampleObjectPose,
} from '../lib/keyframes'
import {
  applySpeedPreset,
  createSpeedCurve,
  resampleSpeedCurve,
  sliceSpeedCurve,
} from '../lib/speedCurve'
import type {
  CameraSettings,
  DeviceTab,
  EditorSnapshot,
  FontAsset,
  HideMode,
  InspectorTab,
  LeftNav,
  LidSettings,
  MaterialSettings,
  MediaAsset,
  ProjectAspect,
  MediaKind,
  SceneObject,
  ObjectKeyframe,
  ObjectPose,
  SceneSettings,
  ScreenClip,
  ScreenSettings,
  SpeedCurve,
  TextSettings,
  TimelineState,
  Transform,
  Vec3,
  ViewportCamera,
} from '../types'

export const DEFAULT_FPS = 30

/** Fallback length for a clip whose source duration we do not know. */
export const DEFAULT_CLIP_SECONDS = 6
/**
 * Pixels per second on the timeline. The floor is deliberately low: a two-minute
 * piece fits across the lane, which is what you want when hunting for a moment
 * rather than nudging one.
 */
export const MIN_ZOOM = 8
export const MAX_ZOOM = 600

/** Pixels per second the timeline opens at — a second has to be readable. */
export const DEFAULT_ZOOM = 160

/**
 * The zoom slider is *logarithmic*. 8…600 is a 75× range, so a linear track
 * would cram everything above 100 px/s into its last few pixels — the exact
 * places you want to adjust. These two map slider 0…1 ⇄ px/s.
 */
export const zoomToSlider = (zoom: number): number =>
  Math.log(clamp(zoom, MIN_ZOOM, MAX_ZOOM) / MIN_ZOOM) / Math.log(MAX_ZOOM / MIN_ZOOM)

export const sliderToZoom = (value: number): number =>
  // Two decimals, not integers: rounding to whole px/s swallows the small steps
  // at the bottom of the range (8 → 8.35 → 8), so the arrow keys would do nothing.
  Number((MIN_ZOOM * (MAX_ZOOM / MIN_ZOOM) ** clamp(value, 0, 1)).toFixed(2))

/* --------------------------------------------------------------- defaults */

function defaultMaterial(): MaterialSettings {
  const preset = MATERIAL_PRESETS[0]
  return { enabled: false, presetId: preset.id, ...preset.settings }
}

/** Lid state for an asset that declares a hinge; `null` for everything else. */
function defaultLid(assetId: string): LidSettings | null {
  const hinge = findHinge(assetId)
  if (!hinge) return null
  // Born at the "open" snap, so a freshly added laptop already looks like a
  // laptop rather than a closed slab. The empty-project device overrides this
  // with its own keyframe.
  return { openDeg: hinge.fullDeg, maxDeg: hinge.maxDeg, fullDeg: hinge.fullDeg }
}

/**
 * Does this object still show a *video* anywhere — at any keyframe, or in its
 * resting screen? A video row only means something while the answer is yes, so
 * this is what decides whether the clips survive a texture change.
 */
function showsVideo(object: SceneObject): boolean {
  const isVideo = (screen: ScreenSettings | null | undefined) =>
    Boolean(screen && screen.source === 'video' && screen.src)
  if (isVideo(object.screen)) return true
  return object.keyframes.some((frame) => isVideo(frame.pose.screen))
}

/**
 * Drop the video row when nothing on this screen plays video any more: switching
 * a texture from video to image (or clearing it) has to take its clips with it,
 * or the timeline keeps a lane for a video that is no longer there.
 */
function pruneScreenClips(object: SceneObject): SceneObject {
  if (object.screenClips.length === 0 || showsVideo(object)) return object
  return { ...object, screenClips: [] }
}

/** Screen settings for something that is nothing *but* a screen. */
function defaultMediaScreenSettings(): ScreenSettings {
  return {
    enabled: false,
    source: 'image',
    src: null,
    mediaId: null,
    fileName: null,
    duration: 0,
    sourceAspect: 16 / 9,
    fit: 'cover',
    brightness: 1,
    rotation: 0,
    loop: true,
    muted: true,
    rate: 1,
  }
}

/** Screen state for an asset that declares a display; `null` for everything else. */
function defaultScreenSettings(assetId: string): ScreenSettings | null {
  if (!findScreen(assetId)) return null
  return defaultMediaScreenSettings()
}

function defaultText(): TextSettings {
  return {
    content: 'UAE2 Studio',
    fontId: DEFAULT_FONT_ID,
    size: 0.3,
    color: '#ffffff',
    opacity: 1,
    letterSpacing: 0,
    lineHeight: 1.25,
    align: 'center',
    maxWidth: 0,
    billboard: false,
  }
}

/**
 * Object URLs belong to whoever created them.
 *
 * A screen fed from the media library does *not* own its URL — the library
 * revokes it when the asset is deleted — so only self-made `blob:` URLs are
 * handed back here.
 */
function releaseScreenSource(screen: ScreenSettings | null | undefined): void {
  if (screen?.mediaId) return
  if (screen?.src?.startsWith('blob:')) URL.revokeObjectURL(screen.src)
}

/** Browser-side file → store patch, shared by the drop zone and the file picker. */
export function screenPatchFromFile(
  file: File,
  duration = 0,
): Partial<ScreenSettings> {
  return {
    source: file.type.startsWith('video/') ? 'video' : 'image',
    src: URL.createObjectURL(file),
    mediaId: null,
    fileName: file.name,
    // Without this the clip would fall back to a guessed length and the video
    // would not fit on the timeline.
    duration,
    sourceAspect: 16 / 9,
    enabled: true,
  }
}

/** Media library entry → store patch for anything that can play media. */
export function screenPatchFromMedia(asset: MediaAsset): Partial<ScreenSettings> {
  return {
    source: asset.kind === 'video' ? 'video' : 'image',
    src: asset.src,
    mediaId: asset.id,
    fileName: asset.name,
    duration: asset.duration,
    sourceAspect: asset.height > 0 ? asset.width / asset.height : 16 / 9,
    enabled: true,
  }
}

function defaultScene(): SceneSettings {
  return {
    background: {
      type: 'gradient',
      color: '#0b0f16',
      from: '#1d2534',
      to: '#05070b',
      angle: 160,
      mediaId: null,
      src: null,
      source: 'image',
      fit: 'cover',
      overlay: 0.25,
      blur: 0,
    },
    envIntensity: 1,
    exposure: 1,
    shadow: { enabled: true, opacity: 0.55, blur: 2.6 },
    soundtrackId: null,
  }
}

/**
 * The project opens on a single keyframe at 0 — the first frame and nothing more,
 * so the composition is 0 seconds long until the artist puts something later.
 */
export function createDefaultProject(): EditorSnapshot {
  const device: SceneObject = {
    id: 'device-main',
    name: 'MacBook Pro 13"',
    kind: 'model',
    assetId: DEFAULT_ASSET_ID,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    visible: true,
    locked: false,
    material: defaultMaterial(),
    lid: defaultLid(DEFAULT_ASSET_ID),
    screen: defaultScreenSettings(DEFAULT_ASSET_ID),
    text: null,
    color: '#f5a524',
    screenClips: [],
    appearAt: 0,
    keyframes: [],
  }

  // Exactly one keyframe: frame 0. The video is therefore 0 seconds long until a
  // second keyframe lands somewhere later. The camera is left unkeyed, so it
  // simply uses its stored framing until the artist keys it in the 相机 tab.
  const firstKeyframe = createObjectKeyframe(0, {
    transform: device.transform,
    lidOpenDeg: 0,
    screen: device.screen,
    scene: defaultScene(),
  })
  device.keyframes = [firstKeyframe]

  const timeline: TimelineState = {
    fps: DEFAULT_FPS,
    currentTime: 0,
    playing: false,
    loop: true,
    zoom: DEFAULT_ZOOM,
    cameraKeyframes: [],
    // Opening on the first frame means the panel starts in the keyframe context:
    // 对象 + 变速, not 材质/相机/场景.
    selectedKeyframeId: firstKeyframe.id,
    selectedClipId: null,
    redrawAnchor: null,
  }

  return {
    project: { name: '未命名项目', aspect: '16:9' },
    objects: [device],
    media: [],
    customFonts: [],
    selectedObjectId: device.id,
    clipboard: null,
    camera: { ...DEFAULT_CAMERA, revision: 0 },
    view: { ...DEFAULT_VIEW, revision: 0 },
    scene: defaultScene(),
    timeline,
    ui: {
      leftNav: 'resources',
      deviceTab: 'library',
      inspectorTab: 'object',
      showGrid: true,
      previewOpen: false,
      lidTool: false,
      viewportCamera: 'free',
    },
  }
}

/* ---------------------------------------------------------------- actions */

export interface EditorActions {
  /* selection */
  selectObject: (id: string | null) => void

  /* objects */
  addObject: (assetId: string, name?: string) => string
  removeObject: (id: string) => void
  setObjectTransform: (id: string, patch: Partial<Transform>) => void
  setObjectVisible: (id: string, visible: boolean) => void
  /**
   * 隐藏 at the playhead — the per-frame switch behind 消失 / 出现. Keyed like any
   * other pose field, so two frames that disagree make something vanish.
   */
  setObjectHidden: (id: string, hidden: boolean) => void
  /** 瞬间切 or 渐隐 / 渐显, for the visibility change this frame makes. */
  setObjectHideMode: (id: string, mode: HideMode) => void
  setObjectLocked: (id: string, locked: boolean) => void
  renameObject: (id: string, name: string) => void
  updateObjectMaterial: (id: string, patch: Partial<MaterialSettings>) => void
  setMaterialEnabled: (id: string, enabled: boolean) => void
  applyMaterialPreset: (id: string, presetId: string) => void

  /* lid */
  setObjectLidOpen: (id: string, openDeg: number) => void
  setObjectLidClosed: (id: string) => void

  /* screen */
  setObjectScreen: (id: string, patch: Partial<ScreenSettings>) => void
  clearObjectScreen: (id: string) => void

  /** Drop a library image or clip into the scene as its own 3D object. */
  addMediaObject: (mediaId: string) => string | null

  /* video clips — the object's second row */
  moveScreenClip: (objectId: string, clipId: string, start: number) => void
  trimScreenClip: (objectId: string, clipId: string, edge: 'start' | 'end', time: number) => void
  /**
   * Cut a clip in two at `time`: 时间裁剪. Both halves keep their slice of the
   * ramp, so the piece plays exactly as it did — then each half is its own clip.
   */
  splitScreenClip: (objectId: string, clipId: string, time: number) => void
  setScreenClipSpeed: (objectId: string, clipId: string, speed: SpeedCurve) => void
  removeScreenClip: (objectId: string, clipId: string) => void
  selectScreenClip: (id: string | null) => void
  /** Cut the selected clip at the playhead. Does nothing if that is meaningless. */
  splitClipHere: () => void
  /**
   * Delete whatever is selected — the video clip if one is selected, otherwise
   * the keyframe. One action so the toolbar's trash and `Del` can never disagree.
   */
  deleteSelection: () => void
  copyScreenClip: (objectId: string, clipId: string) => void
  pasteScreenClip: (objectId: string) => void

  /* media library */
  /** Validate a batch of files and put what decodes into the library. */
  importMediaFiles: (files: File[]) => Promise<{ ids: string[]; problems: string[] }>
  addMediaAsset: (input: {
    name: string
    relativePath?: string
    kind: MediaKind
    src: string
    size: number
    width: number
    height: number
    duration: number
  }) => string
  removeMediaAsset: (id: string) => void
  applyMediaToScreen: (objectId: string, mediaId: string) => void
  applyMediaToBackground: (mediaId: string) => void
  setSoundtrack: (mediaId: string | null) => void

  /* text */
  addTextObject: (content?: string) => string
  updateObjectText: (id: string, patch: Partial<TextSettings>) => void
  /** Import a local font file (TTF/OTF/WOFF) and return its id. */
  importFont: (file: File) => string
  removeFont: (id: string) => void

  /* shot camera */
  updateCamera: (patch: Partial<Omit<CameraSettings, 'revision'>>) => void
  applyCameraPreset: (presetId: string) => void
  applyFramingPreset: (presetId: string) => void

  /* editing viewport camera */
  updateViewCamera: (patch: Partial<Omit<CameraSettings, 'revision'>>) => void
  syncViewFromViewport: (values: {
    azimuth: number
    elevation: number
    distance: number
    target: Vec3
  }) => void
  setViewportCamera: (mode: ViewportCamera) => void

  /* environment */
  updateScene: (patch: Partial<SceneSettings>) => void
  updateBackground: (patch: Partial<SceneSettings['background']>) => void
  updateShadow: (patch: Partial<SceneSettings['shadow']>) => void

  /* project */
  setProjectName: (name: string) => void
  setProjectAspect: (aspect: ProjectAspect) => void

  /* the project as text */
  /** The whole project in the 代码 panel's format. */
  projectText: () => string
  /** Parse text back into the project. Nothing is applied unless it is clean. */
  applyProjectText: (text: string, sourcePath?: string) => { errors: string[]; warnings: string[] }

  /* history */
  undo: () => void
  redo: () => void

  /* preview player */
  setPreviewOpen: (open: boolean) => void

  /* timeline — keyframes, not clips */
  play: () => void
  pause: () => void
  togglePlay: () => void
  seek: (time: number) => void
  advance: (delta: number) => void
  setFps: (fps: number) => void
  setZoom: (zoom: number) => void
  toggleLoop: () => void
  /** `D`: key the selected object, or the camera when nothing is selected. */
  keyframeHere: () => void
  keyframeObject: (objectId: string) => void
  keyframeCamera: () => void
  /**
   * 从此处重绘 — scoped to one object: make its later keyframes hold this
   * frame's pose and mark them as being on a redraw chain.
   */
  redrawFrom: (objectId: string, time: number) => void
  selectKeyframe: (id: string | null) => void
  moveObjectKeyframe: (objectId: string, id: string, time: number) => void
  /** Step to the neighbouring keyframe of the selected object. */
  stepKeyframe: (direction: -1 | 1) => void
  /** Esc: leave redraw mode. The chain stops following; the frames keep the mark. */
  exitRedraw: () => void
  moveCameraKeyframe: (id: string, time: number) => void
  removeObjectKeyframe: (objectId: string, id: string) => void
  removeCameraKeyframe: (id: string) => void
  clearObjectKeyframes: (objectId: string) => void
  setObjectKeyframeSpeed: (objectId: string, id: string, speed: SpeedCurve) => void
  setObjectKeyframeNodeCount: (objectId: string, id: string, count: number) => void
  applyObjectKeyframeSpeedPreset: (objectId: string, id: string, presetId: string) => void
  setCameraKeyframeSpeed: (id: string, speed: SpeedCurve) => void
  setCameraKeyframeNodeCount: (id: string, count: number) => void
  applyCameraKeyframeSpeedPreset: (id: string, presetId: string) => void

  /* ui */
  setLeftNav: (nav: LeftNav) => void
  setDeviceTab: (tab: DeviceTab) => void
  setInspectorTab: (tab: InspectorTab) => void
  toggleGrid: () => void
  toggleLidTool: () => void

  /* project */
  resetProject: () => void
}

export type EditorStore = EditorSnapshot &
  EditorActions & {
    /** Undo stack, newest last. Not part of a snapshot: history is not an edit. */
    past: EditorSnapshot[]
    future: EditorSnapshot[]
  }

/* ------------------------------------------------------------- selectors */

export function selectSelectedObject(state: EditorStore): SceneObject | null {
  return state.objects.find((object) => object.id === state.selectedObjectId) ?? null
}

export function selectObjectKeyframes(
  state: EditorStore,
  objectId: string | null,
): ObjectKeyframe[] {
  if (!objectId) return []
  return state.objects.find((object) => object.id === objectId)?.keyframes ?? []
}

/**
 * The redraw-chain rule: arriving on a chained keyframe that sits *after* the
 * anchor copies the anchor's pose into it, and the anchor moves up.
 *
 * Direction matters. Stepping backwards, or landing on an unchained frame, never
 * rewrites anything — otherwise walking back through a chain would silently undo
 * it.
 */
function carryChain(
  state: EditorStore,
  targetId: string,
): { objects: SceneObject[]; anchor: { objectId: string; keyframeId: string } | null } | null {
  const { redrawAnchor } = state.timeline
  if (!redrawAnchor) return null
  const object = state.objects.find((entry) => entry.id === redrawAnchor.objectId)
  if (!object) return null
  const source = object.keyframes.find((frame) => frame.id === redrawAnchor.keyframeId)
  const target = object.keyframes.find((frame) => frame.id === targetId)
  if (!source || !target) return null
  if (!target.chained || target.time <= source.time + KEYFRAME_EPSILON) return null

  const keyframes = object.keyframes.map((frame) =>
    frame.id === target.id ? { ...frame, pose: source.pose } : frame,
  )
  return {
    objects: state.objects.map((entry) => (entry.id === object.id ? { ...entry, keyframes } : entry)),
    anchor: { objectId: object.id, keyframeId: target.id },
  }
}

/** Is this source still owned by a clip? Then its object URL must stay alive. */
function isClipSource(object: SceneObject, src: string | null): boolean {
  return Boolean(src) && object.screenClips.some((clip) => clip.src === src)
}

/**
 * Write a scene patch into the composition *and* into the keyframes standing at
 * the playhead, so "改场景" behaves exactly like "改贴图": it belongs to the frame
 * you are parked on.
 */
function applyScene(
  state: EditorStore,
  patch: Partial<SceneSettings>,
): Partial<EditorStore> {
  const scene: SceneSettings = { ...state.scene, ...patch }
  const time = state.timeline.currentTime
  let touched = false
  const objects = state.objects.map((object) => {
    if (!object.keyframes.some((frame) => Math.abs(frame.time - time) <= KEYFRAME_EPSILON)) {
      return object
    }
    touched = true
    return {
      ...object,
      keyframes: object.keyframes.map((frame) =>
        Math.abs(frame.time - time) <= KEYFRAME_EPSILON
          ? { ...frame, pose: { ...frame.pose, scene } }
          : frame,
      ),
    }
  })
  return touched ? { scene, objects, timeline: state.timeline } : { scene }
}

/**
 * Write pose fields onto the frame under the playhead (upsert by time, so
 * toggling a switch twice does not fill the timeline with frames).
 *
 * 隐藏 and its mode are properties of *a moment*, so they are written exactly the
 * way a transform is.
 */
function keyPoseField(
  state: EditorStore,
  id: string,
  patch: Partial<ObjectPose>,
): Partial<EditorStore> {
  if (state.timeline.playing) return {}
  const time = state.timeline.currentTime
  return {
    objects: state.objects.map((object) => {
      if (object.id !== id) return object
      const frame = createObjectKeyframe(time, { ...shownPose(state, object, time), ...patch })
      return { ...object, keyframes: resyncSpans(putObjectKeyframe(object.keyframes, frame)) }
    }),
  }
}

/** The pose on screen at `time` — the starting point for any edit. */
function shownPose(state: EditorStore, object: SceneObject, time: number): ObjectPose {
  const shown = evaluateFrame(state, time).objects[object.id]
  return {
    transform: shown?.transform ?? object.transform,
    lidOpenDeg: shown?.lidOpenDeg ?? (object.lid ? object.lid.openDeg : null),
    screen: resolveScreenState(object.keyframes, time, object.screen),
    scene: resolveSceneState(state.objects, time, state.scene),
    hidden: shown?.hidden ?? false,
    hideMode: shown?.hideMode,
  }
}

/** Write a screen state onto the frame under the playhead, creating it if needed. */
function applyScreenState(
  state: EditorStore,
  object: SceneObject,
  time: number,
  screen: ScreenSettings,
): SceneObject {
  const pose: ObjectPose = { ...shownPose(state, object, time), screen }
  const keyframes =
    object.keyframes.length === 0
      ? object.keyframes
      : resyncSpans(
          putObjectKeyframe(object.keyframes, createObjectKeyframe(time, pose)),
        )
  return {
    ...object,
    screen: object.keyframes.length === 0 ? screen : object.screen,
    keyframes,
    screenClips: withClipForScreen(state, object, time, screen),
  }
}

/**
 * Attaching a video puts a clip on the object's video row, starting at the frame
 * you attached it on and spanning the whole source until you trim it.
 */
function withClipForScreen(
  state: EditorStore,
  object: SceneObject,
  time: number,
  screen: ScreenSettings,
): ScreenClip[] {
  if (!screen.enabled || screen.source !== 'video' || !screen.src) return object.screenClips
  if (object.screenClips.some((clip) => clip.src === screen.src)) return object.screenClips
  const asset = state.media.find((entry) => entry.id === screen.mediaId)
  const source =
    screen.duration > 0.1
      ? screen.duration
      : asset && asset.duration > 0.1
        ? asset.duration
        : DEFAULT_CLIP_SECONDS
  const clip: ScreenClip = {
    id: uid('vclip'),
    mediaId: screen.mediaId,
    src: screen.src,
    name: screen.fileName ?? asset?.name ?? '视频',
    start: time,
    inPoint: 0,
    outPoint: source,
    speed: createSpeedCurve(2),
  }
  return [...object.screenClips, clip].sort((a, b) => a.start - b.start)
}

/* ----------------------------------------------------------------- store */

/* --------------------------------------------------------------- history -- */

/** What an undo point holds: everything the artist can change by hand. */
function snapshotOf(state: EditorStore): EditorSnapshot {
  return {
    project: state.project,
    objects: state.objects,
    media: state.media,
    customFonts: state.customFonts,
    selectedObjectId: state.selectedObjectId,
    clipboard: state.clipboard,
    camera: state.camera,
    view: state.view,
    scene: state.scene,
    timeline: state.timeline,
    ui: state.ui,
  }
}

/**
 * Did anything *work*-shaped change? Selection, the playhead, the play flag, the
 * panel tabs and the orbit camera are navigation, not edits — recording them
 * would fill the undo stack with steps that undo nothing visible.
 */
function edited(before: EditorSnapshot, after: EditorSnapshot): boolean {
  return (
    before.objects !== after.objects ||
    before.scene !== after.scene ||
    before.media !== after.media ||
    before.customFonts !== after.customFonts ||
    before.project !== after.project ||
    before.timeline.cameraKeyframes !== after.timeline.cameraKeyframes ||
    before.timeline.fps !== after.timeline.fps ||
    // `camera` is the *shot* framing, which only changes when the artist means
    // it (dolly, drag in camera view, a preset) — orbiting the edit view writes
    // `view`, never this.
    before.camera !== after.camera
  )
}

const HISTORY_LIMIT = 80

/** True once the artist has edited since the last save / import / reset. */
let unsavedChanges = false

export function hasUnsavedChanges(): boolean {
  return unsavedChanges
}

export function markClean(): void {
  unsavedChanges = false
}

/** Set while `undo`/`redo` restore a snapshot: restoring is not an edit. */
let restoring = false
/** Set between `beginGesture` and `endGesture`, so a drag is one step. */
let dragging = false
let dragStart: EditorSnapshot | null = null

export const useEditorStore = create<EditorStore>((rawSet, get) => {
  /**
   * Every action goes through this: apply the change, then record an undo point
   * if it actually edited something. A drag is coalesced into a single point by
   * the gesture listeners below.
   */
  const set: typeof rawSet = (partial, replace) => {
    const before = get()
    const beforeSnapshot = snapshotOf(before)
    rawSet(partial as never, replace as never)
    if (restoring || dragging) return
    const after = get()
    if (!edited(beforeSnapshot, snapshotOf(after))) return
    unsavedChanges = true
    rawSet({
      past: [...after.past.slice(-(HISTORY_LIMIT - 1)), beforeSnapshot],
      future: [],
    } as never)
  }

  onGesture((active) => {
    const store = useEditorStore
    if (active) {
      dragging = true
      dragStart = snapshotOf(store.getState())
      return
    }
    dragging = false
    const before = dragStart
    dragStart = null
    if (!before) return
    const state = store.getState()
    if (!edited(before, snapshotOf(state))) return
    unsavedChanges = true
    store.setState({
      past: [...state.past.slice(-(HISTORY_LIMIT - 1)), before],
      future: [],
    })
  })

  return {
  past: [],
  future: [],
  ...createDefaultProject(),

  selectObject: (id) =>
    set((state) => ({
      selectedObjectId: id,
      // A clip belongs to an object: picking a different object (or nothing)
      // leaves the clip context, or the panel would keep showing 变速.
      timeline: { ...state.timeline, selectedClipId: null },
    })),

  addObject: (assetId, name) => {
    const id = uid('object')
    set((state) => {
      const index = state.objects.length + 1
      const born = state.timeline.currentTime
      const transform: Transform = {
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      }
      const object: SceneObject = {
        id,
        name: name ?? `设备 ${index}`,
        kind: 'model',
        assetId,
        transform,
        visible: true,
        locked: false,
        material: defaultMaterial(),
        lid: defaultLid(assetId),
        screen: defaultScreenSettings(assetId),
        text: null,
        color: nextObjectColor(state.objects),
        screenClips: [],
        // Born at the playhead: no keyframes before it, so it simply is not in
        // the shot yet.
        appearAt: born,
        keyframes: [
          createObjectKeyframe(born, {
            transform,
            lidOpenDeg: defaultLid(assetId)?.openDeg ?? null,
            screen: defaultScreenSettings(assetId),
            scene: defaultScene(),
          }),
        ],
      }
      return { objects: [...state.objects, object], selectedObjectId: id }
    })
    return id
  },

  /**
   * A library image or clip becomes a plane in the scene — the same kind of
   * object as the laptop: born at the playhead, keyed once there, and for a video
   * it also gets a clip on the object's video row straight away.
   */
  addMediaObject: (mediaId) => {
    const asset = get().media.find((entry) => entry.id === mediaId)
    if (!asset || asset.kind === 'audio') return null
    const id = uid('media')
    set((state) => {
      const born = state.timeline.currentTime
      const transform: Transform = {
        position: [0, 0.8, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      }
      const screen: ScreenSettings = {
        ...defaultMediaScreenSettings(),
        source: asset.kind === 'video' ? 'video' : 'image',
        src: asset.src,
        mediaId: asset.id,
        fileName: asset.name,
        duration: asset.duration,
        sourceAspect: asset.height > 0 ? asset.width / asset.height : 16 / 9,
        enabled: true,
      }
      const object: SceneObject = {
        id,
        name: asset.name,
        kind: 'media',
        assetId: '',
        transform,
        visible: true,
        locked: false,
        material: defaultMaterial(),
        lid: null,
        screen,
        text: null,
        color: nextObjectColor(state.objects),
        screenClips: [],
        appearAt: born,
        keyframes: [
          createObjectKeyframe(born, {
            transform,
            lidOpenDeg: null,
            screen,
            scene: state.scene,
          }),
        ],
      }
      const withClip: SceneObject = {
        ...object,
        screenClips: withClipForScreen(state, object, born, screen),
      }
      return {
        objects: [...state.objects, withClip],
        selectedObjectId: id,
        ui: { ...state.ui, inspectorTab: 'object' },
      }
    })
    return id
  },

  addTextObject: (content) => {
    const id = uid('text')
    set((state) => {
      const index = state.objects.filter((object) => object.kind === 'text').length + 1
      const body = content ?? 'UAE2 Studio'
      const born = state.timeline.currentTime
      const transform: Transform = {
        position: [0, 1.45, 0.7],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      }
      const object: SceneObject = {
        id,
        name: content ? `文字 · ${body.slice(0, 8)}` : `文字 ${index}`,
        kind: 'text',
        assetId: '',
        transform,
        visible: true,
        locked: false,
        material: defaultMaterial(),
        lid: null,
        screen: null,
        text: { ...defaultText(), content: body },
        color: nextObjectColor(state.objects),
        screenClips: [],
        appearAt: born,
        keyframes: [
          createObjectKeyframe(born, {
            transform,
            lidOpenDeg: null,
            screen: null,
            scene: defaultScene(),
          }),
        ],
      }
      return {
        objects: [...state.objects, object],
        selectedObjectId: id,
        ui: { ...state.ui, leftNav: 'text', inspectorTab: 'object' },
      }
    })
    return id
  },

  updateObjectText: (id, patch) =>
    set((state) => ({
      objects: state.objects.map((object) =>
        object.id === id && object.text ? { ...object, text: { ...object.text, ...patch } } : object,
      ),
    })),

  importFont: (file) => {
    const id = uid('font')
    const font: FontAsset = {
      id,
      name: file.name.replace(/\.[^.]+$/, ''),
      url: URL.createObjectURL(file),
      cjk: true,
    }
    set((state) => ({ customFonts: [...state.customFonts, font] }))
    return id
  },

  removeFont: (id) =>
    set((state) => {
      const font = state.customFonts.find((entry) => entry.id === id)
      if (!font) return {}
      if (font.url.startsWith('blob:')) URL.revokeObjectURL(font.url)
      return {
        customFonts: state.customFonts.filter((entry) => entry.id !== id),
        // A text object that was using the removed font falls back to the default.
        objects: state.objects.map((object) =>
          object.text && object.text.fontId === id
            ? { ...object, text: { ...object.text, fontId: DEFAULT_FONT_ID } }
            : object,
        ),
      }
    }),

  /**
   * A texture belongs to a frame. Once the object has a timeline the change is
   * written onto the keyframe under the playhead — otherwise "换一张图" would
   * repaint the whole video, which is exactly the bug this fixes.
   */
  setObjectScreen: (id, patch) =>
    set((state) => {
      if (state.timeline.playing) return {}
      const time = state.timeline.currentTime
      return {
        objects: state.objects.map((object) => {
          if (object.id !== id || !object.screen) return object
          const base = resolveScreenState(object.keyframes, time, object.screen) ?? object.screen
          if (patch.src !== undefined && patch.src !== base.src && !isClipSource(object, base.src)) {
            releaseScreenSource(base)
          }
          const next: ScreenSettings = { ...base, ...patch }
          // A source is what makes a display live; picking one switches it on.
          if (patch.src !== undefined) next.enabled = patch.src !== null
          return pruneScreenClips(applyScreenState(state, object, time, next))
        }),
      }
    }),

  clearObjectScreen: (id) =>
    set((state) => {
      if (state.timeline.playing) return {}
      const time = state.timeline.currentTime
      return {
        objects: state.objects.map((object) => {
          if (object.id !== id || !object.screen) return object
          const base = resolveScreenState(object.keyframes, time, object.screen) ?? object.screen
          if (!isClipSource(object, base.src)) releaseScreenSource(base)
          return pruneScreenClips(
            applyScreenState(state, object, time, {
              ...base,
              enabled: false,
              src: null,
              mediaId: null,
              fileName: null,
            }),
          )
        }),
      }
    }),

  /* ---------------------------------------------------------- video clips -- */

  /** Move a clip along the timeline (drag it on its row). */
  moveScreenClip: (objectId, clipId, start) =>
    set((state) => ({
      objects: state.objects.map((object) =>
        object.id === objectId
          ? {
              ...object,
              screenClips: object.screenClips
                .map((clip) =>
                  clip.id === clipId ? { ...clip, start: Math.max(0, start) } : clip,
                )
                .sort((a, b) => a.start - b.start),
            }
          : object,
      ),
    })),

  /** Trim: drag either edge of a clip. */
  trimScreenClip: (objectId, clipId, edge, time) =>
    set((state) => ({
      objects: state.objects.map((object) => {
        if (object.id !== objectId) return object
        return {
          ...object,
          screenClips: object.screenClips.map((clip) => {
            if (clip.id !== clipId) return clip
            const mean = meanSpeed(clip.speed)
            if (edge === 'start') {
              // Trimming the head keeps the tail where it is, and walks the
              // source in-point forward by exactly the screen time removed.
              const end = clip.start + (clip.outPoint - clip.inPoint) / mean
              const start = Math.min(end - 0.1, Math.max(0, time))
              return {
                ...clip,
                start,
                inPoint: Math.max(0, clip.outPoint - (end - start) * mean),
              }
            }
            const end = Math.max(clip.start + 0.1, time)
            return { ...clip, outPoint: clip.inPoint + (end - clip.start) * mean }
          }),
        }
      }),
    })),

  setScreenClipSpeed: (objectId, clipId, speed) =>
    set((state) => ({
      objects: state.objects.map((object) =>
        object.id === objectId
          ? {
              ...object,
              screenClips: object.screenClips.map((clip) =>
                clip.id === clipId ? { ...clip, speed } : clip,
              ),
            }
          : object,
      ),
    })),

  splitScreenClip: (objectId, clipId, time) =>
    set((state) => ({
      objects: state.objects.map((object) => {
        if (object.id !== objectId) return object
        const clip = object.screenClips.find((entry) => entry.id === clipId)
        if (!clip) return object
        const end = clip.start + (clip.outPoint - clip.inPoint) / meanSpeed(clip.speed)
        // Only a cut strictly inside the clip means anything.
        if (time <= clip.start + 0.05 || time >= end - 0.05) return object

        const u = (time - clip.start) / (end - clip.start)
        const { before, after } = sliceSpeedCurve(clip.speed, u)
        const source = clip.inPoint + segmentProgress(clip.speed, u) * (clip.outPoint - clip.inPoint)

        const head: ScreenClip = { ...clip, outPoint: source, speed: before }
        const tail: ScreenClip = {
          ...clip,
          id: uid('vclip'),
          start: time,
          inPoint: source,
          speed: after,
        }
        return {
          ...object,
          screenClips: object.screenClips
            .flatMap((entry) => (entry.id === clipId ? [head, tail] : [entry]))
            .sort((a, b) => a.start - b.start),
        }
      }),
      timeline: { ...state.timeline, selectedClipId: clipId },
    })),

  removeScreenClip: (objectId, clipId) =>
    set((state) => ({
      objects: state.objects.map((object) =>
        object.id === objectId
          ? { ...object, screenClips: object.screenClips.filter((clip) => clip.id !== clipId) }
          : object,
      ),
      timeline: {
        ...state.timeline,
        selectedClipId: state.timeline.selectedClipId === clipId ? null : state.timeline.selectedClipId,
      },
    })),

  selectScreenClip: (id) =>
    set((state) => {
      if (!id) return { timeline: { ...state.timeline, selectedClipId: null } }
      const owner = state.objects.find((object) =>
        object.screenClips.some((clip) => clip.id === id),
      )
      const clip = owner?.screenClips.find((entry) => entry.id === id) ?? null
      // Focus the frame the clip starts on: the panel then has both a texture and
      // a ramp to talk about.
      const frame =
        owner && clip
          ? (owner.keyframes.find(
              (entry) => Math.abs(entry.time - clip.start) < KEYFRAME_EPSILON,
            ) ?? null)
          : null
      return {
        // Selecting a clip is selecting where it lives, so the row highlight,
        // the 隐藏 toggle and 剪切 all agree on what is being worked on.
        selectedObjectId: owner ? owner.id : state.selectedObjectId,
        timeline: {
          ...state.timeline,
          selectedClipId: id,
          selectedKeyframeId: frame ? frame.id : state.timeline.selectedKeyframeId,
        },
      }
    }),

  splitClipHere: () => {
    const state = get()
    const id = state.timeline.selectedClipId
    if (!id) return
    for (const object of state.objects) {
      if (!object.screenClips.some((clip) => clip.id === id)) continue
      get().splitScreenClip(object.id, id, state.timeline.currentTime)
      return
    }
  },

  deleteSelection: () => {
    const state = get()
    const clipId = state.timeline.selectedClipId
    if (clipId) {
      for (const object of state.objects) {
        if (object.screenClips.some((clip) => clip.id === clipId)) {
          get().removeScreenClip(object.id, clipId)
          return
        }
      }
    }
    const keyframeId = state.timeline.selectedKeyframeId
    if (!keyframeId) return
    const owner = state.objects.find((object) =>
      object.keyframes.some((frame) => frame.id === keyframeId),
    )
    if (owner) get().removeObjectKeyframe(owner.id, keyframeId)
    else get().removeCameraKeyframe(keyframeId)
  },

  copyScreenClip: (objectId, clipId) =>
    set((state) => {
      const clip = state.objects
        .find((object) => object.id === objectId)
        ?.screenClips.find((entry) => entry.id === clipId)
      return clip ? { clipboard: { ...clip } } : {}
    }),

  /**
   * Paste at the playhead, on the same object the clip was copied from — a video
   * belongs to one screen, so pasting it onto another object would have nothing
   * to play it.
   */
  pasteScreenClip: (objectId) =>
    set((state) => {
      const source = state.clipboard
      if (!source) return {}
      const object = state.objects.find((entry) => entry.id === objectId)
      if (!object) return {}
      const clip: ScreenClip = {
        ...source,
        id: uid('vclip'),
        start: state.timeline.currentTime,
      }
      return {
        objects: state.objects.map((entry) =>
          entry.id === objectId
            ? {
                ...entry,
                screenClips: [...entry.screenClips, clip].sort((a, b) => a.start - b.start),
              }
            : entry,
        ),
        timeline: { ...state.timeline, selectedClipId: clip.id, selectedKeyframeId: null },
      }
    }),

  /* ------------------------------------------------------- media library -- */

  importMediaFiles: async (files) => {
    const ids: string[] = []
    const problems: string[] = []
    for (const file of files) {
      const probe = await probeMediaFile(file)
      if (!probe.ok) {
        problems.push(`${file.name}：${probe.message}`)
        continue
      }
      // A folder pick gives every file a path relative to the picked root; keep it
      // so the project's own relative paths can find this asset later.
      const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath
      ids.push(
        get().addMediaAsset({
          name: file.name,
          relativePath: relativePath && relativePath !== file.name ? relativePath : undefined,
          kind: probe.info.kind,
          src: URL.createObjectURL(file),
          size: file.size,
          width: probe.info.width,
          height: probe.info.height,
          duration: probe.info.duration,
        }),
      )
    }
    return { ids, problems }
  },

  addMediaAsset: (input) => {
    const id = uid('media')
    set((state) => ({
      media: [...state.media, { ...input, id, addedAt: Date.now() }],
    }))
    return id
  },

  removeMediaAsset: (id) =>
    set((state) => {
      const asset = state.media.find((entry) => entry.id === id)
      if (!asset) return {}
      // The library owns every URL it handed out; take them all back at once.
      if (asset.src.startsWith('blob:')) URL.revokeObjectURL(asset.src)

      const dropReference = <T extends { mediaId: string | null; src: string | null }>(ref: T): T =>
        ref.mediaId === id || ref.src === asset.src
          ? { ...ref, mediaId: null, src: null }
          : ref

      return {
        media: state.media.filter((entry) => entry.id !== id),
        objects: state.objects.map((object) =>
          object.screen && (object.screen.mediaId === id || object.screen.src === asset.src)
            ? {
                ...object,
                screen: {
                  ...object.screen,
                  enabled: false,
                  src: null,
                  mediaId: null,
                  fileName: null,
                },
              }
            : object,
        ),
        scene: {
          ...state.scene,
          background: dropReference(state.scene.background),
          soundtrackId: state.scene.soundtrackId === id ? null : state.scene.soundtrackId,
        },
      }
    }),

  applyMediaToScreen: (objectId, mediaId) => {
    const asset = get().media.find((entry) => entry.id === mediaId)
    if (!asset || asset.kind === 'audio') return
    set((state) => ({
      objects: state.objects.map((object) => {
        if (object.id !== objectId || !object.screen) return object
        releaseScreenSource(object.screen)
        // A still image on the screen means no video row either.
        return pruneScreenClips({
          ...object,
          screen: { ...object.screen, ...screenPatchFromMedia(asset) },
        })
      }),
    }))
  },

  applyMediaToBackground: (mediaId) => {
    const asset = get().media.find((entry) => entry.id === mediaId)
    if (!asset || asset.kind === 'audio') return
    set((state) => ({
      scene: {
        ...state.scene,
        background: {
          ...state.scene.background,
          type: 'media',
          mediaId: asset.id,
          src: asset.src,
          source: asset.kind === 'video' ? 'video' : 'image',
        },
      },
    }))
  },

  setSoundtrack: (mediaId) =>
    set((state) => ({ scene: { ...state.scene, soundtrackId: mediaId } })),

  removeObject: (id) =>
    set((state) => {
      const objects = state.objects.filter((object) => object.id !== id)
      releaseScreenSource(state.objects.find((object) => object.id === id)?.screen)
      return {
        objects,
        selectedObjectId:
          state.selectedObjectId === id ? (objects[0]?.id ?? null) : state.selectedObjectId,
      }
    }),

  setObjectTransform: (id, patch) =>
    set((state) => {
      if (state.timeline.playing) return {}
      const time = state.timeline.currentTime
      return {
        objects: state.objects.map((object) => {
          if (object.id !== id) return object
          const transform = { ...object.transform, ...patch }
          // An object with a timeline is posed *at a time*, and it is showing an
          // interpolated pose. Writing the rest transform would change nothing on
          // screen, so the edit becomes a keyframe here instead — one per instant
          // (upsert by time), so dragging a slider cannot fill the timeline.
          if (object.keyframes.length === 0) return { ...object, transform }
          const frame = createObjectKeyframe(time, {
            transform,
            lidOpenDeg: object.lid ? object.lid.openDeg : null,
            screen: resolveScreenState(object.keyframes, state.timeline.currentTime, object.screen),
            scene: resolveSceneState(state.objects, time, state.scene),
          })
          return {
            ...object,
            transform,
            keyframes: resyncSpans(putObjectKeyframe(object.keyframes, frame)),
          }
        }),
      }
    }),

  setObjectVisible: (id, visible) =>
    set((state) => ({
      objects: state.objects.map((object) => (object.id === id ? { ...object, visible } : object)),
    })),

  setObjectHidden: (id, hidden) => set((state) => keyPoseField(state, id, { hidden })),

  setObjectHideMode: (id, hideMode) => set((state) => keyPoseField(state, id, { hideMode })),

  setObjectLocked: (id, locked) =>
    set((state) => ({
      objects: state.objects.map((object) => (object.id === id ? { ...object, locked } : object)),
    })),

  renameObject: (id, name) =>
    set((state) => ({
      objects: state.objects.map((object) => (object.id === id ? { ...object, name } : object)),
    })),

  updateObjectMaterial: (id, patch) =>
    set((state) => ({
      objects: state.objects.map((object) =>
        object.id === id
          ? { ...object, material: { ...object.material, ...patch, enabled: true } }
          : object,
      ),
    })),

  setMaterialEnabled: (id, enabled) =>
    set((state) => ({
      objects: state.objects.map((object) =>
        object.id === id ? { ...object, material: { ...object.material, enabled } } : object,
      ),
    })),

  applyMaterialPreset: (id, presetId) =>
    set((state) => ({
      objects: state.objects.map((object) => {
        if (object.id !== id) return object
        const preset = MATERIAL_PRESETS.find((entry) => entry.id === presetId)
        if (!preset) return object
        return {
          ...object,
          material: {
            ...object.material,
            ...preset.settings,
            presetId: preset.id,
            // "original" is the escape hatch back to the asset's own materials.
            enabled: preset.id !== 'original',
          },
        }
      }),
    })),

  setObjectLidOpen: (id, openDeg) =>
    set((state) => {
      if (state.timeline.playing) return {}
      const time = state.timeline.currentTime
      return {
        objects: state.objects.map((object) => {
          if (object.id !== id || !object.lid) return object
          const angle = clamp(openDeg, 0, object.lid.maxDeg)
          if (object.keyframes.length === 0) {
            return { ...object, lid: { ...object.lid, openDeg: angle } }
          }
          const frame = createObjectKeyframe(time, {
            transform: object.transform,
            lidOpenDeg: angle,
            screen: resolveScreenState(object.keyframes, state.timeline.currentTime, object.screen),
            scene: resolveSceneState(state.objects, time, state.scene),
          })
          return {
            ...object,
            lid: { ...object.lid, openDeg: angle },
            keyframes: resyncSpans(putObjectKeyframe(object.keyframes, frame)),
          }
        }),
      }
    }),

  setObjectLidClosed: (id) => get().setObjectLidOpen(id, 0),

  updateCamera: (patch) =>
    set((state) => {
      const camera = { ...state.camera, ...patch, revision: state.camera.revision + 1 }
      if (state.timeline.cameraKeyframes.length === 0) return { camera }
      // Same rule as objects: an animated camera is posed at a time.
      return {
        camera,
        timeline: {
          ...state.timeline,
          cameraKeyframes: putCameraKeyframe(
            state.timeline.cameraKeyframes,
            createCameraKeyframe(state.timeline.currentTime, {
              azimuth: camera.azimuth,
              elevation: camera.elevation,
              distance: camera.distance,
              target: [...camera.target] as Vec3,
              fov: camera.fov,
            }),
          ),
        },
      }
    }),
  applyCameraPreset: (presetId) => {
    const preset = CAMERA_PRESETS.find((entry) => entry.id === presetId)
    if (!preset) return
    get().updateCamera({
      azimuth: preset.azimuth,
      elevation: preset.elevation,
      distance: preset.distance,
      target: [...preset.target] as Vec3,
      fov: preset.fov,
    })
  },

  applyFramingPreset: (presetId) => {
    const preset = FRAMING_PRESETS.find((entry) => entry.id === presetId)
    if (!preset) return
    get().updateCamera({ distance: preset.distance, fov: preset.fov })
  },

  updateViewCamera: (patch) =>
    set((state) => ({ view: { ...state.view, ...patch, revision: state.view.revision + 1 } })),

  syncViewFromViewport: ({ azimuth, elevation, distance, target }) =>
    set((state) => ({
      // No revision bump: the artist just orbited, the rig must not fight it.
      view: { ...state.view, azimuth, elevation, distance, target },
    })),

  setViewportCamera: (mode) => set((state) => ({ ui: { ...state.ui, viewportCamera: mode } })),

  /**
   * The scene belongs to a frame. An edit lands in `scene` *and* in every
   * keyframe sitting at the playhead — across objects, because the room is shared
   * — so the background and the lighting can change over the piece. With nothing
   * keyed there it is simply the composition's scene.
   */
  updateScene: (patch) => set((state) => applyScene(state, patch)),

  updateBackground: (patch) =>
    set((state) => applyScene(state, { background: { ...state.scene.background, ...patch } })),

  updateShadow: (patch) =>
    set((state) => applyScene(state, { shadow: { ...state.scene.shadow, ...patch } })),

  play: () =>
    set((state) => {
      const end = timelineEnd(state)
      const atEnd = end > 0 && state.timeline.currentTime >= end - 1e-4
      return {
        timeline: {
          ...state.timeline,
          playing: true,
          currentTime: atEnd && state.timeline.loop ? 0 : state.timeline.currentTime,
        },
      }
    }),

  pause: () => set((state) => ({ timeline: { ...state.timeline, playing: false } })),

  togglePlay: () => {
    const { timeline, play, pause } = get()
    if (timeline.playing) pause()
    else play()
  },

  // The timeline is unbounded, so seeking only has a floor.
  seek: (time) =>
    set((state) => ({ timeline: { ...state.timeline, currentTime: Math.max(0, time) } })),

  /**
   * Playback stops at the last keyframe of any object — that *is* the end of the
   * composition. With nothing keyed there is nothing to play.
   */
  advance: (delta) =>
    set((state) => {
      const { timeline } = state
      if (!timeline.playing) return {}
      const end = timelineEnd(state)
      let next = timeline.currentTime + delta
      let playing = true
      if (end <= 0) {
        next = 0
        playing = false
      } else if (next >= end) {
        if (timeline.loop) next %= end
        else {
          next = end
          playing = false
        }
      }
      return { timeline: { ...timeline, currentTime: next, playing } }
    }),

  setFps: (fps) => set((state) => ({ timeline: { ...state.timeline, fps: clamp(Math.round(fps), 1, 120) } })),

  setZoom: (zoom) =>
    set((state) => ({ timeline: { ...state.timeline, zoom: clamp(zoom, MIN_ZOOM, MAX_ZOOM) } })),

  toggleLoop: () => set((state) => ({ timeline: { ...state.timeline, loop: !state.timeline.loop } })),

  keyframeHere: () => {
    const { selectedObjectId, keyframeObject, keyframeCamera, timeline } = get()
    if (timeline.playing) return
    if (selectedObjectId) keyframeObject(selectedObjectId)
    else keyframeCamera()
  },

  /**
   * Key the object *as it is being displayed* at the playhead.
   *
   * Between two keyframes that is an interpolated pose, not the stored rest
   * transform — keying the rest pose would make the object jump the moment the
   * new keyframe landed, which is the opposite of what "key this frame" means.
   */
  keyframeObject: (objectId) =>
    set((state) => {
      if (state.timeline.playing) return {}
      const object = state.objects.find((entry) => entry.id === objectId)
      if (!object) return {}
      const shown = evaluateFrame(state, state.timeline.currentTime).objects[objectId]
      const pose: ObjectPose = {
        transform: shown?.transform ?? object.transform,
        lidOpenDeg: shown?.lidOpenDeg ?? (object.lid ? object.lid.openDeg : null),
        // Keying grabs the texture on the screen and the room it sits in.
        screen: resolveScreenState(object.keyframes, state.timeline.currentTime, object.screen),
        scene: resolveSceneState(state.objects, state.timeline.currentTime, state.scene),
      }
      const last = object.keyframes[object.keyframes.length - 1]
      const frame = createObjectKeyframe(
        state.timeline.currentTime,
        pose,
        createSpeedCurve(2),
        false,
        last ? Math.max(0, state.timeline.currentTime - last.time) : 0,
      )
      return {
        objects: state.objects.map((entry) =>
          entry.id === objectId
            ? { ...entry, keyframes: putObjectKeyframe(entry.keyframes, frame) }
            : entry,
        ),
        timeline: { ...state.timeline, selectedKeyframeId: frame.id },
      }
    }),

  keyframeCamera: () =>
    set((state) => {
      if (state.timeline.playing) return {}
      // Same as objects: key the pose the preview is showing right now.
      const shown = resolveCamera(state, state.timeline.currentTime)
      const frame = createCameraKeyframe(state.timeline.currentTime, {
        azimuth: shown.azimuth,
        elevation: shown.elevation,
        distance: shown.distance,
        target: [...shown.target] as Vec3,
        fov: shown.fov,
      })
      return {
        timeline: {
          ...state.timeline,
          cameraKeyframes: putCameraKeyframe(state.timeline.cameraKeyframes, frame),
          selectedKeyframeId: frame.id,
        },
      }
    }),

  /**
   * Selecting a keyframe also parks the playhead on it, so the viewport switches
   * to that frame's state — which is the whole point of clicking one.
   */
  /**
   * 从此处重绘 — scoped to **one object**: the one whose keyframe was clicked.
   *
   * Every frame from that point on is marked as being on a redraw chain (drawn
   * white) and rewritten to hold this frame's pose. Frames that do not exist are
   * not invented ("关键帧 4 如果有"). It also sets the chain anchor, so that from
   * here on, stepping forward carries the state of the frame you just edited into
   * the next one.
   *
   * Explicit by design: you decide when a change is a new baseline and when it is
   * a one-off.
   */
  redrawFrom: (objectId, time) =>
    set((state) => {
      const object = state.objects.find((entry) => entry.id === objectId)
      if (!object || object.keyframes.length === 0) return {}
      const pose = sampleObjectPose(object.keyframes, time)
      const source = findKeyframeAt(object.keyframes, time)
      if (!pose || !source) return {}

      const keyframes = object.keyframes.map((frame) =>
        frame.time >= time - KEYFRAME_EPSILON
          ? { ...frame, chained: true, pose: frame.id === source.id ? frame.pose : pose }
          : frame,
      )
      return {
        objects: state.objects.map((entry) =>
          entry.id === objectId ? { ...entry, keyframes } : entry,
        ),
        timeline: {
          ...state.timeline,
          redrawAnchor: { objectId, keyframeId: source.id },
        },
      }
    }),

  /**
   * Selecting a keyframe parks the playhead on it, so the viewport switches to
   * that frame's state. Arriving on a chained frame also carries the state of the
   * frame just edited forward — that is the "每改完一帧，切到下一帧就刷新" rule.
   */
  selectKeyframe: (id) =>
    set((state) => {
      if (!id) return { timeline: { ...state.timeline, selectedKeyframeId: null } }
      const objectFrame = state.objects
        .flatMap((object) => object.keyframes)
        .find((frame) => frame.id === id)
      const cameraFrame = state.timeline.cameraKeyframes.find((frame) => frame.id === id)
      const frame = objectFrame ?? cameraFrame
      const carried = objectFrame ? carryChain(state, objectFrame.id) : null
      // A keyframe belongs to an object, so selecting it selects that object too
      // — the panel then edits the frame you actually clicked.
      const owner = objectFrame
        ? state.objects.find((entry) =>
            entry.keyframes.some((entryFrame) => entryFrame.id === objectFrame.id),
          )
        : null
      return {
        objects: carried ? carried.objects : state.objects,
        selectedObjectId: owner ? owner.id : state.selectedObjectId,
        timeline: {
          ...state.timeline,
          selectedKeyframeId: id,
          selectedClipId: null,
          currentTime: frame ? frame.time : state.timeline.currentTime,
          redrawAnchor: carried ? carried.anchor : state.timeline.redrawAnchor,
        },
        // Camera keyframes are edited in the 相机 tab; don't steal that tab away.
        ui: objectFrame ? { ...state.ui, inspectorTab: 'speed' } : state.ui,
      }
    }),

  exitRedraw: () =>
    set((state) => ({ timeline: { ...state.timeline, redrawAnchor: null } })),

  /** Step to the neighbouring frame of the selected object (transport ‹ ›). */
  stepKeyframe: (direction) =>
    set((state) => {
      const object =
        state.objects.find((entry) => entry.id === state.selectedObjectId) ?? state.objects[0]
      if (!object || object.keyframes.length === 0) return {}
      const time = state.timeline.currentTime
      const target =
        direction > 0
          ? object.keyframes.find((frame) => frame.time > time + KEYFRAME_EPSILON)
          : [...object.keyframes].reverse().find((frame) => frame.time < time - KEYFRAME_EPSILON)
      if (!target) return {}
      const carried = carryChain(state, target.id)
      return {
        objects: carried ? carried.objects : state.objects,
        timeline: {
          ...state.timeline,
          currentTime: target.time,
          selectedKeyframeId: target.id,
          redrawAnchor: carried ? carried.anchor : state.timeline.redrawAnchor,
        },
      }
    }),

  moveObjectKeyframe: (objectId, id, time) =>
    set((state) => ({
      objects: state.objects.map((entry) =>
        entry.id === objectId
          ? {
              ...entry,
              // A drag redefines the content duration; it is not a ramp.
              keyframes: resyncSpans(moveKeyframe(entry.keyframes, id, time)),
            }
          : entry,
      ),
    })),

  moveCameraKeyframe: (id, time) =>
    set((state) => ({
      timeline: {
        ...state.timeline,
        cameraKeyframes: moveKeyframe(state.timeline.cameraKeyframes, id, time),
      },
    })),

  removeObjectKeyframe: (objectId, id) =>
    set((state) => ({
      objects: state.objects.map((entry) =>
        entry.id === objectId ? { ...entry, keyframes: removeKeyframe(entry.keyframes, id) } : entry,
      ),
      timeline: {
        ...state.timeline,
        selectedKeyframeId: state.timeline.selectedKeyframeId === id ? null : state.timeline.selectedKeyframeId,
      },
    })),

  removeCameraKeyframe: (id) =>
    set((state) => ({
      timeline: {
        ...state.timeline,
        cameraKeyframes: removeKeyframe(state.timeline.cameraKeyframes, id),
        selectedKeyframeId: state.timeline.selectedKeyframeId === id ? null : state.timeline.selectedKeyframeId,
      },
    })),

  clearObjectKeyframes: (objectId) =>
    set((state) => ({
      objects: state.objects.map((entry) =>
        entry.id === objectId ? { ...entry, keyframes: [] } : entry,
      ),
    })),

  /**
   * Set a segment's ramp and re-lay the timeline from there: the segment's own
   * duration becomes `sourceSpan / mean(speed)`, and every later keyframe rides
   * along. This is the "自动计算时长并调节关键帧位置" half of 变速.
   */
  setObjectKeyframeSpeed: (objectId, id, speed) =>
    set((state) => ({
      objects: state.objects.map((entry) => {
        if (entry.id !== objectId) return entry
        const index = entry.keyframes.findIndex((frame) => frame.id === id)
        if (index < 0) return entry
        const keyframes = entry.keyframes.map((frame) =>
          frame.id === id ? { ...frame, speed } : frame,
        )
        return { ...entry, keyframes: relayoutFrom(keyframes, index) }
      }),
    })),

  setObjectKeyframeNodeCount: (objectId, id, count) => {
    const object = get().objects.find((entry) => entry.id === objectId)
    const frame = object?.keyframes.find((entry) => entry.id === id)
    if (!frame) return
    get().setObjectKeyframeSpeed(objectId, id, resampleSpeedCurve(frame.speed, count))
  },

  applyObjectKeyframeSpeedPreset: (objectId, id, presetId) => {
    const object = get().objects.find((entry) => entry.id === objectId)
    const frame = object?.keyframes.find((entry) => entry.id === id)
    if (!frame) return
    get().setObjectKeyframeSpeed(objectId, id, applySpeedPreset(frame.speed, presetId))
  },

  setCameraKeyframeSpeed: (id, speed) =>
    set((state) => ({
      timeline: {
        ...state.timeline,
        cameraKeyframes: state.timeline.cameraKeyframes.map((frame) =>
          frame.id === id ? { ...frame, speed } : frame,
        ),
      },
    })),

  setCameraKeyframeNodeCount: (id, count) => {
    const frame = get().timeline.cameraKeyframes.find((entry) => entry.id === id)
    if (!frame) return
    get().setCameraKeyframeSpeed(id, resampleSpeedCurve(frame.speed, count))
  },

  applyCameraKeyframeSpeedPreset: (id, presetId) => {
    const frame = get().timeline.cameraKeyframes.find((entry) => entry.id === id)
    if (!frame) return
    get().setCameraKeyframeSpeed(id, applySpeedPreset(frame.speed, presetId))
  },

  setLeftNav: (nav) => set((state) => ({ ui: { ...state.ui, leftNav: nav } })),

  setDeviceTab: (tab: DeviceTab) => set((state) => ({ ui: { ...state.ui, deviceTab: tab } })),

  setInspectorTab: (tab) => set((state) => ({ ui: { ...state.ui, inspectorTab: tab } })),

  toggleGrid: () => set((state) => ({ ui: { ...state.ui, showGrid: !state.ui.showGrid } })),

  toggleLidTool: () => set((state) => ({ ui: { ...state.ui, lidTool: !state.ui.lidTool } })),

  resetProject: () => {
    markClean()
    set({ past: [], future: [], ...createDefaultProject() })
  },

  /* ------------------------------------------------------------- project -- */

  setProjectName: (name) => set((state) => ({ project: { ...state.project, name } })),

  setProjectAspect: (aspect) => set((state) => ({ project: { ...state.project, aspect } })),

  /* ---------------------------------------------------- project as text -- */

  projectText: () => toProjectText(get()),

  applyProjectText: (text, sourcePath) => {
    const parsed = parseProjectText(text)
    if (parsed.errors.length > 0) return { errors: parsed.errors, warnings: [] }
    const { patch, warnings } = applyParsedProject(parsed, get())
    if (sourcePath !== undefined) {
      patch.project = { ...(patch.project ?? get().project), sourcePath }
    }
    // One edit, one undo step: applying a file is a single deliberate act.
    set({ ...patch, selectedObjectId: patch.objects?.[0]?.id ?? null, past: get().past, future: [] } as never)
    return { errors: [], warnings }
  },

  /* ------------------------------------------------------------- history -- */

  undo: () => {
    const state = get()
    const previous = state.past[state.past.length - 1]
    if (!previous) return
    restoring = true
    set({
      ...previous,
      // Coming back to an earlier edit means looking at it, not rolling on.
      timeline: { ...previous.timeline, playing: false },
      past: state.past.slice(0, -1),
      future: [snapshotOf(state), ...state.future].slice(0, HISTORY_LIMIT),
    } as never)
    restoring = false
  },

  redo: () => {
    const state = get()
    const next = state.future[0]
    if (!next) return
    restoring = true
    set({
      ...next,
      timeline: { ...next.timeline, playing: false },
      past: [...state.past, snapshotOf(state)].slice(-HISTORY_LIMIT),
      future: state.future.slice(1),
    } as never)
    restoring = false
  },

  /* ------------------------------------------------------------- preview -- */

  setPreviewOpen: (open) =>
    set((state) => ({
      ui: { ...state.ui, previewOpen: open },
      timeline: {
        ...state.timeline,
        // Opening plays the piece from the top; closing stops it.
        currentTime: open ? 0 : state.timeline.currentTime,
        playing: open,
      },
    })),
  }
})
