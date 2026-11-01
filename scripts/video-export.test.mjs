import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import ts from 'typescript'

const source = await readFile(new URL('../src/lib/videoExport.ts', import.meta.url), 'utf8')
const functionSource = /export function recommendedEncoderThreads\([\s\S]*?\n}/.exec(source)?.[0]
assert.ok(functionSource, 'recommendedEncoderThreads must exist')
const compiled = ts.transpileModule(
  `const MAX_ENCODER_THREADS = 4\n${functionSource.replace('export function', 'function')}\nexport { recommendedEncoderThreads }`,
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
).outputText
const { recommendedEncoderThreads } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
)

test('auto thread selection reserves CPU capacity and caps encoder workers', () => {
  assert.equal(recommendedEncoderThreads(1), 1)
  assert.equal(recommendedEncoderThreads(2), 1)
  assert.equal(recommendedEncoderThreads(4), 2)
  assert.equal(recommendedEncoderThreads(8), 4)
  assert.equal(recommendedEncoderThreads(32), 4)
  assert.equal(recommendedEncoderThreads(Number.NaN), 1)
})

test('worker source resets encoders at segment boundaries and transfers frames', async () => {
  const worker = await readFile(new URL('../src/lib/videoEncoder.worker.ts', import.meta.url), 'utf8')
  assert.match(worker, /await beginSegment\(message\.segment\)/)
  assert.match(worker, /encoder\.flush\(\)/)
  assert.match(worker, /keyFrame: message\.keyFrame/)
  assert.match(worker, /message\.bitmap\.close\(\)/)
  assert.match(worker, /transfer: transfers/)
})
