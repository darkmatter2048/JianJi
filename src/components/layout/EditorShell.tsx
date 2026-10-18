import { useEffect } from 'react'
import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels'
import { AssetPanel } from '../assets/AssetPanel'
import { InspectorPanel } from '../inspector/InspectorPanel'
import { Timeline, timelineHeightFor } from '../timeline/Timeline'
import { Viewport } from '../viewport/Viewport'
import { useEditorStore } from '../../store/editorStore'

/**
 * The classic editor arrangement:
 *
 *   ┌──────────┬─────────────────┬────────────┐
 *   │  素材区  │     编辑区      │   参数区   │
 *   ├──────────┴─────────────────┴────────────┤
 *   │              时间线 (贯穿底部)           │
 *   └─────────────────────────────────────────┘
 *
 * Every boundary is draggable; panel sizes are pixel-based for the two side
 * rails and percentage-based for the timeline.
 *
 * The timeline panel grows with its row count — one row per object — so adding
 * objects never squeezes the lanes into a scrollbar-sized strip. It caps out at
 * about half the window, after which the lanes scroll.
 */
export function EditorShell() {
  const timelineRef = usePanelRef()
  const objectCount = useEditorStore((state) => state.objects.length)
  // Objects with video also get a clip row, so the panel has to fit both.
  const clipRowCount = useEditorStore(
    (state) => state.objects.filter((object) => object.screenClips.length > 0).length,
  )

  /**
   * Grow the timeline when the rows no longer fit — one row per object — and never
   * shrink it: whatever the artist dragged the separator to is theirs to keep.
   */
  useEffect(() => {
    const panel = timelineRef.current
    if (!panel) return
    const cap = Math.min(window.innerHeight * 0.62, 520)
    const needed = Math.min(timelineHeightFor(objectCount, clipRowCount), cap)
    if (needed > panel.getSize().inPixels + 1) panel.resize(needed)
  }, [objectCount, clipRowCount, timelineRef])

  return (
    <Group orientation="vertical" className="group" id="shell">
      <Panel id="stage" defaultSize="72%" minSize="30%">
        <Group orientation="horizontal" className="group" id="stage-columns">
          <Panel id="assets" defaultSize={272} minSize={210} maxSize={460}>
            <AssetPanel />
          </Panel>
          <Separator className="sep sep--col" />
          <Panel id="viewport" minSize="25%">
            <Viewport />
          </Panel>
          <Separator className="sep sep--col" />
          <Panel id="inspector" defaultSize={312} minSize={240} maxSize={520}>
            <InspectorPanel />
          </Panel>
        </Group>
      </Panel>

      <Separator className="sep sep--row" />

      <Panel
        id="timeline"
        defaultSize={timelineHeightFor(1)}
        minSize={150}
        maxSize="72%"
        panelRef={timelineRef}
      >
        <Timeline />
      </Panel>
    </Group>
  )
}
