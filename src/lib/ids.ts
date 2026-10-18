/** Deterministic-enough ids for editor entities. */
let counter = 0

export function uid(prefix: string): string {
  counter += 1
  return `${prefix}-${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}
