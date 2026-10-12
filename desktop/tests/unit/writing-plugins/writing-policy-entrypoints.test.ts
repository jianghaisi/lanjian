import assert from 'node:assert/strict'
import test from 'node:test'
import { officialCreativePackages } from '@lanjian/writing-plugin-package/official'
import type { CreativePackage, CreativeSlot, PluginComposition } from '@lanjian/writing-plugin-contracts'
import { creativePolicyRun, type CreativePolicyRun } from '../../../src/main/modules/writing-plugins/domain/creative-policy'
import { WritingAgentService } from '../../../src/main/modules/assistant/application/writing-agent-service'
import { ChapterDraftService, parseAdherenceReview } from '../../../src/main/modules/manuscript/application/chapter-draft-service'
import type { WritingAgentRequest, WritingAgentSkillId } from '../../../src/contracts/index'

const sentinel = Error('capture only: never return generated prose')
const budget = { version: 1, inputBudgetTokens: 120000, modelContextLimit: 150000, outputReservePercent: 25, systemReserveTokens: 10000, structuredRepairAttempts: 1 }
const outline = '进入状态：校对资料\n1. 核对当前资料\n退出状态：校对完毕\n允许扩写：已确认资料'
const version = { fingerprint: 'confirmed-fixture', totalFingerprint: 'total', outlineHash: 'outline', eventIds: [], confirmedAt: '2026-10-12T00:00:00Z' }
function policy(marker = 'PERSONAL', disabled?: CreativeSlot) {
  const pkg: CreativePackage = structuredClone(officialCreativePackages().find(p => p.manifest.id.endsWith('creative-writing'))!)
  pkg.manifest.id = 'personal.writing-methods'; pkg.digest = 'a'.repeat(64)
  const files = new Map(pkg.files); pkg.files = files
  for (const c of pkg.manifest.contributions ?? []) if (c.kind === 'creative-policy') {
    files.set(c.asset!, `${marker}_${c.slot}_ONLY`)
    if (c.slot === disabled) { c.mode = 'disabled'; delete c.asset }
  }
  const composition: PluginComposition = { revision: 7, entries: (pkg.manifest.contributions ?? []).map(c => ({ pluginId: pkg.manifest.id, digest: pkg.digest, contributionId: c.id, params: {} })) }
  return creativePolicyRun([pkg], composition)
}
function fixture(capturedPolicy: () => Promise<CreativePolicyRun> = async () => policy()) {
  const calls: Array<{ instruction: string; context: string; task: string }> = []
  let response: string | undefined, ready = true, contractFingerprint = version.fingerprint
  const ai = { modelFor: async () => 'frozen-model', complete: async (instruction: string, _draft: string, context: string, task: string) => {
    calls.push({ instruction, context, task }); if (response === undefined) throw sentinel; return { content: response }
  } }
  const projects = { currentSummary: async () => ({ id: 'book-a', path: 'C:/isolated/book-a' }), currentPath: async () => 'C:/isolated/book-a' }
  const documents = { chapter: async () => ({ id: 1, position: 1 }), chapterOutline: async () => ({ content: outline }) }
  const workspace = {
    foundationStatus: async () => ({ readyForProse: ready, missing: ready ? [] : ['当前总纲/卷纲/章纲尚未确认'] }),
    chapterEvents: async () => [], chapterContractVersion: async () => ({ ...version, fingerprint: contractFingerprint }),
    bookProfile: async () => ({ genre: '仙侠', subgenre: '', targetWordsPerChapter: 300, proseExpansionMode: 'compact', reviewStrictness: 'balanced' }),
    promptContext: async (_id: number, _task: string, options: { policyManaged?: boolean }) => { assert.equal(options.policyManaged, true); return 'AUTHOR_OVERRIDE\n正式事实：当前人物\n境界定义：自定义层级\n系统模板：[属性]' },
    promptContextCandidates: async (_id: number, _task: string, options: { policyManaged?: boolean }) => { assert.equal(options.policyManaged, true); return [{ id: 'formal', sourceId: 'formal', sourceType: 'formal-fixture', label: '正式依据与作者要求', content: 'AUTHOR_OVERRIDE\n正式事实：当前人物', authority: 'required', truncationPolicy: 'never' }] },
    contextBudgetPreferences: async () => budget, currentChapterCardFingerprint: async () => 'card', currentWorldbookFingerprint: async () => null,
    contextFactPack: async () => ({ evidence: [] }), consistencyOverview: async () => ({ items: [] })
  }
  const drafts = new ChapterDraftService(ai as never, documents as never, workspace as never, capturedPolicy)
  const agent = new WritingAgentService(ai as never, projects as never, documents as never, workspace as never, drafts, undefined, undefined, capturedPolicy)
  const input = (skill: WritingAgentSkillId): WritingAgentRequest => ({ chapterId: 1, message: '作者本次要求', currentDraft: '', preferredSkill: skill,
    ...(['rewrite', 'expand', 'compress', 'custom', 'polish'].includes(skill) ? { selection: { start: 0, end: 4, text: '已存原文' }, currentDraft: '已存原文' } : {}) })
  return { ai, workspace, calls, drafts, agent, input, setResponse: (text: string) => { response = text }, setReady: (value: boolean) => { ready = value }, changeContract: () => { contractFingerprint = 'changed' } }
}

