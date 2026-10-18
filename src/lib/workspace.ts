import { basename, sameFileName } from './paths'
import { readProjectText, relativeOf, withRelativePath, type ProjectFile } from './projectImport'

/**
 * 工作区里的工程.
 *
 * The editor runs locally, and so does the folder its projects live in. Rather than
 * asking the artist to hand the browser a folder — which it can only do through a
 * picker, and only for files it was given — the dev server reads this repository
 * directly (see `vite.config.ts`). The panel then has something to *offer*: the
 * projects that are actually here, each of which can be opened with its media in
 * one click.
 */

export interface WorkspaceProject {
  path: string
  name: string
}

export interface Workspace {
  /** The artist's own projects. The repository's example is not in here. */
  projects: WorkspaceProject[]
  /** Every media file in the repository, for resolving references. */
  files: string[]
}

interface WorkspaceListing {
  projects: Array<{ path: string; name: string }>
  files: string[]
}

/** `null` when this build has no local file endpoints (a real deployment). */
export async function listWorkspace(): Promise<Workspace | null> {
  try {
    const response = await fetch('/__workspace', { cache: 'no-store' })
    if (!response.ok) return null
    const listing = (await response.json()) as WorkspaceListing
    if (!Array.isArray(listing.projects)) return null
    return { projects: listing.projects, files: listing.files ?? [] }
  } catch {
    return null
  }
}

async function readWorkspaceBlob(path: string): Promise<Blob> {
  const response = await fetch(`/__workspace/file?path=${encodeURIComponent(path)}`)
  if (!response.ok) throw new Error(`读不到 ${path}`)
  return response.blob()
}

export interface LoadedProject {
  project: ProjectFile
  files: File[]
  /** References that had to be matched by name because the path was not there. */
  rescued: string[]
}

/**
 * Read a project **and its media** straight off the disk.
 *
 * Paths are resolved exactly as the format means them — relative to the code file
 * — and only the files it names are read. A reference whose path does not exist
 * falls back to the first file of that name anywhere in the workspace, so a
 * project written before paths were relative still comes together.
 */
export async function loadWorkspaceProject(
  entry: WorkspaceProject,
  files_: string[] = [],
): Promise<LoadedProject> {
  const text = await (await readWorkspaceBlob(entry.path)).text()
  const project = readProjectText(entry.name, text, entry.path)
  const pool = files_

  const files: File[] = []
  const rescued: string[] = []
  const used = new Set<string>()

  for (const { ref, path } of project.resources.map((ref) => ({
    ref,
    path: resolveAgainst(entry.path, ref),
  }))) {
    let target = path
    if (!target || !pool.includes(target)) {
      const name = basename(ref)
      const found = pool.find((candidate) => sameFileName(basename(candidate), name))
      if (found) {
        target = found
        rescued.push(ref)
      } else {
        continue
      }
    }
    if (used.has(target)) continue
    used.add(target)
    const blob = await readWorkspaceBlob(target)
    const file = new File([blob], basename(target), { type: blob.type || 'application/octet-stream' })
    // The library reads each asset's place from the file; this is that place,
    // relative to the project's own folder.
    files.push(withRelativePath(file, relativeFrom(entry.path, target)))
  }

  return { project, files, rescued }
}

/** `ref` resolved against the folder the code file sits in. */
function resolveAgainst(projectPath: string, ref: string): string | null {
  const dir = projectPath.includes('/') ? projectPath.slice(0, projectPath.lastIndexOf('/')) : ''
  const parts = [...(dir ? dir.split('/') : []), ...ref.split(/[\\/]/)]
  const out: string[] = []
  for (const part of parts) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (out.length === 0) return null
      out.pop()
      continue
    }
    out.push(part)
  }
  return out.join('/')
}

/** `target` expressed relative to the folder the code file sits in. */
function relativeFrom(projectPath: string, target: string): string {
  const dir = projectPath.includes('/') ? projectPath.slice(0, projectPath.lastIndexOf('/')) : ''
  if (!dir) return target
  const prefix = `${dir}/`
  if (target.startsWith(prefix)) return target.slice(prefix.length)
  // Outside the project's folder: keep the path that still resolves, up and over.
  const up = dir.split('/').filter(Boolean).length
  return `${'../'.repeat(up)}${target}`
}

/**
 * Read the resources a project asks for, found **by file name** anywhere in the
 * workspace.
 *
 * This is the rescue for the「只选工程文件」path: a single picked `.txt` does not
 * come with its siblings, so the local server searches the repository for the
 * names the code wrote and hands the bytes back. Files outside the workspace
 * simply stay missing (and are reported as such).
 */
export async function loadResourcesByName(refs: string[]): Promise<File[]> {
  const listing = await listWorkspace()
  if (!listing) return []
  const pool = listing.files
  const files: File[] = []
  const used = new Set<string>()

  for (const ref of refs) {
    const name = basename(ref)
    const match = pool.find((candidate) => !used.has(candidate) && sameFileName(basename(candidate), name))
    if (!match) continue
    used.add(match)
    try {
      const blob = await (
        await fetch(`/__workspace/file?path=${encodeURIComponent(match)}`, { cache: 'no-store' })
      ).blob()
      // A single picked `.txt` has no directory to resolve against, so the asset
      // is keyed by its bare file name — the same name the project wrote — rather
      // than by a repository path it could never match.
      files.push(withRelativePath(new File([blob], name, { type: blob.type || 'application/octet-stream' }), name))
    } catch {
      /* A file that went away between the listing and the read. */
    }
  }
  return files
}

/** Re-exported so the panel reads one module for both ways in. */
export { relativeOf }

/**
 * Save the project text into the workspace (local deployment only). Returns the
 * relative path it landed at, or `null` when there is no local file endpoint.
 */
export async function saveProject(name: string, text: string): Promise<string | null> {
  try {
    const response = await fetch('/__workspace/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, text }),
    })
    if (!response.ok) return null
    const result = (await response.json()) as { ok?: boolean; path?: string }
    return result.ok ? (result.path ?? null) : null
  } catch {
    return null
  }
}
