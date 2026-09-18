import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { EventMigrationReviewSession } from '../../../src/main/modules/timeline/application/event-migration-review-session'
import { eventMigrationMirrorAcknowledgements, reviewEventMigrationDecisions, type EventMigrationDecisionsInput } from '../../../src/main/modules/timeline/domain/event-migration-decisions'
import { prepareEventMigrationPayloads } from '../../../src/main/modules/timeline/domain/event-migration-payloads'
import { inspectEventMigrationSources, type EventMigrationReviewPage } from '../../../src/main/modules/timeline/domain/event-migration-review'
import { decodeEventSourceDocument, EVENT_SOURCE_KINDS, type EventSourceKind, type EventSourceSnapshot } from '../../../src/main/modules/timeline/domain/event-source-snapshot'
import { storyEventVersionPayload, type StoryEventVersion } from '../../../src/main/modules/timeline/domain/story-event-version'
import { eventSourceFingerprint } from '../../../src/main/modules/timeline/adapters/event-source-snapshot'

const hash = (text: string) => createHash('sha256').update(text).digest('hex')
const stamp = '2026-09-18T08:00:00.000Z'
const direct = { id: 'original', time: '第一夜', characters: '  和田、林与舟；和田  ', location: '旧城', event: '钟响' }
const source = { id: 'material', provider: 'manual', sourceType: 'manual', title: '来源', capturedAt: stamp,
  excerpt: '资料原文', userNotes: '', contentHash: 'a'.repeat(64) }
const canonical = { id: 'canonical', time: '第一夜', characters: ['和田'], location: '旧城', event: '钟响',
  evidenceRefs: [{ sourceId: source.id, excerpt: '资料' }], confidence: 0.75, status: 'candidate' as const, createdAt: stamp }
function freeze<T>(value: T): T {
  const pending: unknown[] = [value]
  while (pending.length) { const next = pending.pop(); if (!next || typeof next !== 'object' || Object.isFrozen(next)) continue
    pending.push(...Object.values(next)); Object.freeze(next) }
  return value
}
function snapshot(values: Partial<Record<EventSourceKind, unknown>>, histories: EventSourceSnapshot['eventHistory'] | null = null): EventSourceSnapshot {
  const documents = {} as EventSourceSnapshot['documents'], files = {} as EventSourceSnapshot['files'], mirrors = {} as EventSourceSnapshot['mirrors']
  for (const kind of EVENT_SOURCE_KINDS) {
    const content = values[kind] === undefined ? null : typeof values[kind] === 'string' ? values[kind] as string : JSON.stringify(values[kind])
    const contentHash = content === null ? null : hash(content)
    documents[kind] = { authority: kind === 'events' && histories ? 'sqlite' : 'file', content, contentHash, revision: null,
      ...decodeEventSourceDocument(kind, content) }
    files[kind] = { base64: content === null ? null : Buffer.from(content).toString('base64'), hash: contentHash,
      byteLength: content === null ? 0 : Buffer.byteLength(content) }; mirrors[kind] = null
  }
  const retained: Omit<EventSourceSnapshot, 'fingerprint'> = { version: 1, scope: { workItemId: 'book', root: 'book-root', generation: 1 },
    database: { projectId: 'project', schemaVersion: 40, storageMode: 'sqlite', hasMigrationEvidence: false }, documents, files, mirrors,
    eventHistory: histories ?? [], chapterCatalog: { manuscripts: 'sqlite', outlines: 'sqlite', entries: [] } }
  return freeze({ ...retained, fingerprint: eventSourceFingerprint(retained) })
}
function all<T>(read: (offset: number) => EventMigrationReviewPage<T>): T[] {
  const result: T[] = []; let offset: number | null = 0
  while (offset !== null) { const page = read(offset); result.push(...page.items); offset = page.nextOffset }
  return result
}
function decisions(retained: EventSourceSnapshot): EventMigrationDecisionsInput {
  const inspection = inspectEventMigrationSources(retained)
  return { fingerprint: retained.fingerprint, rows: all(inspection.rowsPage).map(row => ({ rowIndex: row.index,
    disposition: row.ref.source === 'sources' ? 'retain-source' : 'keep-separate' })),
    acknowledgedGroups: all(inspection.groupsPage).filter(group => group.severity === 'review').map(group => group.id),
    acknowledgedPlanningFindings: all(inspection.planningFindingsPage).flatMap((finding, index) => finding.severity === 'review' ? [index] : []),
    acknowledgedMirrors: [...eventMigrationMirrorAcknowledgements(retained)] }
}
function convert(retained: EventSourceSnapshot, input = decisions(retained)) {
  return prepareEventMigrationPayloads(retained, reviewEventMigrationDecisions(retained, input))
}
function historyRecord(): StoryEventVersion {
  const payload = storyEventVersionPayload({ content: canonical, status: canonical.status,
    phase: 'legacy-unknown', granularity: 'legacy-unknown', creator: 'legacy-unknown', sources: [] })
  return { ...payload, eventId: canonical.id, id: 'baseline-version', projectId: 'project', version: 1,
    previousVersionId: null, contentHash: hash(JSON.stringify(payload)), createdAt: stamp }
}

