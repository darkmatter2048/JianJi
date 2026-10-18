import { Billboard, Text } from '@react-three/drei'
import { useRef } from 'react'
import * as THREE from 'three'
import { findFont, useFontCatalog } from '../../lib/fonts'
import { objectVisibilityAt } from '../../lib/keyframes'
import { useEditorStore } from '../../store/editorStore'
import type { SceneObject } from '../../types'
import { isRotationGizmoPart } from './RotationGizmo'
import { useObjectDrag } from './useObjectDrag'
import { useObjectTransform } from './useObjectTransform'

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

  if (!text) return null

  const anchorX = text.align === 'left' ? 'left' : text.align === 'right' ? 'right' : 'center'

  const body = (
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
