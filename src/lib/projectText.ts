import { findHinge, findScreen, MODEL_ASSETS } from './assets'
import { relativeTo } from './paths'
import { DEFAULT_CAMERA, DEFAULT_VIEW } from './presets'
import { uid } from './ids'
import { createSpeedCurve, DEFAULT_MAX_SPEED } from './speedCurve'
import { ASPECT_RATIO } from '../types'
import type {
  BackgroundSettings,
  HideMode,
  MediaFit,
  SpeedCurve,
  SpeedNode,
  EditorSnapshot,
  MediaAsset,
  ObjectKeyframe,
  ProjectAspect,
  ObjectPose,
  SceneObject,
  SceneSettings,
  ScreenClip,
  ScreenSettings,
  TextSettings,
  Transform,
  Vec3,
} from '../types'

/**
 * The project as text.
 *
 * A project *is* a text file here: resources are declared as `alias = …`, and
 * every object then lists its keyframes one per line with the field names the
 * format was specified with — `t` time, `p` position, `s` screen (lid) angle,
 * `a` rotation, `f` the texture on the screen, `v` the speed ramp of the segment
 * arriving at that frame. Cameras and video clips get the same treatment with the
 * fields that make sense for them.
 *
 * The grammar is line-oriented on purpose: one thing per line, `#` comments, and
 * whitespace-separated `key=value` fields with no spaces inside a value, so it
 * stays readable, diffable and hand-editable.
 */

const HEADER = '# 简辑 · 工程文件 v1'

/** The frame ratios a file may ask for. */
const ASPECTS = Object.keys(ASPECT_RATIO) as ProjectAspect[]

/* ------------------------------------------------------------- writing -- */

const f = (value: number, digits = 2): string => {
  const rounded = Number(value.toFixed(digits))
  return String(rounded)
}

const vec = (value: Vec3, digits = 2): string =>
  `[${value.map((part) => f(part, digits)).join(',')}]`

/** A speed ramp: a bare number when it is flat, otherwise its `(t,v)` nodes. */
function speedText(curve: SpeedCurve): string {
  const nodes = curve.nodes
  const flat = nodes.every((node) => Math.abs(node.v - nodes[0].v) < 1e-3)
  if (flat) return f(nodes[0].v)
  return `[${nodes.map((node) => `${f(node.t, 3)}:${f(node.v, 3)}`).join(',')}]`
}

/** Index just past the closing `"`, honouring `\\` escapes. */
function scanQuoted(text: string, start: number): number {
  let index = start + 1
  while (index < text.length) {
    if (text[index] === '\\') index += 2
    else if (text[index] === '"') return index + 1
    else index += 1
  }
  return text.length
}

/** A resource path or name, quoted when it holds a space. */
function quotedRef(text: string): string {
  return /\s/.test(text) ? `"${text.replace(/"/g, '\\"')}"` : text
}

/** `alias` for a library asset: its file name, slugged and de-duplicated. */
function aliasFor(name: string, taken: Set<string>): string {
  const base =
    name
      .replace(/\.[^.]+$/, '')
      // Keep letters of any script: a Chinese file name is a perfectly good
      // alias, and slugging it to "asset" would collide with the next one.
      .replace(/[^\p{L}\p{N}_-]+/gu, '_')
      .replace(/^_+|_+$/g, '')
      .toLowerCase() || 'asset'
  let alias = /^[0-9]/.test(base) ? `m_${base}` : base
  let n = 2
  while (taken.has(alias)) alias = `${base}${n++}`
  taken.add(alias)
  return alias
}

function screenRef(screen: ScreenSettings | null, aliasOf: Map<string, string>): string {
  if (!screen || !screen.src) return '-'
  const key = screen.mediaId ?? screen.src
  return aliasOf.get(key) ?? aliasOf.get(screen.fileName ?? '') ?? '-'
}

function textFields(text: TextSettings): string {
  return [
    `font=${text.fontId}`,
    `size=${f(text.size, 3)}`,
    `color=${text.color}`,
    `opacity=${f(text.opacity, 2)}`,
    `align=${text.align}`,
    `spacing=${f(text.letterSpacing, 3)}`,
    `lineheight=${f(text.lineHeight, 2)}`,
    `wrap=${f(text.maxWidth, 2)}`,
  ].join(' ')
}

/** The scene as `key=value` pairs. `separator` is a space in the header line and
 * a comma inside a keyframe field, where a space would end the value. */
