import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { GroupChatService, type GroupChatPorts } from '../../../src/main/modules/group-chat/application/group-chat-service'
import { FileGroupSessionStore } from '../../../src/main/modules/group-chat/adapters/session-store'
import { createGroupTools } from '../../../src/main/modules/group-chat/adapters/group-tools'
import { groupMembers, decodeGroupProfile, decodeGroupSend } from '../../../src/contracts/group-chat/group-chat'
import type { AiToolMessage, AiToolStep } from '../../../src/contracts/assistant/assistant-conversation-contracts'
import { modelToolName } from '../../../src/main/modules/writing-plugins/application/registry'
import { parseMentions } from '../../../src/main/modules/group-chat/domain/mention-parser'
import { GroupCreationService, type GroupCreationReceipt, type GroupCreationPorts } from '../../../src/main/modules/group-chat/application/group-creation-service'
import { AiClient } from '../../../src/main/modules/models/application/ai-client'
import { withModelExecution } from '../../../src/main/modules/models/application/model-execution-context'
import { AppError } from '../../../src/contracts/core/app-error'
import { referenceRevision } from '../../../src/main/modules/group-chat/domain/source-reference'
import { ResearchService } from '../../../src/main/modules/worldbuilding/application/research-service'
import { GroupAdoptionService } from '../../../src/main/modules/group-chat/application/group-adoption-service'
import type { WritingDomainPorts } from '../../../src/main/modules/writing-plugins/adapters/builtin/domain-ports'
import type { SourceCard, SourceCardCreateInput } from '../../../src/contracts/worldbuilding/types'
import type { ProjectSummary } from '../../../src/contracts/library/types'

