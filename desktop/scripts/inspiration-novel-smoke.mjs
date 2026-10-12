import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, resolve, basename } from 'node:path'
import { _electron } from 'playwright'

// Manual supplied-file acceptance; no provider, book creation or formal writes.
const inputPath = resolve(process.argv[2] ?? '')
assert.ok(process.argv[2], 'Usage: inspiration-novel-smoke.mjs <novel.txt>')
const bytes = await readFile(inputPath)
const digest = value => createHash('sha256').update(value).digest('hex')
const originalHash = digest(bytes)
const root = resolve('../.local/inspiration-novel-acceptance/native-profile')
const output = resolve('../.trellis/tasks/10-11-v3-inspiration-library-video/research/native-real-novel')
await mkdir(root, { recursive: true }); await mkdir(output, { recursive: true })
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('LANJIAN_') && !['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL'].includes(k)))
env.LANJIAN_USER_DATA_PATH = root
env.LANJIAN_GLOBAL_MODEL_DATA_PATH = join(root, 'empty-model-settings')
const app = await _electron.launch({ args: [resolve('out/main/index.js'), '--disable-gpu'], env })
const errors = []
try {
  const page = await app.firstWindow(), window = await app.browserWindow(page)
  page.setDefaultTimeout(45000)
  page.on('pageerror', error => errors.push(error.name))
  await window.evaluate(w => { w.setContentSize(1440, 960); w.show() })
  await page.waitForFunction(() => Boolean(window.novelDesktop?.inspiration))
  await page.evaluate(async () => {
    localStorage.setItem('lanjian-loading-v1', JSON.stringify({ theme: 'impact', bootStyle: 'brief', bootPalette: 'system' }))
    await window.companionSettings?.update({ voice: { mute: true, textModel: false, preload: false } })
  })
  await page.reload()
  await page.waitForFunction(() => ['app-boot-enter', 'app-boot-skip-models'].some(id => document.querySelector(`[data-testid="${id}"]`)?.getClientRects().length), undefined, { timeout: 60000 })
  if (await page.getByTestId('app-boot-skip-models').isVisible()) await page.getByTestId('app-boot-skip-models').click()
  else await page.getByTestId('app-boot-enter').click()
  await page.getByTestId('app-boot').waitFor({ state: 'hidden', timeout: 60000 })
  await page.getByTestId('open-inspiration-library').click()
  const started = performance.now()
  await page.locator('.inspiration-library input[type=file]').setInputFiles(inputPath)
  const preview = page.getByRole('dialog', { name: '核对来源导入' })
  await preview.waitFor(); await preview.locator('summary').click()
  assert.ok((await preview.textContent()).includes(basename(inputPath, '.txt')))
  const previewMs = Math.round(performance.now() - started)
  await page.screenshot({ path: join(output, '01-real-import-preview.png') })
  await preview.getByRole('button', { name: '确认收入灵感库' }).click()
  await preview.waitFor({ state: 'hidden' })
  const source = await page.evaluate(async title => (await window.novelDesktop.inspiration.listSources()).find(s => s.title === title), basename(inputPath, '.txt'))
  assert.ok(source)
  assert.equal(source.totalCharacters, new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').length)
  await page.locator('.inspiration-source-shelf article').filter({ hasText: source.title }).getByRole('button', { name: '阅读原文', exact: true }).click()
  const reader = page.getByRole('complementary', { name: '完整来源', exact: true })
  await reader.locator('pre').first().waitFor()
  assert.ok((await reader.textContent()).includes('第一卷'))
  await reader.getByRole('button', { name: '继续阅读来源' }).click()
  await page.waitForFunction(() => document.querySelectorAll('.inspiration-source-reader pre').length >= 4)
  assert.ok((await reader.textContent()).includes('第1章'))
  await page.screenshot({ path: join(output, '02-real-source-reading.png') })
  const tail = await page.evaluate(s => window.novelDesktop.inspiration.readSource({ sourceId: s.id, sourceVersion: s.version, offset: s.segmentCount - 1, limit: 1 }), source)
  assert.equal(tail.nextOffset, -1)
  assert.ok(tail.segments[0].title.includes('君生我未生'))
  const jobs = await page.evaluate(() => window.novelDesktop.inspiration.listJobs())
  assert.equal(jobs.length, 0)
  assert.deepEqual(errors, [])
  assert.equal(digest(await readFile(inputPath)), originalHash)
  await writeFile(join(output, 'checks.json'), JSON.stringify({ production: true, fileHash: originalHash, bytes: bytes.length,
    source, previewMs, pagesReadInUi: 2, lastSegmentReadByIpc: true, modelCalls: 0, originalFileUnchanged: true, errors }, null, 2))
  console.log('PASS production Electron: actual 9MB file input, preview, commit, source pagination and final segment; no inference')
} finally { await app.close() }
