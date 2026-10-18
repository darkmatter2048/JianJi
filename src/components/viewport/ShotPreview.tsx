import { useFrame, useThree } from '@react-three/fiber'
import { useMemo } from 'react'
import * as THREE from 'three'
import { resolveCamera } from '../../lib/animation'
import { ASPECT_RATIO } from '../../types'
import { createBackdrop, withBackdrop } from '../../lib/backdrop'
import { resolveSceneState } from '../../lib/keyframes'
import { applyCameraSettings } from '../../lib/cameraMath'
import { finishShotCapture, isShotCapturePending, shotCaptureHeight } from '../../lib/capture'
import { useEditorStore } from '../../store/editorStore'

/** Geometry of the little preview window, shared with its DOM frame. */
/**
 * Geometry of the little preview window: width and margin are fixed, the height
 * follows the project's aspect so the window always shows the frame that will be
 * exported — not a 16:10 crop of it.
 */
export const SHOT_PREVIEW = { width: 226, margin: 14 } as const

const GIZMO_SIZE = 60
const GIZMO_MARGIN = 18

/** The largest centred rectangle of `ratio` that fits inside the canvas. */
function letterbox(
  width: number,
  height: number,
  ratio: number,
): { x: number; y: number; width: number; height: number } {
  const frameWidth = Math.min(width, height * ratio)
  const frameHeight = frameWidth / ratio
  return {
    x: Math.round((width - frameWidth) / 2),
    y: Math.round((height - frameHeight) / 2),
    width: Math.round(frameWidth),
    height: Math.round(frameHeight),
  }
}

/** Objects named `editor:*` are editing aids and never belong in the shot. */
function hideEditorOverlays(root: THREE.Object3D): THREE.Object3D[] {
  const hidden: THREE.Object3D[] = []
  root.traverse((node) => {
    if (node.name.startsWith('editor:') && node.visible) {
      node.visible = false
      hidden.push(node)
    }
  })
  return hidden
}

function createAxisGizmo(): THREE.Scene {
  const scene = new THREE.Scene()
  const axes = new THREE.AxesHelper(1)
  const material = axes.material as THREE.LineBasicMaterial
  material.depthTest = false
  material.transparent = true
  scene.add(axes)
  return scene
}

/**
 * The whole frame, drawn by hand.
 *
 * Taking over rendering (priority 1) is what makes the picture-in-picture
 * possible at all: the same scene is drawn three times into different scissor
 * rectangles — the editing viewport, the shot preview, and the axis gizmo — so
 * there is no second renderer, no duplicated scene and no second copy of the
 * screen textures.
 */
