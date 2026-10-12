// Real Electron/IPC/UI, localhost scripted responses, isolated books and model roots.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron } from 'playwright'
const root = await realpath(await mkdtemp(join(tmpdir(), 'lanjian-story-outline-')))
const output = resolve('../.trellis/tasks/10-11-v3-writing-quality-full-names/research/native')
await mkdir(output, { recursive: true })
const story = '林舟拿着旧信来到档案室，想找到落款人。管理员让林舟核对登记簿，林舟发现信件落款与登记不符，决定去找当年的管理员。'
const constraints = { entryState: '林舟持信进入档案室。', beats: ['林舟向管理员询问落款人。', '管理员递出登记簿，林舟核对发现不同。'], exitState: '林舟决定寻找当年的管理员。', allowedFacts: ['档案室核对动作和当场对话。'], forbiddenEvents: ['提前揭示旧信真相。'], foreshadowActions: [] }
const requests = []
let needsNameCorrection = true
let fieldGeneration = 0
const prose = story + '\n\n' + '林舟把登记簿合上。旧信仍放在桌边。'
const literaryFinding = { category: 'scene-function', severity: 'advice', candidateQuote: '林舟把登记簿合上。', sourceQuote: '', reason: '动作可以更具体。', correction: '在当前场景补一个有作用的可见反应。' }
const server = createServer(async (req, res) => {
  try {
    const chunks = []; for await (const chunk of req) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString()), prompt = body.messages.at(-1).content
    requests.push(prompt)
    console.log("[synthetic request]", body.stream ? "stream" : "structured", prompt.slice(0, 80))
    let value
    if (prompt.startsWith('复核下方')) {
      if (prompt.includes('他拿过旧信')) value = { issues: [{ category: 'character-name', quote: '他拿过旧信', parentQuote: '', reason: '两名参与者的动作归属需要作者核对。', needsAuthor: true }] }
      else if (prompt.includes('管理员让他核对登记簿')) { value = { issues: [{ category: 'character-name', quote: '管理员让他核对登记簿', parentQuote: '', reason: '此处应明确动作属于林舟。', needsAuthor: false }] }; if (!prompt.includes('候选：{"value"')) needsNameCorrection = false }
      else value = { issues: [] }
    }
    else if (prompt.includes('"authorRequest":"字段姓名专项"')) { fieldGeneration++; value = { value: fieldGeneration === 1 ? story.replace('管理员让林舟核对登记簿', '管理员让他核对登记簿') : story } }
    else if (prompt.includes('"authorRequest":"字段歧义专项"')) value = { value: '林舟和管理员停下，他拿过旧信。' }
    else if (prompt.startsWith('你现在是只读的章节契约审校员')) value = { summary: '节点覆盖，保留表达建议。', passed: true, beats: [{ id: 'B1', status: 'covered', evidence: story }, { id: 'B2', status: 'covered', evidence: story }], boundary: { entryRespected: true, exitReached: true, evidence: story }, foreshadowing: [], violations: [], introducedFacts: [], characterChanges: [], characterConflicts: [], literaryFindings: [literaryFinding] }
    else if (prompt.includes('只输出小说正文')) value = prose
    else if (prompt.includes('生成创作蓝图')) value = { premise: '核对旧信', worldView: '旧城中的现实调查。', characters: [{ name: '林舟', role: '调查者', arcSeed: '核对信件后寻找见证人。' }], powerSystem: '', cheatSystem: '', rationale: '事件结果引出下一步。' }
    else if (prompt.includes('覆盖全书的总纲')) value = { title: '旧信', summary: '林舟核对旧信，发现差异后寻找管理员。', content: `${needsNameCorrection ? story.replace('管理员让林舟核对登记簿', '管理员让他核对登记簿') : story}当年的管理员拿出原始登记，解释了誊抄的错误。林舟寄出回信，停止怀疑朋友，林舟和朋友重新开始往来。` }
    else if (prompt.includes('把总纲拆成')) value = { volumes: [{ order: 1, title: '落款', storyContent: `${story}管理员帮林舟联系前任，前任以原始登记解释誊抄错误。林舟于是回信道歉，朋友接到信后重新约林舟见面。`, goal: '核对落款。', summary: '核对登记，联系前任，回信。', ending: '误会解除，恢复来往。' }] }
    else if (prompt.includes('轻量章节骨架')) value = { chapters: [{ volumeChapter: 1, title: '核对', coreEvent: '林舟询问落款，管理员让林舟核对登记。', characters: ['林舟', '管理员'], location: '档案室', result: '林舟发现差异，决定找前任管理员。' }] }
    else if (prompt.includes('本批章节编号')) value = { chapters: [{ chapter: 1, storyContent: story, ...constraints }] }
    else if (prompt.includes('忠实提取执行约束')) value = constraints
    else if (prompt.includes('只输出JSON：{"content"')) value = { content: `# 第1章 核对\n所属卷：第1卷\n\n${story}` }
    else throw new Error('Unexpected scripted request')
    if (body.stream) { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: typeof value === 'string' ? value : JSON.stringify(value) } }] }) + '\n\n'); res.write('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\n'); res.end('data: [DONE]\n\n'); return }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: typeof value === 'string' ? value : JSON.stringify(value) }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 } }))
  } catch (error) { console.error('[synthetic server]', String(error)); res.writeHead(500); res.end('{"error":{"message":"synthetic fixture mismatch"}}') }
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('LANJIAN_') && !['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL'].includes(key)))
Object.assign(env, { LANJIAN_USER_DATA_PATH: join(root, 'profile'), LANJIAN_GLOBAL_MODEL_DATA_PATH: join(root, 'models') })
await mkdir(join(root, 'profile'), { recursive: true })
const args = [resolve('node_modules/.cache/writing-quality-full-names/out/main/index.js')]
let app, page
const errors = [], checks = []
async function launch() {
  app = await _electron.launch({ args, env, timeout: 60000 })
  app.process().stderr.on('data', chunk => console.log('[isolated electron]', String(chunk)))
  page = await app.firstWindow({ timeout: 60000 }); page.setDefaultTimeout(30000)
  page.on('pageerror', e => errors.push(e.message))
  await page.waitForFunction(() => Boolean(window.novelDesktop))
  await page.evaluate(async () => { localStorage.setItem('lanjian-opening-enabled', 'false'); localStorage.setItem('lanjian-loading-v1', JSON.stringify({ theme: 'standard', bootStyle: 'brief', bootPalette: 'system' })); localStorage.setItem('lanjian-companion-voice-v1', JSON.stringify({ voice: 'ningguang', mute: true, textModel: false, preload: false })); await window.companionSettings?.update({ voice: { mute: true, textModel: false, preload: false } }) })
}
async function closeNormally() {
  const closed = app.waitForEvent('close', { timeout: 45000 })
  const owner = await app.browserWindow(page)
  await owner.evaluate(window => window.close())
  await closed
  app = null
}
async function openBook() {
  await page.reload(); await page.getByTestId('app-boot-enter').click(); await page.getByTestId('app-boot').waitFor({ state: 'hidden' })
  await page.locator('[data-library-view="all"]').click()
  await page.locator('.work-item-open').filter({ hasText: '故事大纲隔离验证' }).first().click()
  await page.getByTestId('workspace-loading').waitFor({ state: 'hidden' })
  await page.locator('[data-nav-parent="planning"] svg').first().click()
  await page.getByTestId('planning-chapter-1').click()
  await page.getByTestId('outline-inspector-toggle').click()
  await page.getByTestId('chapter-story-constraints').waitFor()
}
try {
  await launch()
  const result = await page.evaluate(async ({ root, baseUrl }) => {
    const api = window.novelDesktop
    let step = 'create project'
    try {
    const { project } = await api.projects.create({ parentPath: root, name: '故事大纲隔离验证', genre: '悬疑' })
    step = 'model catalogue'
    const catalogue = await api.modelConnections.list()
    step = 'create synthetic connection'
    const created = await api.modelConnections.create({ expectedRevision: catalogue.revision, name: '合成故事接口', baseUrl, protocol: 'openai-compatible', apiKey: 'synthetic-outline-key' })
    step = 'book model assignments'
    const connection = created.connections.find(c => c.name === '合成故事接口'), edit = await api.modelConnections.book()
    step = 'save synthetic routing'
    await api.modelConnections.saveBook({ token: edit.token, patch: { routingMode: 'shared', globalReferences: [{ id: 'smoke', globalConnectionId: connection.id }], globalRevisions: [{ id: connection.id, revision: connection.revision }], shared: { connectionId: 'smoke', model: 'outline-synthetic', temperature: .6, topP: 1, maxTokens: 8192 } } })
    step = 'book profile'
    const profile = await api.workspace.getBookProfile()
    await api.workspace.saveBookProfile({ ...profile, plannedVolumes: 1, chaptersPerVolume: 18, targetWordsPerChapter: 2000 })
    step = 'foundation'
    await api.workspace.saveFoundation({ creationPath: 'materials', sourceNotes: '林舟核对旧信，发现不同后寻找管理员，误会解除。', worldView: '普通旧城', useRealms: false, useSystem: false })
    step = 'create chapter'
    await api.chapters.create()
    step = 'initialize isolated event authority'
    const migration = await api.events.previewMigration()
    const grant = await api.events.reviewMigration({ previewId: migration.previewId, fingerprint: migration.fingerprint, rows: [], acknowledgedGroups: [], acknowledgedPlanningFindings: [], acknowledgedMirrors: [] })
    await api.events.commitMigration(grant.token)
    step = 'create formal four-element event'
    const eventProjection = await api.events.projection()
    const eventPreview = await api.events.previewOperation({ kind: 'create', expectedOrderId: eventProjection.state.order.id, granularity: 'macro', content: { time: '第一日', characters: ['林舟', '管理员'], location: '档案室', event: '林舟核对旧信与登记簿。', result: '林舟发现落款不同，决定寻找前任管理员。', evidenceRefs: [], confidence: 1 } })
    const eventResult = await api.events.commitOperation(eventPreview.token)
    const wait = async (job, read) => {
      for (let n = 0; n < 180; n++) { if (job.status !== 'running') { if (job.status !== 'completed') throw new Error(job.error?.message ?? job.status); return job.proposal }; await new Promise(r => setTimeout(r, 250)); job = await read(job.id) }
      throw new Error('Synthetic job timeout')
    }
    step = 'generate total and volume'
    const p = await wait(await api.planning.start(), api.planning.job)
    step = 'save draft'
    await api.planning.saveDraft(p)
    step = 'adopt prerequisite settings'
    for (const [preview, adopt] of [['previewCharacterSeedAdoption', 'adoptCharacterSeeds'], ['previewWorldSeedAdoption', 'adoptWorldSeed'], ['previewPowerSystemAdoption', 'adoptPowerSystem'], ['previewCheatSystemAdoption', 'adoptCheatSystem']]) {
      const candidate = await api.planning[preview](p.id)
      await api.planning[adopt]({ proposalId: p.id, candidateFingerprint: candidate.candidateFingerprint, currentFingerprint: candidate.currentFingerprint })
    }
    step = 'adopt total'
    const t = await api.planning.previewTotalAdoption(p.id)
    await api.planning.adoptTotal({ proposalId: p.id, candidateFingerprint: t.candidateFingerprint, currentFingerprint: t.currentFingerprint })
    step = 'initialize volumes'
    const v = await api.planning.previewVolumeStructure(p.id)
    await api.planning.initializeVolumeStructure({ proposalId: p.id, candidateFingerprint: v.candidateFingerprint, currentFingerprint: v.currentFingerprint, totalFingerprint: v.totalFingerprint })
    const confirm = async scope => { const s = await api.outlines.planningStatus(), r = scope === 'total' ? s.totalReview : s.volumes.find(v => v.volume === scope).review; if (r.status === 'attention') await api.outlines.acknowledgeReview(scope); await api.outlines.confirmPlanning(scope) }
    step = 'confirm total'
    await confirm('total')
    step = 'adopt volume'
    const vp = await api.planning.previewVolumeOutlineAdoption(p.id, 1)
    await api.planning.adoptVolumeOutline({ proposalId: p.id, order: 1, parentFingerprint: vp.parentFingerprint, candidateFingerprint: vp.candidateFingerprint, currentFingerprint: vp.currentFingerprint })
    step = 'confirm volume'
    await api.outlines.placeChapter(1, 1); await confirm(1)
    await api.outlines.placeEventInChapter(eventResult.receipt.eventId, 1)
    step = 'generate skeleton'
    const skeleton = await wait(await api.planning.startChapterSkeleton(p.id), api.planning.chapterSkeletonJob)
    step = 'adopt skeleton'
    const sp = await api.planning.previewFormalSkeleton(p.id, 1); await api.planning.adoptFormalSkeleton(sp.token)
    step = 'generate detail'
    const detailed = await wait(await api.planning.startChapterDetail(p.id, 1), api.planning.chapterDetailJob)
    step = 'adopt detail'
    const cp = await api.planning.previewChapterDetailAdoption(p.id, 1)
    await api.planning.adoptChapterDetail({ proposalId: p.id, chapterId: 1, upstreamFingerprint: cp.upstreamFingerprint, candidateFingerprint: cp.candidateFingerprint, currentFingerprint: cp.currentFingerprint })
    step = 'confirm chapter'
    await api.outlines.confirmChapter(1)
    const status = await api.outlines.planningStatus(1)
    step = 'single chapter story candidate'
    const saved = await api.chapterOutlines.get(1)
    const single = await api.planning.generateChapterStory(1)
    if (!single.content.includes('林舟拿着旧信')) throw new Error('Single chapter did not return the story')
    if ((await api.chapterOutlines.get(1)).content !== saved.content) throw new Error('Unexpected story write')
    return { project, count: skeleton.chapterSkeleton.chapters.length, detailed: detailed.chapterDetails[0].chapters[0].storyContent, status }
    } catch (error) { throw new Error(step + ': ' + JSON.stringify({ code: error?.code, message: error?.message })) }
  }, { root, baseUrl: `http://127.0.0.1:${server.address().port}/v1` })
  assert.equal(result.count, 1); assert.equal(result.detailed, story)
  assert.deepEqual(result.status.chapter.contractVersion.storyConstraints, constraints)
  checks.push('generation + review through typed IPC, 18 expected becomes 1 actual chapter, natural detail adopted with current contract; independent chapter generation is a zero-write story candidate')
  await openBook()
  const panel = page.getByTestId('chapter-story-constraints')
  await panel.getByRole('button', { name: '准备写作约束', exact: true }).click()
  await page.getByTestId('story-contract-preview').waitFor()
  await panel.getByRole('button', { name: '核对无误，采用约束' }).click()
  await panel.getByRole('status').waitFor()
  await page.getByRole('button', { name: '确认本版', exact: true }).click()
  await page.getByRole('button', { name: '已确认', exact: true }).waitFor()
  const owner = await app.browserWindow(page)
  await owner.evaluate(w => { if (w.isMaximized()) w.unmaximize(); w.setContentSize(1100, 800); w.webContents.setZoomFactor(1.25) })
  await panel.scrollIntoViewIfNeeded()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false)
  await writeFile(join(output, 'constraints-125.png'), Buffer.from(await owner.evaluate(async w => (await w.webContents.capturePage()).toPNG().toString('base64')), 'base64'))
  checks.push('visible preparation, exact preview/adoption, confirmation and compact 125% layout')
  assert.equal(needsNameCorrection, false)
  await page.getByRole('button', { name: '书稿', exact: true }).click()
  const chapters = page.locator('[data-nav-leaf="chapters"]'); if (await chapters.isVisible()) await chapters.click()
  await page.getByRole('button', { name: '打开智能助笔侧栏', exact: true }).click()
  await page.getByTestId('field-assistant-instruction').fill('按已确认章纲生成候选。中文输入验证。')
  assert.equal(await page.getByTestId('field-assistant-instruction').inputValue(), '按已确认章纲生成候选。中文输入验证。')
  const foundation = await page.evaluate(() => window.novelDesktop.workspace.getFoundationStatus(1))
  await writeFile(join(output, 'foundation.json'), JSON.stringify(foundation, null, 2))
  assert.equal(foundation.readyForProse, true, JSON.stringify(foundation))
  const writing = await page.evaluate(() => window.novelDesktop.ai.startWritingAgent({ operationId: crypto.randomUUID(), request: { chapterId: 1, currentDraft: '', message: '按已确认章纲生成候选。', preferredSkill: 'continue' } }))
  const completed = await page.evaluate(async id => { for (let i = 0; i < 240; i++) { const task = await window.novelDesktop.ai.writingAgentTask(id); if (!['queued','resuming','preparing','running','streaming'].includes(task.status)) return task; await new Promise(r => setTimeout(r, 250)) } throw Error('Synthetic writing timeout') }, writing.id)
  await writeFile(join(output, 'writing-task.json'), JSON.stringify(completed, null, 2))
  assert.equal(completed.status, 'succeeded', JSON.stringify(completed.error))
  assert.deepEqual(completed.turn.proposal.report.literaryFindings, [literaryFinding])
  await page.reload(); await page.getByTestId('app-boot-enter').click(); await page.getByTestId('app-boot').waitFor({ state: 'hidden' })
  await page.locator('[data-library-view="all"]').click(); await page.locator('.work-item-open').filter({ hasText: '故事大纲隔离验证' }).first().click(); await page.getByTestId('workspace-loading').waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: '书稿', exact: true }).click()
  const reopenedChapters = page.locator('[data-nav-leaf="chapters"]'); if (await reopenedChapters.isVisible()) await reopenedChapters.click()
  const openAssistant = page.getByRole('button', { name: '打开智能助笔侧栏', exact: true }); if (await openAssistant.isVisible()) await openAssistant.click()
  const reportPanel = page.locator('.agent-candidate-check').first()
  await reportPanel.waitFor({ timeout: 60000 })
  const reportOwner = await app.browserWindow(page)
  await reportOwner.evaluate(w => { w.setContentSize(1600, 1000); w.webContents.setZoomFactor(1) })
  await reportPanel.getByText('人物与场景问题 · 1 项', { exact: true }).click()
  await reportPanel.getByText('修改方向：' + literaryFinding.correction, { exact: true }).waitFor()
  await reportPanel.scrollIntoViewIfNeeded()
  const reportGeometry = await reportPanel.evaluate(el => { const rect = el.getBoundingClientRect(); return { left: rect.left, right: rect.right, viewport: innerWidth, overflow: el.scrollWidth > el.clientWidth + 1 } })
  assert.ok(reportGeometry.left >= 0 && reportGeometry.right <= reportGeometry.viewport + 1 && !reportGeometry.overflow, JSON.stringify(reportGeometry))
  await writeFile(join(output, 'literary-report-geometry.json'), JSON.stringify(reportGeometry, null, 2))
  assert.ok((await reportPanel.textContent()).includes('表达建议：动作可以更具体。'))
  assert.equal((await page.evaluate(() => window.novelDesktop.chapters.get(1))).content, '')
  await page.screenshot({ path: join(output, 'literary-report.png') })
  checks.push('Chinese composer input, formal event + confirmed story contract, normal IPC start and streamed candidate, new literary advice persists and renders visibly at 1600px/100% after reload; original prose remains empty')
  const fields = await page.evaluate(async ({ story }) => {
    const api = window.novelDesktop, scope = (await api.projects.status()).project.id
    const results = []
    for (const [fieldId,label,instruction] of [['AppShell.totalOutline','总纲姓名检查','字段姓名专项'],['AppShell.chapterOutline','歧义章纲检查','字段歧义专项']]) {
      const request = { operationId: crypto.randomUUID(), target: { fieldId, instanceId: crypto.randomUUID(), editorSessionId: crypto.randomUUID(), workItemId: scope, pageId: 'planning', label, revision: 1, value: '林舟在档案室核对旧信。' }, instruction }
      let task = await api.fieldAssistant.start(request)
      for (let i=0; i<180 && task.status==='running'; i++) { await new Promise(r=>setTimeout(r,100)); task=await api.fieldAssistant.task(task.id) }
      results.push(task)
    }
    return results
  }, { story })
  assert.equal(fields[0].status, 'completed', fields[0].error); assert.equal(fields[0].candidate.after, story)
  assert.equal(fields[1].status, 'failed'); assert.equal(fields[1].candidate, undefined); assert.ok(fields[1].rawResult.includes('full-names-v1'))
  await writeFile(join(output, 'field-outline-tasks.json'), JSON.stringify(fields, null, 2))
  await page.getByTestId('assistant-mode-tasks').click()
  await page.getByTestId('assistant-field-history').getByRole('button').filter({ hasText: '歧义章纲检查' }).click()
  const failureDetails = page.getByTestId('field-outline-review-failure')
  await failureDetails.locator('summary').click(); await failureDetails.locator('pre').waitFor()
  await failureDetails.scrollIntoViewIfNeeded()
  const failureGeometry = await failureDetails.evaluate(el => { const r=el.getBoundingClientRect(); return {left:r.left,right:r.right,viewport:innerWidth,overflow:el.scrollWidth>el.clientWidth+1} })
  assert.ok(failureGeometry.left>=0 && failureGeometry.right<=failureGeometry.viewport+1 && !failureGeometry.overflow, JSON.stringify(failureGeometry))
  await page.screenshot({ path: join(output, 'field-outline-failure.png') })
  checks.push('field editing through real typed IPC: one complete-name correction; ambiguous names stop with durable evidence and readable history, no field adoption or formal write')
  await closeNormally(); await launch(); await openBook()
  const reopened = await page.evaluate(() => window.novelDesktop.outlines.planningStatus(1))
  assert.equal(reopened.chapter.review.status, 'confirmed')
  await page.evaluate(async () => { const api = window.novelDesktop, old = await api.chapterOutlines.get(1); await api.chapterOutlines.update(1, old.content + '\n作者修改了章末选择。') })
  const changed = await page.evaluate(() => window.novelDesktop.outlines.planningStatus(1))
  assert.equal(changed.chapter.review.canConfirm, false); assert.equal(changed.chapter.contractVersion, undefined)
  checks.push('restart keeps exact contract; narrative edit revokes confirmation and prose permission')
  assert.equal(errors.length, 0, errors.join('\n'))
  await writeFile(join(output, 'result.json'), JSON.stringify({ root, checks, errors, requests: requests.length, model: 'localhost scripted transport; no real model quality assertion' }, null, 2))
  console.log(JSON.stringify({ checks, requests: requests.length, errors }))
} catch (error) {
  if (page) await page.screenshot({ path: join(output, 'failure.png') }).catch(() => {})
  await writeFile(join(output, 'failure.json'), JSON.stringify({ root, checks, errors, error: String(error) }, null, 2))
  throw error
} finally {
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => {}); await app.close().catch(() => {}) }
  await new Promise(done => server.close(done))
}