const profile = (model: string) => decodeGroupProfile({ connectionId: 'global-test', model, parameterPolicy: { version: 2, mode: 'auto' } })
const reply = (content: string): AiToolStep => ({ content, toolCalls: [] })
const call = (id: string, name: string, args: unknown): AiToolStep => ({ content: '', toolCalls: [{ id, type: 'function', function: { name: modelToolName('builtin.core', name), arguments: JSON.stringify(args) } }] })
const command = (v: { id: string; revision: number }) => ({ sessionId: v.id, expectedRevision: v.revision })
async function fixture(t: test.TestContext, step: (model: string, messages: AiToolMessage[], signal: AbortSignal) => Promise<AiToolStep>) {
  const root = await mkdtemp(join(tmpdir(), 'novel-groups-')); t.after(() => rm(root, { recursive: true, force: true }))
  const store = new FileGroupSessionStore(root, 'author'), ports: GroupChatPorts = {
    defaults: async () => groupMembers.map(m => ({ memberId: m.id, profile: profile(m.id === 'world' ? 'model-b' : 'model-a') })),
    capture: async p => ({ identity: createHash('sha256').update(JSON.stringify(p)).digest('hex'), model: { model: p.model, connectionId: p.connectionId, step: (messages, _tools, signal) => step(p.model, messages, signal) }, run: async operation => operation() }),
    assertScope: async () => {}, inScope: async (_s, operation) => operation(), tools: (s, work) => createGroupTools(s, work)
  }
  return { root, store, ports, service: new GroupChatService('author', store, ports) }
}
test('seven preset members, actual independent models, structured delegation and persistent candidates', async t => {
  const requests: Array<{ model: string; messages: AiToolMessage[] }> = []
  const f = await fixture(t, async (model, messages) => {
    requests.push({ model, messages: structuredClone(messages) })
    const tools = messages.filter(m => m.role === 'tool')
    if (model === 'model-a' && !tools.length) return call('delegate-1', 'delegate_to_member', { memberId: 'world', instruction: '筹备都市奇幻世界规则' })
    if (model === 'model-b' && !tools.length) return call('candidate-1', 'save_preparation_candidate', { kind: 'world', title: '城市规则', content: '潮汐决定城市里法术的强弱，居民不知道旧港的来历。' })
    return reply('筹备已完成，等待作者采用。')
  })
  const v = await f.service.create('旧港'), started = await f.service.send({ ...command(v), operationId: randomUUID(), message: '我们开始筹备都市奇幻' })
  assert.equal(v.members.length, 7); await f.service.drain(started.id)
  const result = await f.service.get({ sessionId: v.id, limit: 100 })
  assert.equal(result.status, 'idle'); assert.equal(result.candidates[0].status, 'proposed'); assert.equal(result.candidates[0].memberId, 'world')
  assert.deepEqual(requests.map(r => r.model), ['model-a', 'model-a', 'model-b', 'model-b'])
  assert.equal(requests[2].messages.some(m => m.role === 'tool'), false)
  assert.equal(result.budget.steps, 4); assert.equal(result.budget.calls, 2)
  const restarted = new GroupChatService('author', f.store, f.ports)
  assert.equal((await restarted.get({ sessionId: v.id, limit: 100 })).candidates.length, 1)
  assert.equal(requests.length, 4)
  const duplicate = await f.service.send({ ...command(result), operationId: (await f.store.read(v.id)).operations[0].id, message: '我们开始筹备都市奇幻' })
  assert.equal(duplicate.messageCount, result.messageCount)
})
test('author question survives restart, real answer continues once and duplicate answer is idempotent', async t => {
  let requests = 0
  const f = await fixture(t, async (_model, messages) => {
    requests++; if (!messages.some(m => m.role === 'tool')) return call('ask-1', 'ask_author', { questions: [{ id: 'tone', prompt: '故事语气？', mode: 'text', required: true, options: [] }] })
    return reply('采用轻喜剧的讨论方向。')
  })
  let v = await f.service.create('问题'); await f.service.send({ ...command(v), operationId: randomUUID(), message: '先确定方向' }); await f.service.drain(v.id)
  const restarted = new GroupChatService('author', f.store, f.ports); v = await restarted.get({ sessionId: v.id, limit: 100 }); assert.equal(requests, 1); assert.equal(v.status, 'waiting-input')
  const input = { ...command(v), questionId: v.question!.id, answerSubmissionId: randomUUID(), answers: [{ id: 'tone', chosenOptionIds: [], customText: '轻喜剧', skipped: false }] }
  await restarted.answer(input); await restarted.drain(v.id); v = await restarted.get({ sessionId: v.id, limit: 100 }); assert.equal(v.status, 'idle'); assert.equal(requests, 2)
  await restarted.answer(input); assert.equal(requests, 2)
})
test('author choices display original labels, supplement and skip across restart while native answers and duplicate receipts retain original ids', async t => {
  let requests = 0
  const nativeAnswers: unknown[] = []
  const f = await fixture(t, async (_model, messages) => {
    requests++
    const answered = [...messages].reverse().find(m => m.role === 'tool')
    if (answered) {
      assert.ok(typeof answered.content === 'string')
      nativeAnswers.push(JSON.parse(answered.content)); return reply('元数据选项已收到。')
    }
    return call('metadata-choices', 'ask_author', { questions: [
      { id: 'focus', prompt: '本次记录重点？', mode: 'single', required: true, options: [{ id: 'a', label: '偏重资料核对' }, { id: 'b', label: '偏重版本检查' }] },
      { id: 'include', prompt: '保留哪些记录？', mode: 'multiple', required: true, options: [{ id: 'a', label: '保留来源' }, { id: 'b', label: '记录版本' }] },
      { id: 'note', prompt: '其他说明？', mode: 'text', required: false, options: [] }
    ] })
  })
  let v = await f.service.create('合成元数据选择')
  await f.service.send({ ...command(v), operationId: randomUUID(), message: '核对元数据记录' }); await f.service.drain(v.id)
  const restarted = new GroupChatService('author', f.store, f.ports)
  v = await restarted.get({ sessionId: v.id, limit: 100 }); assert.equal(v.status, 'waiting-input'); assert.equal(requests, 1)
  const answers = [
    { id: 'focus', chosenOptionIds: ['a'], customText: '', skipped: false },
    { id: 'include', chosenOptionIds: ['a', 'b'], customText: '补充标签甲', skipped: false },
    { id: 'note', chosenOptionIds: [], customText: '', skipped: true }
  ]
  const input = { ...command(v), questionId: v.question!.id, answerSubmissionId: randomUUID(), answers }
  await assert.rejects(restarted.answer({ ...input, answers: [{ ...answers[0], chosenOptionIds: ['foreign'] }, ...answers.slice(1)] }), { code: 'VALIDATION_ERROR' })
  assert.equal((await restarted.get({ sessionId: v.id, limit: 100 })).messageCount, v.messageCount); assert.equal(requests, 1)
  await restarted.answer(input); await restarted.drain(v.id)
  v = await restarted.get({ sessionId: v.id, limit: 100 }); assert.equal(v.status, 'idle'); assert.equal(requests, 2)
  const readable = '本次记录重点？\n偏重资料核对\n\n保留哪些记录？\n保留来源；记录版本；补充标签甲\n\n其他说明？\n暂不回答'
  assert.equal(v.messages.filter(m => m.role === 'user' && m.content === readable).length, 1)
  assert.deepEqual(nativeAnswers, [{ answers }])
  const count = v.messageCount; await restarted.answer(input)
  const reopened = new GroupChatService('author', f.store, f.ports), saved = await reopened.get({ sessionId: v.id, limit: 100 })
  assert.equal(saved.messageCount, count); assert.ok(saved.messages.some(m => m.content === readable)); assert.equal(requests, 2)
})