function sceneText(scene: SceneSettings, separator = ' ', aliasOf?: Map<string, string>): string {
  const bg = scene.background
  const parts: string[] = []
  if (bg.type === 'media') {
    const alias = aliasOf?.get(bg.mediaId ?? bg.src ?? '')
    parts.push(`bg=media`)
    if (alias) parts.push(`bgmedia=${alias}`)
    if (bg.fit !== 'cover') parts.push(`bgfit=${bg.fit}`)
    if (bg.overlay !== 0.25) parts.push(`bgoverlay=${f(bg.overlay, 2)}`)
    if (bg.blur > 0) parts.push(`bgblur=${f(bg.blur, 1)}`)
  } else {
    parts.push(`bg=${bg.type === 'gradient' ? 'gradient' : bg.type === 'transparent' ? 'none' : 'solid'}`)
    parts.push(`color=${bg.color}`)
    parts.push(`grad=${bg.from}>${bg.to}`)
    parts.push(`angle=${f(bg.angle, 0)}`)
  }
  parts.push(`env=${f(scene.envIntensity, 2)}`)
  parts.push(`exp=${f(scene.exposure, 2)}`)
  if (scene.shadow.enabled) {
    parts.push(`shadow=${f(scene.shadow.opacity, 2)}:${f(scene.shadow.blur, 2)}`)
  }
  return parts.join(separator)
}

/** The whole project, as the text file it is. */
export function toProjectText(state: EditorSnapshot): string {
  const lines: string[] = [HEADER]

  lines.push('', '# 项目')
  lines.push(`project = ${state.project.name}`)
  lines.push(`aspect = ${state.project.aspect}`)
  lines.push(`fps = ${state.timeline.fps}`)

  /* --- resources: everything an alias can point at ---------------------- */
  const taken = new Set<string>()
  const aliasOf = new Map<string, string>()
  const resourceLines: string[] = []

  for (const asset of state.media) {
    const alias = aliasFor(asset.name, taken)
    aliasOf.set(asset.id, alias)
    if (asset.name) aliasOf.set(asset.name, alias)
    const size = asset.width > 0 ? ` ${asset.width}x${asset.height}` : ''
    const duration = asset.duration > 0 ? ` ${f(asset.duration, 2)}s` : ''
    /**
     * The path is written **relative to the file being written**, because that is
     * what a reader resolves it against. An asset imported from
     * `promo/素材/封面.png` therefore goes into `promo/工程.txt` as `素材/封面.png`.
     */
    const path = asset.relativePath
      ? (relativeTo(state.project.sourcePath ?? '', asset.relativePath) ?? asset.name)
      : asset.name
    resourceLines.push(`${alias} = media:${quotedRef(path)}${duration}${size}`)
  }
  if (resourceLines.length > 0) {
    lines.push('', '# 素材库（名字 = 相对本文件的路径；blob 内容不在文件里）')
    lines.push(...resourceLines)
  }

  /* --- objects ---------------------------------------------------------- */
  const nameOfModel = new Map(MODEL_ASSETS.map((asset) => [asset.id, asset.name]))
  for (const object of state.objects) {
    const alias = aliasFor(object.name || object.id, taken)
    aliasOf.set(`object:${object.id}`, alias)

    const declaration: string[] = []
    if (object.kind === 'model') {
      declaration.push(`${alias} = model:${object.assetId}`)
    } else if (object.kind === 'media') {
      const mediaId = object.screen?.mediaId ?? object.screen?.src ?? ''
      const ref = aliasOf.get(mediaId) ?? aliasOf.get(object.screen?.fileName ?? '') ?? 'media'
      declaration.push(`${alias} = ${object.screen?.source === 'video' ? 'video' : 'image'}:${ref}`)
    } else {
      declaration.push(`${alias} = text`)
    }
    const quoted = `"${object.name.replace(/"/g, '\\"')}"`
    if (object.kind !== 'model') declaration.push(quoted)
    else if (nameOfModel.get(object.assetId) !== object.name) declaration.push(quoted)
    declaration.push(`color=${object.color}`)
    if (object.appearAt > 0) declaration.push(`appear=${f(object.appearAt, 2)}`)
    if (!object.visible) declaration.push('off')
    lines.push('', `# ${object.kind === 'model' ? '3D 模型' : object.kind === 'media' ? '图片 / 视频平面' : '文字'}`, declaration.join(' '))
    if (object.kind === 'text' && object.text) {
      lines.push(`  text ${textFields(object.text)} content="${object.text.content.replace(/"/g, '\\"')}"`)
    }

    // The scene belongs to the frame (场景信息也属于关键帧), so it rides on the
    // keyframe line — written when it *changes*, because repeating the same room
    // on every line would bury the frames that actually differ.
    let lastScene: string | null = null
    for (const frame of object.keyframes) {
      const scene = frame.pose.scene ? sceneText(frame.pose.scene, ',', aliasOf) : null
      lines.push(frameText(alias, frame, aliasOf, scene !== lastScene ? scene : null))
      lastScene = scene
    }

    if (object.screenClips.length > 0) {
      lines.push('')
      for (const clip of object.screenClips) lines.push(clipText(alias, clip, aliasOf))
    }
  }

  return `${lines.join('\n')}\n`
}