export function ShotPreview() {
  const gl = useThree((state) => state.gl)
  const scene = useThree((state) => state.scene)
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera
  const size = useThree((state) => state.size)

  const previewCamera = useMemo(
    () => new THREE.PerspectiveCamera(30, 16 / 9, 0.05, 200),
    [],
  )
  const gizmo = useMemo(() => createAxisGizmo(), [])
  const gizmoCamera = useMemo(
    () => new THREE.OrthographicCamera(-1.4, 1.4, 1.4, -1.4, 0.1, 20),
    [],
  )

  useFrame(() => {
    const state = useEditorStore.getState()
    const shot = resolveCamera(state, state.timeline.currentTime)
    const width = size.width
    const height = size.height

    // The picture carries its own background: the backdrop is a DOM layer, so a
    // shot rendered without one would come out with a hole in it.
    const background = resolveSceneState(
      state.objects,
      state.timeline.currentTime,
      state.scene,
    ).background

    // The player takes the whole canvas: one clean, letterboxed shot frame.
    if (state.ui.previewOpen) {
      const band = letterbox(width, height, ASPECT_RATIO[state.project.aspect])
      gl.setScissorTest(false)
      gl.setViewport(0, 0, width, height)
      gl.setClearColor(0x000000, 1)
      gl.clear(true, true, true)
      gl.setScissorTest(true)
      gl.setScissor(band.x, band.y, band.width, band.height)
      gl.setViewport(band.x, band.y, band.width, band.height)
      applyCameraSettings(previewCamera, shot)
      previewCamera.aspect = band.width / band.height
      previewCamera.updateProjectionMatrix()
      const hidden = hideEditorOverlays(scene)
      const restore = withBackdrop(scene, background)
      gl.render(scene, previewCamera)
      restore()
      for (const node of hidden) node.visible = true
      gl.setScissorTest(false)
      gl.setViewport(0, 0, width, height)
      gl.setClearColor(0x000000, 0)
      return
    }

    // Export: one clean frame of the *shot*, no overlays.
    if (isShotCapturePending()) {
      /**
       * Export renders at its own size, not at the window's: a 900px viewport
       * should still be able to hand back a 1080p film. The renderer is resized
       * for this one frame (`updateStyle: false` leaves the layout alone) and put
       * back immediately afterwards.
       */
      const target = shotCaptureHeight()
      const previousPixelRatio = gl.getPixelRatio()
      const restore = () => {
        gl.setPixelRatio(previousPixelRatio)
        gl.setSize(width, height, false)
      }
      if (target) {
        const targetWidth = Math.max(2, Math.round(target * ASPECT_RATIO[state.project.aspect]))
        gl.setPixelRatio(1)
        gl.setSize(targetWidth, target, false)
      }
      const bufferWidth = gl.domElement.width
      const bufferHeight = gl.domElement.height
      const band = letterbox(bufferWidth, bufferHeight, ASPECT_RATIO[state.project.aspect])
      gl.setScissorTest(true)
      gl.setScissor(band.x, band.y, band.width, band.height)
      gl.setViewport(band.x, band.y, band.width, band.height)
      gl.setClearColor(0x000000, 0)
      applyCameraSettings(previewCamera, shot)
      previewCamera.aspect = band.width / band.height
      previewCamera.updateProjectionMatrix()
      const hidden = hideEditorOverlays(scene)
      const restoreBackdrop = withBackdrop(scene, background)
      gl.render(scene, previewCamera)
      restoreBackdrop()
      for (const node of hidden) node.visible = true
      gl.setScissorTest(false)
      gl.setViewport(0, 0, bufferWidth, bufferHeight)
      finishShotCapture(gl.domElement, band)
      restore()
      return
    }


    // 1. the editing viewport
    gl.setScissorTest(false)
    gl.setViewport(0, 0, width, height)
    gl.setClearColor(0x000000, 0)
    gl.render(scene, camera)

    // 2. the shot preview, bottom-right
    const shotRatio = ASPECT_RATIO[state.project.aspect]
    const previewWidth = SHOT_PREVIEW.width
    const previewHeight = previewWidth / shotRatio
    const previewX = width - previewWidth - SHOT_PREVIEW.margin
    // Anchored to the bottom, so a tall frame (4:5, 9:16) grows upwards instead
    // of leaving the corner.
    const previewY = SHOT_PREVIEW.margin
    applyCameraSettings(previewCamera, shot)
    previewCamera.aspect = shotRatio
    previewCamera.updateProjectionMatrix()
    gl.setScissorTest(true)
    gl.setScissor(previewX, previewY, previewWidth, previewHeight)
    gl.setViewport(previewX, previewY, previewWidth, previewHeight)
    // The composition's own background inside the window; the dark fallback is
    // only for a transparent one, so the window still reads as a monitor.
    const backdrop = createBackdrop(background)
    const previousBackdrop = scene.background
    if (backdrop) scene.background = backdrop
    gl.setClearColor(0x05070b, 1)
    const hidden = hideEditorOverlays(scene)
    gl.render(scene, previewCamera)
    scene.background = previousBackdrop
    for (const node of hidden) node.visible = true

    // 3. the axis gizmo, bottom-left, over the frame and without clearing it
    gizmoCamera.position.set(0, 0, 3).applyQuaternion(camera.quaternion)
    gizmoCamera.quaternion.copy(camera.quaternion)
    gl.setScissor(GIZMO_MARGIN, GIZMO_MARGIN + 26, GIZMO_SIZE, GIZMO_SIZE)
    gl.setViewport(GIZMO_MARGIN, GIZMO_MARGIN + 26, GIZMO_SIZE, GIZMO_SIZE)
    const autoClear = gl.autoClear
    gl.autoClear = false
    gl.render(gizmo, gizmoCamera)
    gl.autoClear = autoClear

    gl.setScissorTest(false)
    gl.setViewport(0, 0, width, height)
    gl.setClearColor(0x000000, 0)
  }, 1)

  return null
}
