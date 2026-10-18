import { uid } from './ids'
import type { SpeedCurve, SpeedNode } from '../types'

/**
 * Cubic-Bézier speed ramps.
 *
 * x is the position inside the clip (0..1) and y is the speed multiplier, so a
 * flat line at 1 is "play at normal speed" and a dip is slow motion. Each node
 * carries two handles, exactly like a Bézier keyframe in an animation editor.
 *
 * NOTE: the timeline does not consume any of this yet — the panel is the
 * interface only. Everything here exists so the UI can be drawn and edited.
 */

export const SPEED_MIN_NODES = 2
export const SPEED_MAX_NODES = 8
export const DEFAULT_MAX_SPEED = 4

/** Handles stay inside this fraction of the gap to the next node. */
const HANDLE_LIMIT = 0.9

type Point = [number, number]

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function makeNode(t: number, v: number): SpeedNode {
  return { id: uid('speed'), t, v, inHandle: [-0.1, 0], outHandle: [0.1, 0] }
}

function cubic(p0: number, p1: number, p2: number, p3: number, s: number): number {
  const u = 1 - s
  return u * u * u * p0 + 3 * u * u * s * p1 + 3 * u * s * s * p2 + s * s * s * p3
}

/** The four control points of the segment between two nodes, in curve space. */
export function segmentPoints(a: SpeedNode, b: SpeedNode): [Point, Point, Point, Point] {
  return [
    [a.t, a.v],
    [a.t + a.outHandle[0], a.v + a.outHandle[1]],
    [b.t + b.inHandle[0], b.v + b.inHandle[1]],
    [b.t, b.v],
  ]
}

/**
 * Re-derive every handle from the neighbouring nodes (a Catmull-Rom-style
 * tangent). Used whenever nodes move or the node count changes, so the curve
 * stays smooth without the artist touching a single handle.
 */
export function autoSmooth(nodes: SpeedNode[]): SpeedNode[] {
  return nodes.map((current, index) => {
    const prev = nodes[index - 1]
    const next = nodes[index + 1]
    if (!prev && !next) return { ...current }

    const from = prev ?? current
    const to = next ?? current
    const span = Math.max(1e-4, to.t - from.t)
    const slope = (to.v - from.v) / span
    const back = (prev ? current.t - prev.t : span) / 3
    const forward = (next ? next.t - current.t : span) / 3

    return {
      ...current,
      inHandle: [-back, -slope * back] as Point,
      outHandle: [forward, slope * forward] as Point,
    }
  })
}

/** A flat 1× ramp — the neutral starting point for every clip. */
export function createSpeedCurve(count = 2, maxSpeed = DEFAULT_MAX_SPEED): SpeedCurve {
  const total = clamp(Math.round(count), SPEED_MIN_NODES, SPEED_MAX_NODES)
  const nodes: SpeedNode[] = []
  for (let index = 0; index < total; index += 1) {
    nodes.push(makeNode(index / (total - 1), 1))
  }
  return { nodes: autoSmooth(nodes), maxSpeed }
}

/** Speed at `t`, solved by walking the Bézier chain (x is not linear in s). */
export function evaluateSpeed(curve: SpeedCurve, t: number): number {
  const { nodes } = curve
  if (nodes.length === 0) return 1
  if (t <= nodes[0].t) return nodes[0].v
  const last = nodes[nodes.length - 1]
  if (t >= last.t) return last.v

  for (let index = 0; index < nodes.length - 1; index += 1) {
    const a = nodes[index]
    const b = nodes[index + 1]
    if (t > b.t) continue
    const [p0, p1, p2, p3] = segmentPoints(a, b)
    let low = 0
    let high = 1
    let s = 0.5
    for (let iteration = 0; iteration < 26; iteration += 1) {
      s = (low + high) / 2
      if (cubic(p0[0], p1[0], p2[0], p3[0], s) < t) low = s
      else high = s
    }
    return cubic(p0[1], p1[1], p2[1], p3[1], s)
  }
  return last.v
}

