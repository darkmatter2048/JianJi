import type {
  CameraKeyframe,
  CameraPose,
  CameraSettings,
  EditorSnapshot,
  ObjectPose,
} from '../types'
import { lastKeyframeTime, sampleCameraPose, sampleObjectPose } from './keyframes'

/**
 * One frame of the composition.
 *
 * Everything is derived analytically from `(snapshot, time)` — no state is
 * carried between frames, so scrubbing backwards is exact. Objects that carry
 * keyframes report an *absolute* pose; objects without any keep their own
 * `transform`, which is what lets a freshly dropped device sit still until the
 * artist keys it.
 */
export interface FrameEvaluation {
  /** Absolute poses, keyed by object id. Missing = "use the object's own transform". */
  objects: Record<string, ObjectPose>
  /** Absolute camera pose, or `null` when the camera has no keyframes. */
  camera: CameraPose | null
}

const EMPTY: FrameEvaluation = { objects: {}, camera: null }

export function evaluateFrame(snapshot: EditorSnapshot, time: number): FrameEvaluation {
  const { objects, timeline } = snapshot
  const hasObjectKeys = objects.some((object) => object.keyframes.length > 0)
  if (!hasObjectKeys && timeline.cameraKeyframes.length === 0) return EMPTY

  const poses: Record<string, ObjectPose> = {}
  for (const object of objects) {
    if (object.keyframes.length === 0) continue
    const pose = sampleObjectPose(object.keyframes, time)
    if (pose) poses[object.id] = pose
  }

  return { objects: poses, camera: sampleCameraPose(timeline.cameraKeyframes, time) }
}

/**
 * The shot camera at `time`: its keyframed pose when it has one, otherwise the
 * framing stored on the camera itself.
 *
 * `resolveCameraAt` takes its inputs separately so React components can memoise
 * it over three stable references — a selector that built a new object on every
 * call would send `useSyncExternalStore` into an infinite loop.
 */
export function resolveCameraAt(
  camera: CameraSettings,
  keyframes: CameraKeyframe[],
  time: number,
): CameraSettings {
  const pose = sampleCameraPose(keyframes, time)
  return pose ? { ...camera, ...pose } : camera
}

export function resolveCamera(snapshot: EditorSnapshot, time: number): CameraSettings {
  return resolveCameraAt(snapshot.camera, snapshot.timeline.cameraKeyframes, time)
}

/**
 * Where the composition ends: the last keyframe of any object or of the camera.
 * There is no stored duration — the timeline is exactly as long as its content.
 */
export function timelineEnd(snapshot: EditorSnapshot): number {
  return lastKeyframeTime(snapshot.objects, snapshot.timeline.cameraKeyframes)
}
