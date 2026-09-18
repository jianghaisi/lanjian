// Standalone Electron diagnostic: no application, books, credentials or IPC loaded.
// Run with node node_modules/electron/cli.js tests/smoke/narrative-paint-diagnostic.cjs
const { app, BrowserWindow } = require('electron')
const { mkdtempSync, mkdirSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
app.setPath('userData', mkdtempSync(join(tmpdir(), 'lanjian-paint-diagnostic-')))
const output = resolve(process.cwd(), 'artifacts/ui/narrative-paint-diagnostic.json')
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const observations = []
let window
mkdirSync(resolve(process.cwd(), 'artifacts/ui'), { recursive: true })
const record = value => {
  observations.push(value)
  writeFileSync(output, JSON.stringify({ ok: false, pending: true, observations }, null, 2))
  console.log(JSON.stringify(value))
}
const deadline = setTimeout(() => {
  record({ label: 'diagnostic-deadline', error: 'A diagnostic operation did not complete; inspect the last stage.' })
  if (window && !window.isDestroyed()) window.destroy()
  app.exit(1)
}, 20000)
async function inspect(label) {
  record({ label: `before-${label}` })
  const state = await window.webContents.executeJavaScript('({visibility:document.visibilityState,hidden:document.hidden,frames:window.framesObserved,theme:document.body.dataset.theme})')
  record({ label, visible: window.isVisible(), backgroundThrottling: window.webContents.getBackgroundThrottling(), ...state })
}
async function frames(label) {
  // Main-process deadline remains reliable when the renderer is background-throttled.
  let timer
  const result = await Promise.race([
    window.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve("painted"))))'),
    new Promise(resolve => { timer = setTimeout(() => resolve('timed-out'), 1200) }),
  ])
  clearTimeout(timer)
  record({ label, result })
}
app.whenReady().then(async () => {
  record({ label: 'ready' })
  window = new BrowserWindow({ width: 460, height: 320, show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
  await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<body style="background:#F3F0E8"><h1>Isolated paint diagnostic</h1><script>window.framesObserved=0;function tick(){framesObserved++;requestAnimationFrame(tick)}requestAnimationFrame(tick)</script>'))
  window.show()
  await pause(150)
  await inspect('shown')
  await frames('shown-raf')
  window.hide()
  await pause(150)
  await inspect('hidden')
  await frames('hidden-raf')
  window.webContents.setBackgroundThrottling(false)
  await pause(150)
  await inspect('hidden-unthrottled')
  await frames('hidden-unthrottled-raf')
  // Default capturePage needs a visible surface. Keep the earlier hidden-capture
  // deadline report as evidence; the real driver explicitly rejects hidden windows.
  window.show()
  await frames('reshown-raf')
  // Change an actual pixel and read it back, so a returned stale image cannot pass.
  await window.webContents.executeJavaScript('document.body.dataset.theme="updated";document.body.style.background="rgb(233,154,53)"')
  await frames('updated-raf')
  record({ label: 'before-capture' })
  const bitmap = (await window.capturePage()).toBitmap()
  const pixelBGRA = Array.from(bitmap.subarray(0, 4))
  record({ label: 'updated-visible-capture', pixelBGRA })
  for (const label of ['shown-raf', 'hidden-unthrottled-raf', 'reshown-raf', 'updated-raf']) {
    if (!observations.some(row => row.label === label && row.result === 'painted')) throw new Error(`${label} failed`)
  }
  if (!observations.some(row => row.label === 'hidden-raf' && row.result === 'timed-out')) throw new Error('Hidden RAF throttling did not reproduce')
  if (pixelBGRA.join(',') !== '53,154,233,255') throw new Error('Captured surface does not contain the latest pixel')
  await window.webContents.executeJavaScript(`document.body.innerHTML='<button id="target" style="position:fixed;left:200px;top:120px;width:80px;height:40px">Target</button>';window.pointerEvents=[];document.addEventListener('click',e=>pointerEvents.push({target:e.target.id,x:e.clientX,y:e.clientY,trusted:e.isTrusted}))`)
  window.webContents.setZoomFactor(1.25)
  await pause(150)
  await frames('zoomed-pointer-raf')
  const target = await window.webContents.executeJavaScript('(()=>{const r=document.getElementById("target").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()')
  for (const scale of [1, 1.25]) {
    window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, x: Math.round(target.x * scale), y: Math.round(target.y * scale) })
    window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, x: Math.round(target.x * scale), y: Math.round(target.y * scale) })
    await frames(`pointer-${scale}-raf`)
  }
  const pointerEvents = await window.webContents.executeJavaScript('pointerEvents')
  record({ label: 'zoomed-native-input', target, pointerEvents })
  if (pointerEvents[0]?.target === 'target' || pointerEvents[1]?.target !== 'target' || !pointerEvents.every(event => event.trusted)) throw new Error('Native DIP/CSS coordinate reproduction failed')
  mkdirSync(resolve(process.cwd(), 'artifacts/ui'), { recursive: true })
  writeFileSync(output, JSON.stringify({ ok: true, observations }, null, 2))
  console.log(JSON.stringify({ ok: true, observations }))
  clearTimeout(deadline)
  window.destroy()
  app.quit()
}).catch(error => {
  clearTimeout(deadline)
  mkdirSync(resolve(process.cwd(), 'artifacts/ui'), { recursive: true })
  writeFileSync(output, JSON.stringify({ ok: false, error: String(error), observations }, null, 2))
  console.error(error)
  if (window && !window.isDestroyed()) window.destroy()
  app.exit(1)
})
