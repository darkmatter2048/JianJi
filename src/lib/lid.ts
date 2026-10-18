import * as THREE from 'three'
import type { HingeSpec } from './assets'

/**
 * Hinge conventions for laptop-style lids.
 *
 * A lid is one rotational degree of freedom. The model's own baked animation
 * fixes the convention used throughout the editor:
 *
 *   - the hinge pivot is the origin of the glTF node named by the asset's
 *     `hinge.node` (for the shipped MacBook that is `Bevels_2`, whose origin
 *     sits on the rear edge at mid-thickness),
 *   - the default hinge axis is the node's local +X, and
 *   - opening is, by default, a *negative* rotation about that axis.
 *
 * Models whose export was baked a different way declare that difference on the
 * asset: `axis`, `sign` and `offset` (the openDeg value of the baked pose).
 *
 * Dragging maps pointer travel to degrees linearly. Projecting the pointer
 * onto the hinge plane instead looks appealing but cannot express more than
 * ~90° — reaching past vertical would require the pointer to cross behind the
 * hinge — so it can never open a lid all the way.
 */

/** Lid degrees per pixel of vertical drag; ~300 px sweeps the full range. */
export const LID_DRAG_DEG_PER_PX = 0.4

/** Radians about the hinge axis for a lid opened by `openDeg`. */
export function lidRotation(spec: HingeSpec, openDeg: number): number {
  const sign = spec.sign ?? -1
  const offset = spec.offset ?? 0
  return sign * THREE.MathUtils.degToRad(openDeg - offset)
}

/** Write the hinge rotation for `openDeg` onto the hinge node. */
export function applyLidRotation(hinge: THREE.Object3D, spec: HingeSpec, openDeg: number): void {
  const angle = lidRotation(spec, openDeg)
  if (spec.axis === 'y') hinge.rotation.y = angle
  else if (spec.axis === 'z') hinge.rotation.z = angle
  else hinge.rotation.x = angle
}

/** True when `node` is `root` or sits underneath it. */
export function isDescendant(root: THREE.Object3D, node: THREE.Object3D): boolean {
  for (let current: THREE.Object3D | null = node; current; current = current.parent) {
    if (current === root) return true
  }
  return false
}
