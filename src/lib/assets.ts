/**
 * Asset registry. Anything the素材区 can drop into the scene lives here.
 *
 * Every model lives under `public/models/<id>/` with a `scene.gltf` (plus its
 * `.bin`, `textures/` and `license.txt`), and the folder is named after its asset
 * id — e.g. `public/models/macbook-pro-13-2020/scene.gltf`. Adding another device
 * is therefore just: drop the folder, append an entry here. The viewport
 * auto-fits whatever it loads.
 */

/**
 * A lid the viewport can rotate, expressed as data so no asset name is
 * hard-coded in the renderer. `node` must be a node of the glTF hierarchy whose
 * origin sits on the hinge line.
 *
 * The rotation applied for a lid open `openDeg` is
 * `sign · (openDeg − offset)°` about `axis`. The shipped MacBook is the base
 * convention: `axis = 'x'`, `sign = -1`, `offset = 0` — its lid lies along +Z
 * when closed and a negative rotation about +X tips it open.
 */
export interface HingeSpec {
  /** Name of the glTF node that carries the lid geometry. */
  node: string
  /** Physical limit of the hinge, in degrees. */
  maxDeg: number
  /** Angle the "open" snap goes to, in degrees. */
  fullDeg: number
  /** Hinge axis. Defaults to 'x'. */
  axis?: 'x' | 'y' | 'z'
  /** Rotation direction. Defaults to -1 (the MacBook convention). */
  sign?: 1 | -1
  /**
   * The `openDeg` value at which the model's baked pose is shown (rotation 0).
   * Defaults to 0 — i.e. the baked pose is the closed lid.
   */
  offset?: number
}

/**
 * A texturable display, expressed as data.
 *
 * `material` (not a mesh name) is the binding key: a screen is almost always
 * one material shared by one flat mesh, and the material survives the model
 * normalisation untouched. `aspect` is the panel's width / height and drives
 * how uploaded media is letterboxed or cropped.
 */
export interface ScreenSpec {
  /** Human label shown in the UI. */
  label: string
  /** Name of the material that paints the display. */
  material: string
  /** Panel aspect ratio (width / height). */
  aspect: number
}

export interface ModelAsset {
  id: string
  name: string
  /** Path served by Vite, relative to the site root. */
  url: string
  /** Shown in the素材区 card. */
  note: string
  /** Approximate on-disk size, for orientation. */
  size: string
  /** Optional rotatable lid, driven by the「开合」tool in the viewport. */
  hinge?: HingeSpec
  /** Optional display that can play an image or a video. */
  screen?: ScreenSpec
  /**
   * Extra words the library search should match.
   */
  keywords?: string[]
  /**
   * Form factor shown as the library glyph. Defaults to `laptop`.
   */
  form?: 'phone' | 'laptop'
  /**
   * Euler rotation (degrees, XYZ) baked in at prepare time so a model whose
   * export faces a different axis still greets the camera. Applied before
   * auto-fit, so the floor drop and longest-axis fit stay correct.
   */
  orientation?: [number, number, number]
}

export const MODEL_ASSETS: ModelAsset[] = [
  {
    id: 'macbook-pro-13-2020',
    name: 'MacBook Pro 13" (2020)',
    url: '/models/macbook-pro-13-2020/scene.gltf',
    note: 'glTF 2.0 · 含贴图',
    size: '5.1 MB',
    // This export names the display assembly "Bevels_2"; its pivot sits on the
    // rear edge at mid-thickness, i.e. exactly on the hinge.
    hinge: { node: 'Bevels_2', maxDeg: 135, fullDeg: 120 },
    // The panel itself is the flat 16:10 mesh painted by `Material.002`.
    screen: { label: '内屏', material: 'Material.002', aspect: 1.595 },
    keywords: ['macbook', 'laptop', 'notebook', 'apple', '笔记本', '电脑', 'mac'],
  },
  {
    id: 'iphone-16-pro-max',
    name: 'iPhone 16 Pro Max',
    url: '/models/iphone_16_pro_max/scene.gltf',
    note: 'glTF 2.0 · 含贴图',
    size: '2.7 MB',
    screen: { label: '屏幕', material: 'screen.001', aspect: 0.47 },
    // The export's front faces −X; a quarter turn about Y greets the camera (+Z).
    orientation: [0, 90, 0],
    form: 'phone',
    keywords: ['iphone', 'phone', 'apple', '手机', '苹果', '16'],
  },
  {
    id: 'xiaomi-17-pro-max',
    name: '小米 17 Pro Max',
    url: '/models/free_xiaomi_17_pro_max/scene.gltf',
    note: 'glTF 2.0 · 含贴图',
    size: '2.2 MB',
    // The display plane sits under the front `glass`, which is what is visible.
    screen: { label: '屏幕', material: 'glass', aspect: 0.456 },
    form: 'phone',
    keywords: ['xiaomi', 'phone', '手机', '小米'],
  },
  {
    id: 'gaming-laptop',
    name: '游戏本',
    url: '/models/gaming_laptop/scene.gltf',
    note: 'glTF 2.0 · 含贴图',
    size: '12.6 MB',
    // The screen half's origin sits on the hinge line (the shared edge), and the
    // export is baked open 180° (screen up). A negative turn about +Z (openDeg
    // shrinking) swings the panel up and over onto the keyboard deck.
    hinge: { node: 'Cube.001_1', maxDeg: 180, fullDeg: 180, axis: 'z', sign: 1, offset: 180 },
    screen: { label: '屏幕', material: 'Material.004', aspect: 2.17 },
    keywords: ['gaming', 'laptop', '游戏本', '笔记本', '电竞'],
  },
]

export const DEFAULT_ASSET_ID = MODEL_ASSETS[0].id

export function findAsset(assetId: string): ModelAsset | undefined {
  return MODEL_ASSETS.find((asset) => asset.id === assetId)
}

export function findHinge(assetId: string): HingeSpec | undefined {
  return findAsset(assetId)?.hinge
}

export function findScreen(assetId: string): ScreenSpec | undefined {
  return findAsset(assetId)?.screen
}
