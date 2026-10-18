/**
 * Screenshot helper: waits until the editor reports the model in its HUD,
 * then captures the page through the DevTools protocol.
 *
 * Usage: node shot.mjs <url> <outfile> [waitSeconds] [preCaptureExpression]
 */
const url = process.argv[2] ?? 'http://127.0.0.1:5273/'
const outFile = process.argv[3] ?? '/tmp/shot.png'
const extraWait = Number(process.argv[4] ?? 2)
const preCapture = process.argv[5] ?? ''
const port = 9222

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const target = await (await fetch(`http://127.0.0.1:${port}/json/new?${url}`, { method: 'PUT' })).json()
const ws = new WebSocket(target.webSocketDebuggerUrl)
let nextId = 1
const pending = new Map()

ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message)
    pending.delete(message.id)
  }
})

await new Promise((resolve) => ws.addEventListener('open', resolve))

function send(method, params = {}) {
  const id = nextId++
  return new Promise((resolve) => {
    pending.set(id, resolve)
    ws.send(JSON.stringify({ id, method, params }))
  })
}

async function evaluate(expression) {
  const response = await send('Runtime.evaluate', { expression, returnByValue: true })
  return response.result?.result?.value
}

await send('Page.enable')
await send('Runtime.enable')

// Wait for the editor to report loaded model geometry in the viewport HUD.
let ready = false
for (let attempt = 0; attempt < 120; attempt += 1) {
  const text = await evaluate(
    `(document.querySelector('.viewport__hud')?.textContent ?? '') + '|' + (document.querySelector('.viewport__loading')?.textContent ?? '')`,
  )
  if (typeof text === 'string' && text.includes('网格')) {
    ready = true
    console.log('model ready after ~' + attempt + ' polls:', text.trim())
    break
  }
  await sleep(1000)
}

if (!ready) console.log('WARNING: model never reported as loaded, capturing anyway')

if (preCapture) {
  const result = await evaluate(preCapture)
  console.log('pre-capture:', preCapture, '→', result)
}

await sleep(extraWait * 1000)

const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
const { writeFileSync } = await import('node:fs')
writeFileSync(outFile, Buffer.from(shot.result.data, 'base64'))
console.log('wrote', outFile)

ws.close()
process.exit(0)
