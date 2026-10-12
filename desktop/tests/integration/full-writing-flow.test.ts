import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { BookProfile } from '../../src/contracts/index'
import { assistantFieldCatalog } from '../../src/contracts/assistant/assistant-field-catalog'
import { decodeBookProfileArgs } from '../../src/contracts/ipc'
import { unwrapValidatedIpcResponse } from '../../src/contracts/core/ipc-response'
import { ChapterDraftService } from '../../src/main/modules/manuscript/application/chapter-draft-service'
import { ProjectService } from '../../src/main/modules/library/application/project-service'
import { SettingsStore } from '../../src/main/platform/settings/settings-store'
import { WorkspaceService } from '../../src/main/modules/library/application/workspace-service'

const codec = {
  available: () => true,
  encrypt: (value: string) => Buffer.from(value).toString('base64'),
  decrypt: (value: string) => Buffer.from(value, 'base64').toString()
}

test('new and legacy file profiles expose reviewed without read-time mode migration', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-full-flow-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const projects = new ProjectService(new SettingsStore(join(root, 'user-data'), codec))
  const { project } = await projects.create({ parentPath: root, name: '完整流程测试', genre: '玄幻' })
  const workspace = new WorkspaceService(projects)
  const initial = await workspace.bookProfile()
  assert.equal(initial.chapterGenerationMode, 'reviewed')
  const path = join(project.path, '.webnovel', 'config', 'book-profile.json')
  for (const mode of ['fast', undefined] as const) {
    const raw = JSON.stringify({ ...initial, chapterGenerationMode: mode, legacyExtension: { keep: true } })
    await writeFile(path, raw, 'utf8')
    const profile = await workspace.bookProfile()
    assert.equal(profile.chapterGenerationMode, 'reviewed')
    assert.equal((await workspace.bookProfile()).chapterGenerationMode, 'reviewed')
    assert.equal(await readFile(path, 'utf8'), raw)
    assert.equal(decodeBookProfileArgs([{ ...profile, chapterGenerationMode: undefined }])[0].chapterGenerationMode, 'reviewed')
    for (const invalid of ['fast', null, '', 'turbo', 1, false]) {
      const input = { ...profile, chapterGenerationMode: invalid }
      assert.throws(() => decodeBookProfileArgs([input]))
      await assert.rejects(workspace.saveBookProfile(input as BookProfile), { code: 'VALIDATION_ERROR' })
      assert.equal(await readFile(path, 'utf8'), raw)
    }
    assert.deepEqual(unwrapValidatedIpcResponse('workspace:get-book-profile', { ok: true, value: profile }), profile)
    assert.throws(() => unwrapValidatedIpcResponse('workspace:get-book-profile', {
      ok: true, value: { ...profile, chapterGenerationMode: 'fast' }
    }))
    await workspace.saveBookProfile(profile)
    const stored = JSON.parse(await readFile(path, 'utf8'))
    assert.equal(stored.chapterGenerationMode, 'reviewed')
    assert.deepEqual(stored.legacyExtension, { keep: true })
  }
  assert.equal(assistantFieldCatalog['AppShell.bookProfile.chapterGenerationMode'], undefined)
})

test('direct fast saves are rejected before project access', async () => {
  const workspace = new WorkspaceService({ currentPath: async () => assert.fail('must not read project') } as never)
  await assert.rejects(workspace.saveBookProfile({ chapterGenerationMode: 'fast' } as BookProfile), { code: 'VALIDATION_ERROR' })
})

const prose = Array.from({ length: 25 }, () => '沈砚在城门外发现脚印，沿着雨水留下的痕迹走到酒馆门前。').join('\n\n')
const validReview = JSON.stringify({
  summary: '按序完成本章节点', passed: true,
  beats: [{ id: 'B1', status: 'covered', evidence: '城门外发现脚印' }, { id: 'B2', status: 'covered', evidence: '走到酒馆门前' }],
  boundary: { entryRespected: true, exitReached: true, evidence: '沈砚在城门外发现脚印，沿着雨水留下的痕迹走到酒馆门前。' },
  violations: [], introducedFacts: [], characterChanges: [], characterConflicts: [], literaryFindings: []
})

function draftFixture(mode: 'fast' | 'reviewed' | undefined, options: {
  review?: () => Promise<{ content: string }>; ready?: boolean; prose?: string
  onRoute?: (task: string, model?: string, connection?: string) => void
  contractFingerprints?: string[]
  events?: Array<{ id: string; time: string; characters: string[]; location: string; event: string; versionId?: string; phase?: 'planned' | 'realized' }>
  eventVersions?: Array<{ eventId: string; versionId: string; phase: 'planned' | 'realized' }>
} = {}) {
  const calls: string[] = []
  const contexts: string[] = []
  const ai = {
    complete: async (_instruction: string, _draft: string, context: string, task: string, _signal?: unknown, model?: string, connection?: string) => {
      calls.push(task)
      options.onRoute?.(task, model, connection)
      assert.equal(context, `${task}-完整上下文`)
      return task === 'review' ? options.review?.() ?? { content: validReview } : { content: options.prose ?? prose }
    },
    streamComplete: async (_instruction: string, _draft: string, context: string, task: string, _signal: unknown, _model: unknown, onDelta: (delta: string, content: string) => Promise<void>) => {
      calls.push(`${task}:stream`)
      assert.equal(context, 'prose-完整上下文')
      await onDelta(prose, prose)
      return { content: prose }
    }
  }
  let contractReads = 0
  const workspace = {
    foundationStatus: async () => ({ readyForProse: options.ready ?? true, missing: ['已确认章纲'] }),
    chapterEvents: async () => options.events ?? [],
    chapterContractVersion: async () => ({
      fingerprint: options.contractFingerprints?.[Math.min(contractReads++, options.contractFingerprints.length - 1)] ?? 'contract',
      totalFingerprint: 'total', outlineHash: 'outline', eventIds: (options.events ?? []).map((event) => event.id),
      ...(options.eventVersions ? { eventVersions: options.eventVersions } : {}),
      confirmedAt: '2026-09-12T00:00:00.000Z'
    }),
    bookProfile: async () => ({ chapterGenerationMode: mode, targetWordsPerChapter: 300, proseExpansionMode: 'web-serial', reviewStrictness: 'balanced' }),
    promptContext: async (_id: number, task: string, options?: unknown) => {
      assert.deepEqual(options, { policyManaged: true }, 'full context retains author/formal facts without reinjecting the replaced default method')
      contexts.push(task)
      return `${task}-完整上下文`
    },
    contextBudgetPreferences: async () => ({ structuredRepairAttempts: 0 })
  }
  const documents = {
    chapterOutline: async () => ({ content: '进入状态：沈砚在城门外，尚未发现线索\n1. 城门外发现脚印\n2. 沿着脚印追到酒馆\n退出状态：沈砚走到酒馆门前，尚未进门\n允许扩写：对白；动作；环境' }),
    chapter: async () => ({ id: 1, position: 1 })
  }
  return { draft: new ChapterDraftService(ai as never, documents as never, workspace as never), calls, contexts }
}

