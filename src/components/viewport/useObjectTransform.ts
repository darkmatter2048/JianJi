import { useFrame } from '@react-three/fiber'
import type { RefObject } from 'react'
import * as THREE from 'three'
import { evaluateFrame } from '../../lib/animation'
import { objectVisibilityAt } from '../../lib/keyframes'
import { useEditorStore } from '../../store/editorStore'
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
    // Text is the exception: troika ignores a material's `opacity` and the
    // component owns `fillOpacity`, so a text fade travels through its props
    // (see `TextObject`).
    if (live.kind !== 'text') applyFade(group, group.visible ? visibility.opacity : 0)

    group.position.set(transform.position[0], transform.position[1], transform.position[2])
    group.rotation.set(
      THREE.MathUtils.degToRad(transform.rotation[0]),
      THREE.MathUtils.degToRad(transform.rotation[1]),
      THREE.MathUtils.degToRad(transform.rotation[2]),
    )
    group.scale.set(transform.scale[0], transform.scale[1], transform.scale[2])
  })
}
