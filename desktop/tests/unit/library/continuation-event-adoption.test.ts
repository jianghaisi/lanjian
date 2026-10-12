import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test, { type TestContext } from 'node:test'
import { AppError } from '../../../src/main/core/errors/app-error'
import { ContinuationAnalysisService } from '../../../src/main/modules/library/application/continuation-analysis-service'

const stamp = '2026-09-20T12:00:00.000Z'
const sourceFingerprint = 'a'.repeat(64)

async function fixture(t: TestContext, loseResponse = false) {
  const parent = tmpdir(), root = await mkdtemp(join(parent, 'lanjian-continuation-event-'))
  t.after(async () => {
    assert.equal(dirname(root), parent)
    assert.ok(root.startsWith(join(parent, 'lanjian-continuation-event-')))
    await rm(root, { recursive: true, force: true })
  })
  const candidate = {
    version: 1 as const, id: 'candidate-one', workItemId: 'work-one', manifestId: 'manifest-one', sourceFingerprint,
    createdAt: stamp, updatedAt: stamp, status: 'candidate' as const,
    sections: ['projectDefinition', 'existingPlot', 'characters', 'worldView', 'powerSystem', 'cheatSystem', 'totalOutline', 'volumeOutline', 'chapterOutline'].map(area => ({
      area, status: 'found', content: area === 'existingPlot' ? '林舟已经在古城找到第一条线索。' : `${area}候选`,
      evidence: area === 'existingPlot' ? [{ fileName: '第一卷.txt', excerpt: '林舟在古城找到第一条线索' }] : [{ fileName: '第一卷.txt', excerpt: '正文' }]
    })),
    gaps: [], rationale: '候选'
  }
  const candidatePath = join(root, '.webnovel', 'imports', 'continuation-analysis-candidate.json')
  await mkdir(dirname(candidatePath), { recursive: true })
  await writeFile(candidatePath, JSON.stringify(candidate), 'utf8')
  let approvedRevision = 'b'.repeat(64), receipt: any = null, pendingInput: any = null, eventCount = 0
  const approved: any[] = []
  const events = {
    projection: { read: async () => ({ approvedRevision, state: { order: { id: 'order-one' } }, approved }) },
    operations: {
      previewVerifiedManuscript: async (input: any) => {
        pendingInput = input
        return { token: 'token-one', operationId: 'operation-one', requestHash: 'c'.repeat(64), kind: 'create', expiresAt: Date.now() + 1_000 }
      },
      commitVerifiedManuscript: async (_token: string, verify: () => Promise<void>) => {
        await verify()
        eventCount++
        receipt = { operationId: 'operation-one', kind: 'create', requestHash: 'c'.repeat(64), eventId: 'event-one',
          versionId: 'version-one', lifecycleId: 'lifecycle-one', orderId: 'order-two', noOp: false, committedAt: stamp }
        approved.splice(0, approved.length, { eventId: 'event-one', versionId: 'version-one', version: 1,
          content: pendingInput.content, granularity: 'macro', phase: 'realized', creator: 'manuscript-extraction',
          sources: [{ source: { kind: 'manuscript', id: 'chapter-internal', revision: 'body-one' }, relation: 'derived-from' }], createdAt: stamp })
        approvedRevision = 'd'.repeat(64)
        if (loseResponse) throw new AppError('STORAGE_ERROR', 'simulated lost response', { recoverable: true })
        return { receipt, mirror: { status: 'synced' } }
      },
      receipt: async () => receipt
    }
  }
  const service = () => new ContinuationAnalysisService(
    { complete: async () => ({ content: '' }) },
    { currentPath: async () => root, currentSummary: async () => ({ id: 'work-one', path: root }) } as any,
    { latestCompletedManifestId: async () => 'manifest-one', completedManifestEvidence: async () => ({
      id: 'manifest-one', sourceFingerprint, files: [{ fileName: '第一卷.txt', ownership: 'owned', title: '第一卷',
        content: '正文。林舟在古城找到第一条线索。', chapters: [{ id: 1, content: '林舟在古城找到第一条线索。', bodyVersionId: 'body-one' }] }]
    }) } as any,
    {} as any, {} as any, {} as any, events as any
  )
  return { root, candidate, service, events, eventCount: () => eventCount }
}

test('existing plot adoption records one recoverable unified event receipt', async t => {
  const f = await fixture(t), service = f.service()
  const preview = await service.previewExistingPlot(f.candidate.id)
  const result = await service.adoptExistingPlot({ candidateId: f.candidate.id, candidateFingerprint: preview.candidateFingerprint,
    currentTimelineFingerprint: preview.currentTimelineFingerprint,
    event: { time: '第一夜', characters: '林舟', location: '古城', event: '林舟找到第一条线索。' } })
  const adoption = result.candidate.adoption!.existingPlot![0]!
  assert.equal(result.event.id, 'event-one')
  assert.equal(adoption.operationId, 'operation-one')
  assert.equal(adoption.eventVersionId, 'version-one')
  assert.equal(adoption.sourceManifestId, 'manifest-one')
  assert.equal(adoption.sourceFingerprint, sourceFingerprint)
  assert.equal(f.eventCount(), 1)
  await assert.rejects(readFile(join(f.root, '.webnovel', 'imports', 'continuation-existing-plot-pending.json')), { code: 'ENOENT' })
})

test('lost adoption response is finalized from the durable receipt after restart without duplicate creation', async t => {
  const f = await fixture(t, true), service = f.service()
  const preview = await service.previewExistingPlot(f.candidate.id)
  await assert.rejects(service.adoptExistingPlot({ candidateId: f.candidate.id, candidateFingerprint: preview.candidateFingerprint,
    currentTimelineFingerprint: preview.currentTimelineFingerprint,
    event: { time: '第一夜', characters: '林舟', location: '古城', event: '林舟找到第一条线索。' } }), { code: 'STORAGE_ERROR' })
  assert.equal(f.eventCount(), 1)
  const recovered = await f.service().state()
  assert.equal(recovered.candidate?.adoption?.existingPlot?.[0]?.operationId, 'operation-one')
  assert.equal(f.eventCount(), 1)
  const next = await f.service().previewExistingPlot(f.candidate.id)
  assert.equal(next.canAdopt, false)
  assert.match(next.reason || '', /已经确认过/)
})