function frameText(
  alias: string,
  frame: ObjectKeyframe,
  aliasOf: Map<string, string>,
  scene: string | null,
): string {
  const { transform, lidOpenDeg, screen } = frame.pose
  const parts = [
    `t=${f(frame.time)}`,
    `p=${vec(transform.position, 3)}`,
    `s=${lidOpenDeg === null ? '-' : f(lidOpenDeg, 1)}`,
    `a=${vec(transform.rotation, 2)}`,
  ]
  if (transform.scale.some((value) => Math.abs(value - 1) > 1e-3)) {
    parts.push(`sc=${vec(transform.scale, 3)}`)
  }
  parts.push(`f=${screenRef(screen, aliasOf)}`)
  parts.push(`v=${speedText(frame.speed)}`)
  // 显隐：this frame has no object in it, and how it gets there. Two frames that
  // disagree make something disappear and come back; the mode belongs to the
  // frame being arrived at, so only that frame needs to say it.
  const hideMode = frame.pose.hideMode ?? 'cut'
  if (frame.pose.hidden) parts.push(hideMode === 'fade' ? 'hid=fade' : 'hid')
  else if (hideMode === 'fade') parts.push('vis=fade')
  if (scene) parts.push(`scene=${scene}`)
  if (frame.chained) parts.push('chain')
  return `@${alias} ${parts.join(' ')}`
}

function clipText(alias: string, clip: ScreenClip, aliasOf: Map<string, string>): string {
  const ref = aliasOf.get(clip.mediaId ?? clip.src) ?? aliasOf.get(clip.name) ?? 'media'
  return `@${alias}.clip ${clip.id} m=${ref} t=${f(clip.start)} in=${f(clip.inPoint)} out=${f(clip.outPoint)} v=${speedText(clip.speed)}`
}

/* ------------------------------------------------------------- reading -- */

export interface ParsedResource {
  alias: string
  kind: 'model' | 'media'
  ref: string
  /** Nominal seconds / pixel size, for a `media:` line (documentation only). */
  duration: number
  width: number
  height: number
}

export interface ParsedFrame {
  time: number
  position: Vec3 | null
  lid: number | null
  hasLid: boolean
  rotation: Vec3 | null
  scale: Vec3 | null
  screen: string | null
  speed: SpeedCurve | null
  /** The room at this frame, when the file spelled it out. */
  scene: ParsedScene | null
  /** `hid`: the object is not in this frame. */
  hidden: boolean
  /** `hid=fade` / `vis=fade`: this frame's visibility change fades. */
  hideMode: HideMode
  chained: boolean
}

export interface ParsedClip {
  id: string
  media: string
  start: number
  inPoint: number
  outPoint: number
  speed: SpeedCurve | null
}

export interface ParsedObject {
  alias: string
  kind: 'model' | 'media' | 'text'
  /** Model asset id, media alias, or '' for text. */
  ref: string
  source: 'image' | 'video'
  name: string | null
  color: string | null
  appearAt: number
  visible: boolean
  text: Partial<TextSettings> | null
  frames: ParsedFrame[]
  clips: ParsedClip[]
}

/** A scene read from the file: the same shape, plus the alias of a media backdrop. */
export interface ParsedScene extends Partial<SceneSettings> {
  /** Alias of the backdrop media, to be resolved against the library. */
  backgroundMedia?: string
}

export interface ParsedProject {
  name?: string
  aspect?: string
  fps?: number
  scene?: Partial<SceneSettings>
  resources: ParsedResource[]
  objects: ParsedObject[]
  errors: string[]
}

/** The reference after `kind:`; a leading quote keeps its spaces. */
function readRef(text: string, start: number): string {
  let index = start
  while (index < text.length && /\s/.test(text[index])) index += 1
  if (text[index] === '"') {
    const end = scanQuoted(text, index)
    return text.slice(index + 1, end).replace(/\\"/g, '"').replace(/"$/, '')
  }
  let end = index
  while (end < text.length && !/\s/.test(text[end])) end += 1
  return text.slice(index, end)
}

/** `key=value` fields; values never contain spaces (lists use `[…]`). */
function fields(text: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const token of text.split(/\s+/)) {
    if (!token) continue
    const eq = token.indexOf('=')
    if (eq < 0) {
      map.set(token, '')
      continue
    }
    map.set(token.slice(0, eq), token.slice(eq + 1))
  }
  return map
}

function num(map: Map<string, string>, key: string, fallback: number): number {
  const raw = map.get(key)
  if (raw === undefined) return fallback
  const value = Number(raw)
  return Number.isFinite(value) ? value : fallback
}

function parseVec(raw: string | undefined, digits = 2): Vec3 | null {
  if (!raw || raw === '-') return null
  const body = raw.replace(/^\[|\]$/g, '')
  const parts = body.split(',').map(Number)
  if (parts.length !== 3 || parts.some((value) => !Number.isFinite(value))) return null
  return parts.map((value) => Number(value.toFixed(digits))) as Vec3
}

