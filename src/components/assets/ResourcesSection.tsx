import { Music, Plus, Upload, X } from 'lucide-react'
import { useState } from 'react'
import { useT } from '../../lib/i18n'
import { formatDuration } from '../../lib/media'
import { useEditorStore } from '../../store/editorStore'
import type { MediaAsset } from '../../types'
import { Button, Empty, Tip } from '../ui/kit'
import { dropHandlers, useMediaImport } from './useMediaImport'

function Thumb({ asset }: { asset: MediaAsset }) {
  if (asset.kind === 'image') return <img src={asset.src} alt="" />
  if (asset.kind === 'video') return <video src={asset.src} muted preload="metadata" />
  return <Music size={20} style={{ color: 'var(--text-2)' }} />
}

/**
 * 资源 — the user's own imported media, as a grid.
 *
 * Import is the only action up here; what you do with an asset happens on the
 * asset itself: the green plus drops it into the scene as its own 3D object.
 */
export function ResourcesSection() {
  const t = useT()
  const media = useEditorStore((state) => state.media)
  const [dragActive, setDragActive] = useState(false)
  const importer = useMediaImport()

  return (
    <div
      className={`resources${dragActive ? ' resources--over' : ''}`}
      {...dropHandlers(importer.acceptFiles, setDragActive)}
    >
      <div className="section-actions">
        <Button
          variant="primary"
          icon={<Upload size={14} />}
          onClick={importer.open}
          disabled={importer.busy}
        >
          {importer.busy ? t('正在校验…') : t('导入')}
        </Button>
        {importer.input}
      </div>

      {importer.error ? (
        <div className="notice notice--error" onClick={importer.clearError}>
          {importer.error}
        </div>
      ) : null}

      <div className="ui-grid">
        {media.map((asset) => (
          <div className="ui-tile" key={asset.id}>
            <span className="ui-tile__thumb">
              <Thumb asset={asset} />
            </span>
            <span className="ui-tile__name" title={asset.name}>
              {asset.name}
            </span>
            {asset.kind !== 'image' ? (
              <span className="ui-tile__meta">{formatDuration(asset.duration)}</span>
            ) : null}
            {asset.kind !== 'audio' ? (
              <Tip label={t('添加到场景')}>
                <button
                  type="button"
                  className="ui-tile__action ui-tile__action--add"
                  aria-label={t('添加到场景')}
                  onClick={() => useEditorStore.getState().addMediaObject(asset.id)}
                >
                  <Plus size={13} strokeWidth={2.6} />
                </button>
              </Tip>
            ) : null}
            <Tip label={t('从项目中删除')}>
              <button
                type="button"
                className="ui-tile__action ui-tile__action--remove"
                aria-label={t('从项目中删除')}
                style={{ top: 5, bottom: 'auto', width: 17, height: 17 }}
                onClick={() => useEditorStore.getState().removeMediaAsset(asset.id)}
              >
                <X size={10} strokeWidth={2.8} />
              </button>
            </Tip>
          </div>
        ))}
      </div>

      {media.length === 0 ? (
        <Empty>
          {t('还没有素材。')}
          <br />
          {t('点「导入」，或把文件拖进来。')}
        </Empty>
      ) : null}
    </div>
  )
}
