import type {
  BackgroundSettings,
  CameraSettings,
  MaterialSettings,
  Vec3,
} from '../types'

/* ------------------------------------------------------------------ camera */

export interface CameraPreset {
  id: string
  name: string
  azimuth: number
  elevation: number
  distance: number
  target: Vec3
  fov: number
}

export const CAMERA_PRESETS: CameraPreset[] = [
  { id: 'hero', name: '主视角 3/4', azimuth: 38, elevation: 18, distance: 5.4, target: [0, 0.5, 0], fov: 30 },
  { id: 'front', name: '正面', azimuth: 0, elevation: 8, distance: 5.2, target: [0, 0.5, 0], fov: 30 },
  { id: 'side', name: '侧面', azimuth: 90, elevation: 6, distance: 5.2, target: [0, 0.45, 0], fov: 30 },
  { id: 'top', name: '俯视', azimuth: 20, elevation: 62, distance: 5.6, target: [0, 0.3, 0], fov: 32 },
  { id: 'low', name: '低角度', azimuth: 34, elevation: -6, distance: 5.0, target: [0, 0.55, 0], fov: 32 },
  { id: 'close', name: '特写', azimuth: 30, elevation: 12, distance: 3.2, target: [0, 0.5, 0], fov: 28 },
]

/**
 * The pinned viewport view.
 *
 * Dead ahead, a touch above the horizon: at exactly 0° a device resting on
 * y = 0 reads as an edge, and any azimuth at all would mean the screen axes
 * drift while objects are being placed.
 */
export const FRONT_VIEW = { azimuth: 0, elevation: 10 } as const

/** Framing presets for the pinned view — distance and lens, never an angle. */
export interface FramingPreset {
  id: string
  name: string
  distance: number
  fov: number
}

export const FRAMING_PRESETS: FramingPreset[] = [
  { id: 'standard', name: '标准', distance: 5.4, fov: 30 },
  { id: 'close', name: '特写', distance: 3.3, fov: 28 },
  { id: 'full', name: '全身', distance: 6.6, fov: 30 },
  { id: 'wide', name: '广角', distance: 5.0, fov: 45 },
]

/** The shot camera starts dead ahead: a product-ish default framing. */
export const DEFAULT_CAMERA: Omit<CameraSettings, 'revision'> = {
  azimuth: FRONT_VIEW.azimuth,
  elevation: FRONT_VIEW.elevation,
  distance: 5.4,
  target: [0, 0.5, 0],
  fov: 30,
}

/**
 * The editing viewport starts three-quarter view instead: the shot is frontal,
 * but you place objects faster when you can see three faces at once.
 */
export const DEFAULT_VIEW: Omit<CameraSettings, 'revision'> = {
  azimuth: 34,
  elevation: 20,
  distance: 5.8,
  target: [0, 0.5, 0],
  fov: 32,
}

/* -------------------------------------------------------------- background */

export interface BackgroundPreset {
  id: string
  name: string
  settings: Pick<BackgroundSettings, 'type' | 'color' | 'from' | 'to'>
}

export const BACKGROUND_PRESETS: BackgroundPreset[] = [
  {
    id: 'studio-dark',
    name: '暗夜工作室',
    settings: { type: 'gradient', color: '#0b0f16', from: '#1d2534', to: '#05070b' },
  },
  {
    id: 'mist',
    name: '雾光',
    settings: { type: 'gradient', color: '#e8ecf3', from: '#f7f9fc', to: '#c9d3e2' },
  },
  {
    id: 'sunset',
    name: '日落',
    settings: { type: 'gradient', color: '#2a1230', from: '#ff8a5c', to: '#3a1055' },
  },
  {
    id: 'mint',
    name: '薄荷',
    settings: { type: 'gradient', color: '#0d2b26', from: '#1f6f5c', to: '#061a1a' },
  },
  {
    id: 'slate',
    name: '纯色 · 石板',
    settings: { type: 'solid', color: '#171b22', from: '#171b22', to: '#171b22' },
  },
  {
    id: 'transparent',
    name: '透明 (可导出带通道)',
    settings: { type: 'transparent', color: '#000000', from: '#000000', to: '#000000' },
  },
]