/** Rebuild the curve with `count` nodes, sampling the current shape. */
export function resampleSpeedCurve(curve: SpeedCurve, count: number): SpeedCurve {
  const total = clamp(Math.round(count), SPEED_MIN_NODES, SPEED_MAX_NODES)
  if (total === curve.nodes.length) return curve
  const nodes: SpeedNode[] = []
  for (let index = 0; index < total; index += 1) {
    const t = index / (total - 1)
    nodes.push(makeNode(t, clamp(evaluateSpeed(curve, t), 0, curve.maxSpeed)))
  }
  return { ...curve, nodes: autoSmooth(nodes) }
}

export function insertSpeedNode(curve: SpeedCurve, t: number, v: number): SpeedCurve {
  if (curve.nodes.length >= SPEED_MAX_NODES) return curve
  const nodes = [
    ...curve.nodes,
    makeNode(clamp(t, 0.02, 0.98), clamp(v, 0, curve.maxSpeed)),
  ].sort((a, b) => a.t - b.t)
  return { ...curve, nodes: autoSmooth(nodes) }
}

export function removeSpeedNode(curve: SpeedCurve, id: string): SpeedCurve {
  if (curve.nodes.length <= SPEED_MIN_NODES) return curve
  const nodes = curve.nodes.filter((entry) => entry.id !== id)
  return { ...curve, nodes: autoSmooth(nodes) }
}

/**
 * Move a node, keeping it between its neighbours and inside the speed axis.
 * Handles are rescaled so they can never cross into the next segment — that is
 * what keeps `evaluateSpeed`'s binary search valid.
 */
export function moveSpeedNode(
  curve: SpeedCurve,
  id: string,
  t: number,
  v: number,
): SpeedCurve {
  const index = curve.nodes.findIndex((entry) => entry.id === id)
  if (index < 0) return curve
  const min = index === 0 ? 0 : curve.nodes[index - 1].t + 0.02
  const max = index === curve.nodes.length - 1 ? 1 : curve.nodes[index + 1].t - 0.02
  const nodes = curve.nodes.map((entry, position) =>
    position === index
      ? { ...entry, t: clamp(t, min, max), v: clamp(v, 0, curve.maxSpeed) }
      : entry,
  )
  return { ...curve, nodes: autoSmooth(nodes) }
}

/**
 * Handle drag. The opposite handle mirrors by default; `broken` (Alt) lets the
 * two move independently, which is how you get a corner in the curve.
 */
export function moveSpeedHandle(
  curve: SpeedCurve,
  id: string,
  side: 'in' | 'out',
  offset: Point,
  broken: boolean,
): SpeedCurve {
  const index = curve.nodes.findIndex((entry) => entry.id === id)
  if (index < 0) return curve
  const node = curve.nodes[index]
  const left = index === 0 ? node.t : node.t - curve.nodes[index - 1].t
  const right =
    index === curve.nodes.length - 1 ? 1 - node.t : curve.nodes[index + 1].t - node.t

  const limit = (side === 'in' ? left : right) * HANDLE_LIMIT
  const clamped: Point =
    side === 'in'
      ? [-clamp(-offset[0], 0.01, limit), offset[1]]
      : [clamp(offset[0], 0.01, limit), offset[1]]

  const nodes = curve.nodes.map((entry, position) => {
    if (position !== index) return entry
    if (broken) {
      return side === 'in'
        ? { ...entry, inHandle: clamped }
        : { ...entry, outHandle: clamped }
    }
    // Mirror: same length, opposite direction.
    const mirrored: Point = [-clamped[0], -clamped[1]]
    return side === 'in'
      ? { ...entry, inHandle: clamped, outHandle: mirrored }
      : { ...entry, outHandle: clamped, inHandle: mirrored }
  })
  return { ...curve, nodes }
}

/**
 * Cut a ramp in two at normalised position `u`.
 *
 * Both halves are the *exact* sub-curves of the original: the straddling Bézier
 * segment is split with de Casteljau, then each half's x-axis is rescaled onto
 * 0..1 (handles stretched by the same factor, y left alone, which preserves the
 * tangents). The area under each half is therefore exactly the area the original
 * had over that stretch — and the area is what decides how long the piece lasts,
 * so splitting a clip never shifts a single later frame.
 *
 * The two halves come back independent: that is the whole point of cutting.
 */