/** `1.25` (flat) or `[0:1,0.5:0.2,1:1]` (nodes). */
function parseSpeed(raw: string | undefined): SpeedCurve | null {
  if (!raw) return null
  if (!raw.startsWith('[')) {
    const value = Number(raw)
    if (!Number.isFinite(value)) return null
    const curve = createSpeedCurve(2)
    curve.nodes[0].v = value
    curve.nodes[1].v = value
    curve.nodes = curve.nodes.map((node, index) => ({ ...node, v: value, t: index }))
    return curve
  }
  const body = raw.replace(/^\[|\]$/g, '')
  const nodes = body
    .split(',')
    .map((pair) => pair.split(':').map(Number))
    .filter((pair) => pair.length === 2 && pair.every((value) => Number.isFinite(value)))
    .map(([t, v]) => ({ t: Math.min(1, Math.max(0, t)), v }))
  if (nodes.length < 2) return null
  return smoothCurve(nodes)
}

/** Build a curve from `(t,v)` pairs, re-deriving the handles. */
function smoothCurve(points: Array<{ t: number; v: number }>): SpeedCurve {
  const nodes = points
    .slice()
    .sort((a, b) => a.t - b.t)
    .map((point, index, all) => {
      const t = index === 0 ? 0 : index === all.length - 1 ? 1 : point.t
      return {
        id: uid('speed'),
        t,
        v: Math.min(DEFAULT_MAX_SPEED, Math.max(0, point.v)),
        inHandle: [-0.2, 0] as [number, number],
        outHandle: [0.2, 0] as [number, number],
      }
    })
  // Slopes that make the ramp read as one smooth move, like the editor's own.
  return { nodes: autoSmoothNodes(nodes), maxSpeed: DEFAULT_MAX_SPEED }
}

function autoSmoothNodes(nodes: SpeedNode[]): SpeedNode[] {
  const result = nodes.map((node) => ({ ...node }))
  for (let i = 0; i < result.length; i++) {
    const prev = result[i - 1]
    const next = result[i + 1]
    const node = result[i]
    if (!prev || !next) {
      node.inHandle = [-0.12, 0]
      node.outHandle = [0.12, 0]
      continue
    }
    const slope = ((next.v - prev.v) / (next.t - prev.t)) * 0.4
    node.inHandle = [-(node.t - prev.t) * 0.4, -slope * (node.t - prev.t) * 0.4]
    node.outHandle = [(next.t - node.t) * 0.4, slope * (next.t - node.t) * 0.4]
  }
  return result
}