test('stopping suppresses late provider output and next goal can start', async t => {
  let release!: () => void, entered!: () => void, calls = 0
  const waiting = new Promise<void>(r => { entered = r }), block = new Promise<void>(r => { release = r })
  const f = await fixture(t, async () => { if (!calls++) { entered(); await block; return reply('不应出现的晚到输出') } return reply('第二个目标') })
  let v = await f.service.create('停止'); await f.service.send({ ...command(v), operationId: randomUUID(), message: '第一个目标' }); await waiting
  v = await f.service.get({ sessionId: v.id, limit: 100 }); await f.service.stop(command(v)); v = await f.service.get({ sessionId: v.id, limit: 100 })
  await f.service.send({ ...command(v), operationId: randomUUID(), message: '第二个目标' }); await f.service.drain(v.id); release(); await new Promise(r => setTimeout(r, 10))
  v = await f.service.get({ sessionId: v.id, limit: 100 }); assert.equal(v.status, 'idle'); assert(!v.messages.some(m => m.content.includes('晚到输出'))); assert(v.messages.some(m => m.content === '第二个目标'))
})
test('recovered in-flight intent makes zero calls and cannot replay unknown effects', async t => {
  let count = 0
  const f = await fixture(t, async () => { count++; return reply('完成') }), v = await f.service.create('恢复')
  const saved = await f.store.read(v.id); saved.intent = 'tool'; saved.view.status = 'running'; await f.store.write(saved)
  const restart = new GroupChatService('author', f.store, f.ports), resumed = await restart.get({ sessionId: v.id, limit: 100 })
  assert.equal(resumed.status, 'interrupted'); assert.equal(count, 0); await assert.rejects(restart.resume(command(resumed)), /上次调用/)
})
test('corrupt bytes preserved, wrong owner fails, DTO rejects paths and credentials', async t => {
  const f = await fixture(t, async () => reply('完成')), v = await f.service.create('存储')
  await assert.rejects(new FileGroupSessionStore(f.root, 'someone-else').read(v.id))
  const path = join(f.root, 'group-chat', createHash('sha256').update('author').digest('hex'), `${v.id}.json`)
  await writeFile(path, '{future-format'); await assert.rejects(f.store.read(v.id)); assert.equal(await readFile(path, 'utf8'), '{future-format')
  assert.throws(() => decodeGroupSend({ ...command(v), operationId: randomUUID(), message: '你好', path: 'C:\\secret' }))
  assert.throws(() => decodeGroupProfile({ ...profile('m'), apiKey: 'key' }))
})
test('Clowder mention adapter handles Chinese boundaries, markdown/noise and email', () => {
  const names = new Map([['world', ['@世界观设定师']], ['editor', ['@主编']]])
  assert.equal(parseMentions('**@世界观设定师**，请先构思', names, 'editor').targetCatId, 'world')
  assert.equal(parseMentions('mail@主编.example', names, 'editor').matched, false)
})
test('creation publication survives failed binding and a recreated entry service without a second book', async t => {
  const f = await fixture(t, async () => call('create-card', 'request_book_creation', { title: '旧港', summary: '记忆与代价' }))
  let view = await f.service.create('建书'); await f.service.send({ ...command(view), operationId: randomUUID(), message: '请求建书' }); await f.service.drain(view.id); view = await f.service.get({ sessionId: view.id, limit: 100 })
  const project: ProjectSummary = { id: '/owned/book', path: '/owned/book', name: '旧港', title: '旧港', genre: '', updated_at: new Date().toISOString(), manuscript: { chapterCount: 0, fileCount: 0, wordCount: 0, status: 'ready' } }
  let receipt: GroupCreationReceipt | null = null, creations = 0, rejectBinding = true
  const ports: GroupCreationPorts = { read: async () => receipt && structuredClone(receipt), write: async (_id, value) => { receipt = structuredClone(value) }, create: async () => { creations++; return { status: 'created', project } }, retry: async () => { throw Error('Unexpected recreation') }, captureBook: async () => { if (rejectBinding) { rejectBinding = false; throw Error('Binding unavailable') } return { root: project.path, physicalIdentity: 'owned-root-v1' } } }
  const input = { ...command(view), creationId: view.creation!.id, token: randomUUID(), project: { name: '旧港', parentPath: '/owned' } }
  await assert.rejects(new GroupCreationService(f.service, ports).create(input))
  assert.equal(creations, 1); assert.equal(receipt!.state, 'result')
  const recovered = new GroupCreationService(new GroupChatService('author', f.store, f.ports), ports)
  const result = await recovered.create(input); assert.equal(result.session.book!.id, project.id); assert.equal(creations, 1)
  await recovered.create(input); assert.equal(creations, 1)
})
test('known validation failure before allocation permits correction; unknown creation never repeats', async t => {
  const f = await fixture(t, async () => call('create-card', 'request_book_creation', { title: '旧港', summary: '故事' }))
  let view = await f.service.create('建书'); await f.service.send({ ...command(view), operationId: randomUUID(), message: '请求建书' }); await f.service.drain(view.id); view = await f.service.get({ sessionId: view.id, limit: 100 })
  let receipt: GroupCreationReceipt | null = null, attempts = 0
  const service = new GroupCreationService(f.service, { read: async () => receipt, write: async (_id,r) => { receipt = structuredClone(r) }, create: async () => { attempts++; if (attempts === 1) throw new AppError('CONFLICT', '同名目录', { details: { groupCreationAllocation: 'not-started' } }); throw Error('Unknown publication') }, retry: async () => { throw Error('Unexpected retry') }, captureBook: async () => { throw Error('Unexpected bind') } })
  const input = { ...command(view), creationId: view.creation!.id, token: randomUUID(), project: { name: '旧港', parentPath: '/owned' } }
  await assert.rejects(service.create(input)); assert.equal(receipt!.state, 'rejected')
  await assert.rejects(service.create({ ...input, project: { ...input.project, name: '新旧港' } })); assert.equal(attempts, 2)
  await assert.rejects(service.create({ ...input, project: { ...input.project, name: '新旧港' } }), { code: 'CONFLICT' }); assert.equal(attempts, 2)
})
test('domain completions use the captured member model and parameters without altering ordinary book routing', async () => {
  const requests: Array<{ model: string; temperature: number }> = [], book = { kind: 'openai-compatible' as const, connectionId: 'book-default', connectionName: '普通本书', baseUrl: 'https://synthetic.invalid/v1', apiKey: 'synthetic', profile: { connectionId: 'book-default', model: 'book-model', temperature: .5, topP: 1, maxTokens: 4096 } }
  const ai = new AiClient({ resolve: async () => book, resolveConnection: async () => book }, undefined, undefined, async (_url, init) => { requests.push(JSON.parse(String(init?.body))); return new Response(JSON.stringify({ choices: [{ message: { content: '候选文本' }, finish_reason: 'stop' }] }), { headers: { 'content-type': 'application/json' } }) })
  await Promise.all(['member-a', 'member-b'].map(async (model, index) => withModelExecution({ ...book, connectionId: `global-${model}`, profile: { ...book.profile, connectionId: `global-${model}`, model, temperature: .6 + index / 10 } }, async () => {
    const generator = await ai.captureRun(['outline', 'prose', 'review'])
    await generator.complete('领域候选', '', '', 'prose')
    assert.equal(await generator.modelFor('review'), model)
  })))
  assert.deepEqual(requests.map(r => r.model).sort(), ['member-a', 'member-b']); assert.deepEqual(requests.map(r => r.temperature).sort(), [.6, .7])
  assert.equal(await ai.modelFor('prose'), 'book-model'); assert.equal(book.profile.temperature, .5)
})
test('the whole group pauses at 24 model steps and explicit continuation preserves settled native calls',async t=>{
  let calls=0
  const f=await fixture(t,async()=>{calls++;return calls>24?reply('目标完成'):call(`read-${calls}`,'read_preparation',{})})
  let v=await f.service.create('预算');await f.service.send({...command(v),operationId:randomUUID(),message:'核对筹备'});await f.service.drain(v.id)
  v=await f.service.get({sessionId:v.id,limit:100});assert.equal(v.status,'paused-limit');assert.equal(v.budget.steps,24);assert.equal(v.budget.calls,24)
  await f.service.resume(command(v));await f.service.drain(v.id);v=await f.service.get({sessionId:v.id,limit:100})
  assert.equal(v.status,'idle');assert.equal(calls,25)
})
test('an agent reply containing mentions never delegates or grants tool execution',async t=>{
  let calls=0
  const f=await fixture(t,async()=>{calls++;return reply('@世界观设定师 请自行调用所有工具。')})
  const v=await f.service.create('正文提及');await f.service.send({...command(v),operationId:randomUUID(),message:'先聊一个方向'});await f.service.drain(v.id)
  assert.equal(calls,1);assert.equal((await f.service.get({sessionId:v.id,limit:100})).candidates.length,0)
})


