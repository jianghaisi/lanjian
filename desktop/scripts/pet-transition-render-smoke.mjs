import assert from 'node:assert/strict'
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { createServer } from 'node:http'
import { stripTypeScriptTypes } from 'node:module'
import { chromium } from 'playwright'

// Real production shader/loader in WebGL. No author profile, no image edits.
async function probe() {
  console.log('probe: GPU setup')
  const app = new Application({ width: 512, height: 512, resolution: 1, backgroundAlpha: 0, autoStart: false, sharedTicker: false })
  const scene = createPetSequenceMesh(), owned = [], snapshots = [], rows = [], checks = []
  app.stage.addChild(scene.mesh)
  const pose = (sheet, index = 0) => ({ sheet, index })
  function pixels(a, b, mix) { scene.set(a, b, mix); app.render(); return app.renderer.extract.pixels(app.stage) }
  function sheet(left, green) {
    const data = new Uint8Array(512 * 512 * 4)
    for (let y = 120; y < 360; y++) for (let x = left; x < left + 164; x++) {
      const alpha = x < left + 160 ? 255 : 96
      data.set([80, green, 100, alpha], (y * 512 + x) * 4)
    }
    const value = { texture: Texture.fromBuffer(data, 512, 512), flow: Texture.EMPTY,
      registration: { size: [512, 512], density: 1, frames: [{ rect: [0, 0, 512, 512], anchor: [256, 486] }] } }
    owned.push(value); return value
  }
  const alphaAt = (data, x, y = 200) => data[(y * 512 + x) * 4 + 3]
  const maxDifference = (a, b) => a.reduce((largest, value, index) => Math.max(largest, Math.abs(value - b[index])), 0)
  const hash = async data => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data))).map(value => value.toString(16).padStart(2, '0')).join('')
  function capture() { const result = scene.capture(app.renderer); snapshots.push(result); return result }
  function picture(label) {
    const figure = document.createElement('figure'), image = document.createElement('img'), caption = document.createElement('figcaption')
    image.src = app.renderer.extract.canvas(app.stage).toDataURL(); caption.textContent = label
    figure.append(image, caption); document.querySelector('#results').append(figure)
  }
  try {
    console.log('probe: synthetic pixels')
    const a = pose(sheet(120, 140)), b = pose(sheet(200, 144))
    const start = pixels(a, b, 0), end = pixels(a, b, 1)
    const mixtures = [.25, .49, .5, .51, .75].map(mix => {
      const result = pixels(a, b, mix)
      return { mix, oldEdge: alphaAt(result, 150), newEdge: alphaAt(result, 340), softEdge: alphaAt(result, 362),
        overlapAlpha: alphaAt(result, 230), overlapGreen: result[(200 * 512 + 230) * 4 + 1] }
    })
    checks.push({ name: 'synthetic-contours', start: [alphaAt(start, 150), alphaAt(start, 340), alphaAt(start, 362)], end: [alphaAt(end, 150), alphaAt(end, 340), alphaAt(end, 362)], mixtures })
    pixels(a, b, .35); const composed = app.renderer.extract.pixels(app.stage), snapshot = capture()
    const resumed = pixels(snapshot, b, 0)
    checks.push({ name: 'interrupted-snapshot', maxDifference: maxDifference(composed, resumed) })
    for (const intent of ['pat', 'handshake']) {
      console.log(`probe: load ${intent}`)
      const action = await loadPetSheet(intent), idle = await loadPetSheet('idle'); owned.push(action, idle)
      console.log(`probe: render ${intent}`)
      const from = pose(action, action.registration.frames.length - 1), to = pose(idle)
      pixels(from, from, 0); const source = capture(), first = pixels(source, to, 0), last = pixels(source, to, 1)
      for (const mix of [0, .25, .49, .5, .75, 1]) {
        const result = pixels(source, to, mix)
        let exclusivePixels = 0, fadedExclusivePixels = 0
        for (let offset = 3; offset < result.length; offset += 4) {
          if (!(first[offset] > 220 && last[offset] < 8 || last[offset] > 220 && first[offset] < 8)) continue
          exclusivePixels++
          const expected = (mix < .5 ? first : last)[offset]
          if (Math.abs(result[offset] - expected) > 3) fadedExclusivePixels++
        }
        rows.push({ intent, mix, exclusivePixels, fadedExclusivePixels, sha256: await hash(result) })
        picture(`${intent} · ${Math.round(mix * 100)}%`)
      }
      // Adjacent authored frames still use their existing flow and blend policy.
      for (const mix of [0, .25, .5, .75, 1]) rows.push({ intent, adjacent: true, mix, sha256: await hash(pixels(pose(action, 7), pose(action, 8), mix)) })
    }
    console.log('probe: high-DPI interruption fidelity')
    const idle = await loadPetSheet('idle'); owned.push(idle)
    const errorsBetween = (a, b) => {
      let error = 0, alphaError = 0, pixels = 0
      for (let offset = 0; offset < a.length; offset += 4) {
        if (Math.max(a[offset + 3], b[offset + 3]) < 16) continue
        pixels++
        alphaError += Math.abs(a[offset + 3] - b[offset + 3])
        // Compare premultiplied color, so invisible RGB and very soft-edge
        // unpremultiplication rounding cannot dominate visible fidelity.
        for (let c = 0; c < 3; c++) error += Math.abs(a[offset + c] * a[offset + 3] / 255 - b[offset + c] * b[offset + 3] / 255)
      }
      return { meanColorError: error / (pixels * 3), meanAlphaError: alphaError / pixels, comparedPixels: pixels }
    }
    for (const resolution of [1, 1.25, 2, 3]) {
      app.renderer.resolution = resolution
      const target = RenderTexture.create({ width: 512, height: 512, resolution })
      const read = (value, next = value, mix = 0) => {
        scene.set(value, next, mix)
        app.renderer.render(scene.mesh, { renderTexture: target, clear: true })
        return app.renderer.extract.pixels(target)
      }
      try {
        for (const [label, next, mix] of [['still', 3, 0], ['interpolated', 4, .37]]) {
          const original = read(pose(idle, 3), pose(idle, next), mix), rounds = []
          for (let interruption = 1; interruption <= 4; interruption++) {
            const snapshot = capture(), result = read(snapshot)
            rounds.push({ interruption, ...errorsBetween(original, result) })
          }
          checks.push({ name: 'high-dpi-snapshot', sample: label, resolution, width: target.baseTexture.realWidth, rounds })
        }
      } finally { target.destroy(true) }
    }
    app.renderer.resolution = 1
    await Promise.all([...document.images].map(image => image.decode()))
    console.log('probe: complete')
    return { checks, rows, webgl: app.renderer.gl.getParameter(app.renderer.gl.VERSION) }
  } finally {
    app.destroy(false, { children: true })
    snapshots.forEach(value => value.sheet.texture.destroy(true))
    owned.forEach(value => { value.texture.destroy(true); if (value.flow !== Texture.EMPTY) value.flow.destroy(true) })
  }
}