/* ---------------------------------------------------------------- material */

export interface MaterialPreset {
  id: string
  name: string
  settings: Omit<MaterialSettings, 'enabled' | 'presetId'>
}

export const MATERIAL_PRESETS: MaterialPreset[] = [
  {
    id: 'original',
    name: '原模型材质',
    settings: { color: '#ffffff', metalness: 0.5, roughness: 0.5, envIntensity: 1, opacity: 1, wireframe: false },
  },
  {
    id: 'space-gray',
    name: '深空灰',
    settings: { color: '#3a3d42', metalness: 0.85, roughness: 0.32, envIntensity: 1.15, opacity: 1, wireframe: false },
  },
  {
    id: 'silver',
    name: '银',
    settings: { color: '#d8dade', metalness: 0.9, roughness: 0.26, envIntensity: 1.2, opacity: 1, wireframe: false },
  },
  {
    id: 'gold',
    name: '金',
    settings: { color: '#d9b06a', metalness: 0.95, roughness: 0.24, envIntensity: 1.3, opacity: 1, wireframe: false },
  },
  {
    id: 'midnight',
    name: '午夜蓝',
    settings: { color: '#1d2740', metalness: 0.8, roughness: 0.3, envIntensity: 1.1, opacity: 1, wireframe: false },
  },
  {
    id: 'ceramic',
    name: '陶瓷白',
    settings: { color: '#f2f3f5', metalness: 0.1, roughness: 0.45, envIntensity: 0.9, opacity: 1, wireframe: false },
  },
  {
    id: 'clay',
    name: '黏土预览',
    settings: { color: '#c8ccd4', metalness: 0, roughness: 0.95, envIntensity: 0.7, opacity: 1, wireframe: false },
  },
]

/* ---------------------------------------------------------------- colours */

/** Lane colours, handed out in order and reused when they run out. */
export const OBJECT_COLORS = [
  '#f5a524',
  '#4c8dff',
  '#2bb673',
  '#e879f9',
  '#22d3ee',
  '#fb7185',
  '#a3e635',
  '#f97316',
]

/** The least-used colour so far, so two objects rarely share one. */
export function nextObjectColor(objects: Array<{ color: string }>): string {
  const used = OBJECT_COLORS.map(
    (color) => objects.filter((object) => object.color === color).length,
  )
  let best = 0
  for (let index = 1; index < used.length; index += 1) {
    if (used[index] < used[best]) best = index
  }
  return OBJECT_COLORS[best]
}

/* --------------------------------------------------------------- animation */

/**
 * Motion presets are written as *keyframe pairs* now: each one stamps a pose at
 * the playhead and another one later, which is all a clip ever was.
 */
export interface MotionPreset {
  id: string
  name: string
  /** Which timeline it lands on. */
  target: 'object' | 'camera'
  /** Seconds between the two keyframes. */
  span: number
  description: string
  /** Pose delta applied to the object (position / rotation / scale). */
  offset?: { position?: Vec3; rotation?: Vec3; scale?: Vec3 }
  /** Camera delta, for camera presets. */
  camera?: { azimuth?: number; distance?: number; fov?: number }
}

export const MOTION_PRESETS: MotionPreset[] = [
  {
    id: 'spin-360',
    name: '自转 360°',
    target: 'object',
    span: 4,
    description: '两帧之间绕 Y 轴转一整圈',
    offset: { rotation: [0, 360, 0] },
  },
  {
    id: 'float-up',
    name: '浮起',
    target: 'object',
    span: 2.5,
    description: '升起再落下的一半',
    offset: { position: [0, 0.12, 0] },
  },
  {
    id: 'push-in',
    name: '推近',
    target: 'camera',
    span: 3.5,
    description: '摄像机拉近',
    camera: { distance: -2 },
  },
  {
    id: 'orbit-180',
    name: '半圈环绕',
    target: 'camera',
    span: 4,
    description: '摄像机绕主体半圈',
    camera: { azimuth: 180 },
  },
]
