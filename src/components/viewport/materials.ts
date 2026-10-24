import * as THREE from 'three'
import type { MaterialSettings } from '../../types'

/**
 * The glTF is shared through `useGLTF`'s cache, so the first time we touch a
 * material we record its pristine values. Every later override — and the
 * "原模型材质" reset — restores from that snapshot instead of re-loading.
 */
interface MaterialSnapshot {
  color: number
  metalness: number
  roughness: number
  envMapIntensity: number
  opacity: number
  transparent: boolean
  wireframe: boolean
}

const ORIGINALS = new WeakMap<THREE.Material, MaterialSnapshot>()

function snapshot(material: THREE.Material): MaterialSnapshot {
  const standard = material as Partial<THREE.MeshStandardMaterial>
  return {
    color: standard.color ? standard.color.getHex() : 0xffffff,
    metalness: standard.metalness ?? 0,
    roughness: standard.roughness ?? 0.5,
    envMapIntensity: standard.envMapIntensity ?? 1,
    opacity: material.opacity,
    transparent: material.transparent,
    wireframe: standard.wireframe ?? false,
  }
}

/** Collect every unique material under `root`. */
export function collectMaterials(root: THREE.Object3D): THREE.Material[] {
  const materials = new Set<THREE.Material>()
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    const list = Array.isArray(child.material) ? child.material : [child.material]
    for (const material of list) if (material) materials.add(material)
  })
  return [...materials]
}

/**
 * Push the inspector's material settings onto a set of materials.
 * `opacityScale` carries timeline-driven fades on top of the static setting.
 * `exempt` marks materials that must keep their own surface look (displays).
 */
export function applyMaterialSettings(
  materials: THREE.Material[],
  settings: MaterialSettings,
  opacityScale = 1,
  exempt?: ReadonlySet<THREE.Material>,
): void {
  for (const material of materials) {
    let original = ORIGINALS.get(material)
    if (!original) {
      original = snapshot(material)
      ORIGINALS.set(material, original)
    }

    const standard = material as Partial<THREE.MeshStandardMaterial>
    // A display is painted by its own content, never by the object's material
    // preset — and its fade travels through `emissiveIntensity` (the caller's
    // job), not opacity. Leave it entirely alone.
    if (exempt?.has(material)) continue

    if (settings.enabled) {
      standard.color?.set(settings.color)
      if (standard.metalness !== undefined) standard.metalness = settings.metalness
      if (standard.roughness !== undefined) standard.roughness = settings.roughness
      if (standard.envMapIntensity !== undefined) standard.envMapIntensity = settings.envIntensity
      if (standard.wireframe !== undefined) standard.wireframe = settings.wireframe
      material.opacity = original.opacity * settings.opacity * opacityScale
    } else {
      standard.color?.setHex(original.color)
      if (standard.metalness !== undefined) standard.metalness = original.metalness
      if (standard.roughness !== undefined) standard.roughness = original.roughness
      if (standard.envMapIntensity !== undefined) standard.envMapIntensity = original.envMapIntensity
      if (standard.wireframe !== undefined) standard.wireframe = original.wireframe
      material.opacity = original.opacity * opacityScale
    }

    material.transparent = material.opacity < 0.999
    material.depthWrite = material.opacity >= 0.999
    material.needsUpdate = true
  }
}

/* ------------------------------------------------------------ screens ---- */

interface ScreenSnapshot {
  map: THREE.Texture | null
  emissiveMap: THREE.Texture | null
  emissive: number
  emissiveIntensity: number
  color: number
  roughness: number
  metalness: number
}

const SCREEN_ORIGINALS = new WeakMap<THREE.Material, ScreenSnapshot>()

