import assert from 'node:assert/strict'
import { mkdtemp, realpath, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { _electron } from 'playwright'

const root = await realpath(await mkdtemp(join(tmpdir(), 'lanjian-skeleton-')))
const output = resolve('../.trellis/tasks/09-20-v3-formal-skeleton-dependencies/evidence')
await mkdir(output, { recursive: true })
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('LANJIAN_') && !['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL'].includes(key)))
Object.assign(env, { LANJIAN_USER_DATA_PATH: join(root, 'profile'), LANJIAN_GLOBAL_MODEL_DATA_PATH: join(root, 'models') })
const args = [resolve(process.argv[2] ?? 'out-skeleton-check/main/index.js')]
const hash = text => createHash('sha256').update(text).digest('hex')
const proposal = {
  id: 'skeleton-smoke', workItemId: '', createdAt: new Date().toISOString(),
  basedOn: { inputFingerprint: hash('input'), blueprintFingerprint: hash('blueprint'), totalOutlineFingerprint: hash('total') },
  blueprint: { premise: '旧信追查', worldView: '两座相邻城市', characters: [{ name: '沈砚', role: '调查者', arcSeed: '追查来信' }], powerSystem: '', cheatSystem: '', rationale: '因果调查' },
  totalOutline: { title: '旧信', summary: '追查落款', content: '沈砚因为收到来信而调查，发现矛盾，于是前往另一座城核对。' },
  volumes: [{ order: 1, title: '旧城', goal: '找到旧信', summary: '沈砚收到来信，因此寻找证人，导致旧事浮现。', ending: '发现落款' }, { order: 2, title: '新城', goal: '核对落款', summary: '因为旧城证人失踪，沈砚前往新城，因此查清真相。', ending: '完成调查' }]
}
proposal.chapterSkeleton = { generatedAt: new Date().toISOString(), targetWordsPerChapter: 2000,
  basedOn: { totalOutlineFingerprint: hash(`# 旧信\n\n> 追查落款\n\n${proposal.totalOutline.content}\n`), volumePlanFingerprint: hash(JSON.stringify(proposal.volumes)) },
  chapters: [1, 2, 3, 4].map((chapter, i) => ({ chapter, volume: i < 2 ? 1 : 2, volumeChapter: i % 2 + 1, title: `线索${chapter}`, coreEvent: '沈砚核对信件', characters: ['沈砚'], location: i < 2 ? '旧城' : '新城', result: '找到下一条线索' })) }
