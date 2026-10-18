import * as THREE from 'three'
import type { CameraSettings, Vec3 } from '../types'

/**
 * One place for the orbit-to-matrix maths, shared by the editing viewport rig
 * and the shot-preview camera so the two can never drift apart.
 */

const DEG = THREE.MathUtils.degToRad
export const RAD = THREE.MathUtils.radToDeg

/** Spherical (azimuth / elevation / distance) → world position around `target`. */
export function orbitToPosition(
  azimuth: number,
  elevation: number,
  distance: number,
  target: THREE.Vector3,
  out: THREE.Vector3,
): THREE.Vector3 {
  const polar = DEG(elevation)
  const theta = DEG(azimuth)
  const cosPolar = Math.cos(polar)
  return out.set(
    target.x + distance * cosPolar * Math.sin(theta),
    target.y + distance * Math.sin(polar),
    target.z + distance * cosPolar * Math.cos(theta),
  )
}

/** Push a stored camera state onto a live camera. */
export function applyCameraSettings(
  camera: THREE.PerspectiveCamera,
  settings: CameraSettings,
  target = new THREE.Vector3(),
): THREE.Vector3 {
  target.set(settings.target[0], settings.target[1], settings.target[2])
  orbitToPosition(settings.azimuth, settings.elevation, settings.distance, target, camera.position)
  camera.fov = settings.fov
  camera.updateProjectionMatrix()
  camera.lookAt(target)
  return target
}

/** The inverse: what orbit state is this camera currently in? */
export function cameraSettingsFromOrbit(
  camera: THREE.Camera,
  target: THREE.Vector3,
): { azimuth: number; elevation: number; distance: number; target: Vec3 } {
  const offset = new THREE.Vector3().copy(camera.position).sub(target)
  const spherical = new THREE.Spherical().setFromVector3(offset)
  return {
    azimuth: RAD(spherical.theta),
    elevation: 90 - RAD(spherical.phi),
    distance: spherical.radius,
    target: [target.x, target.y, target.z],
  }
}