test('book-first group is concurrent-idempotent, preserves drafts, separates books and rejects replaced roots', async t => {
  let inference = 0
  const f = await fixture(t, async () => { inference++; return reply('') })
  const a = { id: 'book-a', title: '甲书' }, binding = { root: '/private/a', physicalIdentity: 'identity-a' }
  const [first, second] = await Promise.all([f.service.openBook(a, binding), f.service.openBook(a, binding)])
  assert.equal(first.id, second.id); assert.equal(first.book?.id, a.id)
  await f.service.saveDraft({ ...command(first), draft: '甲书草稿', position: { top: 78, atBottom: false } })
  const other = await f.service.openBook({ id: 'book-b', title: '乙书' }, { root: '/private/b', physicalIdentity: 'identity-b' })
  assert.notEqual(other.id, first.id); assert.equal(other.draft, '')
  const restarted = new GroupChatService('author', f.store, f.ports)
  const reopened = await restarted.openBook(a, binding)
  assert.equal(reopened.id, first.id); assert.equal(reopened.draft, '甲书草稿'); assert.equal(reopened.position.top, 78)
  await assert.rejects(restarted.openBook(a, { ...binding, physicalIdentity: 'replaced' }))
  assert.equal((await f.service.list()).length, 2); assert.equal(inference, 0)
})