test('direct conversion keeps exact names/order, absent vs empty metadata, and legacy uncertainty without allocating IDs', () => {
  const retained = snapshot({ timeline: { events: [direct, { ...direct, title: '', result: '' }], envelopeNote: '保留' } })
  const before = JSON.stringify(retained), result = convert(retained), [first, second] = result.rows
  if (first?.kind !== 'direct' || second?.kind !== 'direct') assert.fail('expected direct conversions')
  assert.deepEqual(first.payload.content.characters, ['和田', '林与舟', '和田'])
  assert.equal(first.payload.content.rawCharacters, direct.characters)
  assert.equal(Object.hasOwn(first.payload.content, 'title'), false); assert.equal(Object.hasOwn(first.payload.content, 'result'), false)
  assert.equal(second.payload.content.title, ''); assert.equal(second.payload.content.result, '')
  assert.equal(first.payload.status, 'approved'); assert.equal(first.payload.phase, 'legacy-unknown')
  assert.equal(first.payload.creator, 'legacy-unknown'); assert.deepEqual(first.payload.sources, [])
  assert.equal('eventId' in first, false); assert.equal('versionId' in first, false)
  assert.equal(JSON.stringify(retained), before)
  assert.equal(Object.isFrozen(result.rows), true); assert.equal(Object.isFrozen(first.payload.content.characters), true)
})
for (const status of ['candidate', 'approved'] as const) test(`direct ${status} status and zero confidence are explicit`, () => {
  const retained = snapshot({ timeline: { events: [{ ...direct, status, confidence: 0 }] } })
  assert.equal(inspectEventMigrationSources(retained).rowsPage().items[0]!.legacyStatus, status)
  const row = convert(retained).rows[0]!; if (row.kind !== 'direct') assert.fail('expected direct conversion')
  assert.equal(row.payload.status, status); assert.equal(row.payload.content.confidence, 0)
})
for (const field of [{ status: null }, { status: 'realized' }, { status: true }, { confidence: null }, { confidence: '0.2' },
  { confidence: -0.1 }, { confidence: 1.1 }]) test(`invalid authority field blocks review: ${JSON.stringify(field)}`, () => {
  const retained = snapshot({ timeline: { events: [{ ...direct, ...field }] } })
  assert.equal(inspectEventMigrationSources(retained).summary.blockedRowCount, 1)
  assert.throws(() => convert(retained), { code: 'CONFLICT' })
})
for (const field of ['phase', 'creator', 'sources', 'evidenceRefs', 'approvedAt', 'archived', 'customAuthority', '__proto__']) {
  test(`unsupported direct ${field} blocks conversion without leaking field values`, () => {
    const retained = snapshot({ timeline: { events: [{ ...direct, [field]: 'private/source-content' }] } }), before = JSON.stringify(retained)
    assert.throws(() => convert(retained), (error: unknown) => {
      const failure = error as { code: string; message: string; details: object }
      assert.equal(failure.code, 'CONFLICT'); assert.equal(failure.message.includes('private'), false)
      assert.deepEqual(failure.details, { area: 'eventMigrationPayload', source: 'timeline', ordinal: 0, reason: 'unsupported-fields' }); return true
    }); assert.equal(JSON.stringify(retained), before)
  })
}
test('material references stay exact and detached; canonical baselines do not invent provenance', () => {
  const material = { ...source, externalId: '', author: ' 作者 ', references: [{ title: ' 原标题 ', url: 'https://example.invalid/a/' }] }
  const event = { ...canonical, title: '旧事件', rawCharacters: '原始人物', conflictGroupId: 'existing-conflict' }
  const retained = snapshot({ sources: { version: 1, sources: [material] }, events: { version: 1, events: [event] } })
  const [retainedSource, baseline] = convert(retained).rows
  if (retainedSource?.kind !== 'material' || baseline?.kind !== 'baseline') assert.fail('expected material and baseline')
  assert.deepEqual(retainedSource.record, material); assert.notEqual(retainedSource.record.references, material.references)
  assert.equal(Object.isFrozen(retainedSource.record.references![0]), true)
  assert.equal(baseline.eventId, canonical.id); assert.equal(baseline.payload.status, 'candidate')
  assert.deepEqual(baseline.payload.sources, []); assert.deepEqual(baseline.payload.content.evidenceRefs, canonical.evidenceRefs)
  assert.equal(baseline.payload.content.title, event.title); assert.equal(baseline.payload.content.rawCharacters, event.rawCharacters)
})
for (const target of ['material', 'reference', 'canonical', 'evidence'] as const) test(`unsupported ${target} metadata blocks every row`, () => {
  const material = { ...source, ...(target === 'material' ? { unknown: 'retain' } : {}),
    ...(target === 'reference' ? { references: [{ title: '引用', url: 'https://example.invalid', rank: 1 }] } : {}) }
  const event = { ...canonical, ...(target === 'canonical' ? { phase: 'realized' } : {}),
    evidenceRefs: [{ ...canonical.evidenceRefs[0]!, ...(target === 'evidence' ? { revision: 'unproven' } : {}) }] }
  assert.throws(() => convert(snapshot({ sources: { version: 1, sources: [material] }, events: { version: 1, events: [event] } })), { code: 'CONFLICT' })
})
test('selected approved version survives a later candidate and keeps metadata absent from compatibility rows', () => {
  const base = historyRecord(), approved: StoryEventVersion = { ...base, id: 'approved', status: 'approved',
    content: { ...base.content, title: '版本标题', rawCharacters: '和田' } }
  const candidate: StoryEventVersion = { ...approved, id: 'candidate', version: 2, previousVersionId: approved.id,
    status: 'candidate', content: { ...approved.content, event: '尚未采用的新内容' } }
  const retained = snapshot({ sources: { version: 1, sources: [source] }, events: { version: 1, events: [{ ...canonical, status: 'approved' }] } },
    [{ eventId: canonical.id, versions: [approved, candidate], heads: { latestVersionId: candidate.id, approvedVersionId: approved.id } }])
  const before = JSON.stringify(retained)
  assert.deepEqual(convert(retained).rows[1], { kind: 'existing-version', rowIndex: 1, eventId: canonical.id, versionId: approved.id })
  assert.equal(JSON.stringify(retained), before)
})
test('unversioned SQLite canonical row receives a candidate baseline', () => {
  const retained = snapshot({ sources: { version: 1, sources: [source] }, events: { version: 1, events: [canonical] } },
    [{ eventId: canonical.id, versions: [], heads: null }])
  assert.equal(convert(retained).rows[1]!.kind, 'baseline')
})
for (const changed of ['status', 'content', 'title', 'head', 'scope', 'sequence', 'missing-history'] as const) {
  test(`canonical ${changed} mismatch cannot be silently re-baselined`, () => {
    const version = historyRecord(), heads = { latestVersionId: version.id, approvedVersionId: null }
    if (changed === 'scope') version.projectId = 'foreign'; if (changed === 'sequence') version.version = 2
    if (changed === 'head') heads.latestVersionId = 'missing'
    const event = { ...canonical, ...(changed === 'status' ? { status: 'approved' } : {}),
      ...(changed === 'content' ? { result: 'different' } : {}), ...(changed === 'title' ? { title: 'unversioned-title' } : {}) }
    const retained = snapshot({ sources: { version: 1, sources: [source] }, events: { version: 1, events: [event] } },
      changed === 'missing-history' ? [] : [{ eventId: canonical.id, versions: [version], heads }])
    assert.throws(() => convert(retained), { code: 'CONFLICT' })
  })
}
test('duplicate keys, rounded numbers and unprovable JSON encodings cannot silently change conversion', () => {
  const plain = JSON.stringify({ events: [{ ...direct, confidence: 0.5 }] })
  for (const text of [plain.replace('0.5', '0.50000000000000001'), plain.replace('"confidence":0.5', '"confidence":0.1,"confidence":0.5'),
    plain.replace('第一夜', '\\u7b2c一夜')]) assert.throws(() => convert(snapshot({ timeline: text })), { code: 'CONFLICT' })
  assert.equal(convert(snapshot({ timeline: JSON.stringify(JSON.parse(plain), null, 2) })).rows.length, 1)
})
test('forged normalized references and partial decisions are rejected by conversion itself', () => {
  const retained = snapshot({ timeline: { events: [direct] } }), plan = reviewEventMigrationDecisions(retained, decisions(retained))
  assert.throws(() => prepareEventMigrationPayloads(retained, { ...plan, rows: [] }), { code: 'VALIDATION_ERROR' })
  assert.throws(() => prepareEventMigrationPayloads(retained, { ...plan, rows: [{ ...plan.rows[0]!, ref: { ...plan.rows[0]!.ref, originalId: 'foreign' } }] }), { code: 'CONFLICT' })
})
for (const [kind, json] of [
  ['timeline', '{"events":[{"id":"hidden"}],"events":[]}'],
  ['events', '{"version":1,"events":[{"id":"hidden"}],"events":[]}'],
  ['sources', '{"version":1,"sources":[{"id":"hidden"}],"sources":[]}'],
  ['planning', '{"version":1,"total":{"revision":0,"hash":""},"assignments":[],"chapters":[],"chapterPlacements":[{"hidden":true}],"chapterPlacements":[]}']
] as const) test(`ambiguous ${kind} envelope is rejected even when no occurrences remain after parsing`, () => {
  const retained = snapshot({ [kind]: json })
  const summary = inspectEventMigrationSources(retained).summary
  assert.equal(summary.rowCount, 0); assert.equal(summary.planningBlockingCount, 0)
  assert.throws(() => convert(retained), { code: 'CONFLICT', details: {
    area: 'eventMigrationPayload', source: kind, ordinal: null, reason: 'json-representation'
  } })
})
test('5000 occurrences preserve forward links and every decision; final-row unknown fields block all', context => {
  const events = Array.from({ length: 5000 }, (_, i) => ({ ...direct, id: `original-${i}` }))
  const retained = snapshot({ timeline: { events } }), input = decisions(retained)
  input.rows[0] = { rowIndex: 0, disposition: 'link-existing', targetRowIndex: 4999 }
  const start = performance.now(), result = convert(retained, input)
  context.diagnostic(`5000-row conversion ${Math.round(performance.now() - start)} ms`)
  assert.equal(result.rows.length, 5000); assert.deepEqual(result.rows[0], { kind: 'link', rowIndex: 0, targetRowIndex: 4999 })
  assert.equal(result.rows[4999]!.kind, 'direct')
  assert.throws(() => convert(snapshot({ timeline: { events: [...events.slice(0, -1), { ...events[4999], phase: 'realized' }] } })), { code: 'CONFLICT' })
})
test('session retains proven payloads and refuses to allocate a token for unsupported conversion', async () => {
  const run = async (retained: EventSourceSnapshot) => {
    let nonces = 0
    const session = new EventMigrationReviewSession({ capture: async () => retained }, async () => retained.scope,
      { nonce: () => `nonce-${++nonces}`, sha256: hash, now: () => 1000 })
    return { session, preview: await session.preview(), nonces: () => nonces, retained }
  }
  const good = await run(snapshot({ timeline: { events: [{ ...direct, status: 'candidate', confidence: 0.2 }] } }))
  const grant = await good.session.review(good.preview.previewId, decisions(good.retained)), claim = await good.session.claimConfirmation(grant.token)
  assert.deepEqual(claim.payloads, convert(good.retained)); assert.equal(Object.isFrozen(claim.payloads), true); assert.equal(claim.snapshot, good.retained)
  await assert.rejects(good.session.claimConfirmation(grant.token), { code: 'CONFLICT' })
  const bad = await run(snapshot({ timeline: { events: [{ ...direct, extra: { status: 'candidate' } }] } })), before = bad.nonces()
  await assert.rejects(bad.session.review(bad.preview.previewId, decisions(bad.retained)), { code: 'CONFLICT' }); assert.equal(bad.nonces(), before)
  assert.equal((await bad.session.inspection(bad.preview.previewId)).summary.rowCount, 1)
})
