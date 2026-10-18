import { useEffect } from 'react'
import { useEditorStore } from '../store/editorStore'

/**
 * Drives `timeline.currentTime` from the display refresh loop.
 *
 * The clock lives outside React state on purpose: the 3D scene reads the time
 * imperatively inside `useFrame`, so a playing timeline never re-renders the
 * whole editor — only the two small components that subscribe to the time
 * (playhead + timecode) update per frame.
 */
export function usePlaybackClock(): void {
  useEffect(() => {
    let frame = 0
    let last = performance.now()

    const tick = (now: number) => {
      const delta = Math.min(0.1, (now - last) / 1000)
      last = now
      const { timeline, advance } = useEditorStore.getState()
      if (timeline.playing) advance(delta)
      frame = requestAnimationFrame(tick)
    }

    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [])
}
