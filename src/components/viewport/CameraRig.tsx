import { OrbitControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef, type ComponentRef } from 'react'
import * as THREE from 'three'
import { resolveCamera } from '../../lib/animation'
import { applyCameraSettings, cameraSettingsFromOrbit } from '../../lib/cameraMath'
import { clamp } from '../../lib/format'
import { beginGesture, endGesture, isGestureActive } from '../../lib/gesture'
import { useEditorStore } from '../../store/editorStore'

/**
 * Owns the *editing* viewport camera.
 *
 * The shot camera (what the preview window and an export see) is a different
 * camera entirely, resolved in `lib/animation.ts`. Keeping them apart is what
 * lets a camera clip animate the shot without ever moving the axes the artist
 * is placing objects in.
 *
 * Two modes:
 *  - `free` — OrbitControls drive the viewport; every gesture is mirrored back
 *    into `store.view` so switching away and back restores the exact framing.
 *  - `scene` — the viewport looks through the shot camera, clips included.
 */
/** How far the view may be tilted by the drag that leaves the camera view. */
const MIN_ELEVATION = -20
const MAX_ELEVATION = 86

export function CameraRig() {
  const controlsRef = useRef<ComponentRef<typeof OrbitControls>>(null)
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera
  const gl = useThree((state) => state.gl)
  const mode = useEditorStore((state) => state.ui.viewportCamera)
  const viewRevision = useEditorStore((state) => state.view.revision)
  const shotRevision = useEditorStore((state) => state.camera.revision)
  const syncView = useEditorStore((state) => state.syncViewFromViewport)

  // Deliberate view edits (reset button, dolly via wheel, returning from camera
  // view) are applied here; ordinary orbiting is left to the controls.
  useEffect(() => {
    if (mode !== 'free') return
    const { view } = useEditorStore.getState()
    const target = applyCameraSettings(camera, view)
    const controls = controlsRef.current
    if (controls) {
      controls.target.copy(target)
      controls.update()
    }
  }, [camera, mode, viewRevision])

  useEffect(() => {
    if (mode !== 'scene') return
    const state = useEditorStore.getState()
    const target = applyCameraSettings(camera, resolveCamera(state, state.timeline.currentTime))
    const controls = controlsRef.current
    if (controls) {
      controls.target.copy(target)
      controls.update()
    }
  }, [camera, mode, shotRevision])

  /**
   * Looking through the shot camera is a *peek*: the moment the artist reaches
   * for the view, they are asking to navigate again, so the drag hands the free
   * view back and keeps turning it. One continuous gesture — no lost motion, and
   * no trip to a button to get out.
   *
   * The listeners are attached for the whole session rather than per mode: the
   * mode flips *during* the drag, and an effect scoped to `scene` would tear its
   * own handlers down mid-gesture.
   */
  useEffect(() => {
    const element = gl.domElement
    let armed = false
    let orbiting = false
    let lastX = 0
    let lastY = 0
    let pointerId = -1

    const onDown = (event: PointerEvent) => {
      if (event.button !== 0) return
      armed = useEditorStore.getState().ui.viewportCamera === 'scene'
      lastX = event.clientX
      lastY = event.clientY
      pointerId = event.pointerId
    }

    const onMove = (event: PointerEvent) => {
      if (armed && !orbiting) {
        // The first move decides who owns the drag. An object, a rotation ring or
        // a lid claims it by calling `beginGesture` from its own pointerdown, and
        // by the first move that has certainly landed.
        armed = false
        if (isGestureActive()) return
        useEditorStore.getState().setViewportCamera('free')
        orbiting = true
        beginGesture()
        element.setPointerCapture(pointerId)
      }
      if (!orbiting) return
      const dx = event.clientX - lastX
      const dy = event.clientY - lastY
      if (dx === 0 && dy === 0) return
      lastX = event.clientX
      lastY = event.clientY
      // Measured against OrbitControls' own rate (~0.28°/px on a 700px viewport),
      // so the hand feels no seam at the moment the view changes.
      const perPixel = 190 / Math.max(1, element.clientHeight)
      const store = useEditorStore.getState()
      store.updateViewCamera({
        azimuth: store.view.azimuth - dx * perPixel,
        elevation: clamp(store.view.elevation + dy * perPixel, MIN_ELEVATION, MAX_ELEVATION),
      })
    }

    const onUp = () => {
      armed = false
      if (!orbiting) return
      orbiting = false
      endGesture()
    }

    element.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      element.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      if (orbiting) {
        orbiting = false
        endGesture()
      }
    }
  }, [gl])

  // drei's OrbitControls update runs at priority -1, so this runs after it.
  useFrame(() => {
    const state = useEditorStore.getState()
    const controls = controlsRef.current

    if (state.ui.viewportCamera === 'scene') {
      const target = applyCameraSettings(camera, resolveCamera(state, state.timeline.currentTime))
      if (controls) {
        controls.target.copy(target)
        controls.enabled = false
      }
      return
    }

    // A device drag or a lid drag owns the pointer; the controls must stay out
    // of the way until it ends, or the same gesture would also orbit.
    if (isGestureActive()) {
      if (controls) controls.enabled = false
      return
    }

    if (controls && !controls.enabled) {
      controls.enabled = true
      controls.update()
    }
  })

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enabled={mode === 'free'}
      // Zooming is handled by the viewport itself: the wheel belongs to the
      // selected device, and letting OrbitControls dolly at the same time would
      // move the camera every time an object was scaled.
      enableZoom={false}
      enableDamping
      dampingFactor={0.09}
      minDistance={1.2}
      maxDistance={18}
      minPolarAngle={0.06}
      maxPolarAngle={Math.PI / 2 + 0.35}
      onEnd={() => {
        const controls = controlsRef.current
        if (!controls) return
        syncView(cameraSettingsFromOrbit(camera, controls.target))
      }}
    />
  )
}
