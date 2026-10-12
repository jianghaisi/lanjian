import assert from 'node:assert/strict'
import test from 'node:test'
import type { IpcResponse } from '../../src/contracts/index'
import { unwrapValidatedIpcResponse } from '../../src/contracts/core/ipc-response'
import { decodeEventMaterialCandidatePreviewArgs, decodeEventMigrationPageArgs, decodeEventMigrationReviewArgs,
  decodeEventModelCandidateGenerationArgs, decodeEventModelCandidatePreviewArgs, decodeEventOperationPreviewArgs,
  decodeEventOperationReceiptArgs, decodeEventOperationTokenArgs, decodeOptionalEventOperationIdArgs } from '../../src/contracts/timeline/ipc'
import { registerValidatedIpc } from '../../src/main/platform/ipc/validated-ipc'

const hash = 'a'.repeat(64)
const otherHash = 'b'.repeat(64)
const timestamp = '2026-09-20T10:00:00.000Z'
const migrationOperationId = '11111111-2222-4333-8444-555555555555:1'
const operationId = '22222222-3333-4444-8555-666666666666:1'
const tokenId = '33333333-4444-4555-8666-777777777777:2'
const content = { time: '第二夜', characters: ['林舟'], location: '古城', event: '寻找线索', evidenceRefs: [], confidence: 1 }
const projected = {
  eventId: 'event-one', versionId: 'version-one', version: 1, content,
  granularity: 'macro', phase: 'planned', creator: 'author', sources: [], createdAt: timestamp
}
const lifecycle = {
  id: 'life-one', eventId: 'event-one', revision: 1, expectedEventVersionId: 'version-one', state: 'active', createdAt: timestamp
}
const projection = {
  version: 1, workItemId: 'book-one', revision: hash, approvedRevision: otherHash, candidateRevision: hash,
  operationId: migrationOperationId, committedAt: timestamp, ordering: 'author-display',
  state: { order: { id: 'order-one', revision: 1, eventIds: ['event-one'], contentHash: hash, createdAt: timestamp }, lifecycles: [lifecycle] },
  approved: [projected], candidates: [], archived: [], mirror: { status: 'synced', issue: 'none' }
}
const receipt = {
  operationId, kind: 'create', requestHash: hash, eventId: 'event-one', versionId: 'version-one',
  lifecycleId: 'life-one', orderId: 'order-two', noOp: false, committedAt: timestamp
}
const migrationReceipt = {
  operationId: migrationOperationId, projectId: 'book-project', sourceFingerprint: hash, decisionFingerprint: otherHash,
  committedAt: timestamp, mappingCount: 1, sourceCounts: { sources: 0, events: 0, timeline: 1 }
}

function harness<T>(decode: (args: unknown[]) => unknown[], listener: (...args: unknown[]) => T | Promise<T>) {
  let handler: ((_event: unknown, ...args: unknown[]) => Promise<IpcResponse<T>>) | undefined
  registerValidatedIpc({ handle: (_channel, value) => { handler = value as typeof handler } }, 'events:test', decode, listener)
  return (...args: unknown[]) => handler!({}, ...args)
}

test('event operation intents are narrow, bounded and cannot smuggle authority across IPC', async () => {
  const preview = harness(decodeEventOperationPreviewArgs, value => value)
  const create = { kind: 'create', expectedOrderId: 'order-one', content, granularity: 'macro' }
  assert.deepEqual((await preview(create)).ok, true)
  assert.deepEqual((await preview({ kind: 'edit', expectedOrderId: 'order-one', eventId: 'event-one',
    expectedVersionId: 'version-one', expectedLifecycleId: 'life-one', content, granularity: 'legacy-unknown' })).ok, true)
  assert.deepEqual((await preview({ kind: 'adopt', expectedOrderId: 'order-one', eventId: 'event-one',
    expectedVersionId: 'version-two', expectedLifecycleId: 'life-one' })).ok, true)

  for (const value of [
    { ...create, status: 'approved' },
    { ...create, creator: 'author' },
    { ...create, content: { ...content, sources: [] } },
    { kind: 'adopt', expectedOrderId: 'order-one', eventId: 'event-one', expectedVersionId: 'version-two', expectedLifecycleId: 'life-one', content },
    { kind: 'reorder', expectedOrderId: 'order-one', eventIds: ['event-one', 'event-one'] },
    { ...create, content: { ...content, characters: [] } }
  ]) {
    const response = await preview(value)
    assert.equal(response.ok, false)
    if (!response.ok) assert.equal(response.error.code, 'VALIDATION_ERROR')
  }
  assert.equal((await preview(create, 'extra')).ok, false)
})