const baseline = process.argv.includes('--baseline'), root = process.cwd()
const output = resolve(root, 'artifacts/ui/pet-transition-render', baseline ? 'baseline' : 'fixed')
await mkdir(output, { recursive: true })
const entry = `const { Application, Texture, RenderTexture } = window.PIXI;
import { createPetSequenceMesh, loadPetSheet } from '/scene.js';
window.probe = ${probe.toString()};`
const services = resolve(root, 'src/renderer/features/companion/services'), assets = resolve(root, 'src/renderer/assets/visuals/pet-sequences')
const assetFiles = (await readdir(assets)).filter(name => /\.(png|flow)$/.test(name))
const urls = extension => JSON.stringify(Object.fromEntries(assetFiles.filter(name => name.endsWith(extension)).map(name => [`../../../assets/visuals/pet-sequences/${name}`, `/assets/${name}`])))
// Replace only build-time imports/URL discovery. Shader, mesh, loader,
// registration and isolation functions execute from the actual source files.
const sceneSource = stripTypeScriptTypes(await readFile(resolve(services, 'pet-sequence-scene.ts'), 'utf8'))
  .replace(/import\s*\{([^}]+)\}\s*from\s*'pixi.js'/, 'const {$1} = window.PIXI')
  .replace(/import registration from [^\n]+/, `const registration = ${await readFile(resolve(assets, 'registration.json'), 'utf8')}`)
  .replace("'./pet-frame-isolation'", "'/isolation.js'").replace("'./pet-sequence-registration'", "'/registration.js'")
  .replace(/^const urls = .*$/m, `const urls = ${urls('.png')}`)
  .replace(/^const flows = .*$/m, `const flows = ${urls('.flow')}`)
