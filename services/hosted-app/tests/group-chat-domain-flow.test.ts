import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { fixture } from './helpers.ts'
import { unwrapValidatedIpcResponse } from '../../../desktop/src/contracts/core/ipc-response'
import type { GroupSessionView } from '../../../desktop/src/contracts/group-chat/group-chat'

test('bound group uses member models for planning, expansion and read-only review; prose without a chapter contract sends and charges nothing', async t => {
  const requests: any[] = []
  let stage: 'creation' | 'planning' | 'expansion' | 'writer' | 'reviewer' = 'creation', chapterId = 0, revision = ''
  const event = { time: '第一日午后', characters: ['林舟'], location: '旧城', event: '核对旧信的落款', result: '发现名字不符', evidenceRefs: [], confidence: 1 }
  const prose = Array.from({ length: 24 }, () => '林舟沿着湿漉漉的石阶走进旧城。他展开信纸，反复核对落款，发现名字不符，于是决定前去寻找证人。').join('\n\n')
  const f = fixture(t, async (_url, init) => {
    const body = JSON.parse(String(init?.body)); requests.push(body)
    let message: any
    if (body.tools) {
      const results = body.messages.filter((m: any) => m.role === 'tool'), last = results.at(-1) && JSON.parse(results.at(-1).content).value
      const tool = (name: string, args: unknown) => ({ id: `call-${requests.length}-${name}`, type: 'function', function: { name: body.tools.find((t: any) => t.function.name.includes(`_${name}_`))?.function.name ?? name, arguments: JSON.stringify(args) } })
      let call
      if (stage === 'creation') call = tool('request_book_creation', { title: '领域工具样书', summary: '沿原创作流程生成候选。' })
      else if (!results.length) call = stage === 'planning' ? tool('generate_planning', {}) : stage === 'expansion' ? tool('read_planning_outline', { key: 'total' }) : tool('read_manuscript', { chapterId })
      else if (last?.revision) call = stage === 'expansion' ? tool('expand_outline', { parentKey: 'total', expectedRevision: last.revision, count: 1, instruction: '展开完整因果。' }) : tool(stage === 'writer' ? 'generate_manuscript' : 'review_manuscript', { chapterId, expectedRevision: last.revision, instruction: '按章纲处理本章。' })
      message = { role: 'assistant', content: call ? '正在调用原领域工具。' : '候选任务已经提交，请作者核对。', ...(call ? { tool_calls: [call] } : {}) }
    } else {
      const raw = JSON.stringify(body)
      let content
      if (raw.includes('复核下方完整候选与给定父级/素材')) content = JSON.stringify({ issues: [] })
      else if (stage === 'planning' && raw.includes('生成创作蓝图。')) content = JSON.stringify({ premise: '追查旧信的来源', worldView: '没有超自然力量的旧城', characters: [{ name: '林舟', role: '送信人', arcSeed: '从怀疑到查明真相' }], powerSystem: '', cheatSystem: '', rationale: '依靠人物选择推进故事。' })
      else if (stage === 'planning' && raw.includes('生成覆盖全书的总纲候选。')) content = JSON.stringify({ title: '旧信之谜', summary: '林舟找到旧信来源。', content: '因为旧信落款不符，林舟走访旧城，随后发现证人隐瞒实情，最终查明发信人的身份。' })
      else if (stage === 'planning') content = JSON.stringify({ volumes: [{ order: 1, title: '旧城来信', goal: '寻找证人', summary: '林舟核对旧信并调查旧城。', ending: '得知发信人住处。', storyContent: '林舟因为收到旧信而来到旧城，他核对落款发现名字不符，于是寻找旧信中的证人。证人起初回避，林舟出示字迹让他认出旧友，最终得知发信人的住处。' }] })
      else if (stage === 'expansion') content = JSON.stringify({ children: [{ title: '旧城', content: '因为旧信落款不符，林舟进入旧城寻找证人。', events: [event] }] })
      else if (body.stream) content = prose
      else content = JSON.stringify({ passed: true, summary: '逐项核对通过', beats: Array.from({ length: 12 }, (_, i) => ({ id: `B${i + 1}`, status: 'covered', evidence: '核对落款' })), boundary: { entryRespected: true, exitReached: true, evidence: '决定前去寻找证人' }, violations: [], introducedFacts: [], characterChanges: [], characterConflicts: [], literaryFindings: [] })
      message = { role: 'assistant', content }
    }
    return new Response(JSON.stringify({ choices: [{ message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 1200, completion_tokens: 300 } }), { headers: { 'content-type': 'application/json' } })
  })
  const user = await f.login(), owner = user.me.user.id
  // Observe failures after the app has loaded. Return the exact original Promise:
  // a diagnostic await can otherwise change the scheduling we are investigating.
  const failures: unknown[] = []
  let observedTools = 0, observedPlanning = 0
  const canonicalRoot = await realpath(f.root)
  const redact = (text: string) => text.replaceAll(f.root, '[isolated test root]').replaceAll(canonicalRoot, '[isolated test root]').replace(/synthetic-key|secret-sentinel|bearer-secret/gi, '[redacted]')
  const observe = (stage: string, error: unknown) => {
    const causes: unknown[] = []
    for (let current = error as Error & { code?: string; cause?: unknown }; current && causes.length < 5; current = current.cause as typeof current) {
      causes.push({ name: current.name, code: current.code, message: redact(String(current.message)), stack: current.stack?.split('\n').slice(0, 9).map(redact) })
    }
    failures.push({ stage, causes })
  }
  const { WritingPluginDispatcher } = await import('../../../desktop/src/main/modules/writing-plugins/application/dispatcher.ts')
  const { PlanningDraftService } = await import('../../../desktop/src/main/modules/planning/application/planning-draft-service.ts')
  const execute = WritingPluginDispatcher.prototype.execute, generate = PlanningDraftService.prototype.generate
  WritingPluginDispatcher.prototype.execute = function (...args) {
    observedTools++; const pending = execute.apply(this, args); void pending.catch(error => observe('tool', error)); return pending
  }
  PlanningDraftService.prototype.generate = function (...args) {
    observedPlanning++; const pending = generate.apply(this, args); void pending.catch(error => observe('planning', error)); return pending
  }
  t.after(() => { WritingPluginDispatcher.prototype.execute = execute; PlanningDraftService.prototype.generate = generate })
  for (const id of ['normal', 'outline', 'chapter', 'writer', 'reviewer']) {
    f.models.update('admin', id, { name: id, protocol: 'openai-compatible', baseUrl: 'https://provider.example/v1', model: `member-${id}`, enabled: true, maxInputTokens: 100000, maxOutputTokens: 4096, expectedRevision: 0, apiKey: 'synthetic-key' })
    f.credits.updatePrice('admin', id, { expectedVersion: 0, policy: { mode: 'request', points: 1000 } })
  }
  f.models.select('admin', { modelId: 'normal', expectedRevision: 0 })
  const call = async <T = GroupSessionView>(name: string, args: unknown[] = []) => {
    const reply = await f.app.inject({ method: 'POST', url: `/api/desktop/library/group-chat/${name}`, cookies: user.cookies, headers: user.headers, payload: { args, operation: randomUUID() } })
    assert.equal(reply.statusCode, 200, reply.body)
    return unwrapValidatedIpcResponse<T>(`group-chat:${name}`, reply.json())
  }
  let s = await call('create', ['真实领域群'])
  s = await call('send', [{ sessionId: s.id, expectedRevision: s.revision, operationId: randomUUID(), message: '创建样书' }])
  const groups = (await f.groups.account(owner)).groups
  await groups.drain(s.id); s = await call('get', [{ sessionId: s.id, limit: 100 }])
  const preview = await f.app.inject({ method: 'POST', url: '/api/desktop/library/model-connections/previewCreation', cookies: user.cookies, headers: user.headers, payload: { args: [false], operation: randomUUID() } })
  const token = unwrapValidatedIpcResponse<any>('model-connections:previewCreation', preview.json()).token
  s = (await call<any>('createBook', [{ sessionId: s.id, expectedRevision: s.revision, creationId: s.creation!.id, token, project: { name: '领域工具样书', parentPath: '账户书库' } }])).session
  const bookId = s.book!.id
  await f.runtimes.run(owner, bookId, async r => {
    await r.workspace.saveBookProfile({ ...await r.workspace.bookProfile(), genre: '悬疑', coreIdea: '追查旧信', plannedVolumes: 1 })
    await r.workspace.saveFoundation({ creationPath: 'materials', sourceNotes: '林舟收到落款矛盾的旧信，前往旧城寻找证人。', worldView: '', useRealms: false, useSystem: false })
  })
  for (const memberId of ['outline', 'chapter', 'writer', 'reviewer'] as const) s = await call('saveMember', [{ sessionId: s.id, expectedRevision: s.revision, memberId, profile: { connectionId: `global-hosted-${memberId}`, model: `member-${memberId}`, temperature: .61, topP: .9, maxTokens: 2048 } }])
  const run = async (next: typeof stage, memberId: 'outline' | 'chapter' | 'writer' | 'reviewer') => {
    stage = next; const first = requests.length
    s = await call('send', [{ sessionId: s.id, expectedRevision: s.revision, operationId: randomUUID(), memberId, message: `执行${stage}工具` }])
    await groups.drain(s.id); s = await call('get', [{ sessionId: s.id, limit: 100 }])
    assert.equal(s.status, 'idle', JSON.stringify({ stage, notice: s.notice, failures }))
    const generation = requests.slice(first).filter(body => !body.tools?.length)
    const expansionState = generation.length || next !== 'expansion' ? null : (await f.app.inject({ method: 'POST', url: `/api/books/${bookId}/desktop/workspace/list-outline-expansions`, cookies: user.cookies, headers: user.headers, payload: { args: [], operation: randomUUID() } })).json()
    assert.ok(generation.length > 0, `${stage} must really invoke the original domain provider: ${JSON.stringify({ expansionState, messages: s.messages, requests: requests.slice(first).map(body => ({ model: body.model, tools: body.tools?.length, prompt: body.messages.at(-1)?.content?.slice(0, 300) })) })}`)
    assert.ok(generation.every(body => body.model === `member-${memberId}`), JSON.stringify(generation.map(body => body.model)))
    assert.ok(generation.every(body => body.max_tokens === 2048 || body.max_completion_tokens === 2048))
    return generation
  }
  await run('planning', 'outline')
  await f.runtimes.run(owner, bookId, async r => {
    const proposal = await f.jobs.services(r).packages.get()
    assert.ok(proposal?.totalOutline.content.includes('旧信'), JSON.stringify({ failures, tasks: await r.projects.backgroundTasks.list() }))
    assert.equal((await r.workspace.planningOutline('total'))?.content ?? '', '', 'automatic planning remains a candidate')
    await r.planning.updateOutline('total', proposal!.totalOutline.content)
  })
  await run('expansion', 'chapter')
  await f.runtimes.run(owner, bookId, async r => {
    const source = await r.workspace.planningOutline('total'); assert.ok(source?.content.includes('旧信'))
    // Seed unconfirmed static outlines for read-only review; do not confirm them in this fixture.
    await r.workspace.saveBookProfile({ ...await r.workspace.bookProfile(), genre: '悬疑', coreIdea: '追查旧信', targetWordsPerChapter: 1000 })
    await r.workspace.saveFoundation({ creationPath: 'materials', sourceNotes: '作者设想', worldView: '旧城只有人力', useRealms: true, useSystem: true })
    await r.workspace.saveRealms([{ id: 'initial', name: '观微境', description: '只能辨认纸面痕迹，不能隔空探查' }])
    await r.workspace.saveSystemTemplate('[线索面板]\n[属性]\n[技能]\n[任务]')
    await r.planning.createVolume('旧城'); await r.planning.updateOutline(1, '林舟进入旧城，因为发现落款不符而查找证人，最终找到发信人。')
    const chapter = await r.documents.createChapter(); chapterId = chapter.id; revision = chapter.revision!
    await r.planning.placeChapter(chapterId, 1)
    const outline = '进入状态：林舟拿着旧信，尚未核对落款\n1. 核对旧信的落款\n2. 发现名字不符\n退出状态：林舟决定寻找证人，尚未离开旧城\n允许扩写：纸面细节；动作；环境；对白\n禁止：不得提前找到发信人'
    await r.planning.updateChapterOutline(chapterId, outline, 1)
  })
  stage = 'writer'; const beforeWriter = requests.length, balance = f.credits.wallet(owner).balance
  s = await call('send', [{ sessionId: s.id, expectedRevision: s.revision, operationId: randomUUID(), memberId: 'writer', message: '核对正文任务入口。' }])
  await groups.drain(s.id); s = await call('get', [{ sessionId: s.id, limit: 100 }])
  assert.equal(s.status, 'failed'); assert.match(s.notice, /书稿|正文章契/); assert.equal(requests.length, beforeWriter); assert.equal(f.credits.wallet(owner).balance, balance)
  await f.runtimes.run(owner, bookId, async r => {
    assert.equal((await r.documents.chapter(chapterId)).content, '', 'rejected group prose preserves the empty chapter')
    // Seed the pre-existing static source fixture for read-only review, without generation or confirmation.
    await r.documents.updateChapter(chapterId, { content: prose, title: '核对旧信', expectedRevision: revision })
  })
  const reviewRequests = await run('reviewer', 'reviewer')
  assert.match(JSON.stringify(reviewRequests), /观微境/); assert.match(JSON.stringify(reviewRequests), /线索面板/)
  await f.runtimes.run(owner, bookId, async r => assert.equal((await r.documents.chapter(chapterId)).content, prose))
  assert.equal(f.models.selected()!.id, 'normal', 'group model overrides do not change ordinary routing')
  assert.equal(f.db.get("SELECT COUNT(*) AS n FROM group_model_jobs WHERE status='succeeded'")!.n, 4)
  assert.equal(f.credits.wallet(owner).balance, 6000, 'each permitted member work item charges once including its domain calls; rejected prose charges nothing')
  assert.ok(observedTools > 0 && observedPlanning > 0, 'Diagnostics must observe the actual domain and dispatcher instances')
})