let app, page
const errors = [], checks = []
const launch = async () => {
  app = await _electron.launch({ args, env })
  page = await app.firstWindow(); page.setDefaultTimeout(30000)
  page.on('pageerror', e => errors.push(e.message))
  await page.waitForFunction(() => Boolean(window.novelDesktop))
  await page.evaluate(() => { localStorage.setItem('lanjian-opening-enabled', 'false'); localStorage.setItem('lanjian-companion-voice-v1', JSON.stringify({ voice: 'ningguang', mute: true, textModel: false, preload: false })); localStorage.setItem('lanjian-theme', 'moye') })
}
const openBook = async title => {
  await page.reload(); await page.getByTestId('app-boot').waitFor({ state: 'hidden' })
  await page.locator('[data-library-view="all"]').click()
  await page.locator('.work-item-open').filter({ hasText: title }).first().click()
  await page.getByTestId('workspace-loading').waitFor({ state: 'hidden' })
  await page.locator('[data-nav-parent="planning"] svg').first().click()
  await page.locator('[data-nav-leaf="chapter-skeleton"]').click()
  await page.locator('[data-formal-skeleton-volume="1"]').waitFor()
}
try {
  await launch()
  const seed = await page.evaluate(async ({ root, proposal }) => {
    const api = window.novelDesktop
    const { project } = await api.projects.create({ parentPath: root, name: '骨架双卷隔离验收', genre: '悬疑' })
    await api.projects.switch(project.path)
    for (let i = 0; i < 4; i++) await api.chapters.create()
    await api.outlines.update('total', '沈砚因为收到来信而调查，发现矛盾，于是核对真相。')
    for (const v of proposal.volumes) { await api.outlines.createVolume(v.title); await api.outlines.update(v.order, v.summary) }
    for (let id = 1; id <= 4; id++) await api.outlines.placeChapter(id, id < 3 ? 1 : 2)
    for (const scope of ['total', 1, 2]) {
      const s = await api.outlines.planningStatus()
      const review = scope === 'total' ? s.totalReview : s.volumes.find(v => v.volume === scope).review
      if (review.status === 'attention') await api.outlines.acknowledgeReview(scope)
      await api.outlines.confirmPlanning(scope)
    }
    await api.planning.saveDraft({ ...proposal, workItemId: project.id })
    return project
  }, { root, proposal })
  await openBook(seed.title)
  const owner = await app.browserWindow(page)
  await owner.evaluate(win => { if (win.isMaximized()) win.unmaximize(); win.setContentSize(1440, 900); win.webContents.setZoomFactor(1); win.show(); win.focus() })
  const first = page.locator('[data-formal-skeleton-volume="1"]')
  await first.getByRole('button', { name: '核对并采用本卷安排' }).click()
  await first.getByRole('button', { name: '确认采用本卷骨架' }).waitFor()
  assert.match(await first.innerText(), /尚未采用/)
  await first.getByRole('button', { name: '取消', exact: true }).click()
  await first.getByRole('button', { name: '核对并采用本卷安排' }).click()
  await first.getByRole('button', { name: '确认采用本卷骨架' }).focus(); await page.keyboard.press('Enter')
  await first.getByRole('status').waitFor(); assert.match(await first.innerText(), /正式版本有效/)
  checks.push('native preview, cancel, keyboard adoption and persisted current status')
  const before = await page.evaluate(async () => {
    const api = window.novelDesktop
    const p = await api.planning.previewFormalSkeleton('skeleton-smoke', 2); await api.planning.adoptFormalSkeleton(p.token)
    for (let id = 1; id <= 4; id++) await api.chapterOutlines.update(id, '进入状态：沈砚来到旧城\n1. 找到旧信\n2. 核对落款\n退出状态：确认落款，尚未出发\n允许扩写：动作与对白\n禁止：提前揭示真凶')
    await api.outlines.confirmChapter(4)
    return (await api.outlines.planningStatus(4)).chapter.contractVersion
  })
  const firstVolume = page.locator('.skeleton-volume').first()
  await firstVolume.locator('.skeleton-result textarea').first().count().then(async count => {
    const field = count ? firstVolume.locator('.skeleton-result textarea').first() : firstVolume.locator('li').filter({ has: page.locator('.skeleton-number') }).first().locator('textarea').last()
    await field.fill('发现落款来自十年前，决定核对日期。')
  })
  await first.getByRole('button', { name: '核对并采用本卷安排' }).click()
  await first.getByRole('button', { name: '确认采用本卷骨架' }).waitFor()
  assert.match(await first.innerText(), /候选有修改/)
  await first.getByRole('button', { name: '确认采用本卷骨架' }).click()
  await first.getByRole('status').waitFor()
  const status = await page.evaluate(async () => Promise.all([1, 2, 3, 4].map(id => window.novelDesktop.outlines.planningStatus(id))))
  assert.deepEqual(status.map(s => s.chapter.stale), [true, false, false, false])
  assert.equal(status[3].chapter.contractVersion.fingerprint, before.fingerprint)
  checks.push('edited one entry invalidates only that chapter; other volume contract unchanged')
  await first.scrollIntoViewIfNeeded(); await page.evaluate(() => document.fonts.ready)
  const png = await owner.evaluate(async win => (await win.webContents.capturePage()).toPNG().toString('base64'))
  await writeFile(join(output, 'skeleton-adoption.png'), Buffer.from(png, 'base64'))
  await owner.evaluate(win => { win.setContentSize(1100, 800); win.webContents.setZoomFactor(1.25) })
  await first.scrollIntoViewIfNeeded()
  const geometry = await first.evaluate(el => ({ width: el.getBoundingClientRect().width, viewport: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth + 1 }))
  assert.equal(geometry.overflow, false)
  checks.push({ name: 'compact 125% viewport', geometry })
  await app.close(); app = null
  await launch(); await openBook(seed.title)
  const reopened = await page.evaluate(() => window.novelDesktop.planning.previewFormalSkeleton('skeleton-smoke', 1))
  assert.ok(reopened.entries.every(e => e.status === 'current'))
  assert.equal((await page.evaluate(() => window.novelDesktop.outlines.planningStatus(1))).chapter.stale, true)
  checks.push('normal close/relaunch preserves formal skeleton and stale chapter')
  assert.deepEqual(errors, [])
  await writeFile(join(output, 'result.json'), JSON.stringify({ checks, errors, root }, null, 2))
  console.log(JSON.stringify({ checks, errors }))
} catch (error) {
  await writeFile(join(output, 'failure.json'), JSON.stringify({ message: error.message, checks, errors, root }, null, 2))
  if (page && app) { const owner = await app.browserWindow(page); const png = await owner.evaluate(async win => (await win.webContents.capturePage()).toPNG().toString('base64')); await writeFile(join(output, 'failure.png'), Buffer.from(png, 'base64')) }
  throw error
} finally { if (app) await app.close() }