test('material candidate preview accepts only bounded author content and one stored source identity', async () => {
  const preview = harness(decodeEventMaterialCandidatePreviewArgs, value => value)
  const input = { expectedOrderId: 'order-one', sourceId: 'source-one', time: '第三夜', characters: ['林舟'],
    location: '旧钟楼', event: '听见第十三声钟响', result: '决定查阅地方志' }
  assert.equal((await preview(input)).ok, true)
  for (const value of [
    { ...input, status: 'approved' },
    { ...input, sourceRevision: hash },
    { ...input, characters: [] },
    { ...input, event: '' }
  ]) {
    const response = await preview(value)
    assert.equal(response.ok, false)
    if (!response.ok) assert.equal(response.error.code, 'VALIDATION_ERROR')
  }
})

test('model candidate generation and selection expose context and Artifact identities without authority fields', async () => {
  const generate = harness(decodeEventModelCandidateGenerationArgs, value => value)
  const preview = harness(decodeEventModelCandidatePreviewArgs, value => value)
  const input = { operationId: 'generation-one', context: { title: '旧城疑案', genre: '悬疑', subgenre: '', coreIdea: '追查旧案',
    plannedVolumes: 3, chaptersPerVolume: 20, targetWordsPerChapter: 3000, materials: '', worldView: '旧城',
    totalOutline: '钟楼旧案贯穿全书', existingEvents: '第一夜｜敲门' } }
  assert.equal((await generate(input)).ok, true)
  assert.equal((await preview({ expectedOrderId: 'order-one', taskId: 'task-model', artifactId: 'artifact-model', candidateIndex: 0 })).ok, true)
  for (const response of [
    await generate({ ...input, model: 'forged-model' }),
    await generate({ ...input, context: { ...input.context, existingEvents: 'x'.repeat(6001) } }),
    await preview({ expectedOrderId: 'order-one', taskId: 'task-model', artifactId: 'artifact-model', candidateIndex: 30 }),
    await preview({ expectedOrderId: 'order-one', taskId: 'task-model', artifactId: 'artifact-model', candidateIndex: 0, creator: 'model-candidate' })
  ]) {
    assert.equal(response.ok, false)
    if (!response.ok) assert.equal(response.error.code, 'VALIDATION_ERROR')
  }
})

test('event tokens and operation ids reject controls, paths and extra arguments', async () => {
  const token = harness(decodeEventOperationTokenArgs, value => value)
  const operation = harness(decodeEventOperationReceiptArgs, value => value)
  assert.equal((await token(tokenId)).ok, true)
  assert.equal((await operation(operationId)).ok, true)
  for (const response of [await token('bad\nvalue'), await token(''), await operation('../receipt'), await operation(operationId, 'extra')]) {
    assert.equal(response.ok, false)
    if (!response.ok) assert.equal(response.error.code, 'VALIDATION_ERROR')
  }
})

