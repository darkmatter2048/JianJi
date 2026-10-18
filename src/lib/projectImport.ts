import { basename, resolveRelative, sameFileName } from './paths'
import { parseProjectText } from './projectText'
import type { MediaAsset } from '../types'

/**
 * 导入工程.
 *
 * A project file is text — the same text the 代码 panel shows — and the media it
 * uses is referenced **by file name** (`壁纸 = media:"macOS 壁纸.png"`), because a
 * blob URL would be meaningless in a file. So importing a project is two steps
 * that the artist should only have to think of as one: read the text, then make
 * sure every name it mentions exists in the library.
 *
 * This module does the reading and the matching; the dialog does the asking.
 */

export interface ProjectFile {
  /** The file it came from, for the heading. */
  name: string
  /** Its path inside the picked folder, when it came from one. */
  path: string
  text: string
  /** Every `media:` reference the text declares, as the code wrote it. */
  resources: string[]
  errors: string[]
}

/** Parse a project file's text and list what it will need. */
export function readProjectText(name: string, text: string, path = name): ProjectFile {
  const parsed = parseProjectText(text)
  const resources: string[] = []
  for (const resource of parsed.resources) {
    if (resource.kind !== 'media') continue
    const ref = resource.ref.trim()
    if (ref && !resources.includes(ref)) resources.push(ref)
  }
  return { name, path, text, resources, errors: parsed.errors }
}

/** Every asset path a project asks for, resolved against the code file. */
export function resolvedResources(project: ProjectFile): Array<{ ref: string; path: string | null }> {
  return project.resources.map((ref) => ({ ref, path: resolveRelative(project.path, ref) }))
}

/**
 * What the project wants that the library does not have (yet).
 *
 * Matched by the path the code wrote **relative to the code file** when the asset
 * knows its own place in the folder, and by file name otherwise.
 */
export function missingResources(project: ProjectFile, media: MediaAsset[]): string[] {
  return resolvedResources(project)
    .filter(({ ref, path }) => {
      const found = media.some((asset) => {
        if (path && asset.relativePath) return sameFileName(asset.relativePath, path)
        return sameFileName(asset.name, basename(ref))
      })
      return !found
    })
    .map(({ ref }) => ref)
}

/**
 * Is this a project file? The format is text, so the extension is the only hint —
 * and only `.txt` / `.uae2`, because a folder of a project is also likely to hold
 * a `README.md`, which is text too but is not a project.
 */
export function looksLikeProject(file: { name: string; type: string }): boolean {
  return /\.(txt|uae2)$/i.test(file.name)
}

/** The candidates, in a stable order for the "which one parses" pass. */
export function projectCandidates(files: File[]): File[] {
  return files.filter(looksLikeProject).sort((a, b) => a.name.localeCompare(b.name))
}

/** The file's path inside the picked folder (empty when it was picked alone). */
export function relativeOf(file: File): string {
  return (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
}

/**
 * The files in a folder selection that the project actually asks for.
 *
 * Only the named ones: a project folder can hold renders, stills and notes too,
 * and quietly stuffing all of it into the library would be rude.
 */
export function mediaFilesFor(files: File[], project: ProjectFile): File[] {
  const candidates = files.filter(
    (file) =>
      !looksLikeProject(file) && /^(image|video|audio)\//.test(file.type || ''),
  )
  const pathOf = (file: File): string =>
    (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name

  const picked = new Set<File>()
  const unresolved: string[] = []
  for (const { ref, path } of resolvedResources(project)) {
    const match = path ? candidates.find((file) => sameFileName(pathOf(file), path)) : undefined
    if (match) picked.add(match)
    else unresolved.push(basename(ref))
  }

  /**
   * A reference whose path does not exist in this folder is rescued by name —
   * that is the case of a project whose paths went stale, or one written before
   * the paths were relative. Everything else is matched by path **only**, so a
   * decoy of the same name in another folder stays out of the library.
   */
  for (const name of unresolved) {
    for (const file of candidates) {
      if (sameFileName(file.name, name)) picked.add(file)
    }
  }
  return candidates.filter((file) => picked.has(file))
}

export function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new Error(`读不到 ${file.name}`))
    reader.readAsText(file)
  })
}

/* -------------------------------------------------- reading a real folder -- */

/** One file from a folder, with the path that the project will refer to it by. */
export interface FolderEntry {
  path: string
  file: File
}

/** The subset of the File System Access API this needs. */
interface DirectoryHandle {
  kind: 'directory'
  name: string
  entries(): AsyncIterableIterator<[string, DirectoryHandle | FileHandle]>
}
interface FileHandle {
  kind: 'file'
  name: string
  getFile(): Promise<File>
}
interface PickerWindow {
  showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<DirectoryHandle>
}

export function canPickDirectory(): boolean {
  return typeof (window as unknown as PickerWindow).showDirectoryPicker === 'function'
}

/**
 * Ask for a folder and read it — recursively.
 *
 * This is the one-click path the project format deserves: the code says
 * `素材/封面.png`, so the file is read from exactly that place inside the folder
 * the artist pointed at. No name guessing, no second dialog.
 */
export async function pickFolder(): Promise<FolderEntry[] | null> {
  const picker = (window as unknown as PickerWindow).showDirectoryPicker
  if (!picker) return null
  let root: DirectoryHandle
  try {
    root = await picker({ mode: 'read' })
  } catch {
    // The picker was dismissed; that is not an error worth reporting.
    return []
  }
  return readDirectory(root)
}

async function readDirectory(dir: DirectoryHandle, prefix = ''): Promise<FolderEntry[]> {
  const out: FolderEntry[] = []
  for await (const [name, handle] of dir.entries()) {
    const path = prefix ? `${prefix}/${name}` : name
    if (handle.kind === 'file') out.push({ path, file: await handle.getFile() })
    else out.push(...(await readDirectory(handle, path)))
  }
  return out
}

/**
 * A `File` from a folder pick has no `webkitRelativePath` (that is the `<input>`
 * API), and the library reads the path off the file — so put it there.
 */
export function withRelativePath(file: File, path: string): File {
  if (path === file.name) return file
  try {
    Object.defineProperty(file, 'webkitRelativePath', { value: path, configurable: true })
  } catch {
    /* A frozen File: the library will fall back to the bare name. */
  }
  return file
}
