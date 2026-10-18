import { uid } from './ids'
import { createSpeedCurve, evaluateSpeed } from './speedCurve'
import type {
  CameraKeyframe,
  CameraPose,
  ObjectKeyframe,
  ObjectPose,
  SceneSettings,
  ScreenClip,
  ScreenSettings,
  SpeedCurve,
  Transform,
  Vec3,
} from '../types'

/**
 * Keyframe timelines.
 *
 * Every object — including the camera — owns a list of keyframes at absolute
 * seconds. The list is sorted, may start and end anywhere, and has no upper
 * bound: the composition ends where the last keyframe of any object sits.
 *
 * A keyframe stores the *incoming* segment's speed ramp: the ramp on keyframe B
 * describes how the motion from A to B is re-timed. The content progress `p`
 * inside a segment is therefore
 *
 *     p(u) = ∫₀ᵘ v(x) dx / ∫₀¹ v(x) dx
 *
 * with `u` the normalised playback position. A flat ramp at 1 makes `p = u`
 * (constant speed); a dip in the middle slows the content down exactly there.
 */

/** Numeric samples per segment when integrating a speed ramp. */
const SPEED_SAMPLES = 48

/** Two keyframes closer than this are considered the same moment. */
export const KEYFRAME_EPSILON = 1e-3

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/* -------------------------------------------------------------- creation -- */

export function createObjectKeyframe(
  time: number,
  pose: ObjectPose,
  speed: SpeedCurve = createSpeedCurve(2),
  chained = false,
  sourceSpan = 0,
): ObjectKeyframe {
  return { id: uid('key'), time, pose, speed, chained, sourceSpan }
}

/**
 * Mean multiplier of a ramp — the factor between content time and screen time.
 *
 * A ramp whose average is 2× plays the same content in half the seconds, which is
 * what makes 变速 change the length of the piece instead of only its pacing.
 */
export function meanSpeed(curve: SpeedCurve): number {
  const total = speedIntegral(curve, 1)
  return total > 1e-6 ? total : 1
}

/** Seconds actually spent on a segment whose content lasts `sourceSpan`. */
export function rampedSpan(sourceSpan: number, curve: SpeedCurve): number {
  return sourceSpan / meanSpeed(curve)
}

/**
 * Re-derive every keyframe's content duration from the times currently on the
 * timeline. Called after a manual drag or an insert — never after a ramp, where
 * the whole point is that the times no longer match the content.
 *
 * Idempotent on ramped segments: span * mean = (source / mean) * mean = source.
 */
export function resyncSpans(list: ObjectKeyframe[]): ObjectKeyframe[] {
  return list.map((frame, index) => {
    if (index === 0) return frame.sourceSpan === 0 ? frame : { ...frame, sourceSpan: 0 }
    const span = Math.max(0, frame.time - list[index - 1].time)
    const source = span * meanSpeed(frame.speed)
    return Math.abs(source - frame.sourceSpan) < 1e-4 ? frame : { ...frame, sourceSpan: source }
  })
}

/**
 * Re-lay the timeline from `from` onwards using each keyframe's content duration
 * and its own ramp. This is the "调节关键帧的位置" half of 变速.
 */
export function relayoutFrom(list: ObjectKeyframe[], from: number): ObjectKeyframe[] {
  let time = list[0]?.time ?? 0
  return list.map((frame, index) => {
    if (index === 0) return frame
    time += rampedSpan(frame.sourceSpan, frame.speed)
    if (index < from) return frame
    return Math.abs(frame.time - time) < 1e-6 ? frame : { ...frame, time }
  })
}

export function createCameraKeyframe(
  time: number,
  pose: CameraPose,
  speed: SpeedCurve = createSpeedCurve(2),
): CameraKeyframe {
  return { id: uid('ckey'), time, pose, speed }
}

/* -------------------------------------------------------------- ordering -- */

function sortByTime<T extends { time: number }>(list: T[]): T[] {
  return [...list].sort((a, b) => a.time - b.time)
}

/**
 * Put a keyframe on the timeline. Landing on an existing keyframe replaces its
 * pose instead of stacking a second one at the same instant.
 */