test('migration paging and all-row review inputs are explicit and bounded', async () => {
  const page = harness(decodeEventMigrationPageArgs, value => value)
  const review = harness(decodeEventMigrationReviewArgs, value => value)
  const optionalReceipt = harness(decodeOptionalEventOperationIdArgs, value => value ?? null)
  assert.equal((await page({ previewId: migrationOperationId, kind: 'rows', offset: 0 })).ok, true)
  assert.equal((await page({ previewId: migrationOperationId, kind: 'group-members', offset: 0, groupId: 2 })).ok, true)
  const decisions = { previewId: migrationOperationId, fingerprint: hash,
    rows: [{ rowIndex: 0, disposition: 'keep-separate' }], acknowledgedGroups: [1],
    acknowledgedPlanningFindings: [], acknowledgedMirrors: ['timeline'] }
  assert.equal((await review(decisions)).ok, true)
  assert.equal((await optionalReceipt()).ok, true)
  assert.equal((await optionalReceipt(migrationOperationId)).ok, true)
  for (const response of [
    await page({ previewId: migrationOperationId, kind: 'rows', offset: 0, groupId: 2 }),
    await page({ previewId: migrationOperationId, kind: 'group-members', offset: 0 }),
    await review({ ...decisions, rows: [...decisions.rows, decisions.rows[0]] }),
    await review({ ...decisions, acknowledgedMirrors: ['timeline', 'timeline'] }),
    await review({ ...decisions, authorApproved: true }),
    await optionalReceipt('../receipt')
  ]) {
    assert.equal(response.ok, false)
    if (!response.ok) assert.equal(response.error.code, 'VALIDATION_ERROR')
  }
})

