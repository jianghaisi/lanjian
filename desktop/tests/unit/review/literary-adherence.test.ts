import assert from 'node:assert/strict'
import test from 'node:test'
import { ChapterDraftService, parseAdherenceReview } from '../../../src/main/modules/manuscript/application/chapter-draft-service'
import { decodeLiteraryFindings } from '../../../src/contracts/review/literary-findings'
import { unwrapValidatedIpcResponse } from '../../../src/contracts/core/ipc-response'
import type { ChapterContract } from '../../../src/contracts/index'

const first = '程见微邀请许嘉树吃饭。许嘉树叫来周子昂，程见微停下没有解释。'
const prose = first + '\n\n' + Array.from({ length: 25 }, () => '许嘉树走到门口，回头确认程见微和周子昂跟了上来。').join('\n\n')
const canon = '程见微说话温和，希望和许嘉树单独相处。许嘉树还没有答应恋爱。'
const outline = '进入状态：三人在活动室\n1. 程见微邀请许嘉树吃饭\n退出状态：三人一起出门\n允许扩写：眼前动作和对白'
const report = { summary: '节点完成', passed: true, beats: [{ id: 'B1', status: 'covered', evidence: first }],
  boundary: { entryRespected: true, exitReached: true, evidence: first }, foreshadowing: [],
  violations: [], introducedFacts: [], characterChanges: [], characterConflicts: [], literaryFindings: [] as unknown[] }
const finding = { category: 'character-voice', severity: 'blocking', candidateQuote: first, sourceQuote: canon,
  reason: '这项用例声明候选违背已确认人物要求。', correction: '依据当前正式性格重写反应，保留邀请和出门结果。' }
function fixture(response: unknown, repairs = 0) {
  const calls: Array<{ task: string; instruction: string }> = []
  const ai = { complete: async (instruction: string, _draft: string, _context: string, task: string) => {
    calls.push({ task, instruction }); return { content: task === 'prose' ? prose : JSON.stringify(response) }
  } }
  const documents = { chapter: async () => ({ id: 2, position: 2 }), chapterOutline: async () => ({ content: outline }) }
  const workspace = { foundationStatus: async () => ({ readyForProse: true }), chapterEvents: async () => [],
    chapterContractVersion: async () => ({ fingerprint: 'current', totalFingerprint: 'total', outlineHash: 'outline', eventIds: [], confirmedAt: '2026-10-11T00:00:00Z' }),
    bookProfile: async () => ({ targetWordsPerChapter: 300, proseExpansionMode: 'balanced', reviewStrictness: 'balanced' }),
    promptContext: async () => canon, contextBudgetPreferences: async () => ({ structuredRepairAttempts: repairs }) }
  return { service: new ChapterDraftService(ai as never, documents as never, workspace as never), calls }
}

test('actual drafting maps evidence-bearing literary blockers to a failed candidate without rewriting prose', async () => {
  const f = fixture({ ...report, literaryFindings: [finding] })
  const result = await f.service.draft(2, '按当前章纲写')
  assert.equal(result.content, prose)
  assert.equal(result.report.passed, false, 'raw model passed flag must not override blockers')
  assert.match(result.report.summary, /人物与场景/)
  assert.match(result.report.violations[0], /修改方向/)
  assert.deepEqual(result.report.literaryFindings, [finding])
  assert.deepEqual(f.calls.map(call => call.task), ['prose', 'review'])
})

test('aesthetic advice remains nonblocking and needs no invented formal quotation', async () => {
  const advice = { ...finding, severity: 'advice', sourceQuote: '', reason: '反应可以更具体。' }
  const f = fixture({ ...report, literaryFindings: [advice] })
  const result = await f.service.draft(2, '')
  assert.equal(result.report.passed, true)
  assert.deepEqual(result.report.violations, [])
  assert.equal(result.report.literaryFindings?.[0].severity, 'advice')
})

test('missing new review, invented candidate/source quotes and unsupported aesthetic blockers fail closed', async () => {
  const { literaryFindings: _old, ...missing } = report
  for (const raw of [missing, { ...report, literaryFindings: [{ ...finding, candidateQuote: '没有在正文出现' }] },
    { ...report, literaryFindings: [{ ...finding, sourceQuote: '并不存在的正式要求' }] },
    { ...report, literaryFindings: [{ ...finding, sourceQuote: '' }] }]) {
    const f = fixture(raw)
    await assert.rejects(f.service.draft(2, ''), { code: 'AI_RESPONSE_INVALID' })
    assert.deepEqual(f.calls.map(call => call.task), ['prose', 'review'])
  }
})

test('causal gaps quote the actual transition without fabricating a missing sentence', async () => {
  const gap = { ...finding, category: 'causal-gap', sourceQuote: '', reason: '用例以实际前后句说明缺少行动步骤。' }
  const f = fixture({ ...report, literaryFindings: [gap] })
  assert.equal((await f.service.draft(2, '')).report.passed, false)
})

test('wire decoder bounds findings; old reports do not acquire a new checked label', async () => {
  assert.deepEqual(decodeLiteraryFindings([]), [])
  for (const bad of [null, Array.from({ length: 31 }, () => finding), [{ ...finding, candidateQuote: '' }],
    [{ ...finding, severity: 'score' }], [{ ...finding, extra: true }]]) assert.throws(() => decodeLiteraryFindings(bad))
  const contract = { beats: [{ id: 'B1' }], foreshadowActions: [] } as unknown as ChapterContract
  const { literaryFindings: _new, ...old } = report
  assert.equal(parseAdherenceReview(JSON.stringify(old), contract).literaryFindings, undefined)
})

test('IPC accepts historical reports and rejects inconsistent or malformed new findings', async () => {
  const { literaryFindings: _new, ...old } = report
  const turn = (review: unknown) => ({ id: 'turn', workItemId: 'book', chapterId: 2, createdAt: '2026-10-11T00:00:00Z',
    model: 'frozen-model', skill: { id: 'continue', label: '续写' }, answer: prose, tools: [],
    proposal: { id: 'proposal', chapterId: 2, createdAt: '2026-10-11T00:00:00Z', content: prose, contract: {}, report: review } })
  assert.deepEqual(unwrapValidatedIpcResponse('ai:run-writing-agent', { ok: true, value: turn(old) }), turn(old))
  const valid = { ...report, literaryFindings: [{ ...finding, severity: 'advice', sourceQuote: '' }] }
  assert.deepEqual(unwrapValidatedIpcResponse('ai:run-writing-agent', { ok: true, value: turn(valid) }), turn(valid))
  for (const raw of [{ ...report, literaryFindings: [finding] }, { ...report, literaryFindings: [{ ...finding, reason: 3 }] }]) {
    assert.throws(() => unwrapValidatedIpcResponse('ai:run-writing-agent', { ok: true, value: turn(raw) }))
  }
})
