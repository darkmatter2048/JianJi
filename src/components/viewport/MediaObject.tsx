import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { lastFinishedClip, resolveActiveClip, resolveScreenState } from '../../lib/keyframes'
import { useEditorStore } from '../../store/editorStore'
import type { SceneObject } from '../../types'
import { isRotationGizmoPart } from './RotationGizmo'
import { createScreenRuntime, type ScreenRuntime } from './screenTexture'
import { shouldHandlePointerDown, useObjectDrag } from './useObjectDrag'
import { useObjectTransform } from './useObjectTransform'

/**
 * An image or a clip standing in the scene as a plane.
 *
 * It is deliberately built out of the *screen* pipeline: the same canvas texture,
 * the same cover/contain maths, the same clip-driven video playback. A media
 * object is, in effect, a display with nothing behind it — which is why it takes
 * keyframes, video clips and trims without any of it being special-cased.
 */
export function MediaObject({ object }: { object: SceneObject }) {
  const groupRef = useRef<THREE.Group>(null)
  const meshRef = useRef<THREE.Mesh>(null)
  const draggingRef = useRef(false)
  const dragCleanup = useRef<(() => void) | null>(null)
  const runtimeRef = useRef<ScreenRuntime | null>(null)
  const beginMoveDrag = useObjectDrag(object, draggingRef, dragCleanup)
  const selectObject = useEditorStore((state) => state.selectObject)

  /** The texture at this instant, from the object's own timeline. */
  const screen = useEditorStore((state) => {
    const live = state.objects.find((entry) => entry.id === object.id) ?? object
    return resolveScreenState(live.keyframes, state.timeline.currentTime, live.screen)
  })
  const aspect =
    screen && screen.sourceAspect > 0.05 ? screen.sourceAspect : 16 / 9

  useObjectTransform(groupRef, object)

  useEffect(() => () => dragCleanup.current?.(), [])

  /* ------------------------------------------------------------- texture -- */

  useEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    const material = mesh.material as THREE.MeshStandardMaterial
    if (!screen?.enabled || !screen.src) {
      mesh.visible = false
      return
    }
    mesh.visible = true
    const runtime = createScreenRuntime(screen, aspect, (message) =>
      console.warn(`UAE2 media (${object.name}): ${message}`),
    )
    runtimeRef.current = runtime
    material.map = runtime.texture
    material.emissiveMap = runtime.texture
    material.emissive.setRGB(1, 1, 1)
    material.emissiveIntensity = screen.brightness
    material.color.setRGB(1, 1, 1)
    material.needsUpdate = true

    return () => {
      runtimeRef.current = null
      runtime.dispose()
    }
    // `brightness` is a uniform, not a new decode, so it is left out on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    aspect,
    object.name,
    screen?.enabled,
    screen?.src,
    screen?.source,
    screen?.fit,
    screen?.rotation,
    screen?.loop,
    screen?.muted,
    screen?.rate,
  ])

  /* ------------------------------------------------------------ playback -- */

  useFrame(() => {
    const mesh = meshRef.current
    const runtime = runtimeRef.current
    if (!mesh || !runtime) return
    const state = useEditorStore.getState()
    const live = state.objects.find((entry) => entry.id === object.id) ?? object
    const material = mesh.material as THREE.MeshStandardMaterial
    if (live.screen) material.emissiveIntensity = live.screen.brightness

    const rate = live.screen?.rate ?? 1
    const active = resolveActiveClip(live.screenClips, state.timeline.currentTime)
    if (active) {
      runtime.syncVideo(active.sourceTime, active.rate * rate, state.timeline.playing)
      return
    }
    // Nothing is running: freeze on the clip that just finished (or wait on the
    // first frame), never roll on.
    const previous = lastFinishedClip(live.screenClips, state.timeline.currentTime)
    runtime.syncVideo(previous ? previous.outPoint : 0, 1, false)
  })

  return (
    <group
      ref={groupRef}
      name={object.id}
      visible={object.visible}
      onPointerDown={(event: ThreeEvent<PointerEvent>) => {
        if (!shouldHandlePointerDown(object, event)) return
        event.stopPropagation()
        selectObject(object.id)
        if (event.button !== 0) return
        if (event.intersections.some((hit) => isRotationGizmoPart(hit.object))) return
        beginMoveDrag(event)
      }}
      onPointerMove={(event) => {
        if (draggingRef.current) return
        event.stopPropagation()
        document.body.style.cursor = 'pointer'
      }}
      onPointerOut={() => {
        if (draggingRef.current) return
        document.body.style.cursor = 'auto'
      }}
    >
      <mesh ref={meshRef}>
        <planeGeometry args={[1, 1 / aspect]} />
        <meshStandardMaterial
          roughness={0.42}
          metalness={0}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </mesh>
    </group>
  )
}
