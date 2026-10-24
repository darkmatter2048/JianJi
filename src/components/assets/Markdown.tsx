import { Fragment, type ReactNode } from 'react'

/**
 * 轻量 Markdown 渲染：标题 / 加粗 / 斜体 / 行内代码 / 代码块 / 链接 / 列表 / 表格。
 * 不引入外部依赖，够 AI 输出用（分镜脚本、代码块、要点列表、对比表格）。
 */

let seq = 0
const nextKey = () => `md-${seq++}`

/** 行内：`code`、**bold**、*italic*、[text](url)。 */
function inline(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g
  let last = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index))
    const token = match[0]
    if (token.startsWith('`')) {
      nodes.push(<code key={nextKey()}>{token.slice(1, -1)}</code>)
    } else if (token.startsWith('**')) {
      nodes.push(<strong key={nextKey()}>{token.slice(2, -2)}</strong>)
    } else if (token.startsWith('*')) {
      nodes.push(<em key={nextKey()}>{token.slice(1, -1)}</em>)
    } else if (token.startsWith('[')) {
      const m = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
      if (m) {
        nodes.push(
          <a key={nextKey()} href={m[2]} target="_blank" rel="noreferrer">
            {m[1]}
          </a>,
        )
      } else {
        nodes.push(token)
      }
    }
    last = match.index + token.length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

/** 拆一行表格为单元格；`a | b` 和 `| a | b |` 都行。 */
function tableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

/** 分隔行：`---|---`。 */
function isTableSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{2,}.*\|\s*$/.test(line) && line.includes('-')
}

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const out: ReactNode[] = []
  let inCode = false
  let codeBuf: string[] = []
  let list: ReactNode[] | null = null
  let listTag: 'ul' | 'ol' = 'ul'
  let table: string[][] = []

  const flushList = () => {
    if (list && list.length > 0) {
      out.push(listTag === 'ul' ? <ul key={nextKey()}>{list}</ul> : <ol key={nextKey()}>{list}</ol>)
    }
    list = null
  }

  const flushCode = () => {
    if (codeBuf.length > 0) {
      out.push(
        <pre key={nextKey()} className="md-pre">
          <code>{codeBuf.join('\n')}</code>
        </pre>,
      )
      codeBuf = []
    }
  }

  const flushTable = () => {
    if (table.length === 0) return
    // 去掉分隔行（`---|---`），第一行当表头。
    const rows = table.filter((row) => !row.some((cell) => isTableSeparator(cell)))
    if (rows.length === 0) {
      table = []
      return
    }
    const [head, ...body] = rows
    out.push(
      <table key={nextKey()} className="md-table">
        <thead>
          <tr key={nextKey()}>
            {head.map((cell, i) => (
              <th key={i}>{inline(cell)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => (
                <td key={ci}>{inline(cell)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>,
    )
    table = []
  }

  for (const raw of lines) {
    const line = raw.trimEnd()
    if (line.trimStart().startsWith('```')) {
      flushTable()
      if (inCode) {
        flushCode()
        inCode = false
      } else {
        flushList()
        inCode = true
      }
      continue
    }
    if (inCode) {
      codeBuf.push(line)
      continue
    }
    if (line.trim() === '') {
      flushList()
      flushTable()
      continue
    }
    // 表格：以 `|` 开头的连续行。
    if (/^\s*\|/.test(line)) {
      flushList()
      table.push(tableCells(line))
      continue
    }
    flushTable()
    const heading = line.match(/^(#{1,4})\s+(.*)$/)
    if (heading) {
      flushList()
      const level = heading[1].length
      const content = inline(heading[2])
      if (level === 1) out.push(<h1 key={nextKey()}>{content}</h1>)
      else if (level === 2) out.push(<h2 key={nextKey()}>{content}</h2>)
      else if (level === 3) out.push(<h3 key={nextKey()}>{content}</h3>)
      else out.push(<h4 key={nextKey()}>{content}</h4>)
      continue
    }
    const ulItem = line.match(/^\s*[-*+]\s+(.*)$/)
    if (ulItem) {
      listTag = 'ul'
      if (!list) list = []
      list.push(<li key={nextKey()}>{inline(ulItem[1])}</li>)
      continue
    }
    const olItem = line.match(/^\s*\d+[.)]\s+(.*)$/)
    if (olItem) {
      listTag = 'ol'
      if (!list) list = []
      list.push(<li key={nextKey()}>{inline(olItem[1])}</li>)
      continue
    }
    flushList()
    out.push(<p key={nextKey()}>{inline(line)}</p>)
  }
  flushList()
  flushTable()
  flushCode()

  return <div className="md">{out.length > 0 ? out : <Fragment />}</div>
}
