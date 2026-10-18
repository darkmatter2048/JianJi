import { ChevronRight, Eye, EyeOff, LocateFixed, Plus, Trash2, Type, Upload } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { FONTS, useFontCatalog } from '../../lib/fonts'
import { useEditorStore } from '../../store/editorStore'
import type { SceneObject, TextAlign } from '../../types'
import { ColorField, Hint, SliderField, TextField } from '../ui/controls'
import { Button, Empty, Field, Segmented, Select, Tip } from '../ui/kit'

const ALIGNMENTS: Array<{ value: TextAlign; label: string }> = [
  { value: 'left', label: '左' },
  { value: 'center', label: '中' },
  { value: 'right', label: '右' },
]

function TextCard({
  object,
  expanded,
  onToggle,
}: {
  object: SceneObject
  expanded: boolean
  onToggle: () => void
}) {
  const selected = useEditorStore((state) => state.selectedObjectId === object.id)
  const customFonts = useEditorStore((state) => state.customFonts)
  const discovered = useFontCatalog((state) => state.discovered)
  const text = object.text
  const fontInputRef = useRef<HTMLInputElement>(null)
  if (!text) return null

  const update = (patch: Partial<NonNullable<SceneObject['text']>>) =>
    useEditorStore.getState().updateObjectText(object.id, patch)

  const allFonts = [...FONTS, ...discovered, ...customFonts]
  const labelOf = (font: { name: string; note: string }) =>
    font.note ? `${font.name} · ${font.note}` : font.name
  const fontOptions = [
    ...FONTS.map((font) => ({ value: font.id, label: labelOf(font) })),
    ...discovered.map((font) => ({ value: font.id, label: labelOf(font) })),
    ...customFonts.map((font) => ({ value: font.id, label: `${font.name} · 本地字体` })),
  ]

  const importFont = (file: File | undefined) => {
    if (!file) return
    const id = useEditorStore.getState().importFont(file)
    update({ fontId: id })
  }

  return (
    <div className={`acc${selected ? ' acc--selected' : ''}`}>
      <div
        className="acc__head"
        onClick={() => {
          onToggle()
          useEditorStore.getState().selectObject(object.id)
        }}
      >
        <ChevronRight
          className="acc__chevron"
          size={13}
          style={{ transform: expanded ? 'rotate(90deg)' : undefined }}
        />
        <Type className="acc__glyph" size={14} />
        <span className="acc__title">
          {/* The card *is* the text: its title is the content. */}
          <span className="acc__name truncate">{text.content || '（空）'}</span>
        </span>
        <Tip label={object.visible ? '隐藏' : '显示'}>
          <button
            type="button"
            className="mini-toggle"
            aria-label={object.visible ? '隐藏' : '显示'}
            onClick={(event) => {
              event.stopPropagation()
              useEditorStore.getState().setObjectVisible(object.id, !object.visible)
            }}
          >
            {object.visible ? <Eye size={13} /> : <EyeOff size={13} />}
          </button>
        </Tip>
        <Tip label="删除文字">
          <button
            type="button"
            className="mini-toggle"
            aria-label="删除文字"
            onClick={(event) => {
              event.stopPropagation()
              useEditorStore.getState().removeObject(object.id)
            }}
          >
            <Trash2 size={13} />
          </button>
        </Tip>
      </div>

      {expanded ? (
        <div className="acc__body">
          <TextField
            label="内容"
            textarea
            rows={3}
            value={text.content}
            onChange={(content) => update({ content })}
          />

          <Field label="字体">
            <div className="font-row">
              <Select
                value={text.fontId}
                options={fontOptions}
                onChange={(fontId) => update({ fontId })}
                ariaLabel="字体"
              />
              <input
                ref={fontInputRef}
                type="file"
                accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2"
                hidden
                onChange={(event) => {
                  importFont(event.target.files?.[0])
                  event.target.value = ''
                }}
              />
              <Tip label="导入本地字体（TTF / OTF / WOFF）">
                <button
                  type="button"
                  className="mini-toggle"
                  aria-label="导入本地字体"
                  onClick={() => fontInputRef.current?.click()}
                >
                  <Upload size={13} />
                </button>
              </Tip>
            </div>
          </Field>

          <SliderField
            label="字号"
            min={0.05}
            max={1.5}
            step={0.01}
            value={text.size}
            onChange={(size) => update({ size })}
          />
          <ColorField label="颜色" value={text.color} onChange={(color) => update({ color })} />
          <SliderField
            label="不透明度"
            min={0}
            max={1}
            step={0.01}
            value={text.opacity}
            onChange={(opacity) => update({ opacity })}
          />
          <SliderField
            label="字距"
            min={-0.05}
            max={0.4}
            step={0.005}
            value={text.letterSpacing}
            onChange={(letterSpacing) => update({ letterSpacing })}
          />
          <SliderField
            label="行高"
            min={0.8}
            max={2.2}
            step={0.05}
            value={text.lineHeight}
            onChange={(lineHeight) => update({ lineHeight })}
          />

          <div className="ui-field">
            <div className="ui-field__label">对齐</div>
            <Segmented
              wide
              value={text.align}
              options={ALIGNMENTS}
              onChange={(align) => update({ align })}
            />
          </div>

          <SliderField
            label="换行宽度"
            min={0}
            max={4}
            step={0.05}
            value={text.maxWidth}
            format={(value) => (value <= 0 ? '不换行' : value.toFixed(2))}
            onChange={(maxWidth) => update({ maxWidth })}
          />
          <Button
            icon={<LocateFixed size={13} />}
            onClick={() =>
              useEditorStore
                .getState()
                .setObjectTransform(object.id, { position: [0, 1.45, 0.7], rotation: [0, 0, 0] })
            }
          >
            复位位置
          </Button>

          {!allFonts.find((font) => font.id === text.fontId)?.cjk &&
          /[\u3000-\u9fff]/.test(text.content) ? (
            <Hint>当前字体不含中文字形，切到「霞鹜文楷」才能显示中文。</Hint>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/**
 * 文字 — 3D text objects. They live in the same scene graph as devices, so they
 * follow the same transform, selection and timeline rules.
 */
export function TextSection() {
  const objects = useEditorStore((state) => state.objects)
  const texts = useMemo(() => objects.filter((object) => object.kind === 'text'), [objects])
  const [expandedId, setExpandedId] = useState<string | null>(null)

  return (
    <div>
      <div className="section-actions">
        <Button
          variant="primary"
          icon={<Plus size={14} />}
          onClick={() => {
            const id = useEditorStore.getState().addTextObject('UAE2 Studio')
            setExpandedId(id)
          }}
        >
          新建文字
        </Button>
        <span className="asset-section__hint">共 {texts.length} 个</span>
      </div>

      <div className="acc-list">
        {texts.map((object) => (
          <TextCard
            key={object.id}
            object={object}
            expanded={expandedId === object.id}
            onToggle={() => setExpandedId(expandedId === object.id ? null : object.id)}
          />
        ))}
        {texts.length === 0 ? (
          <Empty>
            还没有文字。
            <br />
            点上面的「新建文字」加一条，然后在 3D 场景里拖动或用参数区调整。
          </Empty>
        ) : null}
      </div>
    </div>
  )
}