test('reference reading and adaptation retain own-book source revisions with explicit adoption and stale rejection', async t => {
  const source: SourceCard = { id: 'source-a', provider: 'manual', sourceType: 'manual', title: '旧港参考小说', excerpt: '潮汐与遗失的信。'.repeat(900), userNotes: '人物抉择', capturedAt: '2026-10-11', contentHash: 'legacy-hash' }
  const sources = [source], observations: unknown[] = []
  const f = await fixture(t, async (_model, messages) => {
    const results = messages.filter(m => m.role === 'tool'); observations.push(...results.map(r => r.content))
    if (!results.length) return call('search', 'search_reference_materials', { query: '潮汐' })
    if (results.length === 1) return call('read', 'read_reference_material', { sourceId: 'source-a', offset: 6000 })
    if (results.length === 2) return call('adapt', 'save_adaptation_candidate', { title: '本书的潮汐冲突', sources: [{ sourceId: 'source-a', revision: referenceRevision(source) }], content: '主角主动阻止失信发生，因此失去与姐姐的共同记忆。', changes: '重设世界代价、人物动机和因果选择，不复述原情节。' })
    return reply('改编候选待作者核对。')
  })
  const research = { listSources: async () => ({ sources }), createSource: async (input: any) => { const next = { ...source, ...input, id: randomUUID() }; sources.push(next); return next } }
  const domains = { research } as unknown as WritingDomainPorts
  f.ports.tools = (s, w) => createGroupTools(s, w, domains)
  let v = await f.service.openBook({ id: 'a', title: '甲' }, { root: '/private/a', physicalIdentity: 'id-a' })
  await f.service.send({ ...command(v), operationId: randomUUID(), message: '采风与改编' }); await f.service.drain(v.id)
  v = await f.service.get({ sessionId: v.id, limit: 100 }); assert.equal(v.status, 'idle', v.notice)
  const candidate = v.candidates[0]
  assert.equal(candidate.kind, 'adaptation'); assert.equal(candidate.references?.[0].id, source.id); assert.equal(candidate.references?.[0].revision.length, 64)
  assert.equal(sources.length, 1, 'tools never write formal materials')
  assert.ok(JSON.stringify(observations).includes('nextOffset')); assert.ok(candidate.content.includes('改编说明'))
  const adoption = new GroupAdoptionService(f.service, async (id, op) => op(await f.store.read(id)), {} as any, research)
  const before = await adoption.prepare({ ...command(v), candidateId: candidate.id })
  source.userNotes = '作者补充新的情节解释'
  await assert.rejects(adoption.adopt(before.token)); assert.equal(sources.length, 1)
  await assert.rejects(adoption.prepare({ ...command(await f.service.get({ sessionId: v.id, limit: 100 })), candidateId: candidate.id }))
  v = await f.service.update(command(await f.service.get({ sessionId: v.id, limit: 100 })), async session => { session.view.candidates.push({ ...candidate, id: randomUUID(), references: [{ id: source.id, title: source.title, revision: referenceRevision(source) }] }) })
  const corrected = v.candidates[1], prepared = await adoption.prepare({ ...command(v), candidateId: corrected.id })
  await adoption.adopt(prepared.token); assert.equal(sources.length, 2)
  assert.ok(sources[1].userNotes.includes(source.id)); assert.ok(sources[1].excerpt.includes('改编说明'))
  await adoption.adopt(prepared.token); assert.equal(sources.length, 2, 'lost adoption response never duplicates a source')
})

