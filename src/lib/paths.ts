/**
 * Paths, the way a project file means them.
 *
 * Every `media:` reference is **relative to the code file it is written in**, so
 * these helpers are the only place that knows how to turn "the file I imported"
 * into "the path the code says" and back. Both directions matter: reading has to
 * follow the code to the file, and writing has to keep the text it produces
 * pointing at the same place.
 */

/** The last path segment. */
export function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

/** Everything before the last segment (`''` when the file is at the root). */
export function dirname(path: string): string {
  const normalised = path.replace(/\\/g, '/')
  const cut = normalised.lastIndexOf('/')
  return cut < 0 ? '' : normalised.slice(0, cut)
}

/** Fold `a/./b/../c` into `a/c`. Returns `null` when it climbs above the root. */
export function normalise(path: string): string | null {
  const out: string[] = []
  for (const part of path.replace(/\\/g, '/').split('/')) {
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

/** `ref` as the project means it: relative to the code file at `projectPath`. */
export function resolveRelative(projectPath: string, ref: string): string | null {
  const dir = dirname(projectPath)
  return normalise(dir ? `${dir}/${ref}` : ref)
}

/**
 * `target` expressed relative to the code file at `projectPath` — the inverse of
 * `resolveRelative`, used when writing a project back out.
 */
export function relativeTo(projectPath: string, target: string): string | null {
  const dir = dirname(projectPath)
  if (!dir) return normalise(target)
  const dirParts = dir.split('/').filter(Boolean)
  const targetParts = (normalise(target) ?? target).split('/').filter(Boolean)

  let shared = 0
  while (shared < dirParts.length && shared < targetParts.length - 1) {
    if (dirParts[shared] !== targetParts[shared]) break
    shared += 1
  }
  const up = dirParts.slice(shared).map(() => '..')
  const down = targetParts.slice(shared)
  const joined = [...up, ...down].join('/')
  return joined || basename(target)
}

export function sameFileName(a: string, b: string): boolean {
  if (a === b) return true
  return a.replace(/\.[^.]+$/, '') === b.replace(/\.[^.]+$/, '')
}