test('direct prose captures the selected asset then aborts without prose; missing later review and author confirmation send nothing', async () => {
  let captures = 0
  const f = fixture(async () => { captures++; return policy() })
  await assert.rejects(f.drafts.draft(1, 'AUTHOR_REQUEST'), error => error === sentinel)
  assert.equal(captures, 1); assert.equal(f.calls.length, 1)
  assert.match(f.calls[0].instruction, /PERSONAL_prose_ONLY/); assert.match(f.calls[0].instruction, /本次扩写方式：compact/)
  assert.match(f.calls[0].instruction, /AUTHOR_REQUEST/); assert.match(f.calls[0].context, /AUTHOR_OVERRIDE/)
  assert.match(f.calls[0].context, /自定义层级/); assert.match(f.calls[0].context, /系统模板/)
  assert.doesNotMatch(f.calls[0].instruction, /一个段落只承载一个主要动作|按网络小说节奏充分展开|明显扩充篇幅/)
  const missing = fixture(async () => policy('PERSONAL', 'review'))
  await assert.rejects(missing.drafts.draft(1, ''), { code: 'FEATURE_UNAVAILABLE' }); assert.equal(missing.calls.length, 0)
  f.calls.length = 0; f.setReady(false)
  await assert.rejects(f.drafts.draft(1, ''), /当前总纲/); assert.equal(f.calls.length, 0)
})

test('all selected prose operations consume the replacement method and never return a test sample', async () => {
  const f = fixture()
  for (const skill of ['rewrite', 'expand', 'compress', 'custom', 'polish'] as const) {
    await assert.rejects(f.agent.run(f.input(skill)), error => error === sentinel)
    const call = f.calls.at(-1)!
    assert.match(call.instruction, /PERSONAL_selection-revision_ONLY/); assert.match(call.instruction, /作者本次要求/)
    assert.doesNotMatch(call.instruction, /明显扩充篇幅|明显缩短篇幅|重点改善措辞|一个段落只承载一个主要动作/)
    assert.doesNotMatch(call.context, /PERSONAL_selection-revision_ONLY/)
  }
  f.calls.length = 0; f.setReady(false)
  await assert.rejects(f.agent.run(f.input('rewrite')), { code: 'VALIDATION_ERROR' }); assert.equal(f.calls.length, 0)
})