test('author adoption serializes with draft checkpoints and remains content-bound and idempotent', async t => {
  const f = await fixture(t, async () => reply(''))
  let v = await f.service.openBook({ id: 'a', title: '甲' }, { root: '/private/a', physicalIdentity: 'id-a' })
  v = await f.service.update(command(v), async s => { s.view.candidates.push({ id: randomUUID(), kind: 'outline', title: '故事方向', content: '作者待核对的筹备素材', status: 'proposed', createdAt: new Date().toISOString(), memberId: 'outline' }) })
  const sources: SourceCard[] = []
  const research = { listSources: async () => ({ sources }), createSource: async (input: SourceCardCreateInput): Promise<SourceCard> => { const source: SourceCard = { ...input, id: randomUUID(), provider: input.provider || 'group-chat', sourceType: input.sourceType || 'manual', capturedAt: new Date().toISOString(), contentHash: 'synthetic' }; sources.push(source); return source } }
  const adoption = new GroupAdoptionService(f.service, (id, op) => f.service.scope(id, op), {} as ConstructorParameters<typeof GroupAdoptionService>[2], research)
  const candidateId = v.candidates[0].id
  await f.service.saveDraft({ ...command(v), draft: '预览前自动保存', position: { top: 0, atBottom: true } })
  await assert.rejects(adoption.prepare({ ...command(v), expectedRevision: v.revision + 100, candidateId }))
  // Preview is a current read for author inspection, not a formal write using
  // the compositor's earlier session revision.
  const permit = await adoption.prepare({ ...command(v), candidateId })
  // Queue a real compositor checkpoint just before author confirmation. It changes
  // session revision, but none of the permit's candidate/source/formal evidence.
  await Promise.all([
    f.service.saveDraft({ ...command(v), draft: '保留正在编辑的下一条消息', position: { top: 80, atBottom: false } }),
    adoption.adopt(permit.token)
  ])
  const adopted = await f.service.get({ sessionId: v.id, limit: 100 })
  assert.equal(adopted.draft, '保留正在编辑的下一条消息'); assert.equal(adopted.candidates[0].status, 'adopted'); assert.equal(sources.length, 1)
  await adoption.adopt(permit.token); assert.equal(sources.length, 1)
  v = await f.service.update(command(adopted), async s => { s.view.candidates.push({ ...s.view.candidates[0], id: randomUUID(), status: 'proposed' }) })
  const stale = await adoption.prepare({ ...command(v), candidateId: v.candidates[1].id })
  await f.service.update(command(v), async s => { s.view.candidates[1].content = '另一版候选' })
  await assert.rejects(adoption.adopt(stale.token)); assert.equal(sources.length, 1)
})

