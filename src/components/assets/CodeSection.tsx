import { FileCode2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { tokenizeDocument } from '../../lib/projectSyntax'
import { useEditorStore } from '../../store/editorStore'

/**
 * 代码 — the project as the text file it is.
 *
 * Two things only: the file, and how to write it. The textarea is transparent and
 * sits on top of a coloured copy of the same text, with a gutter of line numbers
 * beside it and the two scrolled together — the standard way to put a highlighter
 * under an editor without writing one.
 *
 * The file applies itself: a second after the typing stops, the text is written
 * back into the project, so the panel is a live two-way view rather than a form
 * with a save button. A line the parser rejected is marked in red in the gutter,
 * the first problem is quoted in the corner, and **nothing is applied while the
 * file is broken** — so a half-typed line can never damage the project.
 *
 * `⌘/Ctrl+S` still applies immediately and `Esc` still throws the edits away.
 */
export function CodeSection() {
  const [text, setText] = useState('')
  const [dirty, setDirty] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const overlayRef = useRef<HTMLPreElement>(null)
  const gutterRef = useRef<HTMLDivElement>(null)
  const store = useEditorStore

  /** Regenerate from the editor, unless there are unsaved edits to protect. */
  const generate = () => {
    setText(store.getState().projectText())
    setDirty(false)
    setErrors([])
  }

  // Fill the box once, on mount.
  useEffect(() => {
    setText(store.getState().projectText())
  }, [store])

  /**
   * Follow the project while the buffer is clean: the panel is a live view.
   *
   * Note the absence of an immediate `setText` here. Regenerating on *subscribe*
   * would rewrite the box the instant an edit was applied — and rewriting a
   * textarea moves the caret to the end, out from under whoever is still typing.
   * The buffer is only replaced when the project changes from somewhere else.
   */
  useEffect(() => {
    if (dirty) return
    return store.subscribe(() => {
      setText(store.getState().projectText())
      setErrors([])
    })
  }, [dirty, store])

  const apply = () => {
    const result = store.getState().applyProjectText(text)
    setErrors(result.errors)
    if (result.errors.length > 0) return
    // Applied. Leave the buffer exactly as typed: rewriting it would move the
    // caret out from under the hand that is still typing. It is regenerated the
    // next time the project changes from somewhere else.
    setDirty(false)
  }

  /**
   * Auto-apply: a second after the last keystroke. Debounced rather than a
   * timer, so a period of typing is one edit, not one edit per second — and it
   * only fires while the buffer is dirty, so an idle panel never touches the
   * project (or the undo stack).
   */
  useEffect(() => {
    if (!dirty) return
    const timer = window.setTimeout(() => apply(), 1000)
    return () => window.clearTimeout(timer)
    // `apply` reads the latest text through the closure; re-arming on every
    // change is what makes it a debounce.
  }, [dirty, text])

  const lines = useMemo(() => text.split('\n'), [text])
  const tokens = useMemo(() => tokenizeDocument(text), [text])
  /** 1-based line numbers the parser complained about. */
  const badLines = useMemo(() => {
    const set = new Set<number>()
    for (const message of errors) {
      const match = /^第 (\d+) 行/.exec(message)
      if (match) set.add(Number(match[1]))
    }
    return set
  }, [errors])

  const sync = (element: HTMLTextAreaElement) => {
    if (overlayRef.current) {
      overlayRef.current.scrollTop = element.scrollTop
      overlayRef.current.scrollLeft = element.scrollLeft
    }
    if (gutterRef.current) gutterRef.current.scrollTop = element.scrollTop
  }

  return (
    <div className="code">
      <div className="code__editor">
        <div className="code__gutter" ref={gutterRef} aria-hidden>
          {lines.map((_, index) => (
            <div
              className={`code__ln${badLines.has(index + 1) ? ' code__ln--bad' : ''}`}
              key={index}
            >
              {index + 1}
            </div>
          ))}
        </div>

        <div className="code__surface">
          <pre className="code__highlight" ref={overlayRef} aria-hidden>
            {tokens.map((line, index) => (
              <div className={`code__row${badLines.has(index + 1) ? ' code__row--bad' : ''}`} key={index}>
                {line.map((token, tokenIndex) => (
                  <span className={`tok tok--${token.kind}`} key={tokenIndex}>
                    {token.text}
                  </span>
                ))}
                {line.length === 1 && line[0].text === '' ? ' ' : null}
              </div>
            ))}
          </pre>

          <textarea
            className="code__input"
            value={text}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            onScroll={(event) => sync(event.currentTarget)}
            onChange={(event) => {
              setText(event.target.value)
              setDirty(true)
            }}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && (event.key === 's' || event.key === 'S')) {
                event.preventDefault()
                apply()
                return
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                generate()
                return
              }
              if (event.key === 'Tab') {
                event.preventDefault()
                const target = event.currentTarget
                const { selectionStart, selectionEnd } = target
                const next = `${text.slice(0, selectionStart)}  ${text.slice(selectionEnd)}`
                setText(next)
                setDirty(true)
                window.requestAnimationFrame(() => {
                  target.selectionStart = selectionStart + 2
                  target.selectionEnd = selectionStart + 2
                })
                return
              }
              // Keep the highlight layer under the caret honest while typing.
              window.requestAnimationFrame(() => sync(event.currentTarget))
            }}
          />

          {errors.length > 0 ? (
            <div className="code__problem" role="status">
              {errors[0]}
              {errors.length > 1 ? ` · 还有 ${errors.length - 1} 处` : ''}
            </div>
          ) : null}
        </div>
      </div>

      <details className="code__help">
        <summary>
          <FileCode2 size={13} />
          语法速查
        </summary>
        <pre>{`# 注释以 # 开头；一行一件事，值里不放空格（列表写成 [a,b,c]）

project = 项目名
aspect  = 16:9              # 画幅
fps     = 30
# 场景不在这里：它写在关键帧上（见下面 scene=），对象首帧就把那一帧的场景定好了

# 资源：别名 = 相对本文件的路径（也可指向内置模型）
macbook = model:macbook-pro-13-2020
cover   = media:封面.png
opening = media:开场.mp4 7.21s 1920x1080
# 路径里有空格就加引号：wall = media:"macOS 壁纸.png"

# 对象：别名 = 类型:资源 ["显示名"] color=#hex appear=秒
macbook = model:macbook-pro-13-2020 "MacBook Pro 13\\"" color=#f5a524
poster  = image:cover "封面" color=#4c8dff
demo    = video:opening
title   = text "简辑" color=#22d3ee
  text font=wenkai size=0.3 color=#ffffff align=center spacing=0 lineheight=1.25 wrap=0 opacity=1 content="简辑"

# 关键帧：@别名 t=时间 p=[x,y,z] s=屏幕开合角度 a=[绕x,y,z的旋转] sc=[缩放] f=贴图 v=速度
#         [scene=场景] [hid] [chain]
#   hid = 这一帧没有它（隐藏属于帧）：前后各一帧，一个写 hid 一个不写，就是消失 / 出现
#   hid=fade / vis=fade = 这次显隐切换是渐隐 / 渐显（默认是瞬间切）
@macbook t=0.00 p=[0,0,0] s=105 a=[0,-20,0] f=cover v=1.00 scene=bg=solid,color=#101418,env=1,exp=1
@macbook t=2.50 p=[0.4,0,0.2] s=105 a=[0,25,0] f=opening v=[0:1,0.5:0.25,1:1]
@macbook t=4.00 p=[0.4,0,0.4] s=105 a=[0,25,0] f=opening v=1 scene=bg=gradient,color=#101418,grad=#2a3550>#05070b,angle=160,env=1.6,exp=1.2

# 视频片段的附加轨道：@别名.clip 片段ID m=素材 t=起点 in=入点 out=出点 v=速度
@macbook.clip c1 m=opening t=1.20 in=0.50 out=3.20 v=1.00

# 摄像机固定不动，工程文件里不描述它（写 @camera 会被当成错误指出来）

# 说明
# · s 只对带铰链的模型有意义，其它对象写 -
# · v 是「到上一帧之间」的变速：写一个数=匀速，写 [t:v,…] 就是曲线上的节点
# · f 引用资源别名，- 表示这一帧屏幕上没有东西
# · 素材用 blob: URL 存在内存里，工程文件因此只记文件名：
#   在别的会话里打开时，需要先把同名素材导进来（缺失的引用会列在警告里）
# · 曲线的手柄、屏幕的填充/亮度/旋转/循环等高级参数不写进文件（界面里也没有），载入时用默认值
# · scene 是帧上的字段（场景也属于帧）：bg/color/grad/angle/env/exp/shadow
#   写在对象首帧上就定好了那一帧的房间；只在「与上一帧不同」时才再写一次
#   缺省=沿用上一帧，写 - 表示这一帧不记场景
# · 摄像机不写：它固定不动，机位是编辑器的常量`}</pre>
      </details>
    </div>
  )
}