test('event projection and operation results are deeply validated before renderer use', () => {
  assert.deepEqual(unwrapValidatedIpcResponse('events:projection', { ok: true, value: projection }), projection)
  const preview = { token: tokenId, operationId, kind: 'create', requestHash: hash, expiresAt: 1_800_000 }
  assert.deepEqual(unwrapValidatedIpcResponse('events:operation-preview', { ok: true, value: preview }), preview)
  assert.deepEqual(unwrapValidatedIpcResponse('events:material-candidate-preview', { ok: true, value: preview }), preview)
  assert.deepEqual(unwrapValidatedIpcResponse('events:model-candidate-preview', { ok: true, value: preview }), preview)
  const modelBatch = { operationId: 'generation-one', taskId: 'task-model', artifactId: 'artifact-model', artifactHash: hash,
    model: 'fixture-model', candidates: [{ id: 'task-model:0', candidateIndex: 0, title: '钟楼异响', time: '第三夜',
      characters: '林舟、顾岚', location: '旧钟楼', event: '听见第十三声钟响', result: '确认旧案并未结束' }] }
  assert.deepEqual(unwrapValidatedIpcResponse('events:model-candidates-generate', { ok: true, value: modelBatch }), modelBatch)
  assert.deepEqual(unwrapValidatedIpcResponse('events:operation-commit', {
    ok: true, value: { receipt, mirror: { status: 'pending', issue: 'stale' } }
  }), { receipt, mirror: { status: 'pending', issue: 'stale' } })
  assert.deepEqual(unwrapValidatedIpcResponse('events:operation-receipt', { ok: true, value: receipt }), receipt)
  assert.equal(unwrapValidatedIpcResponse('events:operation-receipt', { ok: true, value: null }), null)
  assert.equal(unwrapValidatedIpcResponse('events:operation-cancel', { ok: true, value: true }), true)

  const migrationPreview = { previewId: migrationOperationId, fingerprint: hash, expiresAt: 1_800_000,
    summary: { rowCount: 1, referenceCount: 0, groupCount: 0, invalidRowCount: 0, blockedRowCount: 0,
      blockingGroupCount: 0, blockedReferenceCount: 0, planningFindingCount: 0, inspectedUnits: 1,
      planningBlockingCount: 0, planningCoverage: 'ledger-and-chapter-identities', authorReviewRequired: true },
    requiredMirrorAcknowledgements: ['timeline'] }
  const row = { index: 0, ref: { source: 'timeline', contentHash: hash, ordinal: 0, originalId: 'old-one' },
    recordCheck: 'valid', recordProblem: null, legacyStatus: 'direct-unconfirmed', proposedCharacters: ['林舟'], groupIds: [],
    defaultDisposition: 'keep-separate' }
  const page = { kind: 'rows', fingerprint: hash, offset: 0, total: 1, nextOffset: null, items: [row] }
  const grant = { token: tokenId, operationId, decisionFingerprint: otherHash, fingerprint: hash,
    expiresAt: 1_800_000, displayOrderRowIndices: [0] }
  assert.deepEqual(unwrapValidatedIpcResponse('events:migration-preview', { ok: true, value: migrationPreview }), migrationPreview)
  assert.deepEqual(unwrapValidatedIpcResponse('events:migration-page', { ok: true, value: page }), page)
  assert.deepEqual(unwrapValidatedIpcResponse('events:migration-review', { ok: true, value: grant }), grant)
  assert.deepEqual(unwrapValidatedIpcResponse('events:migration-commit', { ok: true,
    value: { receipt: migrationReceipt, mirror: { status: 'synced', issue: 'none' } } }),
  { receipt: migrationReceipt, mirror: { status: 'synced', issue: 'none' } })
  assert.deepEqual(unwrapValidatedIpcResponse('events:migration-receipt', { ok: true, value: migrationReceipt }), migrationReceipt)
  assert.equal(unwrapValidatedIpcResponse('events:migration-cancel', { ok: true, value: true }), true)
  const statePreview = { token: tokenId, migrationOperationId, eventCount: 1, orderHash: hash, expiresAt: 1_800_000 }
  const stateResult = { migrationOperationId, eventCount: 1, orderHash: hash }
  assert.deepEqual(unwrapValidatedIpcResponse('events:state-initialization-preview', { ok: true, value: statePreview }), statePreview)
  assert.deepEqual(unwrapValidatedIpcResponse('events:state-initialization-commit', { ok: true, value: stateResult }), stateResult)
  assert.deepEqual(unwrapValidatedIpcResponse('events:mirror-retry', { ok: true, value: { status: 'conflict', issue: 'external-change' } }),
    { status: 'conflict', issue: 'external-change' })

  for (const [channel, value] of [
    ['events:projection', { ...projection, revision: 'short' }],
    ['events:projection', { ...projection, approved: [{ ...projected, creator: 'renderer' }] }],
    ['events:projection', { ...projection, state: { ...projection.state, order: { ...projection.state.order, eventIds: ['event-one', 'event-one'] } } }],
    ['events:projection', { ...projection, mirror: { status: 'synced', issue: 'stale' } }],
    ['events:operation-preview', { ...preview, phase: 'planned' }],
    ['events:material-candidate-preview', { ...preview, sourceId: 'source-one' }],
    ['events:model-candidate-preview', { ...preview, artifactId: 'artifact-model' }],
    ['events:model-candidates-generate', { ...modelBatch, candidates: [{ ...modelBatch.candidates[0], id: 'forged:0' }] }],
    ['events:operation-commit', { receipt, mirror: { status: 'failed', issue: 'none' } }],
    ['events:operation-receipt', { ...receipt, kind: 'reorder' }],
    ['events:operation-cancel', 'true'],
    ['events:migration-preview', { ...migrationPreview, requiredMirrorAcknowledgements: ['timeline', 'timeline'] }],
    ['events:migration-page', { ...page, nextOffset: 1 }],
    ['events:migration-review', { ...grant, displayOrderRowIndices: [0, 0] }],
    ['events:migration-commit', { receipt: { ...migrationReceipt, mappingCount: 2 }, mirror: { status: 'synced', issue: 'none' } }],
    ['events:migration-receipt', { ...migrationReceipt, projectId: '' }],
    ['events:migration-cancel', null],
    ['events:state-initialization-preview', { token: tokenId, migrationOperationId, eventCount: 100_001, orderHash: hash, expiresAt: 1 }],
    ['events:state-initialization-commit', { migrationOperationId, eventCount: 1, orderHash: 'short' }],
    ['events:mirror-retry', { status: 'pending', issue: 'external-change' }]
  ] as const) {
    assert.throws(() => unwrapValidatedIpcResponse(channel, { ok: true, value }), (error: unknown) =>
      (error as { code?: string }).code === 'INTERNAL_ERROR')
  }
})
