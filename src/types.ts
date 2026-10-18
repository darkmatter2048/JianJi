/**
 * UAE2 Studio — core domain types.
 *
 * The editor is modelled as three cooperating slices:
 *  - a scene graph (`SceneObject[]`) that the viewport renders,
 *  - camera + environment settings that describe *how* it is filmed,
 *  - a timeline (`Track[]` + `Clip[]`) that animates the first two over time.
 *
 * Everything in the timeline is evaluated *analytically* from the current
 * time (see `lib/animation.ts`), so scrubbing to any moment always produces
 * the same frame. Clips never accumulate state between frames.
 */

export type Vec3 = [number, number, number]

/** Object families the viewport knows how to render. */
/**
 * `model` is an imported glTF (the laptop), `text` is 3D type, and `media` is an
 * image or a clip standing in the scene as a plane — all three are the same kind
 * of citizen: selectable, draggable, keyframed.
 */
export type ObjectKind = 'model' | 'light' | 'text' | 'media'

export interface Transform {
  /** World-space offset. */
  position: Vec3
  /** Euler angles in degrees (UI-friendly). */
  rotation: Vec3
  scale: Vec3
}

/** Per-object material override. `enabled: false` means "keep the asset's own materials". */
export interface MaterialSettings {
  enabled: boolean
  presetId: string
  color: string
  metalness: number
  roughness: number
  envIntensity: number
  opacity: number
  wireframe: boolean
}

/**
 * A laptop-style lid: one rotational degree of freedom, driven either by
 * dragging the lid in the viewport or by the inspector. `null` on objects
 * whose asset declares no hinge.
 */
export interface LidSettings {
  /** Hinge angle in degrees; 0 = closed. */
  openDeg: number
  /** Physical limit of the hinge, used as the drag clamp. */
  maxDeg: number
  /** Angle the "open" snap (and the tool's double-click) goes to. */
  fullDeg: number
}

export interface SceneObject {
  id: string
  name: string
  kind: ObjectKind
  /** Key into the asset registry (`lib/assets.ts`); empty for synthesised objects. */
  assetId: string
  transform: Transform
  visible: boolean
  locked: boolean
  material: MaterialSettings
  /** Present only when the asset exposes a rotatable lid (see `lib/assets.ts`). */
  lid: LidSettings | null
  /** Present only when the asset exposes a texturable display (see `lib/assets.ts`). */
  screen: ScreenSettings | null
  /** Present only on `kind: 'text'` objects. */
  text: TextSettings | null
  /** This object's lane colour: its keyframes and its name marker use it. */
  color: string
  /** The video row: one clip per stretch of video shown on this screen. */
  screenClips: ScreenClip[]
  /** This object's own timeline. Empty means "just use `transform`". */
  keyframes: ObjectKeyframe[]
  /**
   * When the object enters the shot, in absolute seconds. Adding an object while
   * the playhead sits at 2.5s means it is simply not there before 2.5s — it
   * exists from that keyframe onwards, not for the whole video.
   */
  appearAt: number
}

/* ---------------------------------------------------------------- screen -- */

export type ScreenSource = 'image' | 'video'

/**
 * How the source is mapped onto the panel.
 *
 * - `cover` (裁剪): scale up to fill, cropping the overflow.
 * - `contain` (适应): scale to fit, letterboxing the rest.
 * - `fill` (填充): stretch to fill, ignoring the source's aspect.
 * - `tile` (平铺): repeat at natural size.
 */
export type ScreenFit = 'cover' | 'contain' | 'fill' | 'tile'

/**
 * What plays on a device's display.
 *
 * The bytes never enter the store: `src` is either a `blob:` object URL
 * produced by the file picker or a data URL from a built-in preset. The
 * viewport redraws it into a canvas sized to the panel's aspect ratio, so
 * `fit` and `rotation` behave identically for stills and video.
 */
export interface ScreenSettings {
  enabled: boolean
  source: ScreenSource
  /** Object URL — either a `blob:` from the picker or a library asset's URL. */
  src: string | null
  /** Set when `src` comes from the media library (see `MediaAsset`). */
  mediaId: string | null
  fileName: string | null
  /** Length of the source in seconds, once we have probed it. 0 = unknown. */
  duration: number
  /** Width / height of the source; a media plane takes its shape from this. */
  sourceAspect: number
  fit: ScreenFit
  /** Emissive multiplier: a display is lit, not shaded. 0..3 */
  brightness: number
  /** Degrees, clockwise. Handy for portrait clips on a landscape panel. */
  rotation: number
  /* video only */
  loop: boolean
  muted: boolean
  /** Playback rate, 0.25..4. */
  rate: number
}

/* ------------------------------------------------------------------ text -- */

export type TextAlign = 'left' | 'center' | 'right'