test('prepared methods are required, budgeted, hashed and fixed; a serialized handle cannot grant policy access', async () => {
  let current = policy('FIRST'), captures = 0
  const f = fixture(async () => { captures++; return current })
  const input = f.input('query'), prepared = await f.agent.prepare(input)
  const method = prepared.contexts.find(c => c.sourceType === 'creative-policy')!
  assert.match(method.content, /FIRST_work-query_ONLY/); assert.match(method.content, /personal.writing-methods/)
  assert.equal(method.authority, 'required'); assert.ok(method.estimatedTokens! > 0)
  current = policy('SECOND')
  await assert.rejects(f.agent.run(input, undefined, prepared), error => error === sentinel)
  assert.equal(captures, 1); assert.match(f.calls[0].instruction, /FIRST_work-query_ONLY/); assert.doesNotMatch(f.calls[0].instruction, /SECOND/)
  const next = await f.agent.prepare(input)
  assert.notEqual(next.contextCompilation.contentHash, prepared.contextCompilation.contentHash)
  await assert.rejects(f.agent.prepare({ ...input, contextSelection: { pinnedIds: [], excludedIds: [method.id!], temporaryAdditions: [] } }), /不能移除/)
  await assert.rejects(f.agent.run(input, undefined, structuredClone(next)), { code: 'CONFLICT' })
  assert.equal(f.calls.length, 1)
})

test('agent continuation carries one policy into the real draft and rejects disabled review before any prose', async () => {
  let captures = 0
  const f = fixture(async () => { captures++; return policy() })
  const prepared = await f.agent.prepare(f.input('continue'))
  await assert.rejects(f.agent.run(f.input('continue'), undefined, prepared), error => error === sentinel)
  assert.equal(captures, 1); assert.equal(f.calls.length, 1); assert.match(f.calls[0].instruction, /PERSONAL_prose_ONLY/)
  assert.doesNotMatch(f.calls[0].context, /PERSONAL_prose_ONLY|PERSONAL_review_ONLY/)
  const missing = fixture(async () => policy('PERSONAL', 'review'))
  await assert.rejects(missing.agent.prepare(missing.input('continue')), { code: 'FEATURE_UNAVAILABLE' }); assert.equal(missing.calls.length, 0)
})

test('read-only review, query and repaired card discussion use selected assets and discard late revoked output', async () => {
  let enabled = true
  const run = policy(), guarded = { ...run, assertAuthorized: async () => { if (!enabled) throw Error('withdrawn') } }
  const f = fixture(async () => guarded)
  for (const [skill, slot] of [['review', 'review'], ['query', 'work-query'], ['plan', 'chapter-discussion']] as const) {
    f.setResponse(skill === 'plan' ? '{"answer":"比较两种安排","options":[{"title":"核对资料","rationale":"保留正式依据","goal":"核对当前资料"}]}' : '本次检索未找到足够依据。')
    const turn = await f.agent.run(f.input(skill)); assert.equal(turn.candidate, undefined)
    assert.match(f.calls.at(-1)!.instruction, new RegExp(`PERSONAL_${slot}_ONLY`))
  }
  const prepared = await f.agent.prepare(f.input('query'))
  const original = f.ai.complete
  f.ai.complete = async (...args) => { const result = await original(...args); enabled = false; return result }
  await assert.rejects(f.agent.run(f.input('query'), undefined, prepared), /withdrawn/)
  const sends = f.calls.length
  await assert.rejects(f.agent.run(f.input('query'), undefined, prepared), /withdrawn/); assert.equal(f.calls.length, sends)
})

test('read-only stream withdrawal blocks late fragments before delivery', async () => {
  let enabled = true, delivered = 0
  const run = policy(), f = fixture(async () => ({ ...run, assertAuthorized: async () => { if (!enabled) throw Error('withdrawn') } }))
  ;(f.ai as typeof f.ai & { streamComplete: (...args: unknown[]) => Promise<never> }).streamComplete = async (...args) => {
    enabled = false; await (args[6] as (delta: string, content: string) => Promise<void>)('迟到只读结果', '迟到只读结果'); throw sentinel
  }
  await assert.rejects(f.agent.run(f.input('query'), undefined, undefined, () => { delivered++ }), /withdrawn/)
  assert.equal(delivered, 0)
})

