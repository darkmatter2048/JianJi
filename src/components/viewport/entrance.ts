import * as THREE from 'three'
import type { EntranceAnimation } from '../../types'

/**
 * 出场（入场）动画：对象在 `appearAt` 之后按动效进入画面。
 *
 * 返回叠加在关键帧姿态上的偏移量：
 * - `position` / `rotation` 是加在姿态上的偏移（rotation 单位是度）；
 * - `scale` / `opacity` 是乘在姿态上的系数。
 */

export interface EntranceEffect {
  position: [number, number, number]
  rotation: [number, number, number]
  scale: number
  opacity: number
}

const IDENTITY: EntranceEffect = { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, opacity: 1 }

/** 滑动进入的距离（世界单位）与旋转进入的角度。 */
const SLIDE_DISTANCE = 1.5
const ROTATE_ANGLE = 360

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function easeOutCubic(p: number): number {
  return 1 - Math.pow(1 - p, 3)
}

function easeOutBack(p: number): number {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2)
}

/** 出场动画进行到哪一步（0 尚未开始，1 已完成）。 */
export function entranceProgress(
  entrance: EntranceAnimation | undefined,
  appearAt: number,
  time: number,
): number {
  if (!entrance || entrance.type === 'none') return 1
  const duration = Math.max(0.001, entrance.duration || 0.6)
  const start = appearAt + (entrance.delay || 0)
  return clamp01((time - start) / duration)
}

/** 对象自身局部 +X 轴（它的一条边）在世界空间里的朝向。 */
export function localEdgeDirection(rotation: [number, number, number]): [number, number, number] {
  return localAxisDirection(rotation, [1, 0, 0])
}

/** 对象自身局部 +Z 轴（它所在平面的法线）在世界空间里的朝向。 */
export function localNormalDirection(rotation: [number, number, number]): [number, number, number] {
  return localAxisDirection(rotation, [0, 0, 1])
}

function localAxisDirection(
  rotation: [number, number, number],
  axis: [number, number, number],
): [number, number, number] {
  const euler = new THREE.Euler(
    THREE.MathUtils.degToRad(rotation[0]),
    THREE.MathUtils.degToRad(rotation[1]),
    THREE.MathUtils.degToRad(rotation[2]),
    'XYZ',
  )
  const dir = new THREE.Vector3(axis[0], axis[1], axis[2]).applyEuler(euler)
  return [dir.x, dir.y, dir.z]
}

export function entranceEffect(
  entrance: EntranceAnimation | undefined,
  appearAt: number,
  time: number,
  rotation: [number, number, number] = [0, 0, 0],
): EntranceEffect {
  if (!entrance || entrance.type === 'none') return IDENTITY
  const p = entranceProgress(entrance, appearAt, time)
  if (p >= 1) return IDENTITY

  const e = entrance.type === 'bounce' ? easeOutBack(p) : easeOutCubic(p)
  const inv = 1 - e

  switch (entrance.type) {
    case 'fade':
      return { ...IDENTITY, opacity: e }
    case 'slide-up':
      return { ...IDENTITY, position: [0, -inv * SLIDE_DISTANCE, 0] }
    case 'slide-down':
      return { ...IDENTITY, position: [0, inv * SLIDE_DISTANCE, 0] }
    case 'slide-left':
      return { ...IDENTITY, position: [inv * SLIDE_DISTANCE, 0, 0] }
    case 'slide-right':
      return { ...IDENTITY, position: [-inv * SLIDE_DISTANCE, 0, 0] }
    case 'reveal':
      // 揭示效果是裁剪（clip plane）而不是位移，由 useObjectTransform 单独处理。
      return IDENTITY
    case 'scale':
      return { ...IDENTITY, scale: e }
    case 'rotate':
      return { ...IDENTITY, rotation: [0, -inv * ROTATE_ANGLE, 0] }
    case 'sling': {
      // 从垂直于对象所在平面的方向甩入：沿对象自身法线（局部 +Z）飞进，
      // 快速飞入 → 右下角带惯性甩出一道弧线 → 一下贴平。
      const e = easeOutCubic(p)
      const swingP = Math.min(p / 0.75, 1)
      const arc = Math.sin(Math.PI * swingP)
      const normal = localNormalDirection(rotation)
      return {
        ...IDENTITY,
        position: [
          normal[0] * 2.2 * (1 - e),
          normal[1] * 2.2 * (1 - e),
          normal[2] * 2.2 * (1 - e),
        ],
        rotation: [-18 * arc, 12 * arc, -30 * arc],
        scale: 0.92 + 0.08 * e,
      }
    }
    case 'bounce':
      return { ...IDENTITY, scale: Math.max(0.001, e) }
    default:
      return IDENTITY
  }
}

/* ----------------------------------------------------------- reveal clip -- */

/** 揭示（从对象边缘向外展开）的已缓动进度 0..1。 */
export function revealAmount(
  entrance: EntranceAnimation | undefined,
  appearAt: number,
  time: number,
): number {
  return easeOutCubic(entranceProgress(entrance, appearAt, time))
}

/** 给对象的所有材质设/清一个裁剪平面（用于"揭示"效果）。 */
export function setObjectClipPlane(root: THREE.Object3D, plane: THREE.Plane | null): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (!(mesh as THREE.Mesh).isMesh) return
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const material of materials) {
      const standard = material as THREE.Material & { clippingPlanes?: THREE.Plane[] | null }
      if ('clippingPlanes' in standard) {
        standard.clippingPlanes = plane ? [plane] : []
        standard.needsUpdate = true
      }
    }
  })
}

/** 对象在其局部 +X 轴方向上的半宽度（世界单位），用于揭示的扫过范围。 */
export function halfExtentAlong(root: THREE.Object3D, direction: [number, number, number]): number {
  const box = new THREE.Box3().setFromObject(root)
  const size = box.getSize(new THREE.Vector3())
  return (
    (size.x * Math.abs(direction[0]) + size.y * Math.abs(direction[1]) + size.z * Math.abs(direction[2])) /
    2
  )
}
