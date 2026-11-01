import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { rolldown } from 'rolldown'

async function loadModule(path) {
  const bundle = await rolldown({ input: fileURLToPath(new URL(path, import.meta.url)) })
  try {
    const { output } = await bundle.generate({ format: 'esm' })
    return await import(`data:text/javascript;base64,${Buffer.from(output[0].code + `\n//# sourceURL=${path}.bundle.js`).toString('base64')}`)
  } finally {
    await bundle.close()
  }
}
const { parseProjectText, toProjectText, applyParsedProject } = await loadModule('../src/lib/projectText.ts')
const { readProjectText } = await loadModule('../src/lib/projectImport.ts')
const base = {
  project: { name: '测试', aspect: '16:9' },
  timeline: { fps: 30 }, objects: [], media: [],
  camera: { revision: 0 }, view: { revision: 0 },
  scene: { background: {}, shadow: {} },
}
const frame = '@title t=0 p=[0,0,0] s=- a=[0,0,0] f=- v=1'
const legacyContent = '内置多种  \n  常用模型\n\n# 这一行也是文字\n@这一行不是关键帧\ntext size=10\n别名 = text'
const legacy = `project = 测试\ntitle = text "标题"\n  text size=0.37 color=#ffffff content="${legacyContent}"\n${frame}\n`

function roundTrip(parsed, state = base) {
  const { patch } = applyParsedProject(parsed, state)
  const serialized = toProjectText({ ...state, ...patch })
  const restored = parseProjectText(serialized)
  assert.deepEqual(restored.errors, [])
  return { serialized, restored, patch }
}

test('imports and pastes legacy multiline text without interpreting its lines as commands', () => {
  for (const text of [legacy, legacy.replaceAll('\n', '\r\n')]) {
    assert.deepEqual(readProjectText('legacy.txt', text).errors, [])
    const parsed = parseProjectText(text)
    assert.deepEqual(parsed.errors, [])
    assert.equal(parsed.objects.length, 1)
    assert.equal(parsed.objects[0].text.content, legacyContent)
    assert.equal(parsed.objects[0].text.size, 0.37)
    assert.equal(parsed.objects[0].frames.length, 1)
    const { serialized, restored } = roundTrip(parsed)
    assert.equal(restored.objects[0].text.content, legacyContent)
    assert.equal(serialized.split('\n').filter((line) => line.trimStart().startsWith('text ')).length, 1)
  }
})

test('round-trips escaped newlines, quotes, backslashes, whitespace and empty text', () => {
  for (const content of [
    '', '普通文字', '第一行\n第二行', '\n  保留缩进和空行  \n\n',
    '引号 "简辑"\n反斜杠 \\ 和字面量 \\n、\\t',
    'Windows: C:\\temp\\new\\\n最后一行\\', '制表符\t和回车\r\n下一行',
    'size=99 color=#000000 opacity=0 font=other',
  ]) {
    const input = `title = text "标题"\n  text size=0.37 color=#ffffff opacity=1 content=${JSON.stringify(content)}\n${frame}`
    const parsed = parseProjectText(input)
    assert.deepEqual(parsed.errors, [])
    assert.equal(parsed.objects[0].text.content, content)
    assert.equal(parsed.objects[0].text.size, 0.37)
    assert.equal(parsed.objects[0].text.color, '#ffffff')
    assert.equal(parsed.objects[0].text.opacity, 1)
    const { restored, serialized } = roundTrip(parsed)
    assert.equal(restored.objects[0].text.content, content)
    assert.ok(serialized.includes(`content=${JSON.stringify(content)}`))
  }
})

test('preserves physical line numbers and reports unclosed content quotes', () => {
  const parsed = parseProjectText(`${legacy}这行不合法`)
  assert.deepEqual(parsed.errors, [`第 ${legacy.split('\n').length} 行：需要一个 = 或 @ 开头`])
  assert.deepEqual(parseProjectText('title = text\n  text content="未完成\n第二行').errors,
    ['第 2 行：文字 content 缺少结束双引号'])
  const valid = parseProjectText('title = text\n  text content="带有 \\"引号\\" 的文字" size=0.5')
  assert.equal(valid.objects[0].text.content, '带有 "引号" 的文字')
  assert.equal(valid.objects[0].text.size, 0.5)
})

if (process.argv[2]) {
  const text = await readFile(process.argv[2], 'utf8')
  test('imports and round-trips the supplied project with all ten text objects', () => {
    assert.deepEqual(readProjectText('project.txt', text).errors, [])
    const parsed = parseProjectText(text)
    assert.deepEqual(parsed.errors, [])
    const texts = parsed.objects.filter((object) => object.kind === 'text')
    assert.equal(texts.length, 10)
    assert.equal(texts[0].text.content, '内置多种\n常用模型')
    assert.equal(texts[2].text.content, '检测到改动\n自动打关键帧\n方便快捷')
    const media = parsed.resources.filter((resource) => resource.kind === 'media').map((resource, index) => ({
      id: `media-${index}`, name: resource.ref, src: `blob:test-${index}`,
      kind: resource.ref.endsWith('.mp4') ? 'video' : 'image', width: 3200, height: 1800, duration: 90,
    }))
    const { restored, patch } = roundTrip(parsed, { ...base, media })
    assert.equal(patch.objects.length, parsed.objects.length)
    assert.deepEqual(restored.objects.filter((object) => object.kind === 'text').map((object) => object.text.content),
      texts.map((object) => object.text.content))
    assert.deepEqual(restored.objects.map((object) => object.frames.length), parsed.objects.map((object) => object.frames.length))
    assert.deepEqual(restored.objects.map((object) => object.clips.length), parsed.objects.map((object) => object.clips.length))
  })
}
