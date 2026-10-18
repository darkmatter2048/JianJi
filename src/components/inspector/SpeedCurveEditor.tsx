import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import {
  DEFAULT_MAX_SPEED,
  SPEED_MAX_NODES,
  SPEED_MIN_NODES,
  insertSpeedNode,
  moveSpeedHandle,
  moveSpeedNode,
  segmentPoints,
} from '../../lib/speedCurve'
import type { SpeedCurve } from '../../types'

/**
 * Bézier speed ramp editor.
 *
 * x is the position inside the clip, y the speed multiplier. Nodes and their two
 * handles are dragged straight on the chart; changing the node count resamples
 * the shape that is already there, so going from 2 to 6 nodes keeps the curve
 * you had drawn. Handles mirror by default, `Alt` breaks the tangent.
 *
 * Interface only: this edits a `SpeedCurve`, and nothing in the timeline reads
 * it back yet.
 */

const W = 300
const H = 168
const PAD = { left: 26, right: 12, top: 12, bottom: 20 }
const PLOT_W = W - PAD.left - PAD.right
const PLOT_H = H - PAD.top - PAD.bottom

/** Presses smaller than this stay clicks, so selecting a node never nudges it. */
const DRAG_THRESHOLD = 2

type DragTarget = { type: 'node' | 'handle'; id: string; side?: 'in' | 'out' }