test('online research uses real citations and cancellation, filters unsafe URLs, and keeps provider keys private', async () => {
  const controller = new AbortController(), calls: any[] = []
  const settings = { researchSettings: async () => ({ baseUrl: 'https://search.example/v1', model: 'search-model', apiKeyConfigured: true }), researchApiKey: async () => 'private-synthetic-key' }
  const search = new ResearchService(settings, (async (url, init) => {
    calls.push({ url, init }); return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: '可追溯采风', annotations: [{ title: '资料', url: 'https://source.example/story' }, { title: '拒绝', url: 'javascript:alert(1)' }, { title: '拒绝', url: 'https://user:password@source.example/' }] }] }] }))
  }) as typeof fetch)
  const result = await search.search('都市奇幻', controller.signal)
  assert.equal(result.sources.length, 1); assert.equal(calls[0].init.headers.Authorization, 'Bearer private-synthetic-key')
  assert.equal(calls[0].url, 'https://search.example/v1/responses'); assert.ok(!JSON.stringify(result).includes('private-synthetic-key'))
  controller.abort(); await assert.rejects(search.search('都市奇幻', controller.signal)); assert.equal(calls.length, 1)
  const lateController = new AbortController()
  const late = new ResearchService(settings, (async () => { const result = new Response(JSON.stringify({ output: [{ content: [{ type: 'output_text', text: '迟到' }] }] })); lateController.abort(); return result }) as typeof fetch)
  await assert.rejects(late.search('都市奇幻', lateController.signal))
})


