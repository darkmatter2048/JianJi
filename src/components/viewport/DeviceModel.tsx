import { useGLTF } from '@react-three/drei'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { evaluateFrame } from '../../lib/animation'
import { MODEL_ASSETS, findAsset, findHinge, findScreen, type HingeSpec, type ScreenSpec } from '../../lib/assets'
import { beginGesture, endGesture } from '../../lib/gesture'
import { LID_DRAG_DEG_PER_PX, applyLidRotation, isDescendant } from '../../lib/lid'
import { useAssetInfoStore } from '../../store/assetInfoStore'
import { useEditorStore } from '../../store/editorStore'
import type { AssetInfo } from '../../store/assetInfoStore'
import type { SceneObject } from '../../types'
import {
  applyMaterialSettings,
  blankScreenMaterial,
  collectMaterials,
} from './materials'
import { isRotationGizmoPart } from './RotationGizmo'
import { useObjectDrag } from './useObjectDrag'
import {
  lastFinishedClip,
  objectVisibilityAt,
  resolveActiveClip,
  resolveScreenState,
} from '../../lib/keyframes'
import { createScreenRuntime } from './screenTexture'

/** Longest axis of every imported model, in scene units. */
const FIT_SIZE = 2

/**
 * GLTFLoader sanitises node names for animation binding: it strips everything
 * except `[A-Za-z0-9_]`, so an export's "Cube.001_1" arrives as "Cube001_1".
 * Match by the same rule instead of trusting the registry's raw spelling.
 */
function sanitizeNodeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, '')
}

function findNodeByName(root: THREE.Object3D, name: string): THREE.Object3D | null {
  const target = sanitizeNodeName(name)
  let found: THREE.Object3D | null = null
  root.traverse((node) => {
    if (!found && sanitizeNodeName(node.name) === target) found = node
  })
  return found
}

interface PreparedModel {
  /** Already centred, scaled to `FIT_SIZE` and resting on y = 0. */
  object: THREE.Group
  materials: THREE.Material[]
  /** The rotatable lid pivot, when the asset declares one the glTF actually has. */
  hinge: THREE.Object3D | null
  /** The hinge's axis/sign/offset, so the rotation lands on the right axis. */
  hingeSpec: HingeSpec | null
  /** The material that paints the display, resolved by name. */
  screenMaterial: THREE.MeshStandardMaterial | null
  info: Omit<AssetInfo, 'assetId'>
}

/**
 * Normalise an arbitrary glTF for the stage: centre it, scale its longest axis
 * to `FIT_SIZE`, drop it onto the floor and measure it. Doing this here means
 * every future asset behaves the same without hand-tuned numbers.
 */
function prepareModel(
  source: THREE.Object3D,
  spec: HingeSpec | undefined,
  screenSpec: ScreenSpec | undefined,
  orientation: [number, number, number] | undefined,
): PreparedModel {
  const root = source.clone(true)

  // Reorient first so the longest-axis fit and the floor drop are computed on
  // the final, camera-facing pose.
  if (orientation) {
    root.rotation.set(
      THREE.MathUtils.degToRad(orientation[0]),
      THREE.MathUtils.degToRad(orientation[1]),
      THREE.MathUtils.degToRad(orientation[2]),
    )
  }

  let meshes = 0
  let vertices = 0
  let triangles = 0
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    meshes += 1
    child.castShadow = true
    child.receiveShadow = true
    const geometry = child.geometry
    const position = geometry.getAttribute('position')
    if (position) vertices += position.count
    triangles += geometry.index ? geometry.index.count / 3 : (position?.count ?? 0) / 3
  })

  const box = new THREE.Box3().setFromObject(root)
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const longest = Math.max(size.x, size.y, size.z) || 1
  const scale = FIT_SIZE / longest

  root.position.sub(center)

  const object = new THREE.Group()
  object.add(root)
  object.scale.setScalar(scale)
  object.position.y = (size.y * scale) / 2
  object.name = 'device'

  const fitted = size.clone().multiplyScalar(scale)
  const materials = collectMaterials(root)

  const hingeNode = spec ? findNodeByName(root, spec.node) : null

  return {
    object,
    materials,
    // Resolved on the clone (names survive `clone(true)`), and only when the
    // asset registry promised one — a missing node simply disables the lid.
    hinge: hingeNode,
    hingeSpec: spec && hingeNode ? spec : null,
    screenMaterial: screenSpec
      ? ((materials.find((material) => material.name === screenSpec.material) as
          | THREE.MeshStandardMaterial
          | undefined) ?? null)
      : null,
    info: {
      meshes,
      vertices,
      triangles,
      size: [size.x, size.y, size.z],
      fittedSize: [fitted.x, fitted.y, fitted.z],
    },
  }
}

/** Everything a lid drag needs, captured when the gesture starts. */
interface LidDrag {
  /** Pointer travel, in px, is measured from here. */
  startY: number
  startAngle: number
}

