/**
 * A one-bit lock shared between the things that grab the pointer and the things
 * that would otherwise steal the gesture.
 *
 * While a gesture is active (`CameraRig` reads `isGestureActive()` every frame)
 * OrbitControls stays disabled, so dragging a device or a lid can never be
 * interpreted as an orbit halfway through.
 */
let active = false

type GestureListener = (active: boolean) => void
const listeners = new Set<GestureListener>()

/**
 * Watch gesture boundaries. The history keeps one entry per drag rather than one
 * per pointer event, and this is where it learns where a drag starts and ends.
 */
export function onGesture(listener: GestureListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function beginGesture(): void {
  if (active) return
  active = true
  for (const listener of listeners) listener(true)
}

export function endGesture(): void {
  if (!active) return
  active = false
  for (const listener of listeners) listener(false)
}

export function isGestureActive(): boolean {
  return active
}
