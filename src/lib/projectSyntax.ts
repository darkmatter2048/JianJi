/**
 * Tokeniser for the project file, for the 代码 panel's highlighting.
 *
 * A hand-written scanner rather than `split(' ')`, because three things in this
 * format look like separators but are not: a `#` inside a hex colour, a space
 * inside a quoted name, and a `=` inside a field list. Nothing here parses the
 * file (that is `lib/projectText.ts`); it only decides what a human sees in
 * colour, so it errs towards "keep it together" whenever a token is ambiguous.
 */

export type TokenKind =
  | 'comment'
  | 'key'
  | 'at'
  | 'suffix'
  | 'kind'
  | 'ref'
  | 'field'
  | 'number'
  | 'vector'
  | 'string'
  | 'flag'
  | 'plain'

export interface Token {
  text: string
  kind: TokenKind
}

const RESOURCE = /^(model|media|image|video|text):/
const NUMBER = /^-?\d+(\.\d+)?[a-z]?$/
const FLAG = /^[a-z]+$/i

/** Index just past the closing delimiter, honouring `\` escapes. */
function scanQuoted(text: string, start: number): number {
  let index = start + 1
  while (index < text.length) {
    if (text[index] === '\\') index += 2
    else if (text[index] === '"') return index + 1
    else index += 1
  }
  return text.length
}

function scanBracket(text: string, start: number): number {
  const end = text.indexOf(']', start)
  return end < 0 ? text.length : end + 1
}

/** `[x,y,z]` → quiet brackets, coloured numbers. */
function vectorTokens(value: string): Token[] {
  const body = value.slice(1, value.endsWith(']') ? -1 : undefined)
  const tokens: Token[] = [{ text: '[', kind: 'plain' }]
  body.split(',').forEach((part, index) => {
    if (index > 0) tokens.push({ text: ',', kind: 'plain' })
    tokens.push({ text: part, kind: NUMBER.test(part) ? 'number' : 'plain' })
  })
  if (value.endsWith(']')) tokens.push({ text: ']', kind: 'plain' })
  return tokens
}

/** A value: whatever follows `=`, which may run past the next space. */
function valueTokens(text: string, start: number): { tokens: Token[]; next: number } {
  if (text[start] === '"') {
    const end = scanQuoted(text, start)
    return { tokens: [{ text: text.slice(start, end), kind: 'string' }], next: end }
  }
  if (text[start] === '[') {
    const end = scanBracket(text, start)
    return { tokens: vectorTokens(text.slice(start, end)), next: end }
  }
  let end = start
  while (end < text.length && !/\s/.test(text[end])) end += 1
  const value = text.slice(start, end)
  return { tokens: [{ text: value, kind: NUMBER.test(value) ? 'number' : 'ref' }], next: end }
}

/** One line of the project file, as coloured pieces. */
export function tokenizeLine(line: string): Token[] {
  const tokens: Token[] = []
  const push = (text: string, kind: TokenKind) => {
    if (text.length > 0) tokens.push({ text, kind })
  }

  let index = 0
  while (index < line.length) {
    const char = line[index]

    /* Whitespace is its own token so the overlay lines up character for character. */
    if (/\s/.test(char)) {
      let end = index
      while (end < line.length && /\s/.test(line[end])) end += 1
      push(line.slice(index, end), 'plain')
      index = end
      continue
    }

    /* A comment is a `#` at the start of a word: `color=#f5a524` is a colour. */
    if (char === '#') {
      push(line.slice(index), 'comment')
      break
    }

    /* A quoted string, which may contain the spaces that end every other word. */
    if (char === '"') {
      const end = scanQuoted(line, index)
      push(line.slice(index, end), 'string')
      index = end
      continue
    }

    /* @target / @target.clip — the camera is not part of the format */
    if (char === '@') {
      let end = index
      while (end < line.length && !/\s/.test(line[end]) && line[end] !== '=') end += 1
      const target = line.slice(index, end)
      const dot = target.indexOf('.')
      if (dot < 0) push(target, 'at')
      else {
        push(target.slice(0, dot), 'at')
        push(target.slice(dot), 'suffix')
      }
      index = end
      continue
    }

    /* A word: `key=value`, `key`, or a bare value. */
    let end = index
    while (end < line.length && !/\s/.test(line[end])) end += 1
    const word = line.slice(index, end)
    const eq = word.indexOf('=')

    if (word === 'text') {
      push(word, 'key')
      index = end
      continue
    }

    if (eq < 0) {
      // A bare word is a *key* when an `=` follows it — `macbook = model:…`, and
      // `project = …` in the header. Otherwise it is a value, which may be a
      // resource reference (`media:开场.mp4`).
      let ahead = end
      while (ahead < line.length && /\s/.test(line[ahead])) ahead += 1
      if (line[ahead] === '=') {
        push(word, 'key')
      } else {
        const match = RESOURCE.exec(word)
        if (match) {
          push(match[0], 'kind')
          push(word.slice(match[0].length), 'ref')
        } else {
          push(word, NUMBER.test(word) ? 'number' : FLAG.test(word) ? 'flag' : 'ref')
        }
      }
      index = end
      continue
    }

    push(word.slice(0, eq), 'key')
    push('=', 'plain')
    // The value may continue past the end of the word (a quoted name, a vector).
    const start = index + eq + 1
    const { tokens: value, next } = valueTokens(line, start)
    // A resource reference is `kind:ref`, coloured in two parts.
    if (value.length === 1 && value[0].kind === 'ref') {
      const match = RESOURCE.exec(value[0].text)
      if (match) {
        push(match[0], 'kind')
        push(value[0].text.slice(match[0].length), 'ref')
      } else {
        push(value[0].text, value[0].kind)
      }
    } else {
      for (const token of value) push(token.text, token.kind)
    }
    index = next
  }

  return tokens.length > 0 ? tokens : [{ text: line, kind: 'plain' }]
}

/** Convenience for the panel: a whole document, line by line. */
export function tokenizeDocument(text: string): Token[][] {
  return text.split('\n').map(tokenizeLine)
}