export interface TextSettings {
  content: string
  /** Key into the font registry (`lib/fonts.ts`). */
  fontId: string
  /** Cap height in scene units. */
  size: number
  color: string
  /** 0..1 */
  opacity: number
  letterSpacing: number
  lineHeight: number
  align: TextAlign
  /** 0 = no wrapping. */
  maxWidth: number
  /** Keep the text facing the camera. */
  billboard: boolean
}

/** A font the user imported from disk (blob-backed), usable by 3D text. */
export interface FontAsset {
  id: string
  name: string
  /** blob: or data: URL of the font file. */
  url: string
  /** Best-effort: whether the face carries CJK glyphs. Custom fonts assume yes. */
  cjk: boolean
}

/* --------------------------------------------------------------- timeline --
 *
 * There is no global clip grid any more. Every object owns an *unbounded*
 * timeline of keyframes laid out at absolute seconds, and the composition ends
 * at the last keyframe of any object (`timelineEnd`).
 */

/** One control point of a speed ramp. `t` is the position inside the clip
 * (0..1), `v` the speed multiplier, and the handles are offsets from the node
 * in curve space — the same model an animation editor uses for a Bézier key. */
export interface SpeedNode {
  id: string
  t: number
  v: number
  inHandle: [number, number]
  outHandle: [number, number]
}

/** A speed ramp over one keyframe segment. */
export interface SpeedCurve {
  nodes: SpeedNode[]
  /** Top of the speed axis, i.e. the fastest the chart can express. */
  maxSpeed: number
}

/** A captured pose of a scene object. */
export type HideMode = 'cut' | 'fade'

export interface ObjectPose {
  transform: Transform
  /** Hinge angle at capture time; `null` for objects without a lid. */
  lidOpenDeg: number | null
  /**
   * What is on the screen at this frame. Steps — a texture swap is a cut, not a
   * dissolve — and `null` means "nothing keyed here".
   */
  screen: ScreenSettings | null
  /**
   * The scene as it stood when this frame was keyed: background, lighting,
   * shadow. 场景信息也属于关键帧 — the room can change over the piece just like
   * the picture on the screen can.
   */
  scene: SceneSettings | null
  /**
   * 隐藏：这一帧没有这个对象。Two frames that disagree are how 消失 / 出现 is
   * made. Absent means shown, so poses written before this existed keep working.
   */
  hidden?: boolean
  /**
   * 这一帧的显隐切换怎么发生：瞬间切（默认）还是渐隐 / 渐显。
   *
   * Like `speed`, the mode belongs to the frame being *arrived at* — the frame
   * that says "and now it is gone" is the one that decides how it goes. A fade
   * borrows the segment's own speed curve, so 变速 is also the easing.
   */
  hideMode?: HideMode
}

/**
 * A video clip on an object's screen.
 *
 * Videos do not belong to a keyframe the way an image does: they have their own
 * extent on the timeline, which is what makes trimming, copying and re-timing
 * them meaningful. So each video gets a clip, on its own row under the object.
 */
export interface ScreenClip {
  id: string
  /** Library asset when it came from the media library. */
  mediaId: string | null
  src: string
  name: string
  /** Where the clip sits on the composition timeline, in seconds. */
  start: number
  /** Trim: the slice of the source that plays, in seconds into it. */
  inPoint: number
  outPoint: number
  /** Bézier rate ramp across the clip. */
  speed: SpeedCurve
}

/** A captured pose of the shot camera. */
export interface CameraPose {
  azimuth: number
  elevation: number
  distance: number
  target: Vec3
  fov: number
}

export interface ObjectKeyframe {
  id: string
  /** Absolute seconds on this object's own, unbounded timeline. */
  time: number
  pose: ObjectPose
  /**
   * On a redraw chain (drawn white). 从此处重绘 marks the frame it was invoked on
   * and every later frame of that object; from then on, stepping forward carries
   * the state of the frame you just edited into the next one.
   */
  chained: boolean
  /**
   * Nominal, un-ramped duration (seconds) of the incoming segment. The time
   * actually spent is `sourceSpan / mean(speed)`, so ramping a segment up pulls
   * every later keyframe closer — and ramping twice cannot compound, because a
   * ramp never rewrites this number.
   */
  sourceSpan: number
  /**
   * Speed ramp of the segment that *ends* here — i.e. from the previous
   * keyframe to this one. x is the normalised playback position across the
   * segment, y the speed multiplier, so a dip in the middle plays that part of
   * the motion in slow motion.
   */
  speed: SpeedCurve
}

export interface CameraKeyframe {
  id: string
  time: number
  pose: CameraPose
  speed: SpeedCurve
}

export interface TimelineState {
  fps: number
  currentTime: number
  playing: boolean
  loop: boolean
  /** Horizontal scale of the ruler, in pixels per second. */
  zoom: number
  /** The camera's own timeline — it is an object like any other. */
  cameraKeyframes: CameraKeyframe[]
  selectedKeyframeId: string | null
  /** The video clip being edited, when one is. */
  selectedClipId: string | null
  /**
   * The frame a redraw chain currently hangs from: the last one edited on a
   * chain. Stepping forward from it copies its pose into the next chained frame.
   */
  redrawAnchor: { objectId: string; keyframeId: string } | null
}

