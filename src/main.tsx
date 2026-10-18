import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { requestShotCapture } from './lib/capture'
import { loadDiscoveredFonts } from './lib/fonts'
import { useEditorStore } from './store/editorStore'
import './styles/app.css'
import './styles/asset-rail.css'
import './styles/viewport.css'
// The kit loads last: it owns the component skin, the shell files own layout.
import './styles/kit.css'

const container = document.getElementById('root')
if (!container) throw new Error('UAE2 Studio: #root container is missing')

// Populate the font picker from the local fonts directory before the first paint.
loadDiscoveredFonts()

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