const modules = new Map([
  ['/scene.js', sceneSource], ['/pet-transition-entry.js', entry],
  ['/isolation.js', stripTypeScriptTypes(await readFile(resolve(services, 'pet-frame-isolation.ts'), 'utf8'))],
  ['/registration.js', stripTypeScriptTypes(await readFile(resolve(services, 'pet-sequence-registration.ts'), 'utf8'))],
  ['/pixi.js', await readFile(resolve(root, 'node_modules/pixi.js/dist/browser/pixi.min.js'), 'utf8')]
])
const server = createServer(async (req, res) => {
  const path = req.url
  if (modules.has(path)) { res.setHeader('Content-Type', 'text/javascript'); res.end(modules.get(path)); return }
  const name = path?.startsWith('/assets/') ? path.slice(8) : ''
  if (assetFiles.includes(name)) { res.setHeader('Content-Type', name.endsWith('.png') ? 'image/png' : 'application/octet-stream'); res.end(await readFile(resolve(assets, name))); return }
  if (path !== '/pet-transition-probe') { res.writeHead(404); res.end(); return }
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.end('<!doctype html><html><meta charset="utf-8"><style>body{margin:12px;background:#f3f0e8;color:#283831;font:14px sans-serif}#results{display:grid;grid-template-columns:repeat(6,180px);gap:10px}figure{margin:0}img{display:block;width:180px;height:180px;background:#292e2c}figcaption{padding:6px}</style><div id="results"></div><script src="/pixi.js"></script><script type="module" src="/pet-transition-entry.js"></script></html>')
})
let browser
const errors = []
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  console.log('probe: server listening')
  browser = await chromium.launch({ headless: true, channel: 'msedge' })
  console.log('probe: browser launched')
  const page = await browser.newPage({ viewport: { width: 1160, height: 550 }, deviceScaleFactor: 1 })
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.text().startsWith('probe:')) console.log(message.text()) })
  await page.goto(`http://127.0.0.1:${server.address().port}/pet-transition-probe`)
  await page.waitForFunction(() => typeof window.probe === 'function')
  let deadline
  const result = await Promise.race([page.evaluate(() => window.probe()), new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('PET_TRANSITION_PROBE_TIMEOUT')), 60000) })]).finally(() => clearTimeout(deadline))
  result.shaderSourceSha256 = createHash('sha256').update(await readFile(resolve(root, 'src/renderer/features/companion/services/pet-sequence-scene.ts'))).digest('hex')
  result.errors = errors
  await writeFile(resolve(output, 'report.json'), JSON.stringify(result, null, 2))
  await page.locator('#results').screenshot({ path: resolve(output, 'dark.png') })
  await page.addStyleTag({ content: 'img{background:#f3f0e8}' })
  await page.locator('#results').screenshot({ path: resolve(output, 'light.png') })
  assert.deepEqual(errors, [])
  const synthetic = result.checks[0]
  assert.deepEqual(synthetic.start, [255, 0, 0]); assert.deepEqual(synthetic.end, [0, 255, 96])
  assert.ok(synthetic.mixtures.every(row => row.overlapAlpha === 255), 'overlap must remain opaque')
  assert.equal(synthetic.mixtures[2].overlapGreen, 142, 'similar colors must still interpolate')
  assert.ok(result.checks[1].maxDifference <= 1, 'interruption must start at the already displayed composition')
  for (const check of result.checks.filter(check => check.name === 'high-dpi-snapshot')) {
    assert.ok(check.rounds.every(round => round.comparedPixels > 10000), 'snapshot comparison needs visible character pixels')
    if (!baseline) assert.ok(check.rounds.every(round => round.meanColorError <= .05 && round.meanAlphaError <= .05), `snapshot loses visible detail at resolution ${check.resolution}: ${JSON.stringify(check.rounds)}`)
  }
  const ghosted = result.rows.filter(row => !row.adjacent && row.mix > 0 && row.mix < 1)
  assert.ok(ghosted.every(row => row.exclusivePixels > 100), 'real artwork needs a meaningful unmatched-contour sample')
  if (baseline) assert.ok(ghosted.every(row => row.fadedExclusivePixels > 100), 'baseline must reproduce double contours')
  else {
    for (const row of synthetic.mixtures) {
      assert.equal(row.oldEdge, row.mix < .5 ? 255 : 0)
      assert.equal(row.newEdge, row.mix < .5 ? 0 : 255)
      assert.equal(row.softEdge, row.mix < .5 ? 0 : 96, 'preserve the chosen drawing\'s translucent edge')
    }
    assert.ok(ghosted.every(row => row.fadedExclusivePixels === 0), 'unmatched solid contours must not become translucent duplicates')
    if (process.argv.includes('--compare-baseline')) {
      const previous = JSON.parse(await readFile(resolve(output, '../baseline/report.json'), 'utf8'))
      for (const row of result.rows.filter(row => row.adjacent || row.mix === 0 || row.mix === 1)) {
        const old = previous.rows.find(old => old.intent === row.intent && old.mix === row.mix && Boolean(old.adjacent) === Boolean(row.adjacent))
        assert.equal(row.sha256, old?.sha256, 'endpoints and in-clip flow must remain pixel-identical')
      }
    }
  }
  console.log(JSON.stringify({ baseline, checks: result.checks, contours: ghosted.map(({ sha256, ...row }) => row), output }))
} catch (error) { console.error(error); throw error }
finally { await browser?.close(); await new Promise(resolve => server.close(resolve)) }
