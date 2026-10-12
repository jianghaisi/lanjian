import assert from 'node:assert/strict'
import { mkdtemp, realpath, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { _electron } from 'playwright'

const root = await realpath(await mkdtemp(join(tmpdir(), 'lanjian-joint-native-')))
const stageMode = process.argv.includes('--stage')
const batchMode = process.argv.includes('--batch')
const refinementMode = process.argv.includes('--refinement')
const upstreamMode = process.argv.includes('--upstream-review')
const historyMode = process.argv.includes('--review-history')
if (historyMode && !upstreamMode) throw new Error('--review-history requires --upstream-review')
if (upstreamMode && !refinementMode) throw new Error('--upstream-review requires --refinement')
const replacementMode = process.argv.includes('--replacement')
if (replacementMode && !refinementMode) throw new Error('--replacement requires --refinement')
if (refinementMode && (!batchMode || !stageMode)) throw new Error('--refinement requires --stage --batch')
const output = resolve(historyMode ? '../.trellis/tasks/09-22-v3-upstream-review-history/evidence' : upstreamMode ? '../.trellis/tasks/09-21-v3-refinement-upstream-review/evidence' : replacementMode ? '../.trellis/tasks/09-21-v3-chapter-event-replacement/evidence' : `../.trellis/tasks/09-20-v3-${refinementMode ? 'event-refinement-source' : batchMode ? 'multi-event-adoption' : `${stageMode ? 'stage-' : ''}chapter-event-adoption`}/evidence`)
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
const addSecondEvent = async panel => {
  await panel.getByRole('button', { name: '添加事件', exact: true }).click()
  const second = panel.locator('.event-draft').nth(1)
  await second.getByLabel('时间', { exact: true }).fill('第一日入夜')
  await second.getByLabel('人物', { exact: true }).fill('沈砚、证人')
  await second.getByLabel('地点', { exact: true }).fill('旧城茶馆')
  await second.getByLabel('事件', { exact: true }).fill('沈砚向证人询问寄信人的行踪')
  await second.getByLabel('结果', { exact: true }).fill('得知寄信人曾前往石桥')
}
const launch = async () => {
  app = await _electron.launch({ args, env })
  page = await app.firstWindow(); page.setDefaultTimeout(30000)
  page.on('pageerror', e => errors.push(e.message))
  await page.waitForFunction(() => Boolean(window.novelDesktop))
  await page.evaluate(async () => {
    localStorage.setItem('lanjian-loading-v1', JSON.stringify({ theme: 'impact', bootStyle: 'brief', bootPalette: 'system' }))
    localStorage.setItem('lanjian-companion-voice-v1', JSON.stringify({ voice: 'ningguang', mute: true, textModel: false, preload: false }))
    localStorage.setItem('lanjian-theme', 'moye')
    // Current desktop preferences are main-owned; this test never needs model preparation.
    await window.companionSettings?.update({ voice: { mute: true, textModel: false, preload: false } })
  })
}
const openBook = async title => {
  await page.reload()
  await page.waitForFunction(() => { const boot = document.querySelector('[data-testid="app-boot"]'); return !boot || boot.getAttribute('data-boot-phase') === 'ready' })
  const window = await app.browserWindow(page)
  await window.evaluate(win => { win.hide(); win.show(); win.focus() })
  await page.getByTestId('app-boot-enter').click()
  await page.getByTestId('app-boot').waitFor({ state: 'hidden' })
  await page.locator('[data-library-view="all"]').click()
  await page.locator('.work-item-open').filter({ hasText: title }).first().click()
  await page.getByTestId('workspace-loading').waitFor({ state: 'hidden' })
  await page.locator('[data-nav-parent="planning"] svg').first().click()
  await page.locator('[data-nav-leaf="chapter-skeleton"]').click()
  await page.locator('[data-formal-skeleton-volume="1"]').waitFor()
}
try {
  await launch()
  const seed = await page.evaluate(async ({ root, proposal, stageMode }) => {
    const api = window.novelDesktop
    const { project } = await api.projects.create({ parentPath: root, name: '联合采用隔离验收', genre: '悬疑' })
    await api.projects.switch(project.path)
    const migration = await api.events.previewMigration()
    const grant = await api.events.reviewMigration({ previewId: migration.previewId, fingerprint: migration.fingerprint,
      rows: [], acknowledgedGroups: [], acknowledgedPlanningFindings: [], acknowledgedMirrors: [] })
    await api.events.commitMigration(grant.token)
    await api.planning.saveDraft({ ...proposal, workItemId: project.id })
    const selected = (value, keys) => Object.fromEntries(keys.map(key => [key, value[key]]))
    for (const [preview, commit] of [
      ['previewCharacterSeedAdoption', 'adoptCharacterSeeds'], ['previewWorldSeedAdoption', 'adoptWorldSeed'],
      ['previewPowerSystemAdoption', 'adoptPowerSystem'], ['previewCheatSystemAdoption', 'adoptCheatSystem'],
      ['previewTotalAdoption', 'adoptTotal']
    ]) await api.planning[commit](selected(await api.planning[preview](proposal.id), ['proposalId', 'candidateFingerprint', 'currentFingerprint']))
    const confirm = async scope => {
      const s = await api.outlines.planningStatus(), r = scope === 'total' ? s.totalReview : s.volumes.find(v => v.volume === scope).review
      if (r.status === 'attention') await api.outlines.acknowledgeReview(scope)
      await api.outlines.confirmPlanning(scope)
    }
    await confirm('total')
    await api.planning.initializeVolumeStructure(selected(await api.planning.previewVolumeStructure(proposal.id), ['proposalId', 'candidateFingerprint', 'currentFingerprint', 'totalFingerprint']))
    for (const volume of [1, 2]) {
      await api.planning.adoptVolumeOutline(selected(await api.planning.previewVolumeOutlineAdoption(proposal.id, volume), ['proposalId', 'order', 'parentFingerprint', 'candidateFingerprint', 'currentFingerprint']))
      await confirm(volume)
    }
    for (let i = 0; i < 4; i++) await api.chapters.create()
    for (let id = 1; id <= 4; id++) await api.outlines.placeChapter(id, id < 3 ? 1 : 2)
    const formal = await api.planning.adoptFormalSkeleton((await api.planning.previewFormalSkeleton(proposal.id, 1)).token)
    let stageId = null
    if (stageMode) {
      const { stage } = await api.outlines.createStage(1, '旧信核对阶段')
      stageId = stage.stage
      await api.outlines.updateStage(stageId, stage.title, '先核对旧信，再查访证人。')
      for (const id of [1, 2]) {
        await api.chapterOutlines.update(id, '原阶段章纲')
        await api.outlines.placeChapterInStage(id, stageId, 1)
      }
    }
    return { project, formal, stageId, draft: await api.planning.draft() }
  }, { root, proposal, stageMode })
  const candidate = seed.draft
  candidate.chapterDetails = [{ volume: 1, generatedAt: new Date().toISOString(), basedOn: {
    totalOutlineFingerprint: hash(`# ${candidate.totalOutline.title}\n\n> ${candidate.totalOutline.summary}\n\n${candidate.totalOutline.content}\n`),
    volumeOutlineFingerprint: hash(`# 第 1 卷 · ${candidate.volumes[0].title}\n\n> 本卷目标：${candidate.volumes[0].goal}\n\n## 事件链\n\n${candidate.volumes[0].summary}\n\n## 卷末状态\n\n${candidate.volumes[0].ending}\n`),
    skeletonFingerprint: hash(JSON.stringify(candidate.chapterSkeleton.chapters.filter(c => c.volume === 1))),
    formalSkeletonFingerprint: hash(JSON.stringify(seed.formal.entries.map(e => [e.chapter, e.revision])))
  }, chapters: candidate.chapterSkeleton.chapters.filter(c => c.volume === 1).map(c => ({ chapter: c.chapter, volume: 1, volumeChapter: c.volumeChapter, title: c.title,
    entryState: '沈砚收到旧信', beats: ['打开信件并核对笔迹', '向旧城证人询问落款'], exitState: '尚未离开旧城，准备继续核对', allowedFacts: ['信纸泛黄'], forbiddenEvents: ['禁止提前到新城'], foreshadowActions: [] })) }]
  await page.evaluate(p => window.novelDesktop.planning.saveDraft(p), candidate)
  await openBook(seed.project.title)
  const owner = await app.browserWindow(page)
  await owner.evaluate(win => { win.setContentSize(1440, 960); win.webContents.setZoomFactor(1); win.show(); win.focus() })
  await page.locator('.detail-chapter > summary').first().click()
  const panel = page.locator('[data-event-preview-chapter="1"]')
  await panel.getByRole('button', { name: '核对事件与来源', exact: true }).click()
  await panel.getByRole('button', { name: '添加细节事件并联合采纳', exact: true }).click()
  const time = panel.getByLabel('时间', { exact: true })
  assert.equal(await time.inputValue(), '')
  assert.equal(await panel.getByRole('button', { name: '预览联合采纳', exact: true }).isDisabled(), true)
  await time.fill('第一日午后')
  await panel.getByLabel('事件', { exact: true }).fill('沈砚核对旧信的落款')
  if (batchMode) {
    await panel.getByRole('checkbox', { name: '采用事件 1', exact: true }).uncheck()
    assert.equal(await panel.getByRole('button', { name: '预览联合采纳', exact: true }).isDisabled(), true)
    await panel.getByRole('checkbox', { name: '采用事件 1', exact: true }).check()
    await addSecondEvent(panel)
    await panel.getByRole('button', { name: '添加事件', exact: true }).click()
    await panel.locator('.event-draft').nth(2).getByLabel('事件', { exact: true }).fill('不应采用的事件')
    await panel.getByRole('checkbox', { name: '采用事件 3', exact: true }).uncheck()
    await panel.getByRole('button', { name: '添加事件', exact: true }).click()
    await panel.getByRole('button', { name: '移除事件 4', exact: true }).click()
    assert.equal(await panel.locator('.event-draft').count(), 3)
    checks.push('native add/collapse/remove and selection retain only two complete selected events')
  }
  await panel.getByRole('button', { name: '预览联合采纳', exact: true }).focus(); await page.keyboard.press('Enter')
  await panel.locator('.joint-review').waitFor()
  assert.equal(await panel.locator('.event-review-list li').count(), batchMode ? 2 : 1)
  assert.equal(await panel.locator('.joint-review').getByText('不应采用的事件', { exact: true }).count(), 0)
  assert.equal(await panel.getByRole('button', { name: '确认联合采纳', exact: true }).isDisabled(), true)
  checks.push('native Chinese event entry, empty time gate, keyboard preview and explicit confirmation')
  await owner.evaluate(win => { win.setContentSize(1100, 800); win.webContents.setZoomFactor(1.25) })
  await panel.locator('.joint-review').scrollIntoViewIfNeeded()
  await page.evaluate(() => document.fonts.ready)
  await writeFile(join(output, 'joint-preview-dark-125.png'), Buffer.from(await owner.evaluate(async win => (await win.webContents.capturePage()).toPNG().toString('base64')), 'base64'))
  assert.equal(await panel.evaluate(el => el.scrollWidth <= el.clientWidth + 1), true)
  await panel.getByRole('checkbox').check()
  if (stageMode) {
    await page.evaluate(id => window.novelDesktop.outlines.updateStage(id, '新落款核对阶段', '更新阶段约束，旧预览必须失效。'), seed.stageId)
    await panel.getByRole('button', { name: '确认联合采纳', exact: true }).click()
    await panel.getByRole('alert').waitFor()
    assert.equal((await page.evaluate(() => window.novelDesktop.events.projection())).approved.length, 0)
    await panel.getByRole('button', { name: '恢复并核对提交结果', exact: true }).click()
    await panel.getByText('已核实本次没有提交或待恢复记录，填写内容已保留，请重新预览。', { exact: true }).waitFor()
    await panel.getByRole('button', { name: '预览联合采纳', exact: true }).click()
    await panel.locator('.joint-review').waitFor()
    await panel.getByRole('checkbox').check()
    checks.push('stage change after native preview refuses adoption and preserves author draft for review')
  }
  await page.evaluate(async () => {
    const candidate = await window.novelDesktop.planning.draft()
    candidate.blueprint.rationale += '（核对期间的外部候选修改）'
    await window.novelDesktop.planning.saveDraft(candidate)
  })
  await panel.getByRole('button', { name: '确认联合采纳', exact: true }).click()
  await panel.getByRole('alert').waitFor()
  assert.equal((await page.evaluate(() => window.novelDesktop.events.projection())).approved.length, 0)
  await panel.getByRole('button', { name: '恢复并核对提交结果', exact: true }).click()
  await panel.getByText('已核实本次没有提交或待恢复记录，填写内容已保留，请重新预览。', { exact: true }).waitFor()
  if (batchMode) {
    await panel.locator('.event-draft').first().getByRole('button', { name: '展开', exact: true }).click()
    assert.equal(await panel.getByRole('checkbox', { name: '采用事件 3', exact: true }).isChecked(), false)
  }
  assert.equal(await panel.locator('.event-draft').first().getByLabel('时间', { exact: true }).inputValue(), '第一日午后')
  await panel.getByRole('button', { name: '预览联合采纳', exact: true }).click()
  await panel.locator('.joint-review').waitFor()
  await panel.getByRole('checkbox').check()
  checks.push('native stale candidate refuses writes and recovery lookup retains entered event for a fresh preview')
  await panel.getByRole('button', { name: '确认联合采纳', exact: true }).click()
  await page.waitForFunction(() => /事件已联合写入|章节细节事件已写入/.test(document.body.innerText))
  await page.locator('.detail-chapter > summary').first().getByText('已写入正式章纲 · 待复核').waitFor()
  const persisted = await page.evaluate(async () => ({ events: await window.novelDesktop.events.projection(), status: await window.novelDesktop.outlines.planningStatus(1), chapter: await window.novelDesktop.chapterOutlines.get(1), proposal: await window.novelDesktop.planning.draft() }))
  await writeFile(join(output, 'persisted.json'), JSON.stringify(persisted, null, 2))
  assert.equal(persisted.status.chapter.stale, false)
  assert.equal(persisted.events.approved.length, batchMode ? 2 : 1)
  assert.ok(persisted.events.approved.every(e => e.content.event !== '不应采用的事件'))
  assert.equal(persisted.events.approved[0].phase, 'planned')
  assert.equal(persisted.events.approved[0].content.time, '第一日午后')
  assert.equal(persisted.events.approved[0].sources[0].source.kind, 'chapter-outline')
  assert.match(persisted.chapter.content, /打开信件并核对笔迹/)
  if (stageMode) assert.equal((await page.evaluate(() => window.novelDesktop.outlines.getPlannedChapter(1))).stage, seed.stageId)
  checks.push('native confirmation commits exact chapter and planned event; current dependency and chapter origin verified')
  await page.locator('.detail-chapter > summary').nth(1).click()
  const recoveryPanel = page.locator('[data-event-preview-chapter="2"]')
  await recoveryPanel.getByRole('button', { name: '核对事件与来源', exact: true }).click()
  await recoveryPanel.getByRole('button', { name: '添加细节事件并联合采纳', exact: true }).click()
  await recoveryPanel.getByLabel('时间', { exact: true }).fill('第一日傍晚')
  if (batchMode) await addSecondEvent(recoveryPanel)
  await recoveryPanel.getByRole('button', { name: '预览联合采纳', exact: true }).click()
  await recoveryPanel.locator('.joint-review').waitFor()
  await recoveryPanel.getByRole('checkbox').check()
  const inject = new DatabaseSync(join(seed.project.path, '.webnovel/workspace.sqlite'))
  inject.exec("CREATE TRIGGER joint_native_failure BEFORE INSERT ON manuscript_file_commits BEGIN SELECT RAISE(ABORT,'native interruption'); END"); inject.close()
  await recoveryPanel.getByRole('button', { name: '确认联合采纳', exact: true }).click()
  await recoveryPanel.getByRole('alert').waitFor()
  assert.equal((await page.evaluate(() => window.novelDesktop.events.projection())).approved.length, batchMode ? 2 : 1)
  const clear = new DatabaseSync(join(seed.project.path, '.webnovel/workspace.sqlite'))
  clear.exec('DROP TRIGGER joint_native_failure'); clear.close()
  await recoveryPanel.getByRole('button', { name: '恢复并核对提交结果', exact: true }).click()
  await page.waitForFunction(() => /已核实章纲与 .*事件提交|第 2 章与细节计划事件已联合写入/.test(document.body.innerText))
  assert.equal((await page.evaluate(() => window.novelDesktop.events.projection())).approved.length, batchMode ? 4 : 2)
  assert.equal((await page.evaluate(() => window.novelDesktop.outlines.planningStatus(2))).chapter.stale, false)
  if (stageMode) assert.equal((await page.evaluate(() => window.novelDesktop.outlines.getPlannedChapter(2))).stage, seed.stageId)
  checks.push('native interrupted commit shows recovery action; explicit recovery completes the same event without duplication')
  await app.close(); app = null
  await launch()
  await page.evaluate(path => window.novelDesktop.projects.switch(path), seed.project.path)
  const reopened = await page.evaluate(async () => ({ events: await window.novelDesktop.events.projection(), status: await window.novelDesktop.outlines.planningStatus(1) }))
  assert.equal(reopened.events.approved.length, batchMode ? 4 : 2)
  assert.equal(reopened.status.chapter.stale, false)
  checks.push('normal close and restart retain both events and current chapter')
  if (refinementMode) {
    await openBook(seed.project.title)
    await page.locator('.detail-chapter > summary').first().click()
    const refinementPanel = page.locator('[data-event-preview-chapter="1"]')
    await refinementPanel.getByRole('button', { name: '核对事件与来源', exact: true }).click()
    await refinementPanel.getByRole('button', { name: '添加细节事件并联合采纳', exact: true }).click()
    const compared = await page.evaluate(id => window.novelDesktop.planning.previewChapterEvents(id, 1), proposal.id)
    const source = compared.formalEvents.filter(e => e.phase === 'planned' && e.version)[0]
    await refinementPanel.getByLabel('细化来源', { exact: true }).selectOption({ index: 1 })
    await refinementPanel.getByLabel('时间', { exact: true }).fill('第一日午后，核对落款时')
    await refinementPanel.getByLabel('事件', { exact: true }).fill('逐笔辨认落款中的改写痕迹')
    await refinementPanel.getByLabel('结果', { exact: true }).fill('确认最后一笔被人改过')
    await refinementPanel.getByRole('button', { name: '预览联合采纳', exact: true }).click()
    await refinementPanel.locator('.joint-review').waitFor()
    await refinementPanel.locator('.refinement-preview').filter({ hasText: source.event }).waitFor()
    assert.ok((await refinementPanel.locator('.refinement-preview').innerText()).includes(source.version))
    await refinementPanel.locator('.joint-review').scrollIntoViewIfNeeded()
    const window = await app.browserWindow(page)
    await writeFile(join(output, 'refinement-preview.png'), Buffer.from(await window.evaluate(async win => (await win.webContents.capturePage()).toPNG().toString('base64')), 'base64'))
    await refinementPanel.getByRole('checkbox').check()
    await refinementPanel.getByRole('button', { name: '确认联合采纳', exact: true }).click()
    await page.waitForFunction(() => /章节细节事件已写入/.test(document.body.innerText))
    const refined = await page.evaluate(() => window.novelDesktop.events.projection())
    const child = refined.approved.find(e => e.content.event === '逐笔辨认落款中的改写痕迹')
    assert.ok(child)
    assert.equal(refined.approved.length, 5)
    assert.deepEqual(child.sources[1], { relation: 'refines', source: { kind: 'event', id: source.id, revision: source.version } })
    assert.equal(refined.approved.find(e => e.eventId === source.id).versionId, source.version)
    assert.equal((await page.evaluate(() => window.novelDesktop.outlines.planningStatus(1))).chapter.stale, false)
    await app.close(); app = null
    await launch()
    await page.evaluate(path => window.novelDesktop.projects.switch(path), seed.project.path)
    const retained = await page.evaluate(() => window.novelDesktop.events.projection())
    assert.deepEqual(retained.approved.find(e => e.eventId === child.eventId).sources, child.sources)
    assert.equal(retained.approved.find(e => e.eventId === source.id).versionId, source.version)
    await writeFile(join(output, 'refinement-persisted.json'), JSON.stringify(retained, null, 2))
    checks.push('native source selector and exact refinement preview preserve original event and provenance across restart')
    if (replacementMode) {
      await openBook(seed.project.title)
      await page.locator('.detail-chapter > summary').first().click()
      const panel = page.locator('[data-event-preview-chapter="1"]')
      await panel.getByRole('button', { name: '核对事件与来源', exact: true }).click()
      await panel.getByRole('button', { name: '添加细节事件并联合采纳', exact: true }).click()
      await panel.getByLabel('事件操作', { exact: true }).selectOption('replace')
      await panel.getByLabel('时间', { exact: true }).fill('第一日午后，重新核验时')
      await panel.getByLabel('事件', { exact: true }).fill('比对两封旧信，重新判定落款的修改时间')
      await panel.getByLabel('结果', { exact: true }).fill('确认落款在寄出前已经改写')
      assert.equal(await panel.getByRole('button', { name: '预览联合采纳', exact: true }).isEnabled(), false)
      await panel.getByLabel('替代对象', { exact: true }).selectOption({ label: `${child.content.time} · ${child.content.event}` })
      await panel.getByRole('button', { name: '预览联合采纳', exact: true }).click()
      await panel.locator('.replacement-preview').waitFor()
      assert.ok((await panel.locator('.replacement-preview').innerText()).includes(child.versionId))
      assert.ok((await panel.locator('.replacement-preview').innerText()).includes(child.content.event))
      await panel.getByRole('button', { name: '返回修改事件', exact: true }).click()
      assert.equal(await panel.getByLabel('事件', { exact: true }).inputValue(), '比对两封旧信，重新判定落款的修改时间')
      await panel.getByRole('button', { name: '预览联合采纳', exact: true }).click()
      await panel.locator('.replacement-preview').waitFor()
      const owner = await app.browserWindow(page)
      await panel.locator('.replacement-preview').scrollIntoViewIfNeeded()
      await writeFile(join(output, 'replacement-comparison.png'), Buffer.from(await owner.evaluate(async win => (await win.webContents.capturePage()).toPNG().toString('base64')), 'base64'))
      await panel.locator('.joint-review').scrollIntoViewIfNeeded()
      await writeFile(join(output, 'replacement-preview.png'), Buffer.from(await owner.evaluate(async win => (await win.webContents.capturePage()).toPNG().toString('base64')), 'base64'))
      await panel.getByRole('checkbox').check()
      await panel.getByRole('button', { name: '确认联合采纳', exact: true }).click()
      await page.waitForFunction(() => /章节细节事件已写入/.test(document.body.innerText))
      const replaced = await page.evaluate(() => window.novelDesktop.events.projection())
      const newVersion = replaced.approved.find(e => e.eventId === child.eventId)
      assert.equal(replaced.approved.length, retained.approved.length)
      assert.notEqual(newVersion.versionId, child.versionId)
      assert.equal(newVersion.content.result, '确认落款在寄出前已经改写')
      assert.deepEqual(newVersion.sources.slice(1), [
        { relation: 'supersedes', source: { kind: 'event', id: child.eventId, revision: child.versionId } }, child.sources[1]
      ])
      assert.deepEqual(replaced.state, retained.state)
      assert.equal((await page.evaluate(() => window.novelDesktop.outlines.planningStatus(1))).chapter.stale, false)
      await app.close(); app = null
      await launch()
      await page.evaluate(path => window.novelDesktop.projects.switch(path), seed.project.path)
      const restarted = await page.evaluate(() => window.novelDesktop.events.projection())
      assert.deepEqual(restarted.approved.find(e => e.eventId === child.eventId), newVersion)
      assert.deepEqual(restarted.state, retained.state)
      await writeFile(join(output, 'replacement-persisted.json'), JSON.stringify(restarted, null, 2))
      checks.push('native replacement choice, target requirement, before/after review and return-to-edit preserve draft; same identity, order, lifecycle and provenance survive normal restart')
    }
  }
  if (upstreamMode) {
    await openBook(seed.project.title)
    await page.getByTestId('planning-chapter-1').click()
    await page.getByTestId('outline-inspector-toggle').click()
    const review = page.getByTestId('chapter-upstream-review')
    await review.getByRole('button', { name: /展开上行复核/ }).click()
    await review.getByLabel('判断理由').fill('需要核对卷纲中落款修改的时间安排')
    await review.getByRole('button', { name: '需要调整上游', exact: true }).click()
    await review.getByText(/已保存判断：需要核对卷纲/).waitFor()
    assert.equal(await page.locator('.review-confirm').filter({ hasText: '确认本版' }).isEnabled(), false)
    await review.getByLabel('判断理由').fill('已核对，两封旧信的比对属于原有调查过程，未改变上游结果')
    await review.getByRole('button', { name: '确认不冲突', exact: true }).click()
    await review.getByText(/已保存判断：已核对/).waitFor()
    const ready = await page.evaluate(() => window.novelDesktop.outlines.planningStatus(1))
    assert.equal(ready.chapter.review.canConfirm, true)
    assert.equal(ready.chapter.review.upstream.history.length, 2)
    const owner = await app.browserWindow(page)
    await review.scrollIntoViewIfNeeded()
    await writeFile(join(output, 'upstream-review.png'), Buffer.from(await owner.evaluate(async win => (await win.webContents.capturePage()).toPNG().toString('base64')), 'base64'))
    await page.getByRole('button', { name: '确认本版', exact: true }).click()
    await page.getByRole('button', { name: '已确认', exact: true }).waitFor()
    assert.ok((await page.evaluate(() => window.novelDesktop.outlines.planningStatus(1))).chapter.contractVersion)
    const finding = ready.chapter.review.upstream.findings[0]
    // Close the owned editor window through its normal close path. Playwright's
    // app.quit wrapper can wait indefinitely with this editor inspector open.
    const closed = app.waitForEvent('close', { timeout: 30000 })
    await page.close({ runBeforeUnload: true })
    await closed; app = null
    await launch()
    await page.evaluate(path => window.novelDesktop.projects.switch(path), seed.project.path)
    const retainedReview = await page.evaluate(() => window.novelDesktop.outlines.planningStatus(1))
    assert.equal(retainedReview.chapter.review.upstream.findings[0].status, 'no-conflict')
    assert.ok(retainedReview.chapter.contractVersion)
    if (historyMode) {
      const before = retainedReview.chapter.review.upstream.history
      assert.ok(before.every(record => record.evidence))
      await page.evaluate(async ({ proposalId, finding }) => {
        const api = window.novelDesktop
        const current = (await api.events.projection()).approved.find(event => event.eventId === finding.eventId)
        const preview = await api.planning.previewChapterEventAdoption(proposalId, 1, {
          time: current.content.time, characters: current.content.characters, location: current.content.location,
          event: '重新检查印章上的细小缺口', result: '发现印章并非寄信人所有',
          replaces: { eventId: finding.eventId, eventVersionId: finding.eventVersion }
        })
        await api.planning.adoptChapterEvent(preview.token)
      }, { proposalId: proposal.id, finding })
      const changed = (await page.evaluate(() => window.novelDesktop.outlines.planningStatus(1))).chapter.review.upstream
      assert.equal(changed.findings[0].status, 'pending')
      assert.deepEqual(changed.history, before)
      assert.equal(changed.findings[0].fields.find(f => f.field === 'event').detail, '重新检查印章上的细小缺口')
      await openBook(seed.project.title)
      await page.getByTestId('planning-chapter-1').click()
      await page.getByTestId('outline-inspector-toggle').click()
      const panel = page.getByTestId('chapter-upstream-review')
      await panel.getByRole('button', { name: /展开上行复核/ }).click()
      const history = panel.getByTestId('upstream-review-history')
      await history.locator(':scope > summary').click()
      const comparison = history.locator('.historical-comparison').first()
      await comparison.locator('summary').click()
      const oldAction = before[0].evidence.fields.find(f => f.field === 'event').detail
      assert.ok((await comparison.innerText()).includes(oldAction))
      assert.ok(!(await comparison.innerText()).includes('重新检查印章上的细小缺口'))
      assert.ok((await comparison.innerText()).includes(before[0].evidence.eventVersion))
      await comparison.scrollIntoViewIfNeeded()
      const owner = await app.browserWindow(page)
      await writeFile(join(output, 'historical-comparison.png'), Buffer.from(await owner.evaluate(async win => (await win.webContents.capturePage()).toPNG().toString('base64')), 'base64'))
      const closed = app.waitForEvent('close', { timeout: 30000 })
      await page.close({ runBeforeUnload: true }); await closed; app = null
      await launch()
      await page.evaluate(path => window.novelDesktop.projects.switch(path), seed.project.path)
      assert.deepEqual((await page.evaluate(() => window.novelDesktop.outlines.planningStatus(1))).chapter.review.upstream.history, before)
      checks.push('historical event comparison keeps exact old fields and versions after event replacement, native history expansion and another normal restart')
    }
    const stale = await page.evaluate(async ({ workItemId, fingerprint }) => {
      const api = window.novelDesktop, old = await api.chapterOutlines.get(1)
      await api.chapterOutlines.update(1, old.content + '\n补充调查动机。')
      try { await api.outlines.decideUpstreamReview({ workItemId, chapterId: 1, fingerprint, decision: 'no-conflict', reason: '不应接受旧依据' }); return false }
      catch { return true }
    }, { workItemId: seed.project.id, fingerprint: finding.fingerprint })
    assert.equal(stale, true)
    const expired = await page.evaluate(() => window.novelDesktop.outlines.planningStatus(1))
    assert.equal(expired.chapter.review.upstream.findings[0].status, 'pending')
    assert.equal(expired.chapter.review.upstream.history.length, 2)
    assert.equal(expired.chapter.contractVersion, undefined)
    await writeFile(join(output, 'upstream-persisted.json'), JSON.stringify({ retainedReview, expired }, null, 2))
    checks.push('native upstream comparison, flagged/no-conflict decisions, confirmation gate, normal restart and later chapter invalidation preserve two historical judgements')
  }
  if (stageMode) {
    assert.equal((await page.evaluate(() => window.novelDesktop.outlines.getPlannedChapter(1))).stage, seed.stageId)
    await page.evaluate(id => window.novelDesktop.outlines.updateStage(id, '再次复核阶段', '重启后阶段的约束变化。'), seed.stageId)
    const states = await page.evaluate(async () => [await window.novelDesktop.outlines.planningStatus(1), await window.novelDesktop.outlines.planningStatus(2)])
    assert.ok(states.every(s => s.chapter.stale))
    checks.push('restart preserves stage parent; later stage edit marks its two adopted chapters stale')
  }
  assert.deepEqual(errors, [])
  await writeFile(join(output, 'result.json'), JSON.stringify({ root, checks, errors }, null, 2))
  console.log(JSON.stringify({ checks, errors }))
} catch (error) {
  await writeFile(join(output, 'failure.json'), JSON.stringify({ message: error.message, stack: error.stack, checks, errors, root }, null, 2))
  if (page && app) {
    const owner = await app.browserWindow(page)
    await writeFile(join(output, 'failure.png'), Buffer.from(await owner.evaluate(async win => (await win.webContents.capturePage()).toPNG().toString('base64')), 'base64'))
  }
  if (app) { await app.evaluate(({ app }) => app.exit(1)).catch(() => {}); app = null }
  throw error
} finally { if (app) await app.close() }