/** Parse the text file. Errors carry the 1-based line they came from. */
export function parseProjectText(text: string): ParsedProject {
  const result: ParsedProject = {
    resources: [],
    objects: [],
    errors: [],
  }
  const byAlias = new Map<string, ParsedObject>()
  let lastObject: ParsedObject | null = null
  let lineNo = 0

  for (const rawLine of text.split(/\r?\n/)) {
    lineNo++
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    /* scene … — a field list, so its first `=` is *inside* `bg=` */
    if (line === 'scene' || line.startsWith('scene ')) {
      result.scene = parseScene(fields(line.slice(5)))
      continue
    }

    /* an indented continuation of the object declared above it */
    if (line.startsWith('text ') || line === 'text') {
      if (!lastObject) {
        result.errors.push(`第 ${lineNo} 行：这一行 text 设置上面没有对象`)
        continue
      }
      lastObject.text = parseTextFields(line, lastObject.text)
      continue
    }

    /* @alias … — a keyframe, a clip, or the camera */
    if (line.startsWith('@')) {
      const space = line.search(/\s/)
      const head = space < 0 ? line : line.slice(0, space)
      const rest = space < 0 ? '' : line.slice(space + 1)
      const map = fields(rest)
      const target = head.slice(1)

      if (target === 'camera') {
        // The camera never moves in this editor, so a file has nothing to say
        // about it — but say *that*, rather than "unknown object".
        result.errors.push(`第 ${lineNo} 行：摄像机是固定的，工程文件里不需要 @camera`)
        continue
      }

      const [alias, suffix] = target.split('.')
      const object = byAlias.get(alias)
      if (!object) {
        result.errors.push(`第 ${lineNo} 行：@${alias} 之前没有声明过这个对象`)
        continue
      }
      if (suffix === 'clip') {
        const media = map.get('m') ?? ''
        object.clips.push({
          id: map.get('id') ?? uid('clip'),
          media,
          start: num(map, 't', 0),
          inPoint: num(map, 'in', 0),
          outPoint: num(map, 'out', 0),
          speed: parseSpeed(map.get('v')),
        })
        continue
      }
      if (suffix) {
        result.errors.push(`第 ${lineNo} 行：不认识的 @${alias}.${suffix}`)
        continue
      }
      // `scene=` is a *change marker*: the writer only spells it out when the
      // room differs from the frame before, so an absent field means "carry on"
      // (and `scene=-` says "this frame keys no scene at all").
      const hidden = map.has('hid')
      const hideMode: HideMode =
        map.get('hid') === 'fade' || map.get('vis') === 'fade' ? 'fade' : 'cut'
      const previousScene = object.frames[object.frames.length - 1]?.scene ?? null
      const rawScene = map.get('scene')
      const frameScene =
        rawScene === undefined
          ? previousScene
          : rawScene === '-'
            ? null
            : parseSceneFields(rawScene)

      object.frames.push({
        time: num(map, 't', 0),
        // Same precision the writer uses, so a file round-trips unchanged.
        position: parseVec(map.get('p'), 3),
        lid: Number.isFinite(Number(map.get('s'))) ? Number(map.get('s')) : null,
        hasLid: map.get('s') !== '-' && map.has('s'),
        rotation: parseVec(map.get('a'), 2),
        scale: parseVec(map.get('sc'), 3),
        screen: map.get('f') === '-' || !map.has('f') ? null : (map.get('f') as string),
        speed: parseSpeed(map.get('v')),
        // `scene=bg=solid,color=#101418,…` — the same vocabulary as the header
        // line, comma-separated because a space would end the field.
        scene: frameScene,
        hidden,
        hideMode,
        chained: map.has('chain'),
      })
      continue
    }

    /* `key = value` inside the header window, or an `alias = …` declaration */
    const eq = line.indexOf('=')
    if (eq < 0) {
      result.errors.push(`第 ${lineNo} 行：需要一个 = 或 @ 开头`)
      continue
    }
    const key = line.slice(0, eq).trim()
    const value = line.slice(eq + 1).trim()

    if (key === 'project') {
      result.name = value
      continue
    }
    if (key === 'aspect') {
      result.aspect = value
      continue
    }
    if (key === 'fps') {
      result.fps = Number(value)
      continue
    }
    if (key === 'scene') {
      result.scene = parseScene(fields(value))
      continue
    }

    /* alias = kind:ref [extras] — `ref` may be a quoted path with spaces */
    const map = fields(value)
    const colon = value.indexOf(':')
    const kind = colon < 0 ? value.split(/\s+/)[0] ?? '' : value.slice(0, colon).trim()
    const ref = colon < 0 ? '' : readRef(value, colon + 1)
    const quoted = /"((?:[^"\\]|\\.)*)"/.exec(value)

    if (kind === 'media') {
      result.resources.push({
        alias: key,
        kind: 'media',
        ref,
        duration: Number(map.get('dur') ?? 0) || 0,
        width: 0,
        height: 0,
      })
      continue
    }
    if (kind === 'model') {
      result.resources.push({ alias: key, kind: 'model', ref, duration: 0, width: 0, height: 0 })
      const object: ParsedObject = {
        alias: key,
        kind: 'model',
        ref,
        source: 'image',
        name: quoted ? quoted[1].replace(/\\"/g, '"') : null,
        color: map.get('color') ?? null,
        appearAt: num(map, 'appear', 0),
        visible: !map.has('off'),
        text: null,
        frames: [],
        clips: [],
      }
      result.objects.push(object)
      byAlias.set(key, object)
      lastObject = object
      continue
    }
    if (kind === 'image' || kind === 'video') {
      const object: ParsedObject = {
        alias: key,
        kind: 'media',
        ref,
        source: kind === 'video' ? 'video' : 'image',
        name: quoted ? quoted[1].replace(/\\"/g, '"') : null,
        color: map.get('color') ?? null,
        appearAt: num(map, 'appear', 0),
        visible: !map.has('off'),
        text: null,
        frames: [],
        clips: [],
      }
      result.objects.push(object)
      byAlias.set(key, object)
      lastObject = object
      continue
    }
    if (kind === 'text') {
      const object: ParsedObject = {
        alias: key,
        kind: 'text',
        ref: '',
        source: 'image',
        name: quoted ? quoted[1].replace(/\\"/g, '"') : null,
        color: map.get('color') ?? null,
        appearAt: num(map, 'appear', 0),
        visible: !map.has('off'),
        text: {},
        frames: [],
        clips: [],
      }
      result.objects.push(object)
      byAlias.set(key, object)
      lastObject = object
      continue
    }
    result.errors.push(`第 ${lineNo} 行：不认识的类型「${kind}」（可用 model / image / video / text / media）`)
  }

  return result
}

/** `text font=… size=… content="…"` — a typed slice of `TextSettings`. */
function parseTextFields(
  line: string,
  existing: Partial<TextSettings> | null,
): Partial<TextSettings> {
  const map = fields(line)
  const content = /content="((?:[^"\\]|\\.)*)"/.exec(line)
  const next: Partial<TextSettings> = { ...(existing ?? {}) }
  if (map.has('font')) next.fontId = map.get('font')
  if (map.has('size')) next.size = num(map, 'size', 0.3)
  if (map.has('color')) next.color = map.get('color')
  if (map.has('opacity')) next.opacity = num(map, 'opacity', 1)
  if (map.has('align')) next.align = map.get('align') as TextSettings['align']
  if (map.has('spacing')) next.letterSpacing = Math.min(1, Math.max(0, num(map, 'spacing', 0)))
  if (map.has('lineheight')) next.lineHeight = num(map, 'lineheight', 1.25)
  if (map.has('wrap')) next.maxWidth = num(map, 'wrap', 0)
  if (content) next.content = content[1].replace(/\\"/g, '"')
  return next
}

