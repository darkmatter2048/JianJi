import { useEffect } from 'react'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { usePlaybackClock } from './hooks/usePlaybackClock'
import { EditorShell } from './components/layout/EditorShell'
import { TopBar } from './components/layout/TopBar'
import { PreviewPlayer } from './components/layout/PreviewPlayer'
import { TooltipProvider } from './components/ui/kit'
import { useEditorStore } from './store/editorStore'

export function App() {
  usePlaybackClock()
  useKeyboardShortcuts()

  const projectName = useEditorStore((state) => state.project.name)
  useEffect(() => {
    document.title = `简辑:${projectName}`
  }, [projectName])

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
