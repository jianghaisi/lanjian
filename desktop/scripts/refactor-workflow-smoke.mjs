import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron } from 'playwright'

const output = resolve(process.argv[2] || 'out')
const fixture = await mkdtemp(join(tmpdir(), 'lanjian-refactor-workflow-'))
const evidence = resolve('artifacts/refactor-workflow')
await mkdir(evidence, { recursive: true })
const importFile = join(fixture, '临时导入测试.txt')
await writeFile(importFile, '第一章 风起\n这份虚构文字仅用于测试导入预览。', 'utf8')
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('LANJIAN_') && !['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL'].includes(key)))
env.LANJIAN_USER_DATA_PATH = join(fixture, 'profile')
const app = await _electron.launch({ args: [join(output, 'main/index.js')], env })
const errors = [], warnings = [], checks = []
let page, stage = 'boot'
const mark = name => { stage = name; checks.push(name); console.log(name) }
try {
  page = await app.firstWindow()
  page.setDefaultTimeout(20000)
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.text().includes('[Vue warn]')) warnings.push(message.text()) })
  page.on('dialog', dialog => dialog.accept())
  await page.getByTestId('project-library').waitFor()
  await page.waitForFunction(() => document.querySelector('main.app-frame')?.inert === false
    || (document.querySelector('[data-testid="app-boot"].has-error')
      && document.querySelector('[data-testid="app-boot-skip-models"]')), null, { timeout: 60000 })
  if (await page.getByTestId('app-boot-skip-models').isVisible()) {
    await page.getByTestId('app-boot-skip-models').click()
    checks.push('optional-models-unavailable-author-skip')
  }
  await page.waitForFunction(() => document.querySelector('main.app-frame')?.inert === false, null, { timeout: 60000 })
  await page.getByTestId('app-boot').waitFor({ state: 'detached' })
  await app.evaluate(({ dialog }, { folder, file }) => {
    dialog.showOpenDialog = async (...args) => {
      const options = args.at(-1)
      return { canceled: false, filePaths: [options.properties?.includes('openDirectory') ? folder : file] }
    }
  }, { folder: fixture, file: importFile })
  mark('library-ready')
  await page.getByTestId('create-work-item').click()
  const title = page.getByPlaceholder('例如：灯火照长安')
  await title.waitFor()
  assert.equal(await title.evaluate(element => element === document.activeElement), true)
  await title.fill('结构回归测试书')
  await page.getByTestId('choose-create-folder').click()
  await page.getByLabel('本次不继承默认，先手写建书').check()
  await page.getByTestId('creation-model-defaults').getByText(/明确不继承默认/).waitFor()
  await page.getByRole('button', { name: '创建空白作品', exact: true }).click()
  await page.getByTestId('book-style-guide').waitFor()
  mark('create-book-and-focus-ref')
  await page.getByTestId('book-style-guide').fill('临时测试：使用具体动作，不读取作者作品。')
  await page.getByTestId('book-autosave-delay').fill('2')
  await page.getByTestId('save-profile-and-continue').click()
  await page.waitForFunction(async () => (await window.novelDesktop.workspace.getBookProfile()).writingStyle.includes('临时测试'))
  await page.locator('.material-workbench').waitFor()
  mark('definition-shared-model-saved')
  await page.getByRole('button', { name: '书稿', exact: true }).click({ position: { x: 25, y: 25 } })
  await page.getByTestId('archive-new-chapter').click()
  await page.getByTestId('manuscript-title-input').waitFor()
  await page.getByTestId('manuscript-title-input').fill('中文保存验证')
  const content = page.getByRole('textbox', { name: '章节正文', exact: true })
  await content.click()
  await page.keyboard.press('Control+A')
  await page.keyboard.insertText('窗外的风停了。\n这是临时作品中的重构验证文本。')
  await page.getByTestId('save-manuscript').click()
  await page.waitForFunction(async () => (await window.novelDesktop.chapters.list()).some(chapter => chapter.title === '中文保存验证'))
  const saved = await page.evaluate(async () => {
    const chapter = (await window.novelDesktop.chapters.list()).find(chapter => chapter.title === '中文保存验证')
    return window.novelDesktop.chapters.get(chapter.id)
  })
  assert.ok(saved.content.includes('重构验证文本'))
  mark('manuscript-editor-and-save')
  await page.getByTestId('open-quick-chapter').click()
  await page.getByRole('dialog').filter({ hasText: '快速打开' }).waitFor()
  await page.keyboard.press('Escape')
  await page.getByTestId('open-manuscript-history').click()
  await page.getByTestId('revision-name-current').waitFor()
  await page.getByLabel('当前版本名称').fill('重构验证版本')
  await page.getByTestId('revision-name-current').getByRole('button').click()
  await page.getByText('重构验证版本', { exact: true }).first().waitFor()
  await page.getByRole('button', { name: '关闭历史版本', exact: true }).click()
  mark('template-ref-and-revision-dialog-binding')
  await page.getByTestId('chapter-transfer-toggle').click()
  await page.getByTestId('import-manuscript-in-book').click()
  await page.locator('.txt-import-modal').waitFor()
  await page.locator('.txt-import-modal').getByRole('button', { name: /取消|关闭/ }).first().click()
  mark('import-dialog')
  for (const name of ['素材', '纪事', '设置']) {
    await page.getByRole('button', { name, exact: true }).first().click({ position: { x: 25, y: 25 } })
    await page.waitForFunction(() => !document.querySelector('main.app-frame')?.inert)
    assert.deepEqual(errors, [])
  }
  mark('feature-workbenches')
  await page.getByRole('button', { name: '返回我的作品', exact: true }).click()
  await page.getByTestId('project-library').waitFor()
  await page.getByTestId('library-continue-writing').click()
  await page.waitForFunction(() => !document.querySelector('main.app-frame')?.inert)
  await page.getByTestId('workspace-loading').waitFor({ state: 'detached' })
  await page.getByRole('button', { name: '书稿', exact: true }).click({ position: { x: 25, y: 25 } })
  await page.getByTestId('manuscript-title-input').waitFor()
  assert.equal(await page.getByTestId('manuscript-title-input').inputValue(), saved.title)
  assert.ok(await page.getByRole('textbox', { name: '章节正文', exact: true }).innerText().then(text => text.includes('重构验证文本')))
  const reopened = await page.evaluate(id => window.novelDesktop.chapters.get(id), saved.id)
  assert.equal(reopened.content, saved.content)
  assert.equal(reopened.title, saved.title)
  mark('reopen-authoritative-manuscript')
  assert.deepEqual(errors, [])
  assert.deepEqual(warnings, [])
  await page.screenshot({ path: join(evidence, 'workspace.png') })
} catch (error) {
  if (page) {
    await page.screenshot({ path: join(evidence, 'failure.png') }).catch(() => {})
    await writeFile(join(evidence, 'failure-dom.txt'), await page.locator('body').innerText().catch(() => ''))
  }
  console.error(JSON.stringify({ stage, errors, warnings }))
  throw error
} finally {
  await writeFile(join(evidence, 'verification.json'), JSON.stringify({ checks, errors, warnings, fixture, output, stage }, null, 2))
  await app.close()
}
