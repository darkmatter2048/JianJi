import { Plus, Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { MODEL_ASSETS, findAsset, type ModelAsset } from '../../lib/assets'
import { useEditorStore } from '../../store/editorStore'
import type { DeviceTab } from '../../types'
import { Empty, Tab, TabList, Tabs, Tip } from '../ui/kit'

/* ---------------------------------------------------------------- library */

function DeviceGlyph({ size = 34, form = 'laptop' }: { size?: number; form?: 'phone' | 'laptop' }) {
  if (form === 'phone') {
    return (
      <svg width={size * 0.6} height={size} viewBox="0 0 22 36" fill="none" aria-hidden>
        <rect x="3" y="1.5" width="16" height="33" rx="2.8" stroke="#8ea4c8" strokeWidth="1.2" />
        <rect x="5.2" y="4.2" width="11.6" height="27" rx="1.2" fill="#1b2233" />
        <rect x="9.1" y="32.1" width="3.8" height="0.9" rx="0.45" fill="#8ea4c8" />
      </svg>
    )
  }
  return (
    <svg width={size} height={size * 0.7} viewBox="0 0 34 24" fill="none" aria-hidden>
      <rect x="7" y="2" width="20" height="13" rx="1.4" stroke="#8ea4c8" strokeWidth="1.1" />
      <rect x="9" y="4" width="16" height="9" rx="0.8" fill="#1b2233" />
      <path d="M2 17.6h30l-1.6 3.2H3.6L2 17.6Z" fill="#2b3446" stroke="#8ea4c8" strokeWidth="1.1" />
      <rect x="13.4" y="18.4" width="7.2" height="1" rx="0.5" fill="#8ea4c8" />
    </svg>
  )
}

function matches(asset: ModelAsset, query: string): boolean {
  const haystack = [asset.name, asset.note, asset.id, ...(asset.keywords ?? [])]
    .join(' ')
    .toLowerCase()
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => haystack.includes(token))
}

function DeviceLibrary({ onAdded }: { onAdded: (id: string) => void }) {
  const [query, setQuery] = useState('')
  const objects = useEditorStore((state) => state.objects)

  const results = useMemo(
    () => MODEL_ASSETS.filter((asset) => matches(asset, query)),
    [query],
  )

  const addToScene = (asset: ModelAsset) => {
    const id = useEditorStore.getState().addObject(asset.id, asset.name)
    onAdded(id)
  }

  const selectFirst = (asset: ModelAsset) => {
    const existing = useEditorStore.getState().objects.find((object) => object.assetId === asset.id)
    if (existing) useEditorStore.getState().selectObject(existing.id)
  }

  return (
    <div>
      <div className="search">
        <Search className="search__icon" size={14} />
        <input
          className="ui-input search__input"
          placeholder="在此处搜索设备"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          spellCheck={false}
        />
        {query ? (
          <Tip label="清除">
            <button
              type="button"
              className="search__clear"
              aria-label="清除"
              onClick={() => setQuery('')}
            >
              <X size={12} />
            </button>
          </Tip>
        ) : null}
      </div>

      <div className="ui-grid">
        {results.map((asset) => {
          const instances = objects.filter((object) => object.assetId === asset.id)
          return (
            <div key={asset.id} className="ui-tile">
              <span className="ui-tile__thumb">
                <DeviceGlyph size={44} form={asset.form} />
              </span>
              <span className="ui-tile__name" title={asset.name}>
                {asset.name}
              </span>
              <Tip label="添加到场景">
                <button
                  type="button"
                  className="ui-tile__action ui-tile__action--add"
                  aria-label="添加到场景"
                  onClick={() => addToScene(asset)}
                >
                  <Plus size={13} strokeWidth={2.6} />
                </button>
              </Tip>
              {instances.length > 0 ? (
                <Tip label="已在场景中，点击选中">
                  <button
                    type="button"
                    className="ui-badge ui-badge--accent"
                    style={{ position: 'absolute', top: 5, left: 5, border: 0, cursor: 'pointer' }}
                    onClick={() => selectFirst(asset)}
                  >
                    {instances.length}
                  </button>
                </Tip>
              ) : null}
            </div>
          )
        })}
        {results.length === 0 ? (
          <Empty>
            没有匹配「{query}」的设备。
            <br />
            把 glTF 放进 public/models/，再到 lib/assets.ts 注册即可。
          </Empty>
        ) : null}
      </div>
    </div>
  )
}

/* ----------------------------------------------------------- screen panel */


/* -------------------------------------------------------------- accordion */

/* ---------------------------------------------------------------- section */

export function DevicesSection() {
  const tab = useEditorStore((state) => state.ui.deviceTab)
  const setTab = useEditorStore((state) => state.setDeviceTab)
  const objects = useEditorStore((state) => state.objects)
  const devices = useMemo(() => objects.filter((object) => object.kind === 'model'), [objects])
  const selectedObjectId = useEditorStore((state) => state.selectedObjectId)

  return (
    <div>
      <Tabs value={tab} onValueChange={(next) => setTab(next as DeviceTab)}>
        <TabList>
          <Tab value="library">库</Tab>
          <Tab value="scene">场景{devices.length > 0 ? ` · ${devices.length}` : ''}</Tab>
        </TabList>
      </Tabs>

      {tab === 'library' ? (
        <DeviceLibrary onAdded={() => setTab('scene')} />
      ) : (
        <div className="ui-grid">
          {devices.map((device) => (
            <div
              key={device.id}
              className={`ui-tile${device.id === selectedObjectId ? ' ui-tile--on' : ''}`}
            >
              <button
                type="button"
                className="ui-tile__open"
                onClick={() => useEditorStore.getState().selectObject(device.id)}
              >
                <span className="ui-tile__thumb">
                  <DeviceGlyph size={44} form={findAsset(device.assetId)?.form} />
                </span>
                <span className="ui-tile__name">{device.name}</span>
              </button>
              <Tip label="从场景中移除">
                <button
                  type="button"
                  className="ui-tile__action ui-tile__action--remove"
                  aria-label="从场景中移除"
                  onClick={() => useEditorStore.getState().removeObject(device.id)}
                >
                  <X size={12} strokeWidth={2.6} />
                </button>
              </Tip>
            </div>
          ))}
          {devices.length === 0 ? (
            <Empty>
              场景里还没有设备。
              <br />
              切到「库」标签页添加一个。
            </Empty>
          ) : null}
        </div>
      )}
    </div>
  )
}
