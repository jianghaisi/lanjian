import test from 'node:test'
import assert from 'node:assert/strict'
import { fixture } from './helpers.ts'

test('hosted real V3 hierarchy produces a reviewed candidate, explicit adoption and export', async t => {
  const prose = Array.from({ length: 24 }, () => '林舟沿着湿漉漉的石阶走进旧城。他展开信纸，反复核对落款，发现名字不符，于是决定前去寻找证人。').join('\n\n')
  const requests: string[] = []
  const f = fixture(t, async (_url, init) => {
    const body = JSON.parse(String(init?.body)); requests.push(String(init?.body))
    const review = JSON.stringify({ passed: true, summary: '逐项核对通过', beats: Array.from({ length: 12 }, (_, i) => ({ id: `B${i + 1}`, status: 'covered', evidence: '核对落款' })),
      boundary: { entryRespected: true, exitReached: true, evidence: '决定前去寻找证人' }, violations: [], introducedFacts: [], characterChanges: [], characterConflicts: [], literaryFindings: [] })
    const content = body.stream ? prose : review
    return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 1200, completion_tokens: 300, total_tokens: 1500 } }), { headers: { 'content-type': 'application/json' } })
  })
  const user = await f.login(), owner = user.me.user.id
  const book = f.books.create(owner, { title: '完整流程样书', operation: 'flow_book_01' })
  const event = { time: '第一日午后', characters: ['林舟'], location: '旧城', event: '核对旧信的落款', result: '发现名字不符', evidenceRefs: [], confidence: 1 }
  let chapterId = 0, revision = ''
  await f.runtimes.run(owner, book.id, async r => {
    await r.workspace.saveBookProfile({ ...await r.workspace.bookProfile(), genre: '悬疑', coreIdea: '林舟核对旧信并追查寄信人', targetWordsPerChapter: 1000 })
    await r.workspace.saveFoundation({ creationPath: 'materials', sourceNotes: '作者原始设想', worldView: '旧城只有人力，没有超自然力量', useRealms: true, useSystem: true })
    await r.workspace.saveRealms([{ id: 'initial', name: '观微境', description: '只能辨认纸面痕迹，不能隔空探查' }])
    await r.workspace.saveSystemTemplate('[线索面板]\n[属性]\n[技能]\n[任务]')
    await r.planning.updateOutline('total', '林舟因为收到旧信而调查，于是发现名字矛盾，最终找出真相。')
    await r.planning.createVolume('旧城')
    await r.planning.updateOutline(1, '林舟进入旧城，因为发现落款不符而查找证人，最终找到发信人。')
    const chapter = await r.documents.createChapter(); chapterId = chapter.id; revision = chapter.revision!
    await r.planning.placeChapter(chapter.id, 1)
    for (const scope of ['total', 1] as const) {
      const status = await r.planning.status(), review = scope === 'total' ? status.totalReview : status.volumes[0]!.review
      if (review.status === 'attention') await r.planning.acknowledgeOutlineReview(scope)
      await r.planning.confirmPlanningOutline(scope)
    }
    const entry = { chapter: chapter.id, volume: 1, volumeChapter: 1, title: '核对旧信', coreEvent: event.event, characters: event.characters, location: event.location, result: event.result }
    const skeleton = await r.planning.inspectFormalSkeleton([entry], 1)
    await r.planning.adoptFormalSkeleton([entry], 1, skeleton.fingerprint)
    const outline = '进入状态：林舟拿着旧信，尚未核对落款\n1. 核对旧信的落款\n2. 发现名字不符\n退出状态：林舟决定寻找证人，尚未离开旧城\n允许扩写：纸面细节；动作；环境；对白\n禁止：不得提前找到发信人'
    const plan = await r.planning.prepareChapterEvent(chapter.id, 1, entry.title, outline, event)
    await r.planning.commitChapterEvent(plan.root, plan.command)
    await r.planning.confirmChapterOutline(chapter.id)
    const status = await r.workspace.foundationStatus(chapter.id)
    assert.equal(status.readyForProse, true, JSON.stringify(status))
  })
  f.models.update('admin', 'fixture', { name: '测试模型', protocol: 'openai-compatible', baseUrl: 'https://provider.example/v1', model: 'fixture-model', enabled: true, maxInputTokens: 100000, maxOutputTokens: 4096, expectedRevision: 0, apiKey: 'synthetic-provider-key' })
  f.credits.updatePrice('admin', 'fixture', { expectedVersion: 0, policy: { mode: 'request', points: 1000 } })
  const started = await f.jobs.start(owner, book.id, { operation: 'flow_generate_01', modelId: 'fixture', kind: 'writing', request: { chapterId, currentDraft: '', message: '按章纲写完本章', preferredSkill: 'continue' } }) as { id: string }
  await f.jobs.settleForTest(started.id)
  const get = await f.app.inject({ url: `/api/books/${book.id}/jobs/${started.id}`, cookies: user.cookies })
  const job = get.json()
  assert.equal(job.status, 'succeeded', get.body)
  assert.ok(requests.length >= 2, 'prose and separate review must both reach the metered transport')
  assert.match(requests[0]!, /观微境/); assert.match(requests[0]!, /线索面板/)
  assert.equal(job.task.turn.proposal.report.reviewMode, 'full')
  assert.equal(job.task.turn.proposal.report.passed, true, JSON.stringify(job.task.turn.proposal.report))
  await f.runtimes.run(owner, book.id, async r => assert.equal((await r.documents.chapter(chapterId)).content, ''))
  const applied = await f.app.inject({ method: 'POST', url: `/api/books/${book.id}/writing/apply`, cookies: user.cookies, headers: user.headers,
    payload: { taskId: job.task.id, expectedRevision: revision, title: '核对旧信', formatting: { firstLineIndent: false, paragraphSpacing: true } } })
  assert.equal(applied.statusCode, 200, applied.body)
  const exported = await f.app.inject({ url: `/api/books/${book.id}/export?format=markdown`, cookies: user.cookies })
  assert.equal(exported.statusCode, 200); assert.match(exported.body, /决定前去寻找证人/)
  assert.equal(f.credits.wallet(owner).balance, 9000, 'all internal calls charge this user task once')
})
