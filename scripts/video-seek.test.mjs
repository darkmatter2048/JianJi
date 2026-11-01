import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import ts from 'typescript'

const source = await readFile(new URL('../src/lib/videoSeek.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
const { clampVideoTime, seekVideoFrame } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
)

globalThis.window = globalThis

class FakeVideo extends EventTarget {
  currentTime = 0
  seeking = false
}

test('clamps clip out-points to a decodable frame', () => {
  assert.equal(clampVideoTime(-2, 10), 0)
  assert.equal(clampVideoTime(4, 10), 4)
  assert.equal(clampVideoTime(10, 10), 9.999)
  assert.equal(clampVideoTime(10.5, 10), 9.999)
  assert.equal(clampVideoTime(Number.NaN, 10), 0)
})

test('resolves when assigning an identical target emits no seeked event', async () => {
  const video = new FakeVideo()
  video.currentTime = 3
  let settled = 0
  await seekVideoFrame(video, 3, () => settled++, 50).promise
  assert.equal(settled, 1)
})

test('times out and can be cancelled instead of hanging forever', async () => {
  const video = new FakeVideo()
  video.seeking = true
  const started = Date.now()
  await seekVideoFrame(video, 5, undefined, 10).promise
  assert.ok(Date.now() - started < 200)

  const request = seekVideoFrame(video, 6, undefined, 1000)
  request.cancel()
  await request.promise
})