export function sliceSpeedCurve(
  curve: SpeedCurve,
  u: number,
): { before: SpeedCurve; after: SpeedCurve } {
  const cut = clamp(u, 0.001, 0.999)
  const index = Math.max(
    0,
    curve.nodes.findIndex((_node, position) => {
      const next = curve.nodes[position + 1]
      return Boolean(next) && cut <= next.t
    }),
  )
  const a = curve.nodes[index]
  const b = curve.nodes[index + 1] ?? a

  // de Casteljau on the segment that contains the cut.
  const [p0, p1, p2, p3] = segmentPoints(a, b)
  const at = (from: Point, to: Point, s: number): Point => [
    from[0] + (to[0] - from[0]) * s,
    from[1] + (to[1] - from[1]) * s,
  ]
  const span = b.t - a.t
  const target = span <= 0 ? 1 : (cut - a.t) / span
  let low = 0
  let high = 1
  let s = target
  for (let iteration = 0; iteration < 26; iteration += 1) {
    s = (low + high) / 2
    if (cubic(p0[0], p1[0], p2[0], p3[0], s) < cut) low = s
    else high = s
  }
  const q0 = at(p0, p1, s)
  const q1 = at(p1, p2, s)
  const q2 = at(p2, p3, s)
  const r0 = at(q0, q1, s)
  const r1 = at(q1, q2, s)
  const middle = at(r0, r1, s) // the point on the curve at x = cut

  // Rescale x onto 0..1 for each half; y and the y-handles stay put.
  const rescale = (offset: number, width: number) => (node: SpeedNode): SpeedNode => ({
    ...node,
    id: uid('speed'),
    t: (node.t - offset) / width,
    inHandle: [node.inHandle[0] / width, node.inHandle[1]],
    outHandle: [node.outHandle[0] / width, node.outHandle[1]],
  })

  // Left half: ... , a (out handle → Q0), then the cut point (in handle → R0).
  // x' = x / cut, i.e. offset 0 and width `cut`.
  const before: SpeedNode[] = curve.nodes
    .filter((node) => node.t < a.t)
    .map(rescale(0, cut))
  before.push(
    rescale(0, cut)({ ...a, outHandle: [q0[0] - p0[0], q0[1] - p0[1]] }),
    rescale(0, cut)({
      ...a,
      t: cut,
      v: middle[1],
      inHandle: [r0[0] - middle[0], r0[1] - middle[1]],
      outHandle: [0.05, 0],
    }),
  )

  // Right half: the cut point (out handle → R1), then b (in handle → Q2), ...
  const after: SpeedNode[] = [
    rescale(cut, 1 - cut)({
      ...b,
      t: cut,
      v: middle[1],
      inHandle: [-0.05, 0],
      outHandle: [r1[0] - middle[0], r1[1] - middle[1]],
    }),
    rescale(cut, 1 - cut)({ ...b, inHandle: [q2[0] - p3[0], q2[1] - p3[1]] }),
  ]
  for (const node of curve.nodes.filter((entry) => entry.t > b.t)) {
    after.push(rescale(cut, 1 - cut)(node))
  }

  return {
    before: { ...curve, nodes: before },
    after: { ...curve, nodes: after },
  }
}

/* ---------------------------------------------------------------- presets */

export interface SpeedPreset {
  id: string
  name: string
  /** [t, v] pairs; handles are smoothed automatically. */
  shape: Array<[number, number]>
}

export const SPEED_PRESETS: SpeedPreset[] = [
  { id: 'constant', name: '匀速', shape: [[0, 1], [1, 1]] },
  { id: 'ramp-up', name: '缓入', shape: [[0, 0.4], [1, 1.8]] },
  { id: 'ramp-down', name: '缓出', shape: [[0, 1.8], [1, 0.4]] },
  { id: 'slow-middle', name: '中间慢放', shape: [[0, 2.2], [0.5, 0.35], [1, 2.2]] },
  { id: 'bullet-time', name: '子弹时间', shape: [[0, 0.35], [0.45, 2.6], [0.75, 2.6], [1, 0.35]] },
]

export function applySpeedPreset(curve: SpeedCurve, presetId: string): SpeedCurve {
  const preset = SPEED_PRESETS.find((entry) => entry.id === presetId)
  if (!preset) return curve
  const nodes = preset.shape.map(([t, v]) => makeNode(t, clamp(v, 0, curve.maxSpeed)))
  return { ...curve, nodes: autoSmooth(nodes) }
}