export function putObjectKeyframe(
  list: ObjectKeyframe[],
  frame: ObjectKeyframe,
): ObjectKeyframe[] {
  const without = list.filter((entry) => Math.abs(entry.time - frame.time) > KEYFRAME_EPSILON)
  const existing = list.find((entry) => Math.abs(entry.time - frame.time) <= KEYFRAME_EPSILON)
  // Replacing a frame keeps its identity, its ramps, its content duration and
  // its place on the chain — an auto-keyed edit is not a new frame.
  return sortByTime([
    ...without,
    existing
      ? {
          ...frame,
          id: existing.id,
          speed: existing.speed,
          sourceSpan: existing.sourceSpan,
          chained: existing.chained,
        }
      : frame,
  ])
}

export function putCameraKeyframe(
  list: CameraKeyframe[],
  frame: CameraKeyframe,
): CameraKeyframe[] {
  const without = list.filter((entry) => Math.abs(entry.time - frame.time) > KEYFRAME_EPSILON)
  const existing = list.find((entry) => Math.abs(entry.time - frame.time) <= KEYFRAME_EPSILON)
  return sortByTime([...without, existing ? { ...frame, id: existing.id, speed: existing.speed } : frame])
}

export function findKeyframeAt<T extends { time: number }>(
  list: T[],
  time: number,
): T | null {
  return list.find((entry) => Math.abs(entry.time - time) <= KEYFRAME_EPSILON) ?? null
}

/** Index of the segment containing `time`, or -1 when outside the range. */
export function segmentIndexAt<T extends { time: number }>(list: T[], time: number): number {
  for (let index = 0; index < list.length - 1; index += 1) {
    if (time <= list[index + 1].time) return index
  }
  return list.length > 1 ? list.length - 2 : -1
}

/* ------------------------------------------------------------ evaluation -- */

/** ∫₀ᵘ v(x) dx by the trapezoid rule. */
function speedIntegral(curve: SpeedCurve, u: number): number {
  if (u <= 0) return 0
  const steps = Math.max(1, Math.ceil(u * SPEED_SAMPLES))
  const h = u / steps
  let total = 0
  for (let index = 0; index < steps; index += 1) {
    const a = evaluateSpeed(curve, (index / steps) * u)
    const b = evaluateSpeed(curve, ((index + 1) / steps) * u)
    total += ((a + b) / 2) * h
  }
  return total
}

/**
 * Content progress (0..1) at normalised playback position `u`, i.e. the
 * re-timing itself. Monotonic by construction, so a segment always arrives at
 * its keyframe.
 */
export function segmentProgress(curve: SpeedCurve, u: number): number {
  const clamped = clamp(u, 0, 1)
  const total = speedIntegral(curve, 1)
  if (total <= 1e-6) return clamped
  return clamp(speedIntegral(curve, clamped) / total, 0, 1)
}

function lerp(a: number, b: number, p: number): number {
  return a + (b - a) * p
}

function lerpVec3(a: Vec3, b: Vec3, p: number): Vec3 {
  return [lerp(a[0], b[0], p), lerp(a[1], b[1], p), lerp(a[2], b[2], p)]
}

function lerpTransform(a: Transform, b: Transform, p: number): Transform {
  return {
    position: lerpVec3(a.position, b.position, p),
    rotation: lerpVec3(a.rotation, b.rotation, p),
    scale: lerpVec3(a.scale, b.scale, p),
  }
}

/** The two frames around `time` and how far between them we are (0..1, eased). */
function segmentAt<T extends { time: number; speed: SpeedCurve }>(
  list: T[],
  time: number,
): { from: T; to: T; p: number } | null {
  if (list.length < 2) return null
  const index = segmentIndexAt(list, time)
  if (index < 0 || index + 1 >= list.length) return null
  const from = list[index]
  const to = list[index + 1]
  const span = to.time - from.time
  const u = span <= 0 ? 1 : (time - from.time) / span
  // The ramp belongs to the keyframe the segment arrives at. `sourceSpan` has
  // already been folded into the times, so progress stays normalised 0..1.
  return { from, to, p: segmentProgress(to.speed, u) }
}

