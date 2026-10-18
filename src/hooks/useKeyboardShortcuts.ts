import { useEffect } from 'react'
import { timelineEnd } from '../lib/animation'
import { useEditorStore } from '../store/editorStore'

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

/**
 * Editor-wide shortcuts. Ignored while a form control has focus.
 *
 * `D` is the keyframe key: it stamps the selected object's current pose at the
 * playhead, or the camera's when nothing is selected.
 */
export function useKeyboardShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return
      const store = useEditorStore.getState()
      const { timeline } = store

      // Undo / redo first: Ctrl+Z and Ctrl+Y (and Ctrl+Shift+Z, the other habit).
      if ((event.metaKey || event.ctrlKey) && (event.key === 'z' || event.key === 'Z')) {
        event.preventDefault()
        if (event.shiftKey) store.redo()
        else store.undo()
        return
      }
      if ((event.metaKey || event.ctrlKey) && (event.key === 'y' || event.key === 'Y')) {
        event.preventDefault()
        store.redo()
        return
      }
      // The player owns Space and Escape while it is open.
      if (store.ui.previewOpen) return

      // 剪切: X, at the playhead, on the selected clip.
      if ((event.key === 'x' || event.key === 'X') && !event.metaKey && !event.ctrlKey) {
        event.preventDefault()
        store.splitClipHere()
        return
      }

      switch (event.key) {
        case ' ':
          event.preventDefault()
          store.togglePlay()
          break
        case 'ArrowLeft':
          event.preventDefault()
          store.seek(timeline.currentTime - (event.shiftKey ? 0.5 : 1 / timeline.fps))
          break
        case 'ArrowRight':
          event.preventDefault()
          store.seek(timeline.currentTime + (event.shiftKey ? 0.5 : 1 / timeline.fps))
          break
        case 'Home':
          store.seek(0)
          break
        case 'End':
          store.seek(timelineEnd(store))
          break
        case 'k':
        case 'K':
          // Ctrl/⌘+K: cut the selected video clip at the playhead.
          if ((event.metaKey || event.ctrlKey) && timeline.selectedClipId) {
            event.preventDefault()
            const owner = store.objects.find((object) =>
              object.screenClips.some((clip) => clip.id === timeline.selectedClipId),
            )
            if (owner && timeline.selectedClipId) {
              store.splitScreenClip(owner.id, timeline.selectedClipId, timeline.currentTime)
            }
          }
          break
        case 'c':
        case 'C':
          // Clip editing shortcuts only apply to a selected video clip.
          if ((event.metaKey || event.ctrlKey) && timeline.selectedClipId) {
            event.preventDefault()
            const owner = store.objects.find((object) =>
              object.screenClips.some((clip) => clip.id === timeline.selectedClipId),
            )
            if (owner && timeline.selectedClipId) {
              store.copyScreenClip(owner.id, timeline.selectedClipId)
            }
          }
          break
        case 'v':
        case 'V':
          if ((event.metaKey || event.ctrlKey) && store.clipboard) {
            const owner = store.objects.find((object) =>
              object.screenClips.some((clip) => clip.id === timeline.selectedClipId),
            )
            event.preventDefault()
            store.pasteScreenClip((owner ?? store.objects[0])?.id ?? '')
          }
          break
        case 'd':
        case 'D':
          event.preventDefault()
          store.keyframeHere()
          break
        case 'Delete':
        case 'Backspace': {
          // A selected video clip takes priority, then the selected keyframe —
          // the same rule as the timeline's trash button.
          if (!timeline.selectedClipId && !timeline.selectedKeyframeId) break
          event.preventDefault()
          store.deleteSelection()
          break
        }
        case 'Escape':
          // Leave redraw mode: the chain stops carrying state forward.
          store.exitRedraw()
          break
        case 'g':
        case 'G':
          store.toggleGrid()
          break
        default:
          break
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
