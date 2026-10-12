import assert from 'node:assert/strict'
import { mkdtemp, realpath, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { _electron } from 'playwright'

const root = await realpath(await mkdtemp(join(tmpdir(), 'lanjian-event-preview-')))
const output = resolve('../.trellis/tasks/09-20-v3-chapter-event-preview/evidence')
await mkdir(output, { recursive: true })
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('LANJIAN_') && !['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL'].includes(key)))
Object.assign(env, { LANJIAN_USER_DATA_PATH: join(root, 'profile'), LANJIAN_GLOBAL_MODEL_DATA_PATH: join(root, 'models') })
const args = [resolve(process.argv[2] ?? 'out/main/index.js')]
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
  const formal = await page.evaluate(async () => {
    const p = await window.novelDesktop.planning.previewFormalSkeleton('skeleton-smoke', 1)
    return window.novelDesktop.planning.adoptFormalSkeleton(p.token)
  })
  const candidate = { ...proposal, workItemId: seed.id, chapterDetails: [{ volume: 1, generatedAt: new Date().toISOString(),
    basedOn: { totalOutlineFingerprint: hash(`# ${proposal.totalOutline.title}\n\n> ${proposal.totalOutline.summary}\n\n${proposal.totalOutline.content}\n`),
      volumeOutlineFingerprint: hash(`# 第 1 卷 · ${proposal.volumes[0].title}\n\n> 本卷目标：${proposal.volumes[0].goal}\n\n## 事件链\n\n${proposal.volumes[0].summary}\n\n## 卷末状态\n\n${proposal.volumes[0].ending}\n`),
      skeletonFingerprint: hash(JSON.stringify(proposal.chapterSkeleton.chapters.filter(c => c.volume === 1))),
      formalSkeletonFingerprint: hash(JSON.stringify(formal.entries.map(e => [e.chapter, e.revision]))) },
    chapters: proposal.chapterSkeleton.chapters.filter(c => c.volume === 1).map(c => ({ chapter: c.chapter, volume: 1, volumeChapter: c.volumeChapter, title: c.title,
      entryState: '沈砚收到旧信', beats: ['打开信件并核对笔迹', '向旧城证人询问落款'], exitState: '尚未离开旧城，准备继续核对', allowedFacts: ['信纸泛黄'], forbiddenEvents: ['禁止提前到新城'], foreshadowActions: [] })) }] }
  await page.evaluate(p => window.novelDesktop.planning.saveDraft(p), candidate)
  await openBook(seed.title)
  const owner = await app.browserWindow(page)
  await owner.evaluate(win => { win.setContentSize(1440, 960); win.webContents.setZoomFactor(1); win.show(); win.focus() })
  await page.locator('.detail-chapter > summary').first().click()
  const panel = page.locator('[data-event-preview-chapter="1"]')
  await panel.getByRole('button', { name: '核对事件与来源', exact: true }).click()
  await panel.getByRole('status').waitFor()
  assert.match(await panel.innerText(), /来源版本有效/)
  assert.match(await panel.innerText(), /未指定/)
  assert.match(await panel.innerText(), /尚未关联正式事件/)
  assert.match(await panel.innerText(), /打开信件并核对笔迹/)
  checks.push('native preview shows exact candidate, unspecified time, no invented formal event')
  await panel.getByRole('button', { name: '收起', exact: true }).click()
  assert.equal(await panel.locator('.event-comparison').count(), 0)
  await panel.getByRole('button', { name: '核对事件与来源', exact: true }).focus(); await page.keyboard.press('Enter')
  await panel.getByRole('status').waitFor()
  checks.push('collapse and keyboard reopen')
  await panel.scrollIntoViewIfNeeded(); await page.evaluate(() => document.fonts.ready)
  await writeFile(join(output, 'chapter-events.png'), Buffer.from(await owner.evaluate(async win => (await win.webContents.capturePage()).toPNG().toString('base64')), 'base64'))
  await owner.evaluate(win => { win.setContentSize(1100, 800); win.webContents.setZoomFactor(1.25) })
  await panel.scrollIntoViewIfNeeded()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false)
  checks.push('125% narrow viewport without horizontal overflow')
  const firstChapter = page.locator('.detail-chapter').first()
  await firstChapter.locator('textarea').first().fill('作者中文修改后的进入状态')
  await panel.getByRole('status').waitFor({ state: 'hidden' })
  await panel.getByRole('button', { name: '核对事件与来源', exact: true }).click()
  await panel.getByRole('status').waitFor()
  assert.match(await panel.innerText(), /作者中文修改后的进入状态/)
  checks.push('editing invalidates old preview; refresh reads saved Chinese edit')
  await page.evaluate(() => window.novelDesktop.outlines.update(1, '作者修改了第一卷的上游内容。'))
  await panel.getByRole('button', { name: '重新核对事件与来源', exact: true }).click()
  await panel.getByRole('status').waitFor()
  assert.match(await panel.innerText(), /来源已变化/)
  checks.push('changed upstream is visible as stale')
  assert.deepEqual(errors, [])
  await writeFile(join(output, 'result.json'), JSON.stringify({ checks, errors, root }, null, 2))
  console.log(JSON.stringify({ checks, errors }))
} catch (error) {
  await writeFile(join(output, 'failure.json'), JSON.stringify({ message: error.message, checks, errors, root }, null, 2))
  if (page && app) {
    const owner = await app.browserWindow(page)
    await writeFile(join(output, 'failure.png'), Buffer.from(await owner.evaluate(async win => (await win.webContents.capturePage()).toPNG().toString('base64')), 'base64'))
  }
  throw error
} finally { if (app) await app.close() }