function poseAt<T extends { time: number; speed: SpeedCurve; pose: P }, P>(
  list: T[],
  time: number,
  blend: (a: P, b: P, p: number) => P,
): P | null {
  if (list.length === 0) return null
  const first = list[0]
  const last = list[list.length - 1]
  if (list.length === 1 || time <= first.time) return first.pose
  if (time >= last.time) return last.pose

  const segment = segmentAt(list, time)
  if (!segment) return last.pose
  return blend(segment.from.pose, segment.to.pose, segment.p)
}

/** Whether the object is in the shot at `time`, and at what opacity. */
export interface Visibility {
  /** Fully gone: do not draw it at all. */
  hidden: boolean
  /** 1 = opaque. Between 0 and 1 only during a 渐隐 / 渐显. */
  opacity: number
}

const SHOWN: Visibility = { hidden: false, opacity: 1 }
const GONE: Visibility = { hidden: true, opacity: 0 }

/**
 * 显隐 at `time` — a cut by default, a fade when the frame we are arriving at
 * asks for one.
 *
 * A fade borrows the segment's speed curve (the same one 变速 shows), so the
 * easing of the fade is the easing of the move that carries it.
 */
export function objectVisibilityAt(list: ObjectKeyframe[], time: number): Visibility {
  if (list.length === 0) return SHOWN
  const pose = sampleObjectPose(list, time)
  if (!pose) return SHOWN

  const segment = segmentAt(list, time)
  if (!segment) return pose.hidden ? GONE : SHOWN

  const fromHidden = segment.from.pose.hidden === true
  const toHidden = segment.to.pose.hidden === true
  if (fromHidden === toHidden) return fromHidden ? GONE : SHOWN

  if ((segment.to.pose.hideMode ?? 'cut') === 'fade') {
    // Mid-fade the object is very much in the shot — just not all there yet.
    return { hidden: false, opacity: toHidden ? 1 - segment.p : segment.p }
  }
  // 瞬间: hold the old state right up to the frame, then swap.
  if (segment.p >= 1) return toHidden ? GONE : SHOWN
  return fromHidden ? GONE : SHOWN
}

/** The object's pose at `time`, or `null` when it has no keyframes at all. */
export function sampleObjectPose(list: ObjectKeyframe[], time: number): ObjectPose | null {
  return poseAt<ObjectKeyframe, ObjectPose>(list, time, (a, b, p) => ({
    transform: lerpTransform(a.transform, b.transform, p),
    lidOpenDeg:
      a.lidOpenDeg === null || b.lidOpenDeg === null ? a.lidOpenDeg : lerp(a.lidOpenDeg, b.lidOpenDeg, p),
    // The texture, the room and being there at all all *step* — interpolating
    // them would mean cross-fading two images or half a disappearance. They flip
    // on the keyframe itself (`p` reaches 1 exactly at the end of the segment),
    // so a cut made at 2.00s is in the film at 2.00s, not one frame later.
    screen: p >= 1 ? b.screen : a.screen,
    scene: p >= 1 ? b.scene : a.scene,
    hidden: p >= 1 ? b.hidden : a.hidden,
    hideMode: b.hideMode,
  }))
}

/* ------------------------------------------------------------ scene blend -- */