/** `bg=solid,color=#101418,grad=…` → a partial scene. `null` when absent. */
function parseSceneFields(value: string | undefined): Partial<SceneSettings> | null {
  if (!value) return null
  const map = new Map<string, string>()
  for (const part of value.split(',')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    map.set(part.slice(0, eq), part.slice(eq + 1))
  }
  return parseScene(map)
}

function parseScene(map: Map<string, string>): ParsedScene {
  let backgroundMedia: string | undefined
  const background: Partial<BackgroundSettings> = {}
  const type = map.get('bg')
  if (type === 'media') background.type = 'media'
  else if (type === 'gradient') background.type = 'gradient'
  else if (type === 'none' || type === 'transparent') background.type = 'transparent'
  else if (type === 'solid') background.type = 'solid'
  if (map.has('color')) background.color = map.get('color')
  const grad = map.get('grad')
  if (grad && grad.includes('>')) {
    const [from, to] = grad.split('>')
    background.from = from
    background.to = to
  }
  if (map.has('angle')) background.angle = num(map, 'angle', 160)
  // A media backdrop is referenced by resource alias; the URL is resolved later.
  if (map.has('bgmedia')) {
    background.type = 'media'
    backgroundMedia = map.get('bgmedia') as string
  }
  if (map.has('bgfit')) background.fit = map.get('bgfit') as MediaFit
  if (map.has('bgoverlay')) background.overlay = num(map, 'bgoverlay', 0.25)
  if (map.has('bgblur')) background.blur = num(map, 'bgblur', 0)

  const scene: ParsedScene = { background: background as BackgroundSettings }
  if (backgroundMedia) scene.backgroundMedia = backgroundMedia
  if (map.has('env')) scene.envIntensity = num(map, 'env', 1)
  if (map.has('exp')) scene.exposure = num(map, 'exp', 1)
  const shadow = map.get('shadow')
  scene.shadow = shadow
    ? (() => {
        const [opacity, blur] = shadow.split(':').map(Number)
        return {
          enabled: true,
          opacity: Number.isFinite(opacity) ? opacity : 0.55,
          blur: Number.isFinite(blur) ? blur : 2.6,
        }
      })()
    : { enabled: false, opacity: 0.55, blur: 2.6 }
  return scene
}

/* ----------------------------------------------------------- applying -- */

export interface ApplyResult {
  patch: Partial<EditorSnapshot>
  warnings: string[]
}

/**
 * Turn a parsed file into a state patch: objects (with their keyframes and
 * clips), the scene and the camera. Model resources resolve against the asset
 * registry; media resources resolve against the library by file name, because a
 * `blob:` URL in a text file would be meaningless in another session.
 */
