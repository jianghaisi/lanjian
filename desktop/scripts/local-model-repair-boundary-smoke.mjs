import { _electron as electron } from 'playwright'
import { readFile, writeFile, realpath, readdir } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import assert from 'node:assert/strict'
import { withChronicleBuildSnapshot } from './chronicle-build-snapshot.mjs'

// Reuse only this task's previously verified synthetic book and independent runtime.
const evidence = resolve('artifacts/local-model-installation')
const previous = JSON.parse(await readFile(join(evidence, 'native-integrity-focus-result.json'), 'utf8'))
const root = await realpath(previous.root), userData = join(root, 'profile'), modelId = 'qwen3-1.7b-q8_0'
assert.equal(dirname(root), await realpath(tmpdir()))
assert.match(basename(root), /^lanjian-model-native-[a-zA-Z0-9]+$/)
const owned = async path => {
  const canonical = await realpath(path), rel = relative(root, canonical)
  assert.ok(rel && !rel.startsWith('..') && !isAbsolute(rel), 'fixture target must remain in the task profile')
  return canonical
}
const receiptPath = await owned(join(userData, 'local-models/runtime-current.json'))
const original = await readFile(receiptPath, 'utf8'), receipt = JSON.parse(original)
const installationPath = await owned(join(userData, 'local-models/installations.json'))
const oldInstallation = await readFile(installationPath)
const resources = async () => ({ downloads: (await readdir(await owned(join(userData, 'local-models/downloads')))).sort(), runtimes: (await readdir(await owned(join(userData, 'local-models/runtimes')))).sort() })
const before = await resources(), checks = [], failures = []
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('LANJIAN_') && key !== 'ELECTRON_RUN_AS_NODE'))
let mutation
await withChronicleBuildSnapshot(resolve('out-local-installation'), join(evidence, 'snapshots'), async snapshot => {
  let app, page
  const start = async () => {
    app = await electron.launch({ args: [join(snapshot, 'out/main/index.js')], env: { ...env, LANJIAN_USER_DATA_PATH: userData, LANJIAN_GLOBAL_MODEL_DATA_PATH: join(root, 'models') }, timeout: 60000 })
    page = await app.firstWindow(); page.setDefaultTimeout(30000)
    await page.waitForFunction(() => Boolean(window.novelDesktop))
    await page.waitForFunction(() => document.querySelector('[data-testid="app-boot"]') || document.querySelector('[data-testid="library-continue-writing"]'))
    const deadline = Date.now() + 60000
    while (Date.now() < deadline && await page.getByTestId('app-boot').isVisible()) {
      const skip = page.getByTestId('app-boot-skip-models'), enter = page.getByTestId('app-boot-enter')
      if (await skip.isVisible()) await skip.click()
      else if (await enter.isVisible()) await enter.click()
      await page.waitForTimeout(250)
    }
    await page.getByTestId('app-boot').waitFor({ state: 'hidden' })
    await page.getByTestId('library-continue-writing').click()
    await page.getByTestId('workspace-loading').waitFor({ state: 'hidden', timeout: 60000 })
    await page.locator('.activitybar [data-activity="settings"]').click()
    await page.getByTestId('settings-category-ai').click(); await page.getByTestId('settings-nav-local-models').click()
    await page.getByTestId('local-model-store').waitFor()
  }
  try {
    await start()
    assert.equal((await page.evaluate(() => window.novelDesktop.localModels.list()))[0].state, 'ready')
    const settings = await page.evaluate(() => window.novelDesktop.ai.getSettings())
    assert.equal(settings.shared.connectionId, 'local:llama-cpp')
    for (const mode of ['malformed', 'duplicate', 'missing-python']) {
      const bad = structuredClone(receipt)
      if (mode === 'duplicate') bad.files.push({ ...bad.files[0], path: bad.files[0].path.toUpperCase() })
      if (mode === 'missing-python') bad.files = bad.files.filter(file => file.path !== 'python/python.exe')
      mutation = mode === 'malformed' ? '{incomplete fixture' : JSON.stringify(bad)
      await writeFile(await owned(receiptPath), mutation)
      const errors = await page.evaluate(async modelId => {
        const output = []
        for (const run of [() => window.novelDesktop.localModels.list(), () => window.novelDesktop.localModels.install(modelId)]) {
          try { await run(); output.push(null) } catch (error) { output.push({ code: error.code, message: error.message }) }
        }
        return output
      }, modelId)
      assert.equal(errors.length, 2)
      for (const error of errors) { assert.ok(error); assert.match(error.message, /记录无效.*原记录已保留/); assert.doesNotMatch(error.message, /[A-Z]:\\|\.exe|stack/) }
      failures.push({ mode, errors })
      await page.getByTestId('local-model-store').getByRole('alert').waitFor()
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="local-model-store"] .store-model').length === 0, null, { timeout: 5000 })
      assert.equal(await page.locator('.store-empty').count(), 0, 'read failure is not an empty search result')
      assert.deepEqual(await readFile(installationPath), oldInstallation)
      assert.equal(await readFile(receiptPath, 'utf8'), mutation); assert.deepEqual(await resources(), before)
      checks.push(mode + ': rejected before installation with original files retained')
      if (mode === 'malformed') await page.screenshot({ path: join(evidence, 'store-invalid-receipt.png') })
      await writeFile(await owned(receiptPath), original); mutation = undefined
      await page.locator('.model-state[data-state="ready"]').waitFor()
      await page.getByTestId('local-model-store').getByRole('alert').waitFor({ state: 'hidden' })
    }
    checks.push('failed listing removes stale ready cards; successful listing clears the error')
    assert.deepEqual(await page.evaluate(() => window.novelDesktop.ai.getSettings()), settings)
    const detected = await page.evaluate(modelId => window.novelDesktop.localModels.inspect(modelId), modelId)
    assert.equal(detected.state, 'ready', JSON.stringify(detected)); checks.push('valid full receipt passes real text/JSON/tool recheck')
    assert.equal(await readFile(receiptPath, 'utf8'), original); assert.deepEqual(await resources(), before)
    checks.push('explicit recheck retains runtime generation and book assignments')
    await app.close(); app = undefined; await start()
    assert.equal((await page.evaluate(() => window.novelDesktop.localModels.list()))[0].state, 'ready')
    assert.deepEqual(await page.evaluate(() => window.novelDesktop.ai.getSettings()), settings); checks.push('normal restart remains ready')
    await writeFile(join(evidence, 'native-repair-boundary-result.json'), JSON.stringify({ root, failures, checks }, null, 2))
    console.log('PASS', checks.length, 'repair-boundary checks')
  } catch (error) {
    if (page) await page.screenshot({ path: join(evidence, 'native-repair-boundary-failure.png') }).catch(() => {})
    throw error
  } finally {
    if (app) await app.close()
    if (mutation !== undefined) {
      assert.equal(await readFile(receiptPath, 'utf8'), mutation, 'restore only this script\'s exact mutation')
      await writeFile(await owned(receiptPath), original)
    }
  }
})
