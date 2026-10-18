import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { evaluateFrame } from '../../lib/animation'
import { beginGesture, endGesture } from '../../lib/gesture'
import { useAssetInfoStore } from '../../store/assetInfoStore'
import { useEditorStore } from '../../store/editorStore'
import type { SceneObject, Vec3 } from '../../types'

/** The three rings, coloured like the corner axis gizmo. */
const AXES = [
  { id: 'x', index: 0, color: '#ff5f6d', rotation: [0, Math.PI / 2, 0] },
  { id: 'y', index: 1, color: '#2bb673', rotation: [-Math.PI / 2, 0, 0] },
  { id: 'z', index: 2, color: '#4c8dff', rotation: [0, 0, 0] },
] as const

type AxisId = (typeof AXES)[number]['id']

/** Built at radius 1 and scaled to the object, so one geometry serves everything. */
const RING_TUBE = 0.012
const ARROW_RADIUS = 0.055
const ARROW_HEIGHT = 0.16

/** True when `object` is (or sits inside) a rotation ring. */
export function isRotationGizmoPart(object: THREE.Object3D | null | undefined): boolean {
  for (let node = object; node; node = node.parent) {
    if (node.userData?.rotationGizmo) return true
  }
  return false
}

/**
 * Three rotation arrows around the selected object.
 *
 * The rings are object-aligned, so dragging the X ring writes straight to
 * `rotation.x` — the number in the inspector is exactly what the ring did, no
 * gimbal algebra in between. Dragging measures pointer travel along the ring's
 * own tangent (projected to screen), which is what makes the rotation follow the
 * hand instead of a fixed horizontal/vertical split.
 */
export function RotationGizmo({ object }: { object: SceneObject }) {
  const camera = useThree((state) => state.camera)
  const size = useThree((state) => state.size)
  const controls = useThree((state) => state.controls) as unknown as { enabled: boolean } | null
  const groupRef = useRef<THREE.Group>(null)
  const worldPerPixel = useRef(0.01)
  const [hovered, setHovered] = useState<AxisId | null>(null)

  const info = useAssetInfoStore((state) =>
    object.kind === 'model' ? state.info[object.assetId] : undefined,
  )

  /** Radius that just clears the object's bounding sphere. */
  const radius = useMemo(() => {
    if (info) {
      const [x, y, z] = info.fittedSize
      return Math.max(0.45, 0.5 * Math.hypot(x, y, z) * 1.15)
    }
    // A media plane is 1 wide and 1/aspect tall, so the rings wrap its corners.
    if (object.kind === 'media') {
      const aspect = object.screen?.sourceAspect ?? 16 / 9
      return Math.max(0.4, 0.5 * Math.hypot(1, 1 / Math.max(0.2, aspect)) * 1.2)
    }
    return 0.55
  }, [info, object.kind, object.screen?.sourceAspect])

  // Follow the object, including whatever the timeline is doing to it.
  useFrame(() => {
    const group = groupRef.current
    if (!group) return
    const state = useEditorStore.getState()
    const pose = evaluateFrame(state, state.timeline.currentTime).objects[object.id]
    const transform = pose?.transform ?? object.transform

    group.visible = state.timeline.currentTime >= object.appearAt - 1e-3

    group.position.set(transform.position[0], transform.position[1], transform.position[2])
    group.rotation.set(
      THREE.MathUtils.degToRad(transform.rotation[0]),
      THREE.MathUtils.degToRad(transform.rotation[1]),
      THREE.MathUtils.degToRad(transform.rotation[2]),
    )

    const depth = camera.position.distanceTo(group.position)
    const fov = (camera as THREE.PerspectiveCamera).fov
    worldPerPixel.current =
      (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2) * depth) / Math.max(1, size.height)
  })

  const beginRotate = (axis: (typeof AXES)[number], event: ThreeEvent<PointerEvent>) => {
    if (object.locked) return
    event.stopPropagation()

    const group = groupRef.current
    if (!group) return

    const center = group.position.clone()
    const axisWorld = new THREE.Vector3()
      .set(axis.index === 0 ? 1 : 0, axis.index === 1 ? 1 : 0, axis.index === 2 ? 1 : 0)
      .applyQuaternion(group.quaternion)
      .normalize()

    // Positive rotation about `axisWorld` moves a point along axis × radius.
    const spoke = event.point.clone().sub(center)
    const tangent = new THREE.Vector3().crossVectors(axisWorld, spoke)
    if (tangent.lengthSq() < 1e-6) return
    tangent.normalize()

    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0)
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1)
    let tangentX = tangent.dot(right)
    let tangentY = -tangent.dot(up)

    // Use the tangent only as a *direction*. Its projected length collapses when
    // the ring is grabbed where its tangent points at the camera, and scaling by
    // that length would make those grab points feel dead (a 120px drag rotating
    // 8° instead of 30°). Direction-only keeps the gain even all the way round.
    const screenLength = Math.hypot(tangentX, tangentY)
    if (screenLength < 0.15) return
    tangentX /= screenLength
    tangentY /= screenLength

    const startX = event.clientX
    const startY = event.clientY
    const startRotation = [...object.transform.rotation] as Vec3
    const radiusPx = radius / Math.max(1e-6, worldPerPixel.current)

    beginGesture()
    if (controls) controls.enabled = false
    document.body.style.cursor = 'grabbing'

    const onMove = (move: PointerEvent) => {
      const travel = (move.clientX - startX) * tangentX + (move.clientY - startY) * tangentY
      const deltaDeg = (travel / radiusPx) * (180 / Math.PI)
      const rotation = [...startRotation] as Vec3
      rotation[axis.index] = startRotation[axis.index] + deltaDeg
      useEditorStore.getState().setObjectTransform(object.id, { rotation })
    }

    const onEnd = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onEnd)
      window.removeEventListener('pointercancel', onEnd)
      endGesture()
      document.body.style.cursor = 'auto'
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onEnd)
    window.addEventListener('pointercancel', onEnd)
  }

  if (!object.visible) return null

  return (
    <group ref={groupRef} name="editor:rotation-gizmo" scale={radius} renderOrder={999}>
      {AXES.map((axis) => {
        const active = hovered === axis.id
        return (
          <group
            key={axis.id}
            rotation={axis.rotation as unknown as THREE.Euler}
            userData={{ rotationGizmo: axis.id }}
            onPointerDown={(event) => beginRotate(axis, event)}
            onPointerOver={(event) => {
              event.stopPropagation()
              setHovered(axis.id)
              document.body.style.cursor = 'grab'
            }}
            onPointerOut={() => {
              setHovered((current) => (current === axis.id ? null : current))
              document.body.style.cursor = 'auto'
            }}
          >
            <mesh renderOrder={999}>
              <torusGeometry args={[1, RING_TUBE * (active ? 2.2 : 1), 8, 96]} />
              <meshBasicMaterial
                color={axis.color}
                transparent
                opacity={active ? 1 : 0.8}
                depthTest={false}
                depthWrite={false}
                toneMapped={false}
              />
            </mesh>
            <mesh position={[1, 0, 0]} renderOrder={999}>
              <coneGeometry
                args={[
                  ARROW_RADIUS * (active ? 1.35 : 1),
                  ARROW_HEIGHT * (active ? 1.35 : 1),
                  16,
                ]}
              />
              <meshBasicMaterial
                color={axis.color}
                transparent
                opacity={active ? 1 : 0.95}
                depthTest={false}
                depthWrite={false}
                toneMapped={false}
              />
            </mesh>
          </group>
        )
      })}
    </group>
  )
}
