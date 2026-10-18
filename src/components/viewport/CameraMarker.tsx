import { useFrame, useThree } from '@react-three/fiber'
import { useRef } from 'react'
import * as THREE from 'three'
import { resolveCamera } from '../../lib/animation'
import { translate, useLocaleStore } from '../../lib/i18n'
import { orbitToPosition } from '../../lib/cameraMath'
import { cameraHint } from '../../lib/hudBridge'
import { useEditorStore } from '../../store/editorStore'

/** On-screen height of the marker, in CSS pixels. Constant by construction. */
const MARKER_PIXELS = 52

const BODY = '#dde5f2'
const LENS = '#4c8dff'
const TRIM = '#98a6c0'

/**
 * A camera icon standing at the shot camera's position, drawn at a fixed screen
 * size.
 *
 * The size is held constant by scaling the group inversely to its depth every
 * frame — the marker cancels perspective instead of obeying it, so a camera 20
 * metres away is as easy to grab with the eyes as one 2 metres away. That is
 * also why it is unlit (`MeshBasicMaterial`), drawn without depth testing and
 * excluded from the shot: it is a piece of UI that happens to live in 3D.
 *
 * It follows the *animated* camera, so playing the timeline flies the marker
 * around the scene while the preview window shows what it sees.
 */
export function CameraMarker() {
  const groupRef = useRef<THREE.Group>(null)
  const camera = useThree((state) => state.camera)
  const size = useThree((state) => state.size)
  const mode = useEditorStore((state) => state.ui.viewportCamera)
  const targetRef = useRef(new THREE.Vector3())
  const projected = useRef(new THREE.Vector3())
  const viewSpace = useRef(new THREE.Vector3())

  useFrame(() => {
    const group = groupRef.current
    if (!group) return

    const state = useEditorStore.getState()
    const shot = resolveCamera(state, state.timeline.currentTime)
    const target = targetRef.current.set(shot.target[0], shot.target[1], shot.target[2])

    orbitToPosition(shot.azimuth, shot.elevation, shot.distance, target, group.position)
    // A plain group points its +Z at the target, and the icon is built looking
    // down +Z, so this aims the lens where the camera looks.
    group.lookAt(target)

    const depth = camera.position.distanceTo(group.position)
    const fov = (camera as THREE.PerspectiveCamera).fov
    const worldPerPixel =
      (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2) * depth) / Math.max(1, size.height)
    group.scale.setScalar(worldPerPixel * MARKER_PIXELS)

    updateHint(group.position, depth)
  })

  /**
   * Keep the DOM chip pointing at the marker, pinned to the nearest screen edge
   * when the marker is outside the frame.
   *
   * Without it the feature is invisible half the time: the shot camera usually
   * sits behind the artist's shoulder, so the icon is off-screen exactly when
   * they would want to know where it is.
   */
  const updateHint = (position: THREE.Vector3, depth: number) => {
    const el = cameraHint.el
    if (!el) return

    // Two separate scratches on purpose: sharing one vector made `view.z` read
    // back the *NDC* depth, so every chip looked like it was behind the camera
    // and flipped to the wrong edge.
    const view = viewSpace.current.copy(position).applyMatrix4(camera.matrixWorldInverse)
    const ndc = projected.current.copy(position).project(camera)
    const x = (ndc.x * 0.5 + 0.5) * size.width
    const y = (-ndc.y * 0.5 + 0.5) * size.height

    const inset = 54
    const onScreen =
      view.z < -0.1 &&
      x > inset &&
      x < size.width - inset &&
      y > inset &&
      y < size.height - inset

    if (onScreen) {
      el.style.opacity = '0'
      el.style.pointerEvents = 'none'
      return
    }

    const centreX = size.width / 2
    const centreY = size.height / 2
    let dx = x - centreX
    let dy = y - centreY
    // Behind the viewer the projection flips; point the chip the other way.
    if (view.z > -0.1) {
      dx = -dx
      dy = -dy
    }
    if (Math.abs(dx) < 1e-3 && Math.abs(dy) < 1e-3) dy = -1

    const angle = Math.atan2(dy, dx)
    const limitX = centreX - inset
    const limitY = centreY - inset
    const clamp = Math.min(limitX / Math.abs(dx || 1e-6), limitY / Math.abs(dy || 1e-6), 1)

    el.style.opacity = '1'
    el.style.pointerEvents = 'auto'
    el.style.transform = `translate(${(centreX + dx * clamp).toFixed(1)}px, ${(centreY + dy * clamp).toFixed(1)}px) translate(-50%, -50%)`
    const arrow = el.querySelector<HTMLElement>('.viewport__camera-hint-arrow')
    if (arrow) arrow.style.transform = `rotate(${angle}rad)`
    const label = el.querySelector<HTMLElement>('.viewport__camera-hint-label')
    const cameraText = translate(useLocaleStore.getState().locale, '摄像机')
    if (label && label.textContent !== `${cameraText} ${depth.toFixed(1)}`) {
      label.textContent = `${cameraText} ${depth.toFixed(1)}`
    }
  }

  // Looking through the camera means standing inside this marker.
  if (mode === 'scene') return null

  return (
    <group
      ref={groupRef}
      name="editor:camera-marker"
      renderOrder={1000}
      /**
       * The chip that points at this marker is hidden while the marker itself is
       * on screen — so the marker has to *be* the affordance: clicking it looks
       * through the shot camera. Without this, a camera in frame meant no way in.
       */
      onClick={(event) => {
        event.stopPropagation()
        useEditorStore.getState().setViewportCamera('scene')
      }}
      onPointerOver={(event) => {
        event.stopPropagation()
        document.body.style.cursor = 'pointer'
      }}
      onPointerOut={() => {
        document.body.style.cursor = 'auto'
      }}
    >
      <mesh>
        <boxGeometry args={[0.62, 0.46, 0.5]} />
        <meshBasicMaterial color={BODY} depthTest={false} depthWrite={false} toneMapped={false} />
      </mesh>

      {/* viewfinder bump */}
      <mesh position={[0, 0.3, -0.06]}>
        <boxGeometry args={[0.22, 0.16, 0.24]} />
        <meshBasicMaterial color={TRIM} depthTest={false} depthWrite={false} toneMapped={false} />
      </mesh>

      {/* lens barrel, then the glass */}
      <mesh position={[0, 0, 0.38]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.19, 0.22, 0.26, 24]} />
        <meshBasicMaterial color={TRIM} depthTest={false} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0, 0.54]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.16, 0.16, 0.06, 24]} />
        <meshBasicMaterial color={LENS} depthTest={false} depthWrite={false} toneMapped={false} />
      </mesh>

      {/* a short nose cone so the direction reads at a glance */}
      <mesh position={[0, 0, 0.72]} rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.13, 0.22, 20, 1, true]} />
        <meshBasicMaterial
          color={LENS}
          transparent
          opacity={0.45}
          depthTest={false}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  )
}
