import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron } from 'playwright'

const require = createRequire(import.meta.url)
require('tsx/cjs')
const { SettingsStore } = require('../src/main/platform/settings/settings-store.ts')
const { ProjectService } = require('../src/main/modules/library/application/project-service.ts')
const root = await mkdtemp(join(tmpdir(), 'lanjian-continue-native-'))
const profile = join(root, 'profile'), output = resolve('artifacts/ui/library-continuation')
await mkdir(output, { recursive: true })
const projects = new ProjectService(new SettingsStore(profile, { available: () => false, encrypt: () => '', decrypt: () => '' }))
const a = (await projects.create({ parentPath: root, title: '我家美少女 · 隔离测试' })).project
const b = (await projects.create({ parentPath: root, title: '测试文稿 · 隔离测试' })).project
const body = '这是隔离回归的合成正文，不是作者作品。'
const manuscript = join(a.path, '正文', '第1章-隔离章节.md')
await writeFile(manuscript, body)
const env = { ...process.env, LANJIAN_USER_DATA_PATH: profile }
delete env.ELECTRON_RUN_AS_NODE; delete env.LANJIAN_SMOKE
let app
const errors = [], checks = []
async function launch() {
  app = await _electron.launch({ args: ['.'], env })
  const page = await app.firstWindow()
  page.setDefaultTimeout(30000)
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  return page
}
try {
  let page = await launch()
  await page.waitForFunction(() => Boolean(window.novelDesktop))
  await page.evaluate(async () => {
    localStorage.setItem('lanjian-companion-voice-v1', JSON.stringify({ voice: 'ningguang', mute: true, textModel: false, preload: false, proactive: false, subtitles: true }))
    await window.novelDesktop.companionVoice.configure({ textModel: false, speechModel: false, preload: false, voice: 'ningguang' })
  })
  await page.reload()
  await page.getByTestId('app-boot').waitFor({ state: 'visible' })
  await page.getByTestId('app-boot').waitFor({ state: 'detached', timeout: 15000 })
  const hero = () => page.getByTestId('library-continue-writing')
  assert.ok((await hero().innerText()).includes(b.title))
  await page.locator('.work-item-open').filter({ hasText: a.title }).first().click()
  await page.locator('.project-title-return').waitFor()
  await page.getByTestId('workspace-loading').waitFor({ state: 'detached', timeout: 30000 })
  await page.locator('.project-title-return').click()
  await page.waitForFunction(title => document.querySelector('[data-testid="library-continue-writing"] h2')?.textContent === title, a.title)
  checks.push('open-older-work-and-return-updates-hero')
  const list = await page.evaluate(() => window.novelDesktop.projects.list())
  assert.deepEqual(list.projects.map(item => item.id), [b.id, a.id])
  assert.equal(list.continueProjectId, a.id)
  const answer = await page.evaluate(async () => {
    const api = window.novelDesktop.companionVoice
    const session = await api.open({ continueWorkId: 'library-current' })
    try { return await api.request({ ...session, requestId: 'continuation-proof', action: 'chat', text: '继续创作是哪部作品？', voice: 'ningguang', mute: true }) }
    finally { await api.close(session.sessionId) }
  })
  assert.ok(answer.text.includes(a.title)); assert.ok(!answer.text.includes(b.title))
  checks.push('shelf-order-unchanged-and-companion-agrees')
  await page.screenshot({ path: join(output, 'returned-library.png') })
  await app.close(); app = undefined
  page = await launch()
  await page.getByTestId('app-boot').waitFor({ state: 'visible' })
  await page.getByTestId('app-boot').waitFor({ state: 'detached', timeout: 15000 })
  await hero().waitFor()
  assert.ok((await hero().innerText()).includes(a.title))
  checks.push('full-app-relaunch-retains-continue-target')
  await page.screenshot({ path: join(output, 'reopened-library.png') })
  assert.equal(await readFile(manuscript, 'utf8'), body)
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ checks, errors, root }))
} catch (error) {
  errors.push(String(error))
  await app?.windows()[0]?.screenshot({ path: join(output, 'failure.png') }).catch(() => {})
  throw error
} finally {
  await writeFile(join(output, 'verification.json'), JSON.stringify({ checks, errors, root }, null, 2))
  // Only this test-owned temporary application; a failed render cannot acknowledge normal quit.
  await app?.evaluate(({ app }) => app.exit(0)).catch(() => {})
}