test('selected prose cannot deliver a fragment after the confirmed contract changes; no prose is returned', async () => {
  let delivered = 0
  const f = fixture()
  ;(f.ai as typeof f.ai & { streamComplete: (...args: unknown[]) => Promise<never> }).streamComplete = async (...args) => {
    f.changeContract(); await (args[6] as (delta: string, content: string) => Promise<void>)('', ''); throw sentinel
  }
  await assert.rejects(f.agent.run(f.input('rewrite'), undefined, undefined, () => { delivered++ }), { code: 'CONFLICT' })
  assert.equal(delivered, 0)
})

test('card schema repair retains the same policy, source parameters and model without recapture', async () => {
  let captures = 0, sends = 0
  const f = fixture(async () => { captures++; return policy() }), original = f.ai.complete
  f.ai.complete = async (...args) => {
    f.setResponse(++sends === 1 ? 'invalid schema' : '{"answer":"仅讨论资料核对","options":[{"title":"校对","rationale":"使用当前依据","goal":"校对资料"}]}')
    return original(...args)
  }
  const turn = await f.agent.run(f.input('plan'))
  assert.equal(captures, 1); assert.equal(sends, 2); assert.equal(turn.candidate, undefined)
  for (const call of f.calls) { assert.match(call.instruction, /PERSONAL_chapter-discussion_ONLY/); assert.match(call.instruction, /"compositionRevision":7/); assert.doesNotMatch(call.instruction, /彼此有明显差异、能够落入当前章卡/)}
})

test('review budget uses actual selected method and rejects old unselected method or method-derived formal facts', async () => {
  const f = fixture(), short = await f.drafts.reviewInputReserve(1, '', 100)
  const longer = fixture(async () => {
    const run = policy(); return { resolve: (slot, params) => run.resolve(slot, params).map(s => ({ ...s, text: s.text + '方法加长'.repeat(400) })) }
  })
  assert.ok(await longer.drafts.reviewInputReserve(1, '', 100) > short + 500)
  const contract = { chapterId: 1, chapterPosition: 1, outlineSnapshot: outline, entryState: '校对资料', exitState: '校对完毕', allowedFacts: ['已确认资料'], forbiddenEvents: [], beats: [{ id: 'B1', order: 1, requirement: '核对当前资料' }], foreshadowActions: [], version }
  const candidate = '已存待核原句', finding = { category: 'character-voice', severity: 'blocking', candidateQuote: candidate, sourceQuote: '人物在当前场景有自己的即时目标', reason: '测试引用旧未选方法', correction: '由作者核对' }
  const report = { passed: true, beats: [{ id: 'B1', status: 'covered', evidence: candidate }], boundary: { entryRespected: true, exitReached: true }, literaryFindings: [finding] }
  assert.ok(parseAdherenceReview(JSON.stringify(report), contract, candidate, '正式依据', 'PERSONAL_review_ONLY').violations.includes('审校报告格式无效'))
  const selected = parseAdherenceReview(JSON.stringify({ ...report, literaryFindings: [{ ...finding, sourceQuote: 'PERSONAL_review_ONLY' }] }), contract, candidate, '正式依据', 'PERSONAL_review_ONLY')
  assert.equal(selected.passed, false); assert.ok(!selected.violations.includes('审校报告格式无效'))
  const facts = { ...report, literaryFindings: [], factClaims: [{ claim: '政策声称的虚构事实', evidence: candidate, status: 'supported', supportEvidence: 'PERSONAL_review_ONLY' }] }
  assert.ok(parseAdherenceReview(JSON.stringify(facts), contract, candidate, '正式依据', 'PERSONAL_review_ONLY').introducedFacts.length)
})
