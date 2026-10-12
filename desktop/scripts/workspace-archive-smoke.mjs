import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron } from 'playwright'

const before = process.argv.includes('--before')
const build = before ? 'out-api-author-workflow' : process.argv.includes('--current-build') ? 'out' : 'out-workspace-archive'
const root = await realpath(await mkdtemp(join(tmpdir(), 'lanjian-workspace-archive-')))
const output = resolve('../.trellis/tasks/09-30-v3-workspace-archive-design/evidence', before ? 'before' : 'after')
const books = join(root, 'books')
await mkdir(output, { recursive: true }); await mkdir(books)
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('LANJIAN_') && !['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL'].includes(k)))
Object.assign(env, { LANJIAN_USER_DATA_PATH: join(root, 'profile'), LANJIAN_GLOBAL_MODEL_DATA_PATH: join(root, 'models') })
const errors = [], frames = [], checks = []
let app, page
async function size(width = 1440, zoom = 1) {
  const win = await app.browserWindow(page)
  await win.evaluate((w, v) => { if (w.isMaximized()) w.unmaximize(); w.setContentSize(v.width, 1000); w.webContents.setZoomFactor(v.zoom) }, { width, zoom })
}
async function capture(name) {
  await page.locator('.toast').waitFor({ state: 'hidden' })
  await page.waitForTimeout(250)
  await page.evaluate(() => document.fonts.ready)
  const geometry = await page.evaluate(() => {
    const root = document.querySelector('.workbench') ?? document.querySelector('.project-library')
    const current = root?.firstElementChild
    const heading = current?.querySelector('h2')
    return { width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth + 1, contentOverflow: current ? current.scrollWidth > current.clientWidth + 2 : false, page: current?.className, heading: heading?.textContent.trim(), headingFont: heading && getComputedStyle(heading).fontFamily }
  })
  assert.equal(geometry.overflow, false, name + ' document overflow')
  frames.push({ name, ...geometry })
  const win = await app.browserWindow(page)
  await writeFile(join(output, name + '.png'), Buffer.from(await win.evaluate(async w => (await w.webContents.capturePage()).toPNG().toString('base64')), 'base64'))
  console.log('CAPTURE', name, JSON.stringify(geometry))
}
async function nav(group, leaf) {
  await page.locator(`[data-nav-parent="${group}"]`).click()
  if (leaf) {
    if (group === 'chronicle') await page.getByTestId('timeline-mode-' + ({ 'event-timeline': 'events', 'world-map': 'map' }[leaf])).click()
    else if (group === 'definition' || (before && group === 'manuscript' && leaf === 'chapters')) { /* Single page / legacy manuscript navigation. */ }
    else await page.locator(`[data-nav-leaf="${leaf}"]`).click()
  }
  await page.waitForTimeout(180)
}
async function theme(value) {
  await page.evaluate(value => { localStorage.setItem('lanjian-theme', value); window.dispatchEvent(new StorageEvent('storage', { key: 'lanjian-theme', newValue: value })) }, value)
  await page.waitForTimeout(450)
}
try {
  app = await _electron.launch({ args: [resolve(build, 'main/index.js')], env })
  await app.evaluate(({ session }) => {
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_, done) => done({ cancel: true }))
    globalThis.fetch = () => { throw Error('External requests blocked in workspace archive smoke') }
  })
  page = await app.firstWindow(); page.setDefaultTimeout(12000)
  page.on('pageerror', e => errors.push(e.message))
  await page.waitForFunction(() => Boolean(window.novelDesktop))
  await page.evaluate(() => {
    localStorage.setItem('lanjian-opening-enabled', 'false')
    localStorage.setItem('lanjian-loading-v1', JSON.stringify({ theme: 'standard', bootStyle: 'brief', bootPalette: 'system' }))
    localStorage.setItem('lanjian-companion-voice-v1', JSON.stringify({ voice: 'ningguang', mute: true, textModel: false, preload: false }))
    sessionStorage.setItem('lanjian-opening-seen', 'true')
  })
  await page.reload(); await page.getByTestId('app-boot-enter').click(); await page.getByTestId('app-boot').waitFor({ state: 'hidden' }); await size()
  await capture('00-library')
  const library = await page.locator('.project-library').evaluate(e => {
    const s = getComputedStyle(e); const title = e.querySelector('h1'); const t = title && getComputedStyle(title)
    return { background: s.background, color: s.color, font: s.font, title: t && { font: t.font, color: t.color } }
  })
  if (!before) {
    const previous = JSON.parse(await readFile(resolve(output, '../before/results.json'), 'utf8'))
    assert.deepEqual(library, previous.library, 'Library computed style stays unchanged')
    checks.push('Library computed styles match before; source protection is checked separately')
  }
  await page.getByTestId('create-work-item').click()
  await page.locator('input[placeholder="例如：灯火照长安"]').fill('霁川纪事 · 界面验证')
  await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }) }, books)
  await page.getByTestId('choose-create-folder').click()
  await page.waitForFunction(() => !document.querySelector('[data-testid="creation-model-defaults"]')?.textContent.includes('正在核对'))
  await page.getByTestId('creation-model-defaults').locator('input[type=checkbox]').check()
  await page.locator('.create-book-modal footer .control-button.primary').click()
  await page.getByTestId('workspace-loading').waitFor({ state: 'hidden' }); await page.getByTestId('new-project-guide').waitFor()
  await capture('01-definition-new')
  await page.getByTestId('book-genre').selectOption({ index: 1 })
  await page.locator('.profile-premise textarea').fill('霁川城的抄书人发现失落的河流图志，沿古驿道寻找消失的城池。')
  await page.getByTestId('save-profile-and-continue').click()
  await page.getByTestId('material-notes-view').waitFor()
  await capture('02-ideas')
  for (const [group, leaf, name] of [
    ['materials', 'manual-sources', '03-sources'], ['materials', 'web-research', '04-research'], ['materials', 'event-extraction', '05-material-events'],
    ['foundation', 'characters', '06-worldbook'], ['foundation', 'world', '07-world'], ['foundation', 'realms', '08-realms'], ['foundation', 'system-template', '09-system'],
    ['chronicle', 'event-timeline', '10-chronicle'], ['chronicle', 'world-map', '11-map'],
    ['planning', 'total-outline', '12-outline'], ['planning', 'chapter-skeleton', '13-skeleton'],
    ['manuscript', 'chapters', '14-manuscript-empty']
  ]) { await nav(group, leaf); await capture(name) }
  await page.getByTestId('archive-new-chapter').click()
  const editor = page.getByTestId('manuscript-input')
  await editor.fill('雨停时，林舟展开了那张没有河流的地图。\n\n这是独立验证作品中的正文，不涉及作者作品。')
  await capture('15-manuscript')
  if (!before) { await nav('manuscript', 'review'); await capture('16-review') }
  else { await nav('definition'); checks.push('Before: review destination has no visible manuscript navigation entry') }
  assert.match(await page.evaluate(async () => { const api = window.novelDesktop; const chapters = await api.chapters.list(); return (await api.chapters.get(chapters[0].id)).content }), /没有河流/)
  checks.push('Native book creation, definition save/continue, prose save through navigation')
  for (const [category, sections] of [['common', ['appearance','companion']], ['ai', ['connection','routing','local-models','context']], ['writing', ['writing','prompts','plugins']], ['data', ['project','trial']], ['advanced', ['research','about']]]) {
    await nav('settings'); await page.getByTestId('settings-category-' + category).click()
    for (const section of sections) { await page.getByTestId('settings-nav-' + section).click(); await capture('settings-' + section) }
  }
  await nav('definition', 'profile'); await capture('17-definition-saved')
  for (const selected of ['moye', 'xuanzhi']) {
    await theme(selected); await size(1100, 1.25)
    await nav('definition', 'profile'); await capture('compact-' + selected + '-definition')
    await nav('foundation', 'characters'); await capture('compact-' + selected + '-worldbook')
    await nav('settings'); await page.getByTestId('settings-category-common').click(); await page.getByTestId('settings-nav-appearance').click(); await capture('compact-' + selected + '-settings')
    await nav('manuscript', 'chapters'); await capture('compact-' + selected + '-manuscript')
  }
  if (!before) {
    await size(); await theme('qingzhou')
    const fixture = await page.evaluate(async () => {
      const api = window.novelDesktop.modelConnections
      let catalog = await api.list()
      for (const [name, protocol] of [['zzshu · Gemini', 'gemini-native'], ['zzshu · GPT', 'openai-compatible'], ['zzshu · Claude', 'openai-compatible'], ['历史副本', 'openai-compatible']]) {
        catalog = await api.create({ expectedRevision: catalog.revision, name, protocol, baseUrl: 'https://synthetic.example.test/v1', apiKey: 'synthetic-only' })
      }
      const retired = catalog.connections.at(-1)
      catalog = await api.update({ expectedRevision: catalog.revision, id: retired.id, connectionRevision: retired.revision, enabled: false })
      const book = await api.book(), selected = catalog.connections[1]
      await api.saveBook({ token: book.token, patch: { globalReferences: [{ id: 'chosen', globalConnectionId: selected.id }], shared: { connectionId: 'chosen', model: 'writer-example' }, globalRevisions: [{ id: selected.id, revision: selected.revision }] } })
      return { selected: selected.id, retired: retired.id }
    })
    await nav('settings'); await page.getByTestId('settings-category-ai').click(); await page.getByTestId('settings-nav-connection').click()
    const manager = page.getByTestId('global-model-settings')
    await page.waitForFunction(() => document.querySelector('[data-testid="global-model-settings"]')?.getAttribute('aria-busy') === 'false')
    assert.equal(await manager.locator('.connection-index > article').count(), 3)
    assert.equal(await manager.getByTestId('retired-connections').getAttribute('open'), null)
    assert.equal(await manager.locator(`[data-global-id="${fixture.retired}"]`).isVisible(), false)
    await capture('feedback-three-apis')
    await manager.getByTestId('retired-connections').locator('summary').click()
    await manager.locator(`[data-global-id="${fixture.retired}"] button`).click()
    assert.match(await manager.locator('.connection-detail').innerText(), /已停用/)
    await page.getByTestId('settings-nav-routing').click()
    await page.waitForFunction(() => document.querySelector('[data-testid="global-model-settings"]')?.getAttribute('aria-busy') === 'false')
    const source = manager.getByLabel('统一模型接口', { exact: true })
    assert.deepEqual(await source.locator('option:not(:disabled)').allTextContents(), ['zzshu · Gemini', 'zzshu · GPT', 'zzshu · Claude'])
    const modelFile = join(books, '霁川纪事 · 界面验证', '.webnovel', 'ai-settings.json')
    const savedBeforeLocal = await readFile(modelFile, 'utf8')
    await manager.locator('.routing-maintenance > summary').click()
    await manager.getByTestId('use-local-shared').click()
    assert.match(await manager.innerText(), /在本机运行，无需 API/)
    assert.equal(await readFile(modelFile, 'utf8'), savedBeforeLocal)
    await manager.getByRole('button', { name: '撤销这次切换', exact: true }).click()
    assert.equal(await source.inputValue(), `global:${fixture.selected}`)
    await manager.locator('.routing-maintenance > summary').click()
    await capture('feedback-model-sources')
    // Use the public save path to refresh the application's one-off model state.
    await manager.getByTestId('save-book-models').click()
    await page.waitForFunction(() => document.querySelector('[data-testid="global-model-settings"]')?.getAttribute('aria-busy') === 'false')
    assert.equal(await manager.getByRole('alert').count(), 0)
    checks.push('Three active API choices only; retired entries collapsed but reachable; private sources excluded; local selection explicit, unsaved and undoable')
    await nav('materials', 'ideas')
    await page.getByTestId('new-idea').click()
    await page.getByTestId('idea-title-input').fill('消失的驿站')
    await page.getByTestId('idea-content-input').fill('每逢雨夜，地图上会多出一座古驿站。' + '这是仍需核对的灵感，尚未提升为正式设定。'.repeat(12))
    await page.getByTestId('idea-editor').getByRole('button', { name: '保存便签', exact: true }).click()
    await page.getByTestId('idea-list').getByRole('button').filter({ hasText: '消失的驿站' }).waitFor()
    await capture('populated-ideas')
    await nav('foundation', 'characters')
    const form = page.locator('.story-entity-form')
    await form.getByLabel('名称', { exact: true }).fill('林舟')
    await page.getByTestId('worldbook-enable').click()
    const description = page.getByTestId('worldbook-description')
    await description.fill('霁川城的抄书人。熟悉古道地图，尚未离开过故乡。')
    const composition = await description.evaluate(e => {
      const before = e.value
      e.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
      e.value = 'linzhou'
      e.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }))
      const during = JSON.parse(document.querySelector('[data-testid="worldbook-json"]').value).worldbook.description
      e.value = before + '中文输入已完成。'
      e.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
      return { before, during }
    })
    assert.equal(composition.during, composition.before)
    await form.getByRole('button', { name: '保存世界书条目', exact: true }).click()
    const record = page.locator('.story-entity-list button').filter({ hasText: '林舟' })
    await record.waitFor(); await record.click()
    assert.match(await description.inputValue(), /中文输入已完成/)
    const persisted = await page.evaluate(async () => (await window.novelDesktop.workspace.listStoryEntities()).find(e => e.canonicalName === '林舟'))
    assert.match(JSON.parse(persisted.profileJson).worldbook.description, /中文输入已完成/)
    await capture('populated-worldbook')
    await size(1100, 1.25); await theme('moye'); await description.scrollIntoViewIfNeeded(); await capture('compact-worldbook-edit')
    checks.push('Idea remains a candidate; worldbook IME composition, explicit save and reload preserve Chinese text')
    await size(); await theme('qingzhou'); await nav('definition')
    const disclosure = page.getByTestId('profile-save-disclosure')
    await disclosure.locator('summary').focus(); await page.keyboard.press('Enter')
    assert.equal(await disclosure.getAttribute('open'), '')
    await page.getByTestId('book-autosave-delay').fill('2')
    await page.getByTestId('profile-alias-disclosure').locator('summary').click()
    await capture('definition-advanced')
    await page.getByRole('button', { name: '保存作品定义', exact: true }).click()
    await nav('manuscript', 'chapters')
    await page.getByTestId('manuscript-layout').focus(); await page.keyboard.press('Enter')
    await capture('editor-layout'); await page.keyboard.press('Escape')
    assert.equal(await page.getByTestId('manuscript-layout').evaluate(e => document.activeElement === e), true)
    await page.getByTestId('manuscript-annotations').click(); await page.getByTestId('annotation-panel').waitFor(); await capture('editor-annotations')
    await page.getByTestId('manuscript-annotations').click()
    await page.getByRole('button', { name: '打开智能助笔侧栏', exact: true }).click()
    await page.getByTestId('field-assistant-panel').waitFor(); await capture('assistant-conversation')
    const assistantColors = await page.locator('.assistant-panel > header').evaluate(e => ({ background: getComputedStyle(e).backgroundColor, text: getComputedStyle(e.querySelector('div > span')).color }))
    assert.notEqual(assistantColors.background, 'rgb(38, 59, 50)', 'Assistant has no dark banner in light theme')
    assert.notEqual(assistantColors.text, assistantColors.background)
    assert.equal(await page.locator('.assistant-panel > header > div').evaluate(e => getComputedStyle(e).fontSize), '14px')
    assert.equal(await page.locator('.field-assistant-intro h3').evaluate(e => getComputedStyle(e).fontSize), '16px')
    await page.getByTestId('assistant-sidebar').locator('.model-catalog-trigger').click()
    const picker = page.getByRole('dialog', { name: '选择模型及所属接口', exact: true })
    await picker.getByRole('button', { name: /找不到要用的模型/ }).click()
    assert.deepEqual((await picker.getByLabel('手动模型所属接口', { exact: true }).locator('option').allTextContents()).map(s => s.split(' · synthetic')[0]).sort(), ['zzshu · Gemini', 'zzshu · GPT', 'zzshu · Claude'].sort())
    await page.keyboard.press('Escape')
    checks.push('Assistant manual API picker also excludes private and retired duplicates')
    const assistant = page.getByTestId('assistant-sidebar'), rect = await assistant.boundingBox(), win = await app.browserWindow(page)
    await writeFile(join(output, 'feedback-assistant.png'), Buffer.from(await win.evaluate(async (w, r) => (await w.webContents.capturePage(r)).toPNG().toString('base64'), { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }), 'base64'))
    for (const selected of ['qingzhou', 'xuanzhi', 'moye']) { await size(1100, 1.25); await theme(selected); await capture('feedback-assistant-' + selected) }
    await size(); await theme('qingzhou')
    await page.getByTestId('assistant-mode-tasks').click(); await page.getByTestId('task-center-panel').waitFor()
    await page.getByTestId('task-filter-all').click(); await page.getByTestId('refresh-task-center').click(); await capture('assistant-tasks')
    await size(1100, 1.25); await theme('moye'); await capture('compact-assistant-tasks')
    await page.getByTestId('assistant-mode-checks').click(); await capture('compact-assistant-checks')
    await page.getByRole('button', { name: '关闭智能助笔侧栏', exact: true }).click()
    await size(); await theme('qingzhou'); await nav('planning', 'total-outline')
    await page.getByRole('button', { name: '新建卷', exact: true }).click()
    await page.getByRole('dialog', { name: '新建卷', exact: true }).waitFor()
    await capture('dialog-new-volume'); await page.keyboard.press('Escape')
    await page.getByRole('dialog', { name: '新建卷', exact: true }).waitFor({ state: 'hidden' })
    checks.push('Keyboard disclosures, preserved autosave controls, editor layout focus restoration, annotations, assistant modes, task filters and native dialog Escape')
    assert.equal(frames.some(f => f.contentOverflow && f.name !== '00-library'), false, 'Page overflow')
  }
  assert.deepEqual(errors, [])
  await writeFile(join(output, 'results.json'), JSON.stringify({ root, library, checks, frames, errors }, null, 2))
  console.log('PASS', frames.length, 'frames', root)
} catch (error) {
  if (app && page) await capture('failure').catch(() => {})
  await writeFile(join(output, 'failure.json'), JSON.stringify({ root, error: String(error), frames, errors }, null, 2))
  throw error
} finally { await app?.close() }