/** Remember what a display material looked like before it started playing media. */
export function rememberScreenMaterial(material: THREE.Material): void {
  if (SCREEN_ORIGINALS.has(material)) return
  const standard = material as THREE.MeshStandardMaterial
  SCREEN_ORIGINALS.set(material, {
    map: standard.map ?? null,
    emissiveMap: standard.emissiveMap ?? null,
    emissive: standard.emissive ? standard.emissive.getHex() : 0x000000,
    emissiveIntensity: standard.emissiveIntensity ?? 1,
    color: standard.color ? standard.color.getHex() : 0xffffff,
    roughness: standard.roughness ?? 0.5,
    metalness: standard.metalness ?? 0,
  })
}

/** Put a display back to the model's own baked wallpaper. */
export function restoreScreenMaterial(material: THREE.Material): void {
  const original = SCREEN_ORIGINALS.get(material)
  if (!original) return
  const standard = material as THREE.MeshStandardMaterial
  standard.map = original.map
  standard.emissiveMap = original.emissiveMap
  standard.emissive?.setHex(original.emissive)
  standard.emissiveIntensity = original.emissiveIntensity
  standard.color?.setHex(original.color)
  if (standard.roughness !== undefined) standard.roughness = original.roughness
  if (standard.metalness !== undefined) standard.metalness = original.metalness
  standard.needsUpdate = true
}

/** A display with nothing on it: an off, dark, matte panel (no baked wallpaper). */
export function blankScreenMaterial(material: THREE.Material): void {
  const standard = material as THREE.MeshStandardMaterial
  standard.map = null
  standard.emissiveMap = null
  standard.emissive?.setRGB(0, 0, 0)
  standard.emissiveIntensity = 1
  standard.color?.setRGB(0.05, 0.06, 0.08)
  // Kill the baked reflection too, so the "off" screen reads as a dark panel
  // rather than a mirror picking up the environment.
  if (standard.roughness !== undefined) standard.roughness = 0.4
  if (standard.metalness !== undefined) standard.metalness = 0.05
  // 屏幕始终不透明、写深度：透明度交给 fade 单独控制，不能残留半透明状态。
  standard.transparent = false
  standard.opacity = 1
  standard.depthWrite = true
  standard.depthTest = true
  standard.needsUpdate = true
}

/* -------------------------------------------------------------- fades ---- */

interface FadeOriginal {
  opacity: number
  transparent: boolean
  /** Troika's text material ignores `opacity`; its glyphs answer to this instead. */
  fillOpacity: number | null
}

/** Each material's own opacity and transparency, before any fade touched it. */
const FADE_ORIGINALS = new WeakMap<THREE.Material, FadeOriginal>()

/**
 * 渐隐 / 渐显 for objects whose materials are not driven by a material preset
 * (text, image and video planes).
 *
 * `fade` multiplies the material's *own* opacity, so a text object set to 60%
 * still fades to 0 and back to 60% — and the original is only read once, so
 * calling this every frame is idempotent.
 */
export function applyFade(root: THREE.Object3D, fade: number): void {
  root.traverse((node) => {
    const mesh = node as Partial<THREE.Mesh>
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined
    if (!material) return
    for (const entry of Array.isArray(material) ? material : [material]) {
      // The base is read once and only once. Re-reading it "when not fading" was a
      // bug: after a fade-out the material sits at opacity 0, so re-reading would
      // latch 0 as the base and the object could never come back.
      let original = FADE_ORIGINALS.get(entry)
      if (!original) {
        const troika = entry as THREE.Material & { fillOpacity?: number }
        original = {
          opacity: entry.opacity,
          transparent: entry.transparent,
          fillOpacity: typeof troika.fillOpacity === 'number' ? troika.fillOpacity : null,
        }
        FADE_ORIGINALS.set(entry, original)
      }
      entry.opacity = original.opacity * fade
      if (original.fillOpacity !== null) {
        ;(entry as THREE.Material & { fillOpacity: number }).fillOpacity =
          original.fillOpacity * fade
      }
      entry.transparent = original.transparent || fade < 0.999
      entry.depthWrite = entry.opacity >= 0.999 && fade >= 0.999
    }
  })
}