export function SpeedCurveEditor({
  curve,
  onChange,
  onCountChange,
  playhead,
}: {
  curve: SpeedCurve
  onChange: (next: SpeedCurve) => void
  /** The one knob besides the curve itself: how many nodes it is made of. */
  onCountChange: (count: number) => void
  /** 0..1 position of the timeline playhead inside the segment, or null. */
  playhead: number | null
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [selectedId, setSelectedId] = useState<string | null>(curve.nodes[0]?.id ?? null)
  const [hover, setHover] = useState<DragTarget | null>(null)

  const max = Math.max(1, curve.maxSpeed || DEFAULT_MAX_SPEED)
  const toX = (t: number) => PAD.left + t * PLOT_W
  const toY = (v: number) => PAD.top + PLOT_H - (v / max) * PLOT_H

  /** Pointer position in curve space, robust to the SVG being scaled by CSS. */
  const pointerToCurve = (event: { clientX: number; clientY: number }) => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0 || rect.height === 0) return { t: 0, v: 0 }
    const x = ((event.clientX - rect.left) / rect.width) * W
    const y = ((event.clientY - rect.top) / rect.height) * H
    return {
      t: (x - PAD.left) / PLOT_W,
      v: ((PAD.top + PLOT_H - y) / PLOT_H) * max,
    }
  }

  const selected = curve.nodes.find((node) => node.id === selectedId) ?? null

  const beginDrag = (target: DragTarget, event: ReactPointerEvent<SVGElement>) => {
    event.stopPropagation()
    event.preventDefault()
    setSelectedId(target.id)

    const startX = event.clientX
    const startY = event.clientY
    let moved = false

    const onMove = (move: PointerEvent) => {
      if (!moved) {
        if (Math.hypot(move.clientX - startX, move.clientY - startY) < DRAG_THRESHOLD) return
        moved = true
      }
      const point = pointerToCurve(move)
      const current = curve.nodes.find((node) => node.id === target.id)
      if (!current) return

      if (target.type === 'node') {
        onChange(moveSpeedNode(curve, target.id, point.t, point.v))
        return
      }
      const side = target.side ?? 'out'
      const offset: [number, number] = [point.t - current.t, point.v - current.v]
      onChange(moveSpeedHandle(curve, target.id, side, offset, move.altKey))
    }

    const onEnd = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onEnd)
      window.removeEventListener('pointercancel', onEnd)
      document.body.style.cursor = 'auto'
    }

    document.body.style.cursor = 'grabbing'
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onEnd)
    window.addEventListener('pointercancel', onEnd)
  }

  /** Clicking empty chart space drops a node there. */
  const onChartPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    const role = (event.target as SVGElement).dataset?.role
    if (role !== 'plot') return
    const point = pointerToCurve(event)
    if (point.t < 0.02 || point.t > 0.98) return
    const next = insertSpeedNode(curve, point.t, point.v)
    if (next === curve) return
    const added = next.nodes.reduce((closest, node) =>
      Math.abs(node.t - point.t) < Math.abs(closest.t - point.t) ? node : closest,
    )
    onChange(next)
    setSelectedId(added.id)
  }

  const path = curve.nodes
    .slice(0, -1)
    .map((node, index) => {
      const next = curve.nodes[index + 1]
      const [p0, p1, p2, p3] = segmentPoints(node, next)
      const start = `M${toX(p0[0]).toFixed(2)},${toY(p0[1]).toFixed(2)}`
      const c1 = `${toX(p1[0]).toFixed(2)},${toY(p1[1]).toFixed(2)}`
      const c2 = `${toX(p2[0]).toFixed(2)},${toY(p2[1]).toFixed(2)}`
      const end = `${toX(p3[0]).toFixed(2)},${toY(p3[1]).toFixed(2)}`
      return `${index === 0 ? start : ''} C${c1} ${c2} ${end}`
    })
    .join(' ')

  const area = `${path} L${toX(1).toFixed(2)},${toY(0).toFixed(2)} L${toX(0).toFixed(2)},${toY(0).toFixed(2)} Z`

  const speedTicks = [0, max / 4, max / 2, (max * 3) / 4, max]
  const timeLines = [0, 0.25, 0.5, 0.75, 1]

  return (
    <div className="speed">
      <div className="speed__chart">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="speed__svg"
          onPointerDown={onChartPointerDown}
        >
          <rect
            data-role="plot"
            x={PAD.left}
            y={PAD.top}
            width={PLOT_W}
            height={PLOT_H}
            className="speed__plot"
          />

          {timeLines.map((fraction) => (
            <line
              key={`t${fraction}`}
              x1={toX(fraction)}
              x2={toX(fraction)}
              y1={PAD.top}
              y2={PAD.top + PLOT_H}
              className="speed__grid"
            />
          ))}
          {speedTicks.map((value) => (
            <g key={`v${value}`}>
              <line
                x1={PAD.left}
                x2={PAD.left + PLOT_W}
                y1={toY(value)}
                y2={toY(value)}
                className={value === 1 ? 'speed__grid speed__grid--unit' : 'speed__grid'}
              />
              <text x={PAD.left - 5} y={toY(value) + 3} className="speed__tick speed__tick--y">
                {value.toFixed(value % 1 === 0 ? 0 : 1)}×
              </text>
            </g>
          ))}
          <text x={PAD.left} y={H - 5} className="speed__tick">
            0%
          </text>
          <text x={PAD.left + PLOT_W / 2} y={H - 5} className="speed__tick speed__tick--mid">
            50%
          </text>
          <text x={PAD.left + PLOT_W} y={H - 5} className="speed__tick speed__tick--end">
            100%
          </text>

          <path d={area} className="speed__area" />
          <path d={path} className="speed__curve" />

          {playhead !== null && playhead >= 0 && playhead <= 1 ? (
            <g className="speed__playhead">
              <line x1={toX(playhead)} x2={toX(playhead)} y1={PAD.top} y2={PAD.top + PLOT_H} />
              <circle cx={toX(playhead)} cy={PAD.top + PLOT_H} r={2.5} />
            </g>
          ) : null}

          {selected ? (
            <g>
              {(['in', 'out'] as const).map((side) => {
                const handle = side === 'in' ? selected.inHandle : selected.outHandle
                const hx = toX(selected.t + handle[0])
                const hy = toY(selected.v + handle[1])
                const active =
                  hover?.type === 'handle' && hover.id === selected.id && hover.side === side
                return (
                  <g key={side}>
                    <line
                      x1={toX(selected.t)}
                      y1={toY(selected.v)}
                      x2={hx}
                      y2={hy}
                      className="speed__handle-line"
                    />
                    <circle
                      cx={hx}
                      cy={hy}
                      r={active ? 5 : 4}
                      className="speed__handle"
                      onPointerDown={(event) =>
                        beginDrag({ type: 'handle', id: selected.id, side }, event)
                      }
                      onPointerEnter={() => setHover({ type: 'handle', id: selected.id, side })}
                      onPointerLeave={() => setHover(null)}
                    />
                  </g>
                )
              })}
            </g>
          ) : null}

          {curve.nodes.map((node) => {
            const isSelected = node.id === selectedId
            const isHovered = hover?.type === 'node' && hover.id === node.id
            return (
              <circle
                key={node.id}
                cx={toX(node.t)}
                cy={toY(node.v)}
                r={isSelected ? 5.5 : isHovered ? 5 : 4.2}
                className={`speed__node${isSelected ? ' speed__node--active' : ''}`}
                onPointerDown={(event) => beginDrag({ type: 'node', id: node.id }, event)}
                onPointerEnter={() => setHover({ type: 'node', id: node.id })}
                onPointerLeave={() => setHover(null)}
              />
            )
          })}
        </svg>
      </div>

      <div className="field">
        <div className="field__label">节点数</div>
        <div className="field__control">
          <button
            type="button"
            className="btn btn--icon"
            disabled={curve.nodes.length <= SPEED_MIN_NODES}
            onClick={() => onCountChange(curve.nodes.length - 1)}
            title="减少一个节点（按当前形状重采样）"
          >
            −
          </button>
          <input className="input input--center" value={curve.nodes.length} readOnly />
          <button
            type="button"
            className="btn btn--icon"
            disabled={curve.nodes.length >= SPEED_MAX_NODES}
            onClick={() => onCountChange(curve.nodes.length + 1)}
            title="增加一个节点（按当前形状重采样）"
          >
            +
          </button>
          <span className="field__hint">2 – {SPEED_MAX_NODES}</span>
        </div>
      </div>

    </div>
  )
}