export function applyParsedProject(
  parsed: ParsedProject,
  state: EditorSnapshot,
): ApplyResult {
  const warnings: string[] = []
  const mediaByName = new Map<string, MediaAsset>()
  for (const asset of state.media) {
    mediaByName.set(asset.name, asset)
    mediaByName.set(asset.name.replace(/\.[^.]+$/, ''), asset)
  }
  /**
   * Assets are matched by the path the code wrote — relative to the project file —
   * when the library knows where each file came from, and by bare file name
   * otherwise. That is what makes `assets/封面.png` find the right file even when
   * another `封面.png` sits somewhere else in the folder.
   */
  const mediaByPath = new Map<string, MediaAsset>()
  for (const asset of state.media) {
    if (asset.relativePath) mediaByPath.set(asset.relativePath.toLowerCase(), asset)
  }

  const mediaAlias = new Map<string, MediaAsset>()
  for (const resource of parsed.resources) {
    if (resource.kind !== 'media') continue
    const ref = resource.ref.replace(/^\.\//, '')
    const name = ref.split('/').pop() ?? ref
    const asset =
      mediaByPath.get(ref.toLowerCase()) ??
      mediaByName.get(name) ??
      mediaByName.get(name.replace(/\.[^.]+$/, ''))
    if (asset) mediaAlias.set(resource.alias, asset)
    else warnings.push(`资源 ${resource.alias} = ${resource.ref} 不在素材库里，引用它的帧会被跳过`)
  }

  /**
   * A `bg=media bgmedia=<alias>` points at a library asset; once it is resolved,
   * the backdrop becomes a real image/video behind the canvas (and in the shot).
   */
  const resolveSceneMedia = (scene: ParsedScene | null | undefined): ParsedScene | null => {
    if (!scene) return null
    if (!scene.backgroundMedia) return scene
    const base = state.scene.background
    const asset = mediaAlias.get(scene.backgroundMedia)
    if (!asset) {
      warnings.push(`背景素材 ${scene.backgroundMedia} 未找到，这一帧用纯色背景`)
      return { ...scene, background: { ...base, ...scene.background, type: 'solid' } }
    }
    return {
      ...scene,
      background: {
        ...base,
        ...scene.background,
        type: 'media',
        mediaId: asset.id,
        src: asset.src,
        source: asset.kind === 'video' ? 'video' : 'image',
      },
    }
  }

  const modelIds = new Set(MODEL_ASSETS.map((asset) => asset.id))
  /** `alias = model:…` first, because objects are meant to name their resource. */
  const modelAlias = new Map<string, string>()
  for (const resource of parsed.resources) {
    if (resource.kind === 'model') modelAlias.set(resource.alias, resource.ref)
  }
  const objects: SceneObject[] = []

  for (const parsedObject of parsed.objects) {
    const framePoses = parsedObject.frames
    const born = parsedObject.appearAt
    const first = framePoses[0]
    let transform: Transform = {
      position: first?.position ?? [0, 0, 0],
      rotation: first?.rotation ?? [0, 0, 0],
      scale: first?.scale ?? [1, 1, 1],
    }
    let screen: ScreenSettings | null = null
    let assetId = ''
    let text: TextSettings | null = null

    if (parsedObject.kind === 'model') {
      assetId = modelAlias.get(parsedObject.ref) ?? parsedObject.ref
      if (!modelIds.has(assetId)) {
        warnings.push(`模型资源 ${assetId} 未注册，跳过对象 ${parsedObject.alias}`)
        continue
      }
      screen = defaultScreen(assetId)
    } else if (parsedObject.kind === 'media') {
      const asset =
        mediaAlias.get(parsedObject.ref) ?? mediaByName.get(parsedObject.ref.split('/').pop() ?? '')
      if (!asset) {
        warnings.push(`素材 ${parsedObject.ref} 未找到，跳过对象 ${parsedObject.alias}`)
        continue
      }
      assetId = ''
      screen = screenFromAsset(asset, parsedObject.source)
    } else {
      text = textFromParsed(parsedObject.text)
    }

    const reference = parsedObject.frames.find((frame) => frame.position)
    if (reference?.position) transform = { ...transform, position: reference.position }

    const keyframes: ObjectKeyframe[] = []
    for (const frame of parsedObject.frames) {
      const pose: ObjectPose = {
        transform: {
          position: frame.position ?? transform.position,
          rotation: frame.rotation ?? transform.rotation,
          scale: frame.scale ?? transform.scale,
        },
        lidOpenDeg: frame.hasLid ? frame.lid : lidFor(assetId, parsedObject.kind),
        hidden: frame.hidden,
        hideMode: frame.hideMode,
        screen: frame.screen ? screenFor(frame.screen, mediaAlias) : null,
        // Deep-merged so a partial `scene=` still gets the rest from the
        // composition's scene rather than from nothing.
        scene: (() => {
          const resolved = resolveSceneMedia(frame.scene)
          if (!resolved) return null
          return {
            ...state.scene,
            ...resolved,
            background: { ...state.scene.background, ...resolved.background },
            shadow: { ...state.scene.shadow, ...resolved.shadow },
          }
        })(),
      }
      keyframes.push({
        id: uid('kf'),
        time: frame.time,
        pose,
        chained: frame.chained,
        sourceSpan: 0,
        speed: frame.speed ?? createSpeedCurve(2),
      })
    }
    // Spans follow from the times, exactly like the editor's own relayout.
    for (let i = 1; i < keyframes.length; i++) {
      keyframes[i].sourceSpan = keyframes[i].time - keyframes[i - 1].time
    }

    const clips: ScreenClip[] = []
    for (const parsedClip of parsedObject.clips) {
      const asset = mediaAlias.get(parsedClip.media)
      if (!asset) {
        warnings.push(`片段 ${parsedClip.id} 的素材 ${parsedClip.media} 未找到，已跳过`)
        continue
      }
      clips.push({
        id: parsedClip.id,
        mediaId: asset.id,
        src: asset.src,
        name: asset.name,
        start: parsedClip.start,
        inPoint: parsedClip.inPoint,
        outPoint: Math.max(parsedClip.inPoint + 0.05, parsedClip.outPoint),
        speed: parsedClip.speed ?? createSpeedCurve(2),
      })
    }

    const frames2 = keyframes
    objects.push({
      id: uid('object'),
      name: parsedObject.name ?? parsedObject.alias,
      kind: parsedObject.kind,
      assetId,
      transform: frames2[0]?.pose.transform ?? transform,
      visible: parsedObject.visible,
      locked: false,
      material: state.objects[0]?.material ?? {
        enabled: false,
        presetId: 'default',
        color: '#ffffff',
        metalness: 0.5,
        roughness: 0.4,
        opacity: 1,
      },
      lid: parsedObject.kind === 'model' ? defaultLidFor(assetId) : null,
      screen,
      text,
      color: parsedObject.color ?? '#4c8dff',
      screenClips: clips,
      keyframes: frames2,
      appearAt: born,
    })
  }

  const patch: Partial<EditorSnapshot> = { objects }

  /**
   * A file states the room on its keyframes, not in a header — the first frame of
   * an object already says what the scene is. The composition still needs a
   * fallback (frames that key nothing, objects with no keyframes), so take it from
   * the earliest frame the file spelled out.
   */
  const firstScene = parsed.objects
    .flatMap((object) => object.frames.map((frame) => ({ time: frame.time, scene: resolveSceneMedia(frame.scene) })))
    .filter((entry) => entry.scene)
    .sort((a, b) => a.time - b.time)[0]?.scene ?? null
  const sceneFromFrames: Partial<SceneSettings> | null = firstScene
    ? {
        ...firstScene,
        background: { ...state.scene.background, ...firstScene.background },
        shadow: { ...state.scene.shadow, ...firstScene.shadow },
      }
    : null
  const aspect = ASPECTS.find((entry) => entry === parsed.aspect)
  if (parsed.aspect && !aspect) warnings.push(`画幅 ${parsed.aspect} 不认识，已保留原画幅`)
  if (parsed.name || aspect) {
    patch.project = {
      ...state.project,
      ...(parsed.name ? { name: parsed.name } : {}),
      ...(aspect ? { aspect } : {}),
    }
  }
  const statedScene = resolveSceneMedia(parsed.scene as ParsedScene | undefined) ?? sceneFromFrames
  if (statedScene) {
    // Deep merge: a file only mentions the fields it cares about, and a shallow
    // spread would drop the rest of the background (from/to/angle/overlay/…).
    patch.scene = {
      ...state.scene,
      ...statedScene,
      background: { ...state.scene.background, ...statedScene.background },
      shadow: { ...state.scene.shadow, ...statedScene.shadow },
    }
  }
  /**
   * 摄像机固定，所以工程文件不描述它 —— 反过来说，应用一份工程就必须把机位**复位**成
   * 那个固定的默认取景，否则"同一份工程"会在留下过别的机位/机位关键帧的会话里拍出不同的画面。
   * (The format has nothing to say about the camera, so applying a file must not
   * inherit one: the composition's framing is the editor's constant.)
   */
  patch.camera = { ...DEFAULT_CAMERA, revision: state.camera.revision + 1 }
  // The editing viewport's orbit too: otherwise the scene you just opened appears
  // from whatever angle the last project left it in, which reads as "相机错位".
  patch.view = { ...DEFAULT_VIEW, revision: state.view.revision + 1 }
  patch.timeline = {
    ...(patch.timeline ?? state.timeline),
    cameraKeyframes: [],
    ...(typeof parsed.fps === 'number' && Number.isFinite(parsed.fps) ? { fps: parsed.fps } : {}),
  }
  return { patch, warnings }
}

function screenFor(
  alias: string,
  mediaAlias: Map<string, MediaAsset>,
): ScreenSettings | null {
  const asset = mediaAlias.get(alias)
  if (!asset) return null
  return screenFromAsset(asset, asset.kind === 'video' ? 'video' : 'image')
}

function screenFromAsset(asset: MediaAsset, source: 'image' | 'video'): ScreenSettings {
  return {
    enabled: true,
    source,
    src: asset.src,
    mediaId: asset.id,
    fileName: asset.name,
    duration: asset.duration,
    sourceAspect: asset.height > 0 ? asset.width / asset.height : 1.6,
    fit: 'cover',
    brightness: 1,
    rotation: 0,
    loop: true,
    muted: true,
    rate: 1,
  }
}

function defaultScreen(assetId: string): ScreenSettings | null {
  if (!findScreen(assetId)) return null
  return { ...emptyScreen(), enabled: true }
}

function defaultLidFor(assetId: string): SceneObject['lid'] {
  const hinge = findHinge(assetId)
  if (!hinge) return null
  return { openDeg: hinge.fullDeg, maxDeg: hinge.maxDeg, fullDeg: hinge.fullDeg }
}

function lidFor(assetId: string, kind: string): number | null {
  if (kind !== 'model') return null
  return findHinge(assetId)?.fullDeg ?? null
}

function emptyScreen(): ScreenSettings {
  return {
    enabled: false,
    source: 'image',
    src: null,
    mediaId: null,
    fileName: null,
    duration: 0,
    sourceAspect: 1.6,
    fit: 'cover',
    brightness: 1,
    rotation: 0,
    loop: true,
    muted: true,
    rate: 1,
  }
}

function textFromParsed(text: Partial<TextSettings> | null): TextSettings {
  return {
    content: text?.content ?? '文字',
    fontId: text?.fontId ?? 'wenkai',
    size: text?.size ?? 0.3,
    color: text?.color ?? '#ffffff',
    opacity: text?.opacity ?? 1,
    letterSpacing: text?.letterSpacing ?? 0,
    lineHeight: text?.lineHeight ?? 1.25,
    align: text?.align ?? 'center',
    maxWidth: text?.maxWidth ?? 0,
    billboard: false,
  }
}
