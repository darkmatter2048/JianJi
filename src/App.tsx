import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { usePlaybackClock } from './hooks/usePlaybackClock'
import { EditorShell } from './components/layout/EditorShell'
import { TopBar } from './components/layout/TopBar'
import { PreviewPlayer } from './components/layout/PreviewPlayer'
import { TooltipProvider } from './components/ui/kit'

export function App() {
  usePlaybackClock()
  useKeyboardShortcuts()

  return (
    <TooltipProvider>
      <div className="app">
        <TopBar />
        <div className="app__body">
          <EditorShell />
        </div>
        <PreviewPlayer />
      </div>
    </TooltipProvider>
  )
}