/** Orbit-style camera: the viewport derives a position from these values. */
export interface CameraSettings {
  /** Degrees around the Y axis. */
  azimuth: number
  /** Degrees above the horizon. */
  elevation: number
  distance: number
  target: Vec3
  fov: number
  /** Bumped whenever the camera is set imperatively, so the rig re-applies it. */
  revision: number
}

export type BackgroundType = 'solid' | 'gradient' | 'transparent' | 'media'

/** How imported media is fitted into the frame it is used in (CSS object-fit). */
export type MediaFit = 'cover' | 'contain'

export type MediaKind = 'image' | 'video' | 'audio'

/**
 * A file the user imported into the project.
 *
 * `src` is always a `blob:` object URL owned by the store: it is revoked when
 * the asset is removed, and every reference to it is cleared at that moment.
 */
export interface MediaAsset {
  id: string
  name: string
  /**
   * Where the file sat inside the folder it was imported from, when that is known
   * (`assets/封面.png`). 代码里的 `media:` 路径就是相对工程文件的，所以记着它
   * 才能把"代码说的路径"和"库里的素材"对上，也让写回去的工程保持同一套路径。
   */
  relativePath?: string
  kind: MediaKind
  src: string
  /** Bytes, as reported by the `File`. */
  size: number
  /** Intrinsic pixel size; 0 for audio. */
  width: number
  height: number
  /** Seconds for video/audio; 0 for stills. */
  duration: number
  addedAt: number
}

export interface BackgroundSettings {
  type: BackgroundType
  color: string
  from: string
  to: string
  /** CSS gradient angle, in degrees. */
  angle: number
  /* --- `type: 'media'` only ------------------------------------------- */
  mediaId: string | null
  src: string | null
  source: 'image' | 'video'
  fit: MediaFit
  /** Dimming layer drawn over the media, 0..0.9 — keeps titles readable. */
  overlay: number
  /** Backdrop blur in px, 0..40. */
  blur: number
}

export interface SceneSettings {
  background: BackgroundSettings
  /** Multiplier on the generated studio environment. */
  envIntensity: number
  exposure: number
  shadow: {
    enabled: boolean
    opacity: number
    blur: number
  }
  /** Media asset used as the project's soundtrack. */
  soundtrackId: string | null
}

/**
 * The panel always looks at a frame: 对象 / 变速 / 场景. A selected video clip
 * narrows it further, to 变速 alone.
 */
export type InspectorTab = 'object' | 'scene' | 'speed'

/** Which camera the editing viewport looks through. */
export type ViewportCamera = 'free' | 'scene'

/** Top-level sections of the asset rail. */
export type LeftNav = 'resources' | 'devices' | 'text' | 'code'

/** The 设备 section's two pages. */
export type DeviceTab = 'library' | 'scene'

export interface UiState {
  leftNav: LeftNav
  deviceTab: DeviceTab
  inspectorTab: InspectorTab
  showGrid: boolean
  /** The player modal: the piece, full frame, with transport controls. */
  previewOpen: boolean
  /** While on, dragging the lid in the viewport opens/closes it instead of orbiting. */
  lidTool: boolean
  /**
   * `free` = the artist's own orbit state (`view`), `scene` = look through the
   * shot camera (`camera`), clips included. One click switches between them.
   */
  viewportCamera: ViewportCamera
}

/** The full editor state, minus actions. */
/** Width / height of the frame the piece is composed for. */
export type ProjectAspect = '16:9' | '9:16' | '1:1' | '4:5' | '21:9'

export const ASPECT_RATIO: Record<ProjectAspect, number> = {
  '16:9': 16 / 9,
  '9:16': 9 / 16,
  '1:1': 1,
  '4:5': 4 / 5,
  '21:9': 21 / 9,
}

export interface ProjectSettings {
  name: string
  /** The frame everything is composed and exported for. */
  aspect: ProjectAspect
  /**
   * Where the code file was read from, relative to the folder it was imported
   * with (`材料/工程.txt`). Its folder is the base every `media:` path in the file
   * is relative to — including the ones written back out.
   */
  sourcePath?: string
}

export interface EditorSnapshot {
  project: ProjectSettings
  objects: SceneObject[]
  /** The user's imported media library (images, video, audio). */
  media: MediaAsset[]
  /** The user's imported fonts (TTF/OTF/WOFF), usable by 3D text. */
  customFonts: FontAsset[]
  selectedObjectId: string | null
  /** One clip, copied and waiting to be pasted. */
  clipboard: ScreenClip | null
  /** The shot camera: what the preview window shows and an export renders. */
  camera: CameraSettings
  /** The editing viewport's own orbit state, so switching back restores it. */
  view: CameraSettings
  scene: SceneSettings
  timeline: TimelineState
  ui: UiState
}
