// Isolated native Electron acceptance for legacy-to-unified chronicle migration and versioned operations.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { withChronicleBuildSnapshot } from './chronicle-build-snapshot.mjs'

const require = createRequire(import.meta.url)
const { _electron } = require('playwright')
const buildRoot = resolve(process.argv[2] || 'out')
const userData = await mkdtemp(join(tmpdir(), 'lanjian-unified-event-profile-'))
const projectParent = await mkdtemp(join(tmpdir(), 'lanjian-unified-event-books-'))
const env = { ...process.env, LANJIAN_USER_DATA_PATH: userData }
delete env.ELECTRON_RUN_AS_NODE
try {
await withChronicleBuildSnapshot(buildRoot, resolve('node_modules/.cache'), async snapshot => {
  let app = await _electron.launch({ executablePath: require('electron'), args: [join(snapshot, 'out/main/index.js')], env, timeout: 30_000 })
try {
  let page = await app.firstWindow()
  page.setDefaultTimeout(15_000)
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))
  const click = selector => selector.startsWith('[data-nav-parent=')
    ? page.locator(selector).locator('svg').first().click()
    : page.locator(selector).first().click()
  async function waitForValue(read, accept, label, timeout = 15_000) {
    const deadline = Date.now() + timeout
    let last
    while (Date.now() < deadline) {
      last = await read()
      if (accept(last)) return last
      await page.waitForTimeout(100)
    }
    throw new Error(`${label} timeout: ${JSON.stringify(last)}`)
  }
  await page.waitForFunction(() => Boolean(window.novelDesktop))
  await page.evaluate(() => {
    localStorage.setItem('lanjian-opening-enabled', 'false')
    sessionStorage.setItem('lanjian-opening-seen', 'true')
  })
  await page.reload()
  const skipModels = page.locator('[data-testid="app-boot-skip-models"]')
  if (await skipModels.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false)) await skipModels.click()
  await page.locator('[data-testid="app-boot"]').waitFor({ state: 'detached' })
  await click('[data-testid="create-work-item"]')
  await page.locator('input[placeholder="例如：灯火照长安"]').fill('统一事件隔离验收')
  await page.locator('input[placeholder="选择本地文件夹"]').evaluate((input, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }, projectParent)
  await click('.create-book-modal footer .control-button.primary')
  await page.locator('[data-testid="new-project-guide"]').waitFor()
  await click('[data-nav-parent="chronicle"]')
  await page.locator('.chronicle-events').waitFor()

  const records = [
    ['钟楼回声', '第一夜', '和田', '旧城钟楼', '和田听见不存在的第十三声钟响。', '他决定在天亮前进入钟楼。'],
    ['雾巷来信', '第二夜', '林照', '南雾巷', '林照收到一封落款为明日的信。', '信中路线指向钟楼地下。']
  ]
  for (const [index, [title, time, characters, location, event, result]] of records.entries()) {
    await click('[data-testid="add-timeline-event"]')
    for (const [label, value] of [['事件标题', title], ['时间或阶段', time], ['人物', characters], ['地点', location], ['事件内容', event], ['结果与后续影响', result]])
      await page.getByRole('textbox', { name: label, exact: true }).fill(value)
    await page.getByRole('button', { name: '保存时间线', exact: true }).last().click()
    await waitForValue(() => page.evaluate(() => window.novelDesktop.workspace.getTimeline()), value => value.events.length === index + 1, 'legacy timeline save')
    await page.waitForFunction(() => [...document.querySelectorAll('button')].filter(button => button.textContent?.trim() === '保存时间线').every(button => !button.disabled))
  }
  assert.equal((await page.evaluate(() => window.novelDesktop.workspace.getTimeline())).events.length, 2)

  await click('[data-testid="open-event-migration"]')
  const panel = page.locator('[data-testid="event-migration-panel"]')
  await page.waitForFunction(() => document.querySelector('[data-testid="event-migration-panel"]') || document.querySelector('.timeline-workbench > .chronicle-warning'), null, { timeout: 10_000 })
    .catch(async error => { throw new Error(`${error.message}\nbuttonDisabled=${await page.locator('[data-testid="open-event-migration"]').isDisabled()}\npageErrors=${JSON.stringify(pageErrors)}\ntext=${(await page.locator('.timeline-workbench').innerText()).slice(0, 2000)}`) })
  if (!await panel.count()) throw new Error(await page.locator('.timeline-workbench > .chronicle-warning').textContent())
  assert.equal(await panel.locator('.event-migration-rows li').count(), 2)
  for (const checkbox of await panel.locator('input[type="checkbox"]').all()) await checkbox.check()
  const confirm = panel.getByRole('button', { name: '确认并切换到统一事件' })
  assert.equal(await confirm.isEnabled(), true)
  await confirm.click()
  await panel.waitFor({ state: 'detached' }).catch(async error => {
    throw new Error(`${error.message}\npageErrors=${JSON.stringify(pageErrors)}\npanel=${(await panel.innerText()).slice(0, 3000)}`)
  })
  const migrated = await page.evaluate(() => window.novelDesktop.events.projection())
  assert.equal(migrated.approved.length, 2)
  assert.equal(await page.locator('[data-testid="timeline-event-node"]').count(), 2)

  // Reproduce an early transitioned book: receipt/aliases/versions exist, but
  // schema-43 lifecycle and order rows were never initialized.
  const migratedProject = await page.evaluate(() => window.novelDesktop.projects.status())
  const migratedRoot = migratedProject?.project?.path
  assert.equal(typeof migratedRoot, 'string')
  await app.close()
  const sqlite = new DatabaseSync(join(migratedRoot, '.webnovel', 'workspace.sqlite'))
  try {
    sqlite.exec('PRAGMA foreign_keys=ON')
    for (const table of ['event_lifecycle_versions', 'event_display_order_versions']) {
      const trigger = `${table}_no_delete`
      const definition = String(sqlite.prepare("SELECT sql FROM sqlite_schema WHERE type='trigger' AND name=?").get(trigger).sql)
      sqlite.exec(`DROP TRIGGER ${trigger}`)
      sqlite.exec(`DELETE FROM ${table}`)
      sqlite.exec(definition)
    }
  } finally { sqlite.close() }
  app = await _electron.launch({ executablePath: require('electron'), args: [join(snapshot, 'out/main/index.js')], env, timeout: 30_000 })
  page = await app.firstWindow()
  page.setDefaultTimeout(15_000)
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.waitForFunction(() => Boolean(window.novelDesktop))
  await page.evaluate(() => {
    localStorage.setItem('lanjian-opening-enabled', 'false')
    sessionStorage.setItem('lanjian-opening-seen', 'true')
  })
  await page.reload()
  const recoverySkipModels = page.locator('[data-testid="app-boot-skip-models"]')
  if (await recoverySkipModels.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false)) await recoverySkipModels.click()
  await page.locator('[data-testid="app-boot"]').waitFor({ state: 'detached' })
  await page.locator('.project-library').waitFor()
  await page.locator('.work-item-open').filter({ hasText: '统一事件隔离验收' }).first().click()
  await page.locator('[data-testid="workspace-loading"]').waitFor({ state: 'hidden' })
  await click('[data-nav-parent="chronicle"]')
  await page.locator('.chronicle-events').waitFor()
  const directRecoveryPreview = await page.evaluate(async () => {
    try { return { value: await window.novelDesktop.events.previewStateInitialization(), error: null } }
    catch (error) { return { value: null, error } }
  })
  assert.ok(directRecoveryPreview.value, JSON.stringify(directRecoveryPreview.error))
  await click('[data-testid="open-event-migration"]')
  const recoveryPanel = page.locator('[data-testid="event-migration-panel"]')
  await recoveryPanel.getByRole('button', { name: '确认恢复事件顺序' }).waitFor().catch(async error => {
    throw new Error(`${error.message}\npageErrors=${JSON.stringify(pageErrors)}\npanel=${await recoveryPanel.innerText().catch(() => '')}\nworkbench=${(await page.locator('.timeline-workbench').innerText().catch(() => '')).slice(0, 3000)}`)
  })
  assert.match(await recoveryPanel.innerText(), /2 个事件身份/)
  await recoveryPanel.getByRole('button', { name: '确认恢复事件顺序' }).click()
  await recoveryPanel.waitFor({ state: 'detached' })
  const recovered = await page.evaluate(() => window.novelDesktop.events.projection())
  assert.deepEqual(recovered.state.order.eventIds, migrated.state.order.eventIds)
  assert.equal(recovered.approved.length, 2)

  await page.locator('[data-testid="timeline-event-node"]').first().locator('button').click()
  await page.getByRole('button', { name: '编辑记录' }).click()
  await page.getByRole('textbox', { name: '结果与后续影响', exact: true }).evaluate((input, value) => {
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '新版本' }))
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new InputEvent('input', { bubbles: true, data: '新版本', inputType: 'insertCompositionText', isComposing: true }))
    input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '新版本' }))
  }, '他带着来信进入钟楼，留下可追踪的新版本。')
  await page.waitForFunction(() => Object.keys(localStorage).some(key => key.startsWith('lanjian:event-edit-session:')))
  await page.getByRole('button', { name: '保存事件版本' }).click()
  const edited = await waitForValue(() => page.evaluate(() => window.novelDesktop.events.projection()),
    value => value.approved.some(item => item.version === 2), 'versioned event save')
  assert.equal(edited.approved.some(item => item.version === 2 && item.content.result.includes('可追踪的新版本')), true, JSON.stringify(edited.approved))
  await page.getByRole('button', { name: '保存事件版本' }).waitFor({ state: 'visible' })
  await page.waitForFunction(() => ![...document.querySelectorAll('button')]
    .find(button => button.textContent?.trim() === '保存事件版本')?.disabled)

  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: '归档事件' }).click()
  await waitForValue(() => page.evaluate(() => window.novelDesktop.events.projection()),
    value => value.archived.length === 1, 'archive commit')
  await page.locator('[data-testid="timeline-archive-drawer"]').waitFor({ timeout: 15_000 }).catch(async error => {
    const sessions = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage)
      .filter(key => key.startsWith('lanjian:event-edit-session:')).map(key => [key, localStorage.getItem(key)])))
    throw new Error(`${error.message}\nsessions=${JSON.stringify(sessions)}\npageErrors=${JSON.stringify(pageErrors)}\ntext=${(await page.locator('.timeline-workbench').innerText()).slice(-2500)}`)
  })
  const archived = await page.evaluate(() => window.novelDesktop.events.projection())
  assert.equal(archived.archived.length, 1)
  assert.equal(archived.approved.length, 1)
  await page.locator('[data-testid="timeline-archive-drawer"]').getByRole('button').click()
  await page.locator('[data-testid="timeline-archive-drawer"]').waitFor({ state: 'detached' })
  const restored = await waitForValue(() => page.evaluate(() => window.novelDesktop.events.projection()),
    value => value.archived.length === 0 && value.approved.length === 2, 'restore commit')
  assert.equal(restored.archived.length, 0)
  assert.equal(restored.approved.length, 2)
  const materialSourceResult = await page.evaluate(async () => {
    try { return { value: await window.novelDesktop.research.createSource({
      title: '旧城地方志', excerpt: '旧钟楼每逢无月之夜会多响一声，地方志将其列为未解旧案。', userNotes: ''
    }), error: null } } catch (error) {
      return { value: null, error: { message: error?.message, code: error?.code, details: error?.details } }
    }
  })
  assert.ok(materialSourceResult.value, JSON.stringify(materialSourceResult.error))
  const materialSource = materialSourceResult.value
  assert.match(materialSource.id, /^[0-9a-f-]{36}$/i)

  await app.close()
  app = await _electron.launch({ executablePath: require('electron'), args: [join(snapshot, 'out/main/index.js')], env, timeout: 30_000 })
  page = await app.firstWindow()
  page.setDefaultTimeout(15_000)
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.waitForFunction(() => Boolean(window.novelDesktop))
  await page.evaluate(() => {
    localStorage.setItem('lanjian-opening-enabled', 'false')
    sessionStorage.setItem('lanjian-opening-seen', 'true')
  })
  await page.reload()
  const restartSkipModels = page.locator('[data-testid="app-boot-skip-models"]')
  if (await restartSkipModels.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false)) await restartSkipModels.click()
  await page.locator('[data-testid="app-boot"]').waitFor({ state: 'detached' })
  await page.locator('.project-library').waitFor()
  await page.locator('.work-item-open').filter({ hasText: '统一事件隔离验收' }).first().click()
  const restartLoading = page.locator('[data-testid="workspace-loading"]')
  await restartLoading.waitFor({ state: 'visible' })
  await waitForValue(() => page.evaluate(() => window.novelDesktop.projects.status()),
    value => value?.project?.title === '统一事件隔离验收', 'restart project open')
  await restartLoading.waitFor({ state: 'hidden' })
  const restarted = await waitForValue(() => page.evaluate(() => window.novelDesktop.events.projection()),
    value => value.archived.length === 0 && value.approved.length === 2, 'restart projection')
  const restartedBootstrap = await page.evaluate(async () => {
    try { return { value: await window.novelDesktop.workspace.bootstrap(), error: null } }
    catch (error) { return { value: null, error: { message: error?.message, code: error?.code, details: error?.details } } }
  })
  assert.equal(restartedBootstrap.value?.eventProjection?.approved.length, 2, JSON.stringify(restartedBootstrap.error))
  await click('[data-nav-parent="chronicle"]')
  await page.locator('.chronicle-events').waitFor()
  await page.locator('[data-testid="timeline-event-node"]').first().waitFor().catch(async error => {
    throw new Error(`${error.message}\npageErrors=${JSON.stringify(pageErrors)}\ntext=${(await page.locator('.timeline-workbench').innerText()).slice(0, 2500)}`)
  })
  assert.equal(await page.locator('[data-testid="timeline-event-node"]').count(), 2)
  assert.equal(await page.locator('[data-testid="open-event-migration"]').count(), 0)
  assert.equal(restarted.archived.length, 0)
  assert.equal(Math.max(...restarted.approved.map(item => item.version)), 2)

  await click('[data-nav-parent="materials"]')
  await page.locator('[data-nav-leaf="event-extraction"]').click()
  await page.locator('[data-testid="material-events-view"]').waitFor()
  await page.locator('.event-source-picker button').filter({ hasText: '旧城地方志' }).click()
  for (const [label, value] of [['时间', '第三夜'], ['人物', '和田'], ['地点', '旧钟楼'],
    ['事件', '和田查阅地方志，确认第十三声钟响曾经出现。'], ['结果与影响', '地方志成为追查旧案的正式线索。']]) {
    await page.getByRole('textbox', { name: label, exact: true }).fill(value)
  }
  await page.getByRole('button', { name: '保存为候选事件', exact: true }).click()
  const withMaterialCandidate = await waitForValue(() => page.evaluate(() => window.novelDesktop.events.projection()),
    value => value.candidates.length === 1, 'material candidate create')
  assert.equal(withMaterialCandidate.candidates[0].sources[0].source.kind, 'material')
  assert.match(withMaterialCandidate.candidates[0].sources[0].source.revision, /^[a-f0-9]{64}$/)
  await page.getByRole('button', { name: '确认入库', exact: true }).waitFor()
  await page.getByRole('button', { name: '确认入库', exact: true }).click()
  const withAdoptedCandidate = await waitForValue(() => page.evaluate(() => window.novelDesktop.events.projection()),
    value => value.candidates.length === 0 && value.approved.length === 3, 'material candidate adoption')
  assert.equal(withAdoptedCandidate.approved.some(item => item.sources.some(edge => edge.source.kind === 'material')), true)

  assert.deepEqual(pageErrors, [])
  console.log(JSON.stringify({ pass: true, rows: withAdoptedCandidate.approved.length,
    highestVersion: Math.max(...withAdoptedCandidate.approved.map(item => item.version)), restarted: true,
    chineseComposition: true, materialCandidate: true, stateInitialization: true, migrationOperationId: restarted.operationId }))
} finally {
  await app.close().catch(() => undefined)
}
})
} finally {
  await rm(userData, { recursive: true, force: true })
  await rm(projectParent, { recursive: true, force: true })
}
