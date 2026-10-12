import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron } from 'playwright'

const root = await realpath(await mkdtemp(join(tmpdir(), 'lanjian-worldbook-ui-')))
const evidenceRoot = resolve('../.trellis/tasks/09-28-v3-worldbook-generation/research')
await mkdir(evidenceRoot, { recursive: true })
const output = await mkdtemp(join(evidenceRoot, 'native-'))
console.log(JSON.stringify({ output, root }))
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('LANJIAN_') && !['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL'].includes(key)))
Object.assign(env, { LANJIAN_USER_DATA_PATH: join(root, 'profile'), LANJIAN_GLOBAL_MODEL_DATA_PATH: join(root, 'models') })
let app, page
const errors = [], checks = []
async function launch() {
  app = await _electron.launch({ args: [resolve('out/main/index.js')], env })
  app.process().stderr.on('data', chunk => process.stderr.write(chunk))
  page = await app.firstWindow(); page.setDefaultTimeout(30000)
  page.on('pageerror', error => errors.push(error.message))
  await page.waitForFunction(() => Boolean(window.novelDesktop))
  await page.evaluate(async () => {
    localStorage.setItem('lanjian-loading-v1', JSON.stringify({ theme: 'impact', bootStyle: 'brief', bootPalette: 'system' }))
    localStorage.setItem('lanjian-theme', 'moye')
    await window.companionSettings.update({ voice: { mute: true, textModel: false, preload: false } })
  })
}
async function library() {
  await page.reload()
  await page.getByTestId('app-boot-enter').click()
  await page.getByTestId('app-boot').waitFor({ state: 'hidden' })
  await page.locator('[data-library-view="all"]').click()
}
async function open(book) {
  await page.locator('.work-item-open').filter({ hasText: book.title }).first().click()
  await page.getByTestId('workspace-loading').waitFor({ state: 'hidden' })
  await page.locator('[data-nav-parent="foundation"]').click()
  await page.locator('[data-nav-leaf="characters"]').click()
  await page.getByTestId('settings-page-story-entities').waitFor()
}
async function close() {
  const done = app.waitForEvent('close', { timeout: 30000 })
  await page.close({ runBeforeUnload: true }); await done; app = null
}
try {
  await launch()
  const books = await page.evaluate(async root => {
    const api = window.novelDesktop, books = []
    for (const name of ['世界书甲', '世界书乙']) {
      const { project } = await api.projects.create({ parentPath: root, name, genre: '悬疑' })
      await api.projects.switch(project.path)
      const chapters = [await api.chapters.create(), await api.chapters.create()]
      const entity = await api.workspace.saveStoryEntity({ entityType: 'character', canonicalName: '白衡', profileJson: '{"legacy":{"keep":true}}', status: 'candidate' })
      books.push({ ...project, chapters, entity })
    }
    return books
  }, root)
  await library(); await open(books[0])
  const panel = page.getByTestId('settings-page-story-entities')
  const form = panel.locator('.story-entity-form')
  const item = () => panel.locator('.story-entity-list button').filter({ hasText: '白衡' })
  await item().click()
  await page.getByTestId('worldbook-enable').click()
  await page.getByTestId('worldbook-description').fill('白衡在旧城教书，雨天不出门。中文输入保留。')
  const composition = await page.getByTestId('worldbook-description').evaluate(element => {
    const before = element.value
    element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    element.value = '拼音输入中的临时串'
    element.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }))
    const draftDuring = JSON.parse(document.querySelector('[data-testid="worldbook-json"]').value).worldbook.description
    element.value = before
    element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
    return { before, draftDuring }
  })
  assert.equal(composition.draftDuring, composition.before)
  await form.getByLabel(/^状态/).selectOption('approved')
  await page.getByText('本章取用与作者备注', { exact: true }).click()
  await form.getByLabel('别名（每行一个）').fill('白先生\n先生')
  await form.getByLabel('指定章节（可多选）').selectOption(books[0].chapters.map(chapter => String(chapter.id)))
  await page.getByTestId('worldbook-notes').fill('仅作者知道的终局计划')
  await page.getByTestId('worldbook-secrets').locator('summary').click()
  await page.getByTestId('worldbook-add-secret').click()
  await page.getByTestId('worldbook-secret-text').fill('白衡是失踪的城主')
  await page.getByTestId('worldbook-reveal').selectOption(String(books[0].chapters[1].id))
  // Fail one real IPC save. The next attempt must use the same preserved draft.
  await app.evaluate(({ ipcMain }) => {
    const channel = 'workspace:save-story-entity', handler = ipcMain._invokeHandlers.get(channel)
    ipcMain._invokeHandlers.set(channel, async (...args) => { ipcMain._invokeHandlers.set(channel, handler); throw new Error('WORLD_BOOK_SIMULATED_SAVE_FAILURE') })
  })
  await form.getByRole('button', { name: '保存世界书条目' }).click()
  assert.match(await page.getByTestId('worldbook-description').inputValue(), /中文输入保留/)
  await form.getByRole('button', { name: '保存世界书条目' }).click()
  await item().filter({ hasText: '已确认' }).waitFor()
  await item().click()
  await page.getByTestId('worldbook-secrets').locator('summary').click()
  await form.getByLabel('届时知情的人物（可多选）').selectOption(books[0].entity.id)
  await form.getByRole('button', { name: '保存世界书条目' }).click()
  await page.getByTestId('worldbook-enable').waitFor()
  await item().click()
  await page.getByText('本章取用与作者备注', { exact: true }).click()
  assert.equal(await form.getByLabel('指定章节（可多选）').locator('option:checked').count(), 2)
  await page.getByTestId('worldbook-secrets').locator('summary').click()
  assert.equal(await form.getByLabel('届时知情的人物（可多选）').inputValue(), books[0].entity.id)
  const saved = await page.evaluate(async () => (await window.novelDesktop.workspace.listStoryEntities())[0])
  assert.deepEqual(JSON.parse(saved.profileJson).legacy, { keep: true })
  assert.equal(JSON.parse(saved.profileJson).worldbook.secrets[0].revealChapterId, books[0].chapters[1].id)
  checks.push('Chinese edit, explicit confirmation, failed save retry, legacy preservation, chapter/person multi-select persistence')
  await panel.getByLabel('搜索世界书').fill('不存在')
  assert.equal(await item().count(), 0)
  await panel.getByLabel('搜索世界书').fill('白衡')
  assert.equal(await item().count(), 1)
  await panel.locator('.story-entity-list').getByLabel(/^类型/).selectOption('location')
  assert.equal(await item().count(), 0)
  await panel.locator('.story-entity-list').getByLabel(/^类型/).selectOption('character')
  assert.equal(await item().count(), 1)
  checks.push('search/type filters and composition boundary')
  await page.getByTestId('worldbook-description').fill('尚未保存的甲书修改')
  await page.getByTestId('book-tabs').getByRole('button', { name: '返回我的作品', exact: true }).click()
  await page.locator('[data-library-view="all"]').click(); await open(books[1])
  assert.equal(await page.getByTestId('worldbook-description').count(), 0)
  await page.locator('[data-book-tab]').filter({ hasText: books[0].title }).click()
  await page.locator('[data-nav-parent="foundation"]').click()
  await page.locator('[data-nav-leaf="characters"]').click()
  assert.equal(await page.getByTestId('worldbook-description').inputValue(), '尚未保存的甲书修改')
  checks.push('book switch isolates entries and retains unsubmitted draft')
  await close(); await launch(); await library(); await open(books[0])
  assert.equal(await page.getByTestId('worldbook-description').inputValue(), '尚未保存的甲书修改')
  const persisted = await page.evaluate(async () => (await window.novelDesktop.workspace.listStoryEntities())[0])
  assert.match(JSON.parse(persisted.profileJson).worldbook.description, /中文输入保留/)
  checks.push('restart restores draft separately from saved formal entry')
  await page.getByTestId('worldbook-secrets').locator('summary').click()
  await page.getByTestId('worldbook-editor').scrollIntoViewIfNeeded()
  await page.screenshot({ path: join(output, 'worldbook.png') })
  assert.deepEqual(errors, [])
  await writeFile(join(output, 'result.json'), JSON.stringify({ root, checks, errors }, null, 2))
  console.log(JSON.stringify({ checks, errors }))
} catch (error) {
  console.error(error)
  await writeFile(join(output, 'errors.json'), JSON.stringify(errors, null, 2))
  if (page) {
    await page.screenshot({ path: join(output, 'failure.png') }).catch(() => {})
    await writeFile(join(output, 'failure.txt'), String(error) + '\n' + await page.locator('body').innerText().catch(() => ''))
  }
  throw error
} finally { if (app) { if (page && !page.isClosed()) await close(); else await app.close().catch(() => {}) } }