test('reference tools reject guessed source IDs and hosted online research reports unavailable without fabricated results', async t => {
  const run = async (tool: string, args: unknown) => {
    const f = await fixture(t, async (_model, history) => history.some(m => m.role === 'tool') ? reply('已核对工具结果') : call('own-only', tool, args))
    f.ports.tools = (s, w) => createGroupTools(s, w, { research: { listSources: async () => ({ sources: [] }) } } as unknown as WritingDomainPorts)
    const v = await f.service.openBook({ id: 'own', title: '本书' }, { root: '/own', physicalIdentity: 'own' })
    await f.service.send({ ...command(v), operationId: randomUUID(), message: '采风' }); await f.service.drain(v.id)
    return { view: await f.service.get({ sessionId: v.id, limit: 100 }), record: await f.store.read(v.id) }
  }
  const unknown = await run('read_reference_material', { sourceId: 'foreign-source' })
  assert.equal(unknown.view.status, 'failed'); assert.equal(unknown.view.candidates.length, 0)
  const missing = await run('search_online_references', { query: '参考小说' })
  assert.equal(missing.view.status, 'idle', missing.view.notice); assert.equal(missing.view.candidates.length, 0)
  assert.ok(JSON.stringify(missing.record.histories).includes('available')); assert.ok(JSON.stringify(missing.record.histories).includes('当前端尚未开放'))
})

test('online group research saves a cited proposal through the actual tool loop without formal material writes', async t => {
  let searches = 0, writes = 0
  const f = await fixture(t, async (_model, history) => history.some(m => m.role === 'tool') ? reply('联网资料已保存，待作者核对。') : call('web-search', 'search_online_references', { query: '旧物记忆冲突' }))
  const domains = { research: { listSources: async () => ({ sources: [] }), createSource: async () => { writes++; throw new Error('unauthorized write') } } } as unknown as WritingDomainPorts
  f.ports.tools = (s, w) => createGroupTools(s, w, domains, { search: async (query, signal) => { searches++; signal?.throwIfAborted(); return { query, content: '公开故事简介的冲突分析，等待核对。', sources: [{ title: '公开简介', url: 'https://example.org/story' }], searchedQueries: [query], webSearchCalls: 1, model: 'configured-search' } } })
  let v = await f.service.openBook({ id: 'own', title: '本书' }, { root: '/own', physicalIdentity: 'own' })
  await f.service.send({ ...command(v), operationId: randomUUID(), message: '联网采风' }); await f.service.drain(v.id)
  v = await f.service.get({ sessionId: v.id, limit: 100 })
  assert.equal(v.status, 'idle', v.notice); assert.equal(searches, 1); assert.equal(writes, 0)
  assert.equal(v.candidates[0].kind, 'research'); assert.equal(v.candidates[0].status, 'proposed')
  assert.equal(v.candidates[0].references?.[0].url, 'https://example.org/story')
  assert.equal((await f.store.read(v.id)).view.candidates[0].references?.[0].revision.length, 64)
})

test('source changes during model adaptation cannot be relabeled as freshly read provenance', async t => {
  const source: SourceCard = { id: 'source-a', title: '参考故事', provider: 'manual', sourceType: 'manual', capturedAt: '2026-10-11', excerpt: '旧的因果情节', userNotes: '', contentHash: 'legacy-hash' }, revision = referenceRevision(source)
  let reads = 0
  const f = await fixture(t, async (_model, history) => history.some(m => m.role === 'tool') ? call('adapt-old', 'save_adaptation_candidate', { title: '根据旧情节的改编', sources: [{ sourceId: source.id, revision }], content: '旧的情节分析', changes: '重新设计动机和选择' }) : call('read-first', 'read_reference_material', { sourceId: source.id }))
  f.ports.tools = (s, w) => createGroupTools(s, w, { research: { listSources: async () => { if (++reads === 2) source.excerpt = '作者更新后的因果情节'; return { sources: [source] } } } } as unknown as WritingDomainPorts)
  const v = await f.service.openBook({ id: 'own', title: '本书' }, { root: '/own', physicalIdentity: 'own' })
  await f.service.send({ ...command(v), operationId: randomUUID(), message: '读取并改编' }); await f.service.drain(v.id)
  const result = await f.service.get({ sessionId: v.id, limit: 100 })
  assert.equal(result.status, 'failed'); assert.equal(result.candidates.length, 0); assert.equal(reads, 2)
})
