import { useCallback, useRef, useState, type ChangeEvent, type DragEvent, type ReactElement } from 'react'
import { useEditorStore } from '../../store/editorStore'

/**
 * Import files into the project's media library.
 *
 * Every file is validated *and measured* before it reaches the store, and the
 * URL that gets stored is a fresh object URL owned by the library (the probe
 * releases its own). Failures are collected instead of aborting the batch, so
 * dropping five files where one is an unsupported codec still imports four.
 */
export interface MediaImport {
  /** Render this next to the trigger button. */
  input: ReactElement
  open: () => void
  /** Files from a drop event, validated the same way. */
  acceptFiles: (files: FileList | File[]) => void
  busy: boolean
  error: string | null
  clearError: () => void
}

export function useMediaImport(options: {
  accept?: string
  onImported?: (ids: string[]) => void
} = {}): MediaImport {
  const { accept = 'image/*,video/*,audio/*', onImported } = options
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const acceptFiles = useCallback(
    (files: FileList | File[]) => {
      const list = Array.from(files)
      if (list.length === 0) return
      setBusy(true)
      setError(null)
      void (async () => {
        const { ids, problems } = await useEditorStore
          .getState()
          .importMediaFiles(list)
        setBusy(false)
        if (problems.length > 0) setError(problems.join('；'))
        if (ids.length > 0) onImported?.(ids)
      })()
    },
    [onImported],
  )

  const input = (
    <input
      ref={inputRef}
      type="file"
      accept={accept}
      multiple
      hidden
      onChange={(event: ChangeEvent<HTMLInputElement>) => {
        if (event.target.files) acceptFiles(event.target.files)
        event.target.value = ''
      }}
    />
  )

  return {
    input,
    open: () => inputRef.current?.click(),
    acceptFiles,
    busy,
    error,
    clearError: () => setError(null),
  }
}

/** `preventDefault` on dragover is what makes a drop target actually work. */
export function dropHandlers(onFiles: (files: FileList) => void, onActive: (active: boolean) => void) {
  return {
    onDragOver: (event: DragEvent) => {
      event.preventDefault()
      onActive(true)
    },
    onDragLeave: () => onActive(false),
    onDrop: (event: DragEvent) => {
      event.preventDefault()
      onActive(false)
      if (event.dataTransfer.files.length > 0) onFiles(event.dataTransfer.files)
    },
  }
}