function hexToRgb(hex: string): [number, number, number] | null {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!match) return null
  const body = match[1].length === 3 ? match[1].replace(/./g, (c) => c + c) : match[1]
  const value = parseInt(body, 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

function rgbToHex(rgb: [number, number, number]): string {
  return `#${rgb.map((part) => Math.round(clamp(part, 0, 255)).toString(16).padStart(2, '0')).join('')}`
}

/** Colours blend, so a background can cross from one to another over a move. */
function lerpHex(a: string, b: string, p: number): string {
  const from = hexToRgb(a)
  const to = hexToRgb(b)
  if (!from || !to) return p < 1 ? a : b
  return rgbToHex([
    lerp(from[0], to[0], p),
    lerp(from[1], to[1], p),
    lerp(from[2], to[2], p),
  ])
}

/**
 * Blend two scenes. Everything that is a number or a colour crosses over; the
 * things that are a *choice* — which kind of background, which media — land on
 * the keyframe you are arriving at, because there is no halfway between them.
 */
export function lerpScene(a: SceneSettings, b: SceneSettings, p: number): SceneSettings {
  if (p <= 0) return a
  if (p >= 1) return b
  return {
    envIntensity: lerp(a.envIntensity, b.envIntensity, p),
    exposure: lerp(a.exposure, b.exposure, p),
    // The soundtrack is a project-wide choice, not something to blend.
    soundtrackId: a.soundtrackId,
    background: {
      ...b.background,
      type: a.background.type,
      color: lerpHex(a.background.color, b.background.color, p),
      from: lerpHex(a.background.from, b.background.from, p),
      to: lerpHex(a.background.to, b.background.to, p),
      angle: lerp(a.background.angle, b.background.angle, p),
      overlay: lerp(a.background.overlay, b.background.overlay, p),
      blur: lerp(a.background.blur, b.background.blur, p),
    },
    shadow: {
      enabled: a.shadow.enabled,
      opacity: lerp(a.shadow.opacity, b.shadow.opacity, p),
      blur: lerp(a.shadow.blur, b.shadow.blur, p),
    },
  }
}

/**
 * The scene at `time`, blended between the frames around it.
 *
 * The scene belongs to the whole composition, so it is read from the first object
 * that has a timeline — every keyframe taken at one instant carries the same
 * scene, so which object answers does not change the answer. The blend uses the
 * segment's own ramp, so the room moves in step with the object in it.
 *
 * NOTE: this returns a *fresh* object while a segment is in flight, so it must
 * not be used inside a store selector — read it per frame instead.
 */
export function resolveSceneState(
  objects: Array<{ keyframes: ObjectKeyframe[] }>,
  time: number,
  fallback: SceneSettings,
): SceneSettings {
  const owner = objects.find((object) => object.keyframes.length > 0)
  if (!owner) return fallback
  const frames = owner.keyframes
  const first = frames[0]
  const last = frames[frames.length - 1]
  if (time <= first.time) return first.pose.scene ?? fallback
  if (time >= last.time) return last.pose.scene ?? fallback

  const index = segmentIndexAt(frames, time)
  if (index < 0) return last.pose.scene ?? fallback
  const from = frames[index]
  const to = frames[index + 1]
  const before = from.pose.scene ?? fallback
  const after = to.pose.scene ?? fallback
  const span = to.time - from.time
  const u = span <= 0 ? 1 : (time - from.time) / span
  return lerpScene(before, after, segmentProgress(to.speed, u))
}

/**
 * The scene as a *step*: the state carried by the last keyframe at or before
 * `time`, returned as one of the stored objects — same reference until the
 * playhead crosses a frame.
 *
 * React-driven parts of the room use this (a media backdrop has to keep playing,
 * and the contact shadow needs its map re-rendered), so they stay safe inside a
 * store selector while the blended value drives the frame loop.
 */
export function resolveSceneFrame(
  objects: Array<{ keyframes: ObjectKeyframe[] }>,
  time: number,
  fallback: SceneSettings,
): SceneSettings {
  const owner = objects.find((object) => object.keyframes.length > 0)
  if (!owner) return fallback
  let found = fallback
  for (const frame of owner.keyframes) {
    if (frame.time > time + 1e-6) break
    if (frame.pose.scene) found = frame.pose.scene
  }
  return found
}

/** The camera's pose at `time`, or `null` when it has no keyframes. */
export function sampleCameraPose(list: CameraKeyframe[], time: number): CameraPose | null {
  return poseAt<CameraKeyframe, CameraPose>(list, time, (a, b, p) => ({
    azimuth: lerp(a.azimuth, b.azimuth, p),
    elevation: lerp(a.elevation, b.elevation, p),
    distance: lerp(a.distance, b.distance, p),
    target: lerpVec3(a.target, b.target, p),
    fov: lerp(a.fov, b.fov, p),
  }))
}

/* ---------------------------------------------------------------- screen -- */

/**
 * What is on the screen at `time`.
 *
 * A texture is a cut, not a blend: the state of the last keyframe at or before
 * `time` holds until the next one. `fallback` is the object's own screen, used
 * when the object has no keyframes at all.
 */
export function resolveScreenState(
  list: ObjectKeyframe[],
  time: number,
  fallback: ScreenSettings | null,
): ScreenSettings | null {
  if (list.length === 0) return fallback
  if (time <= list[0].time) return list[0].pose.screen ?? fallback
  let found: ScreenSettings | null = fallback
  for (const frame of list) {
    if (frame.time > time + 1e-6) break
    if (frame.pose.screen) found = frame.pose.screen
  }
  return found
}

/* ------------------------------------------------------------- video clips -- */

/** Screen seconds a clip occupies, once its ramp is taken into account. */
export function clipDuration(clip: ScreenClip): number {
  const source = Math.max(0, clip.outPoint - clip.inPoint)
  return source / meanSpeed(clip.speed)
}

export function clipEnd(clip: ScreenClip): number {
  return clip.start + clipDuration(clip)
}

export interface ActiveClip {
  clip: ScreenClip
  /** 0..1 across the clip. */
  progress: number
  /** Position inside the source video, in seconds. */
  sourceTime: number
  /** Source rate at this instant — what the `<video>` should be played at. */
  rate: number
}

/**
 * The clip playing at `time`, if any, together with where the source should be.
 *
 * The ramp shapes the pacing and its mean sets the length, exactly as it does
 * for an object's motion, so a clip ramped to 2× plays the same slice in half
 * the seconds.
 */
export function resolveActiveClip(clips: ScreenClip[], time: number): ActiveClip | null {
  for (const clip of clips) {
    const end = clipEnd(clip)
    if (time < clip.start - 1e-6 || time > end + 1e-6) continue
    const span = end - clip.start
    const u = span <= 0 ? 1 : (time - clip.start) / span
    const progress = segmentProgress(clip.speed, u)
    return {
      clip,
      progress,
      sourceTime: clip.inPoint + progress * (clip.outPoint - clip.inPoint),
      rate: evaluateSpeed(clip.speed, u),
    }
  }
  return null
}

/**
 * The most recent clip that has already finished by `time`.
 *
 * Used for the gap between two clips: nothing new is playing there, so the screen
 * holds this clip's final frame rather than running on or snapping back to the
 * start of the source.
 */
export function lastFinishedClip(clips: ScreenClip[], time: number): ScreenClip | null {
  let found: ScreenClip | null = null
  for (const clip of clips) {
    if (clipEnd(clip) > time + 1e-6) continue
    if (!found || clipEnd(clip) > clipEnd(found)) found = clip
  }
  return found
}

/** The last moment any clip of this object reaches. */
export function lastClipEnd(clips: ScreenClip[]): number {
  return clips.reduce((end, clip) => Math.max(end, clipEnd(clip)), 0)
}

/* ----------------------------------------------------------------- edits -- */

export function moveKeyframe<T extends { id: string; time: number }>(
  list: T[],
  id: string,
  time: number,
): T[] {
  return sortByTime(
    list.map((entry) => (entry.id === id ? { ...entry, time: Math.max(0, time) } : entry)),
  )
}

export function removeKeyframe<T extends { id: string }>(list: T[], id: string): T[] {
  return list.filter((entry) => entry.id !== id)
}

/**
 * Where the composition ends: the last keyframe of any object or of the camera —
 * and the tail of any video clip, because a clip plays past the frame that
 * attached it.
 */
export function lastKeyframeTime(
  objects: Array<{ keyframes: ObjectKeyframe[]; screenClips: ScreenClip[] }>,
  cameraKeyframes: CameraKeyframe[],
): number {
  let end = 0
  for (const object of objects) {
    const last = object.keyframes[object.keyframes.length - 1]
    if (last) end = Math.max(end, last.time)
    end = Math.max(end, lastClipEnd(object.screenClips))
  }
  const lastCamera = cameraKeyframes[cameraKeyframes.length - 1]
  if (lastCamera) end = Math.max(end, lastCamera.time)
  return end
}