test('a frozen prose model does not leak to the separate configured review connection', async () => {
  for (const connection of [undefined, 'selected-paired-provider']) {
    const routes: unknown[] = []
    const fixture = draftFixture('reviewed', { onRoute: (task, model, provider) => routes.push({ task, model, provider }) })
    const result = await fixture.draft.draft(1, '继续写', '', undefined, 'gemini-prose-model', undefined, connection)
    assert.equal(result.report.passed, true)
    assert.deepEqual(routes, [
      { task: 'prose', model: 'gemini-prose-model', provider: connection },
      { task: 'review', model: connection ? 'gemini-prose-model' : undefined, provider: connection }
    ])
  }
})

test('event versions and contract fingerprints are rechecked before model execution', async () => {
  const event = { id: 'event-1', time: '第一幕', characters: ['沈砚'], location: '旧塔', event: '取得密信', versionId: 'version-2', phase: 'planned' as const }
  const mismatched = draftFixture('reviewed', { events: [event], eventVersions: [{ eventId: 'event-1', versionId: 'version-1', phase: 'planned' }] })
  await assert.rejects(mismatched.draft.draft(1, '继续写'), { code: 'CONFLICT' })
  assert.deepEqual(mismatched.calls, [])

  const changed = draftFixture('reviewed', { events: [event], eventVersions: [{ eventId: 'event-1', versionId: 'version-2', phase: 'planned' }], contractFingerprints: ['contract', 'changed'] })
  await assert.rejects(changed.draft.draft(1, '继续写'), { code: 'CONFLICT' })
  assert.deepEqual(changed.calls, [])
})

for (const mode of ['fast', 'reviewed', undefined] as const) {
  test(`draft mode ${String(mode)} requires actual full review`, async () => {
    const fixture = draftFixture(mode)
    const proposal = await fixture.draft.draft(1, '继续写')
    assert.deepEqual(fixture.calls, ['prose', 'review'])
    assert.deepEqual(fixture.contexts, ['prose', 'review'])
    assert.equal(proposal.report.reviewMode, 'full')
    assert.equal(proposal.report.passed, true)
    assert.equal(proposal.report.summary, '按序完成本章节点')
  })
}

test('review network and malformed-response failures never return a fast candidate', async () => {
  for (const review of [
    async () => { throw new Error('review unavailable') },
    async () => ({ content: '这份正文看起来没有问题。' })
  ]) {
    const fixture = draftFixture('fast', { review })
    await assert.rejects(fixture.draft.draft(1, '继续写'))
    assert.deepEqual(fixture.calls, ['prose', 'review'])
  }
})

test('review rejection and local completeness failure remain failed full reports', async () => {
  const failed = JSON.parse(validReview)
  failed.passed = false
  failed.violations = ['未遵守当前章纲的事实边界']
  for (const fixture of [draftFixture('fast', { review: async () => ({ content: JSON.stringify(failed) }) }), draftFixture('fast', { prose: '沈砚走到酒馆门前。' })]) {
    const proposal = await fixture.draft.draft(1, '继续写')
    assert.equal(proposal.report.reviewMode, 'full')
    assert.equal(proposal.report.passed, false)
    assert.ok(proposal.report.violations.length > 0)
  }
})

test('streamed prose remains subject to full review after deltas arrive', async () => {
  const fixture = draftFixture('fast')
  const deltas: string[] = []
  const proposal = await fixture.draft.draft(1, '继续写', '', undefined, undefined, {
    onDelta: async (delta) => { deltas.push(delta) }
  })
  assert.deepEqual(deltas, [prose])
  assert.deepEqual(fixture.calls, ['prose:stream', 'review'])
  assert.equal(proposal.report.reviewMode, 'full')
})

test('unready foundation and cancellation prevent generation without a shortcut', async () => {
  const unready = draftFixture('fast', { ready: false })
  await assert.rejects(unready.draft.draft(1, '继续写'), /已确认章纲/)
  assert.deepEqual(unready.calls, [])
  const cancelled = draftFixture('fast')
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(cancelled.draft.draft(1, '继续写', '', controller.signal), { name: 'AbortError' })
  assert.deepEqual(cancelled.calls, [])
})
