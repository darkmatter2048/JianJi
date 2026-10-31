import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { requestShotCapture } from './lib/capture'
import { registerSaveAndClose } from './lib/desktop'
import { loadDiscoveredFonts } from './lib/fonts'
import { saveProject } from './lib/workspace'
import { toProjectText } from './lib/projectText'
import { markClean, useEditorStore } from './store/editorStore'
import './styles/app.css'
import './styles/asset-rail.css'
import './styles/viewport.css'
// The kit loads last: it owns the component skin, the shell files own layout.
import './styles/kit.css'

const container = document.getElementById('root')
if (!container) throw new Error('UAE2 Studio: #root container is missing')

// Populate the font picker from the local fonts directory before the first paint.
loadDiscoveredFonts()

// 桌面端关闭前的「保存并关闭」：主进程弹窗选「保存」后走到这里。
registerSaveAndClose(async () => {
  const store = useEditorStore.getState()
  const text = toProjectText(store)
  const name = store.project.name || '未命名项目'
  const saved = await saveProject(name, text)
  if (saved) markClean()
  return !!saved
})

// Dev-only console/automation bridge: inspect and drive the editor from the
// browser console (`__UAE2__.getState().seek(3)`).
if (import.meta.env.DEV) {
  const bridge = window as unknown as Record<string, unknown>
  bridge.__UAE2__ = useEditorStore
  bridge.__UAE2_EXPORT__ = requestShotCapture
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
