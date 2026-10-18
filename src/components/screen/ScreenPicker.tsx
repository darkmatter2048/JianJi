import { ImagePlus, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { useT } from '../../lib/i18n'
import { formatBytes, probeMediaFile } from '../../lib/media'
import { resolveScreenState } from '../../lib/keyframes'
import { screenPatchFromFile, useEditorStore } from '../../store/editorStore'
import type { SceneObject, ScreenFit, ScreenSettings } from '../../types'
import { Segmented } from '../ui/kit'
import { Hint } from '../ui/controls'

const FIT_OPTIONS: Array<{ value: ScreenFit; label: string }> = [
  { value: 'tile', label: '平铺' },
  { value: 'cover', label: '裁剪' },
  { value: 'fill', label: '填充' },
]

/**
 * The one job of 对象 inside a keyframe: which picture or clip is on the panel.
 *
 * Deliberately nothing else — no fit, rotation, brightness, loop or rate. Those
 * belong to the screen in 素材区 → 设备; here you only decide *what* is playing.
 */
export function ScreenPicker({ object }: { object: SceneObject }) {
  const t = useT()
  /**
   * The texture is read from the frame under the playhead, not from the object's
   * resting screen — that is the whole point of keying it.
   */
  const screen = useEditorStore((state) => {
    const live = state.objects.find((entry) => entry.id === object.id) ?? object
    return resolveScreenState(live.keyframes, state.timeline.currentTime, live.screen)
  })
  const inputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)

  if (!screen) return <Hint>这个模型没有屏幕材质，无法贴图。</Hint>

  const setScreen = (patch: Partial<ScreenSettings>) =>
    useEditorStore.getState().setObjectScreen(object.id, patch)

  const accept = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    setError(null)
    const probe = await probeMediaFile(file)
    setBusy(false)
    if (!probe.ok) {
      setError(probe.message)
      return
    }
    setScreen(screenPatchFromFile(file, probe.info?.duration ?? 0))
    if (file.size > 64 * 1024 * 1024) {
      setError(`已载入 ${formatBytes(file.size)}，大文件首帧可能有延迟`)
    }
  }

  return (
    <div className="screen-picker">
      <div
        className={`ui-drop${dragging ? ' ui-drop--over' : ''}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          void accept(event.dataTransfer.files[0])
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*,video/*"
          hidden
          onChange={(event) => {
            void accept(event.target.files?.[0])
            event.target.value = ''
          }}
        />
        <ImagePlus size={20} />
        <span>{busy ? t('正在校验…') : t('拖入或点击选择图片 / 视频')}</span>
      </div>

      {screen.src ? (
        <>
          <div className="screen-picker__now">
            <span className="screen-picker__dot" data-on={screen.source === 'video'} />
            {screen.source === 'video' ? t('视频') : t('图片')} · {screen.fileName ?? t('素材')}
            {screen.duration > 0.1 ? ` · ${screen.duration.toFixed(2)}s` : ''}
            <button
              type="button"
              className="screen-picker__clear"
              onClick={() => useEditorStore.getState().clearObjectScreen(object.id)}
            >
              <Trash2 size={12} />
              {t('清除')}
            </button>
          </div>
          <div className="screen-picker__fit">
            <Segmented
              wide
              value={screen.fit}
              options={FIT_OPTIONS.map((entry) => ({ ...entry, label: t(entry.label) }))}
              onChange={(fit) => setScreen({ fit })}
            />
          </div>
        </>
      ) : (
        <Hint>{t('屏幕上还没有贴图。')}</Hint>
      )}

      {error ? <div className="notice notice--error">{error}</div> : null}
    </div>
  )
}
