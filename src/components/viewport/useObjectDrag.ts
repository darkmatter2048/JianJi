import { useThree, type ThreeEvent } from '@react-three/fiber'
import { useCallback, type MutableRefObject } from 'react'
import * as THREE from 'three'
import { beginGesture, endGesture } from '../../lib/gesture'
import { objectVisibilityAt } from '../../lib/keyframes'
import { useEditorStore } from '../../store/editorStore'
import type { SceneObject, Vec3 } from '../../types'

/**
 * Drag a scene object across the screen plane.
 *
 * Shared by every object kind — device, text, media plane — so they all answer
 * the pointer the same way, which is the whole point of calling them all "3D
 * objects". The delta is projected onto the camera's right/up vectors at the
 * object's depth, so the object tracks the pointer no matter which way the
 * viewport is turned, and the numbers that land in the inspector are plain world
 * units. A 3px threshold keeps a plain click a click.
 */
export function useObjectDrag(
  object: SceneObject,
  draggingRef: MutableRefObject<boolean>,
  dragCleanup: MutableRefObject<(() => void) | null>,
): (event: ThreeEvent<PointerEvent>) => void {
  const camera = useThree((state) => state.camera)
  const controls = useThree((state) => state.controls) as unknown as { enabled: boolean } | null
  const viewportSize = useThree((state) => state.size)

  return useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      const startX = event.clientX
      const startY = event.clientY
      const origin = new THREE.Vector3(...object.transform.position)
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0)
      const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1)
      const depth = camera.position.distanceTo(origin)
      const perspective = camera as THREE.PerspectiveCamera
      const perPixel =
        (2 * Math.tan(THREE.MathUtils.degToRad(perspective.fov) / 2) * depth) /
        Math.max(1, viewportSize.height)

      let moved = false
      beginGesture()
      if (controls) controls.enabled = false

      const onMove = (move: PointerEvent) => {
        const dx = move.clientX - startX
        const dy = move.clientY - startY
        if (!moved) {
          if (Math.hypot(dx, dy) < 3) return
          moved = true
          document.body.style.cursor = 'grabbing'
          draggingRef.current = true
        }
        const next = origin
          .clone()
          .addScaledVector(right, dx * perPixel)
          .addScaledVector(up, -dy * perPixel)
        const position = [next.x, next.y, next.z].map(
          (value) => Math.round(value * 1000) / 1000,
        ) as Vec3
        useEditorStore.getState().setObjectTransform(object.id, { position })
      }

      const onEnd = () => {
        draggingRef.current = false
        dragCleanup.current = null
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onEnd)
        window.removeEventListener('pointercancel', onEnd)
        endGesture()
        document.body.style.cursor = 'auto'
      }

      dragCleanup.current = onEnd
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onEnd)
      window.addEventListener('pointercancel', onEnd)
    },
    [camera, controls, dragCleanup, draggingRef, object.id, object.transform.position, viewportSize.height],
  )
}

/**
 * 这次 pointer-down 该不该由 `object` 处理。
 *
 * 两个规则：
 * 1. 对象此刻必须**实际可见**——three.js 的射线不检查可见性，隐藏对象的网格
 *    仍会被命中，导致"那一帧明明隐藏了还拖得动"；
 * 2. 若选中的是**另一个**对象、而且它也在同一条射线上（被当前对象挡住），则让
 *    位给选中的对象——实现"选中哪个拖动的是哪个"。
 */
export function shouldHandlePointerDown(object: SceneObject, event: ThreeEvent<PointerEvent>): boolean {
  const state = useEditorStore.getState()
  if (!object.visible) return false
  const visibility = objectVisibilityAt(object.keyframes, state.timeline.currentTime)
  if (visibility.hidden) return false
  if (state.timeline.currentTime < object.appearAt - 1e-3) return false

  const selectedId = state.selectedObjectId
  if (selectedId && selectedId !== object.id) {
    const selectedAlsoHit = event.intersections.some(
      (hit) => (hit.eventObject as THREE.Object3D | undefined)?.name === selectedId,
    )
    if (selectedAlsoHit) return false
  }
  return true
}
