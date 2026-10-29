import { useFrame } from '@react-three/fiber'
import { useRef, type RefObject } from 'react'
import * as THREE from 'three'
import { evaluateFrame } from '../../lib/animation'
import { objectVisibilityAt } from '../../lib/keyframes'
import { useEditorStore } from '../../store/editorStore'
import {
  entranceEffect,
  halfExtentAlong,
  localEdgeDirection,
  revealAmount,
  setObjectClipPlane,
} from './entrance'
import { applyFade } from './materials'
import type { SceneObject } from '../../types'

/**
 * Writes an object's pose at the current instant straight onto a group, once
 * per frame.
 *
 * Kept imperative on purpose: a playing timeline must not re-render React, so
 * the store is read with `getState()` instead of through a subscription.
 */
export function useObjectTransform(
  ref: RefObject<THREE.Group | null>,
  object: SceneObject,
): void {
  const revealPlaneRef = useRef<THREE.Plane | null>(null)
  const revealHalfRef = useRef(0)
  const revealAppliedRef = useRef(false)

  useFrame(() => {
    const group = ref.current
    if (!group) return

    const state = useEditorStore.getState()
    // Read the object back out of the store: props can be a frame behind.
    const live = state.objects.find((entry) => entry.id === object.id) ?? object
    // A keyed object reports an absolute pose; an unkeyed one keeps its own
    // transform, so it sits still until the artist keys it.
    const pose = evaluateFrame(state, state.timeline.currentTime).objects[object.id]
    const transform = pose?.transform ?? live.transform

    // `visible` is the object's master switch; 显隐 is the frame's own — a hidden
    // frame is how something disappears and comes back, and a fade is the same
    // change spread across the segment that carries it.
    const visibility = objectVisibilityAt(live.keyframes, state.timeline.currentTime)
    group.visible =
      live.visible && !visibility.hidden && state.timeline.currentTime >= live.appearAt - 1e-3
    // 出场动画：叠加在姿态上的位移/旋转/缩放/透明度。传入旋转，供「甩入」沿法线方向飞进。
    const entrance = entranceEffect(
      live.entrance,
      live.appearAt,
      state.timeline.currentTime,
      transform.rotation,
    )
    // Text is the exception: troika ignores a material's `opacity` and the
    // component owns `fillOpacity`, so a text fade travels through its props
    // (see `TextObject`).
    if (live.kind !== 'text') {
      applyFade(group, group.visible ? visibility.opacity * entrance.opacity : 0)
    }

    group.position.set(
      transform.position[0] + entrance.position[0],
      transform.position[1] + entrance.position[1],
      transform.position[2] + entrance.position[2],
    )
    group.rotation.set(
      THREE.MathUtils.degToRad(transform.rotation[0] + entrance.rotation[0]),
      THREE.MathUtils.degToRad(transform.rotation[1] + entrance.rotation[1]),
      THREE.MathUtils.degToRad(transform.rotation[2] + entrance.rotation[2]),
    )
    group.scale.set(
      transform.scale[0] * entrance.scale,
      transform.scale[1] * entrance.scale,
      transform.scale[2] * entrance.scale,
    )

    // 揭示（从对象边缘向外展开）：一个裁剪平面沿对象局部 +X 轴扫过，逐帧更新。
    const revealActive =
      live.entrance?.type === 'reveal' && revealAmount(live.entrance, live.appearAt, state.timeline.currentTime) < 1
    if (revealActive) {
      if (!revealPlaneRef.current) revealPlaneRef.current = new THREE.Plane()
      const plane = revealPlaneRef.current
      const direction = localEdgeDirection(transform.rotation)
      if (!revealAppliedRef.current) {
        revealHalfRef.current = halfExtentAlong(group, direction)
      }
      const half = Math.max(0.01, revealHalfRef.current)
      const center = new THREE.Vector3(...transform.position)
      const dot = direction[0] * center.x + direction[1] * center.y + direction[2] * center.z
      const amount = revealAmount(live.entrance, live.appearAt, state.timeline.currentTime)
      // 裁剪掉 `dot(dir, P) > 常数` 的一侧，常数从左边扫到右边。
      plane.setComponents(-direction[0], -direction[1], -direction[2], dot - half + amount * 2 * half)
      setObjectClipPlane(group, plane)
      revealAppliedRef.current = true
    } else if (revealAppliedRef.current) {
      setObjectClipPlane(group, null)
      revealAppliedRef.current = false
    }
  })
}
