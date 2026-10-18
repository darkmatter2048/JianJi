import { Code2, Images, Laptop, Type } from 'lucide-react'
import { useT } from '../../lib/i18n'
import { useEditorStore } from '../../store/editorStore'
import type { LeftNav } from '../../types'
import { Badge, Tip } from '../ui/kit'
import { CodeSection } from './CodeSection'
import { DevicesSection } from './DevicesSection'
import { ResourcesSection } from './ResourcesSection'
import { TextSection } from './TextSection'

const NAV: Array<{ id: LeftNav; label: string; hint: string; icon: typeof Images }> = [
  { id: 'resources', label: '资源', hint: '自己导入的图片 / 视频 / 音频', icon: Images },
  { id: 'devices', label: '设备', hint: '设备库与场景中的设备', icon: Laptop },
  { id: 'text', label: '文字', hint: '3D 文字对象', icon: Type },
  { id: 'code', label: '代码', hint: '工程即文本：查看 / 编辑 / 应用', icon: Code2 },
]

/**
 * The asset rail: a vertical nav on the left edge, one section at a time.
 *
 * Each section owns its own store slice, so switching costs nothing and the
 * rail never has to know how a device, a stage or a text object is edited.
 */
export function AssetPanel() {
  const t = useT()
  const leftNav = useEditorStore((state) => state.ui.leftNav)
  const setLeftNav = useEditorStore((state) => state.setLeftNav)
  const mediaCount = useEditorStore((state) => state.media.length)
  const deviceCount = useEditorStore(
    (state) => state.objects.filter((object) => object.kind === 'model').length,
  )
  /** Images and clips that have been dropped into the scene. */
  const mediaObjectCount = useEditorStore(
    (state) => state.objects.filter((object) => object.kind === 'media').length,
  )
  const textCount = useEditorStore(
    (state) => state.objects.filter((object) => object.kind === 'text').length,
  )

  const counts: Record<LeftNav, number> = {
    resources: mediaCount + mediaObjectCount,
    devices: deviceCount,
    text: textCount,
    // 代码 is a view of the whole project, so it has nothing to count.
    code: 0,
  }

  return (
    <div className="panel panel--rail">
      <nav className="rail">
        {NAV.map((entry) => {
          const Icon = entry.icon
          const count = counts[entry.id]
          return (
            <Tip key={entry.id} label={t(entry.hint)} side="right">
              <button
                type="button"
                className={`rail__item${leftNav === entry.id ? ' rail__item--active' : ''}`}
                onClick={() => setLeftNav(entry.id)}
              >
                <span className="rail__icon">
                  <Icon size={17} strokeWidth={1.7} />
                </span>
                <span className="rail__label">{t(entry.label)}</span>
                {count > 0 ? <Badge>{count}</Badge> : null}
              </button>
            </Tip>
          )
        })}
      </nav>

      <div className="panel__body panel__body--rail">
        {leftNav === 'resources' ? <ResourcesSection /> : null}
        {leftNav === 'devices' ? <DevicesSection /> : null}
        {leftNav === 'text' ? <TextSection /> : null}
        {leftNav === 'code' ? <CodeSection /> : null}
      </div>
    </div>
  )
}
