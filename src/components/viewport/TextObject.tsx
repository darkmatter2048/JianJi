import { Billboard, Text } from '@react-three/drei'
import { useRef } from 'react'
import * as THREE from 'three'
import { findFont, useFontCatalog } from '../../lib/fonts'
import { objectVisibilityAt } from '../../lib/keyframes'
import { useEditorStore } from '../../store/editorStore'
import type { ProjectAspect, SceneObject } from '../../types'
import { isRotationGizmoPart } from './RotationGizmo'
import { useObjectDrag } from './useObjectDrag'
import { useObjectTransform } from './useObjectTransform'

/** 各画幅在拍摄距离处的可见宽度（单位，约等于 shot 相机的横向取景）。 */
const FRAME_WIDTH: Record<ProjectAspect, number> = {
  '16:9': 5.15,
  '9:16': 1.63,
  '1:1': 2.89,
  '4:5': 2.31,
  '21:9': 6.75,
}

/** 粗略估算一行文字渲染后的世界宽度：CJK 全角、拉丁/数字约 0.55 宽。 */
function estimateTextWidth(content: string, fontSize: number, letterSpacing: number): number {
  const lines = content.split('\n')
  let widest = 0
  for (const line of lines) {
    let width = 0
    for (const ch of line) {
      if (ch === ' ') width += fontSize * 0.3
      else if (/[\u3000-\u9fff\uff00-\uffef]/.test(ch)) width += fontSize * 1.0
      else width += fontSize * 0.55
    }
    width += letterSpacing * Math.max(0, line.length - 1)
    widest = Math.max(widest, width)
  }
  return widest
}

/**
 * Renders one `kind: 'text'` object with troika (through drei's `<Text>`).
 *
 * The font is either a bundled face inside `public/fonts/` or a blob URL the
 * user imported from disk — never a CDN, so an offline or firewalled machine
 * would otherwise stage empty glyphs with no error.
 */
export function TextObject({ object }: { object: SceneObject }) {
  /**
   * 渐隐 / 渐显, as a number between 0 and 1.
   *
   * Troika's text does not read `material.opacity` (its glyphs answer to
   * `fillOpacity`, and the component pushes that into its own uniform every
   * frame), so a text fade has to travel through the prop. It is exactly 1 except
   * during a fade, so this costs no extra renders otherwise.
   */
  const fade = useEditorStore((state) =>
    objectVisibilityAt(
      state.objects.find((entry) => entry.id === object.id)?.keyframes ?? [],
      state.timeline.currentTime,
    ).opacity,
  )
  const groupRef = useRef<THREE.Group>(null)
  const draggingRef = useRef(false)
  const dragCleanup = useRef<(() => void) | null>(null)
  const beginMoveDrag = useObjectDrag(object, draggingRef, dragCleanup)
  const selectObject = useEditorStore((state) => state.selectObject)
  const customFonts = useEditorStore((state) => state.customFonts)
  const discovered = useFontCatalog((state) => state.discovered)
  const text = object.text
  // Local (imported) fonts first, then the fonts directory, then the bundled set.
  const font =
    customFonts.find((entry) => entry.id === text?.fontId) ??
    discovered.find((entry) => entry.id === text?.fontId) ??
    findFont(text?.fontId ?? '')

  useObjectTransform(groupRef, object)
  const aspect = useEditorStore((state) => state.project.aspect)

  if (!text) return null

  const anchorX = text.align === 'left' ? 'left' : text.align === 'right' ? 'right' : 'center'

  // 文字太宽会冲出画框：按画幅可见宽度自动等比缩小（只缩不放，保留用户的有意缩放）。
  const maxTextWidth = (FRAME_WIDTH[aspect] ?? 5.15) * 0.9
  const estimatedWidth = estimateTextWidth(text.content, text.size, text.letterSpacing)
  const fitScale = estimatedWidth > maxTextWidth ? Math.min(1, maxTextWidth / estimatedWidth) : 1

  const body = (
    <group scale={fitScale}>
      <Text
        font={font.url}
        fontSize={text.size}
        color={text.color}
        anchorX={anchorX}
        anchorY="middle"
        textAlign={text.align}
        letterSpacing={text.letterSpacing}
        lineHeight={text.lineHeight}
        maxWidth={text.maxWidth > 0 ? text.maxWidth : undefined}
        outlineWidth={0}
        fillOpacity={text.opacity * fade}
        material-transparent={text.opacity * fade < 0.999}
        material-depthWrite={text.opacity * fade >= 0.999}
      >
        {text.content}
      </Text>
    </group>
  )

  return (
    <group
      ref={groupRef}
      name={object.id}
      visible={object.visible}
      onPointerDown={(event) => {
        event.stopPropagation()
        selectObject(object.id)
        // Text is a 3D object like any other: left-drag moves it.
        if (event.button !== 0) return
        if (event.intersections.some((hit) => isRotationGizmoPart(hit.object))) return
        beginMoveDrag(event)
      }}
      onPointerMove={(event) => {
        if (draggingRef.current) return
        event.stopPropagation()
        document.body.style.cursor = 'pointer'
      }}
      onPointerOut={() => {
        if (draggingRef.current) return
        document.body.style.cursor = 'auto'
      }}
    >
      {text.billboard ? <Billboard>{body}</Billboard> : body}
    </group>
  )
}