/**
 * Renders one `SceneObject` of kind `model`.
 *
 * The group transform is written imperatively inside `useFrame` so a playing
 * timeline (or a scrubbed one) never triggers React re-renders — the store is
 * read with `getState()` and the frame is evaluated from the current time.
 */
export function DeviceModel({ object }: { object: SceneObject }) {
  const url = findAsset(object.assetId)?.url ?? MODEL_ASSETS[0].url
  const gltf = useGLTF(url)
  const groupRef = useRef<THREE.Group>(null)
  const opacityRef = useRef(1)
  const draggingRef = useRef(false)
  const dragCleanup = useRef<(() => void) | null>(null)
  const beginMoveDrag = useObjectDrag(object, draggingRef, dragCleanup)

  // drei's OrbitControls with `makeDefault` parks itself here.
  const controls = useThree((state) => state.controls) as unknown as { enabled: boolean } | null

  const selectObject = useEditorStore((state) => state.selectObject)
  const setObjectLidOpen = useEditorStore((state) => state.setObjectLidOpen)
  const lidTool = useEditorStore((state) => state.ui.lidTool)
  const setAssetInfo = useAssetInfoStore((state) => state.setInfo)

  const prepared = useMemo(
    () =>
      prepareModel(
        gltf.scene,
        findHinge(object.assetId),
        findScreen(object.assetId),
        findAsset(object.assetId)?.orientation,
      ),
    [gltf.scene, object.assetId],
  )

  const screenSpec = findScreen(object.assetId)
  /**
   * The texture at *this* instant, read from the object's timeline. The selector
   * returns the keyframe's own screen object, so the reference only changes when
   * the playhead crosses a frame — no per-frame re-render, no unstable snapshot.
   */
  const screen = useEditorStore((state) => {
    const live = state.objects.find((entry) => entry.id === object.id) ?? object
    return resolveScreenState(live.keyframes, state.timeline.currentTime, live.screen)
  })
  const screenRuntime = useRef<ReturnType<typeof createScreenRuntime> | null>(null)

  // Displays keep their own surface: a material preset must not tint the panel.
  const screenExempt = useMemo(() => {
    const exempt = new Set<THREE.Material>()
    if (prepared.screenMaterial && screen?.enabled && screen.src) exempt.add(prepared.screenMaterial)
    return exempt
  }, [prepared, screen?.enabled, screen?.src])

  useEffect(() => {
    setAssetInfo(object.assetId, { assetId: object.assetId, ...prepared.info })
  }, [object.assetId, prepared, setAssetInfo])

  useEffect(() => {
    applyMaterialSettings(prepared.materials, object.material, opacityRef.current, screenExempt)
  }, [prepared, object.material, screenExempt])

  /* ------------------------------------------------------------- screen -- */

  useEffect(() => {
    const material = prepared.screenMaterial
    if (!material || !screenSpec) return
    if (!screen?.enabled || !screen.src) {
      // No texture → the display is blank, not the model's baked wallpaper.
      blankScreenMaterial(material)
      return
    }

    const runtime = createScreenRuntime(screen, screenSpec.aspect, (message) =>
      console.warn(`UAE2 screen (${object.name}): ${message}`),
    )
    screenRuntime.current = runtime

    material.map = runtime.texture
    material.emissiveMap = runtime.texture
    material.emissive.setRGB(1, 1, 1)
    material.emissiveIntensity = screen.brightness
    material.color.setRGB(1, 1, 1)
    material.roughness = 0.16
    material.metalness = 0
    material.needsUpdate = true

    return () => {
      screenRuntime.current = null
      runtime.dispose()
      blankScreenMaterial(material)
    }
    // `brightness` is deliberately absent: it is a uniform, not a new decode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    prepared,
    screenSpec,
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

  // A drag that outlives the component (object deleted mid-gesture) must still
  // release the pointer listeners and give the camera controller back.
  useEffect(() => () => dragCleanup.current?.(), [])

  useFrame(() => {
    const group = groupRef.current
    if (!group) return

    const state = useEditorStore.getState()
    // Read the object back out of the store: during a lid drag the props are a
    // frame behind, and the hinge should track the pointer exactly.
    const live = state.objects.find((entry) => entry.id === object.id) ?? object
    const pose = evaluateFrame(state, state.timeline.currentTime).objects[object.id]
    const transform = pose?.transform ?? live.transform

    // Not born yet at this instant? Then it is not in the shot. Done here rather
    // than in render so scrubbing never re-renders the mesh. 隐藏 is the artist's
    // own switch on the same idea, and it too belongs to the frame.
    const visibility = objectVisibilityAt(live.keyframes, state.timeline.currentTime)
    group.visible =
      live.visible && !visibility.hidden && state.timeline.currentTime >= live.appearAt - 1e-3

    group.position.set(transform.position[0], transform.position[1], transform.position[2])
    group.rotation.set(
      THREE.MathUtils.degToRad(transform.rotation[0]),
      THREE.MathUtils.degToRad(transform.rotation[1]),
      THREE.MathUtils.degToRad(transform.rotation[2]),
    )
    group.scale.set(transform.scale[0], transform.scale[1], transform.scale[2])

    if (prepared.hinge && prepared.hingeSpec && live.lid) {
      applyLidRotation(prepared.hinge, prepared.hingeSpec, pose?.lidOpenDeg ?? live.lid.openDeg)
    }

    // A video on the screen follows its clip: the clip decides where in the
    // source we are and how fast it runs, so trimming and 变速 both show up.
    //
    // It only runs while the *timeline* runs. A paused playhead means a frozen
    // frame — otherwise the element keeps rolling inside its own loop and you get
    // a few seconds of animation replaying behind a paused editor.
    const runtime = screenRuntime.current
    if (runtime) {
      const rate = live.screen?.rate ?? 1
      const active = resolveActiveClip(live.screenClips, state.timeline.currentTime)
      if (active) {
        runtime.syncVideo(active.sourceTime, active.rate * rate, state.timeline.playing)
      } else {
        // No clip is running. The picture must not keep rolling: it freezes on
        // the last frame of the clip that just finished, and before the first
        // clip there is nothing to hold, so it waits on the first frame.
        const previous = lastFinishedClip(live.screenClips, state.timeline.currentTime)
        runtime.syncVideo(previous ? previous.outPoint : 0, 1, false)
      }
    }

    // 渐隐 / 渐显 rides the same opacity channel the material preset uses, so the
    // screen fades with the rest of the machine.
    const nextOpacity = group.visible ? visibility.opacity : 0
    if (Math.abs(nextOpacity - opacityRef.current) > 0.002) {
      opacityRef.current = nextOpacity
      applyMaterialSettings(prepared.materials, live.material, nextOpacity, screenExempt)
    }
    // The display is self-lit and its texture rides both the diffuse (`map`) and
    // emissive (`emissiveMap`) channels; three.js's emissive does not fade with
    // `opacity`, so dim both the emissive intensity and the diffuse tint.
    if (prepared.screenMaterial && screen?.enabled && screen.src) {
      const fade = opacityRef.current
      const target = (screen.brightness ?? 1) * fade
      if (Math.abs(prepared.screenMaterial.emissiveIntensity - target) > 0.001) {
        prepared.screenMaterial.emissiveIntensity = target
      }
      if (Math.abs(prepared.screenMaterial.color.r - fade) > 0.001) {
        prepared.screenMaterial.color.setScalar(fade)
      }
    }
  })

  /* ---------------------------------------------------------------- lid -- */

  /** The lid is grabbable only when a hinge exists and the tool (or Shift) asks for it. */
  const lidGrabbable = (event: ThreeEvent<PointerEvent>): boolean => {
    if (!prepared.hinge || !object.lid) return false
    if (!lidTool && !event.shiftKey) return false
    const hit = event.intersections[0]?.object ?? event.object
    return !!hit && isDescendant(prepared.hinge, hit)
  }

  const beginLidDrag = (event: ThreeEvent<PointerEvent>) => {
    const lid = object.lid
    if (!lid) return

    // Absolute mapping from the gesture's start: overshooting a clamp and
    // coming back re-engages the moment the pointer re-crosses the limit.
    const drag: LidDrag = { startY: event.clientY, startAngle: lid.openDeg }
    draggingRef.current = true

    const onMove = (move: PointerEvent) => {
      setObjectLidOpen(
        object.id,
        drag.startAngle - (move.clientY - drag.startY) * LID_DRAG_DEG_PER_PX,
      )
    }

    const onEnd = () => {
      draggingRef.current = false
      dragCleanup.current = null
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onEnd)
      window.removeEventListener('pointercancel', onEnd)
      // Hand the camera back; CameraRig re-enables the controls next frame
      // unless it is looking through the shot camera.
      endGesture()
      document.body.style.cursor = 'auto'
    }

    dragCleanup.current = onEnd
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onEnd)
    window.addEventListener('pointercancel', onEnd)

    // Kill the orbit gesture before it can consume any of this drag.
    beginGesture()
    if (controls) controls.enabled = false
    document.body.style.cursor = 'ns-resize'
  }

  return (
    <group
      ref={groupRef}
      visible={object.visible}
      onPointerDown={(event) => {
        event.stopPropagation()
        selectObject(object.id)
        if (event.button !== 0) return
        if (lidGrabbable(event)) {
          beginLidDrag(event)
          return
        }
        // The rotation rings draw on top of the device, so a ring under the
        // pointer must win the gesture even when the device is nearer the
        // camera — otherwise the ring would be visible but ungrabbable.
        if (event.intersections.some((hit) => isRotationGizmoPart(hit.object))) return
        beginMoveDrag(event)
      }}
      onPointerMove={(event) => {
        if (draggingRef.current) return
        event.stopPropagation()
        document.body.style.cursor = lidGrabbable(event) ? 'ns-resize' : 'pointer'
      }}
      onPointerOut={() => {
        if (draggingRef.current) return
        document.body.style.cursor = 'auto'
      }}
    >
      <primitive object={prepared.object} />
    </group>
  )
}
