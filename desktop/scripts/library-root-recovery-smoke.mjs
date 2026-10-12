import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { _electron } from 'playwright'

const require = createRequire(import.meta.url)
require('tsx/cjs')
const { SettingsStore } = require('../src/main/platform/settings/settings-store.ts')
const root = await realpath(await mkdtemp(join(tmpdir(), 'lanjian-library-recovery-')))
const libraryRoot = join(root, '作品')
const profile = join(root, 'profile')
const names = ['甲书', '乙书', '丙书', '丁书', '三千盏星灯，他们都叫我主公']
await Promise.all([mkdir(libraryRoot), mkdir(profile)])
for (const name of names) {
  const project = join(libraryRoot, name)
  await Promise.all([mkdir(join(project, '.webnovel'), { recursive: true }), mkdir(join(project, '正文'), { recursive: true })])
}
const first = join(libraryRoot, names[0])
const settings = new SettingsStore(profile, { available: () => false, encrypt: () => '', decrypt: () => '' })
await settings.save({ ...await settings.load(), recentProjects: [first], currentProject: first, libraryRoot: null, excludedProjects: [] })
const env = { ...process.env, LANJIAN_USER_DATA_PATH: profile, LANJIAN_GLOBAL_MODEL_DATA_PATH: join(root, 'models') }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_RENDERER_URL
delete env.LANJIAN_SMOKE

try {
  for (let launch = 1; launch <= 2; launch += 1) {
    const app = await _electron.launch({ executablePath: require('electron'), args: ['.'], env })
    try {
      const page = await app.firstWindow()
      page.setDefaultTimeout(30_000)
      await page.waitForFunction(() => Boolean(window.novelDesktop))
      const listed = await page.evaluate(() => window.novelDesktop.projects.list())
      assert.equal(listed.projects.length, names.length, `launch ${launch}: main IPC must find every sibling`)
      assert.deepEqual(new Set(listed.projects.map(project => project.title)), new Set(names))
      assert.equal(listed.continueProjectId, first)
      await page.evaluate(() => {
        localStorage.setItem('lanjian-opening-enabled', 'false')
        localStorage.setItem('lanjian-companion-voice-v1', JSON.stringify({ voice: 'ningguang', mute: true, textModel: false, preload: false }))
      })
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.reload()
      const handoff = await Promise.race([
        page.getByTestId('app-boot-enter').waitFor({ state: 'visible', timeout: 60_000 }).then(() => 'click'),
        page.getByTestId('app-boot').waitFor({ state: 'detached', timeout: 60_000 }).then(() => 'automatic')
      ])
      if (handoff === 'click') await page.getByTestId('app-boot-enter').click()
      await page.getByTestId('app-boot').waitFor({ state: 'detached', timeout: 30_000 })
      await page.waitForFunction(() => document.querySelectorAll('.work-item-open').length === 5)
      assert.equal(await page.locator('.work-item-open').count(), names.length)
      console.log(`library recovery launch ${launch}: ${listed.projects.length} works`)
    } finally {
      await app.evaluate(({ app }) => app.exit(0)).catch(() => undefined)
      await app.close().catch(() => undefined)
    }
  }
} finally {
  if (dirname(root) !== await realpath(tmpdir()) || !basename(root).startsWith('lanjian-library-recovery-')) throw new Error('Refusing to remove an unexpected test root')
  await rm(root, { recursive: true, force: true })
}
