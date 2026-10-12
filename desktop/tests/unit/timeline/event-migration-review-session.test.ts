import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test, { type TestContext } from 'node:test'
import { EventMigrationReviewSession, EVENT_MIGRATION_REVIEW_TTL_MS } from '../../../src/main/modules/timeline/application/event-migration-review-session'
import { EventSourceSnapshotService } from '../../../src/main/modules/timeline/application/event-source-snapshot-service'
import { WorkspaceWriteCoordinator } from '../../../src/main/core/application/workspace-write-coordinator'
import { reviewEventMigrationDecisions, eventMigrationMirrorAcknowledgements, type EventMigrationDecisionsInput } from '../../../src/main/modules/timeline/domain/event-migration-decisions'
import { inspectEventMigrationSources, type EventMigrationReviewPage } from '../../../src/main/modules/timeline/domain/event-migration-review'
import { decodeEventSourceDocument, EVENT_SOURCE_KINDS, type EventSourceKind, type EventSourceSnapshot, type EventSnapshotScope } from '../../../src/main/modules/timeline/domain/event-source-snapshot'
import { LocalEventSourceSnapshotReader } from '../../../src/main/modules/timeline/adapters/event-source-snapshot'
import { canonicalDirectory } from '../../../src/main/platform/storage/project-path'
import { SqliteWorkspaceDatabaseFactory } from '../../../src/main/platform/storage/workspace-database'

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const stamp = '2026-09-12T12:00:00.000Z'
const source = { id: 'source-one', provider: 'manual', sourceType: 'manual', title: '来源', capturedAt: stamp, excerpt: '真实保留的来源', userNotes: '', contentHash: 'a'.repeat(64) }
const event = { id: 'canonical-one', time: '第一夜', characters: ['和田'], location: '旧城', event: '钟响', evidenceRefs: [{ sourceId: source.id, excerpt: '来源' }], confidence: 1, status: 'candidate', createdAt: stamp }
const direct = (id = 'direct-one') => ({ id, title: ' 标题 ', time: '第一夜', characters: '和田、林与舟', location: '旧城', event: '钟响', result: '' })
function freeze<T>(value: T): T {
  const queue: unknown[] = [value], seen = new Set<object>()
  while (queue.length) { const item = queue.pop(); if (!item || typeof item !== 'object' || seen.has(item)) continue; seen.add(item); queue.push(...Object.values(item)); Object.freeze(item) }
  return value
}
function retained(input: Partial<Record<EventSourceKind, unknown>> = { timeline: { events: [direct(), direct('second')] } }): EventSourceSnapshot {
  const documents = {} as EventSourceSnapshot['documents'], files = {} as EventSourceSnapshot['files'], mirrors = {} as EventSourceSnapshot['mirrors']
  for (const kind of EVENT_SOURCE_KINDS) {
    const content = input[kind] === undefined ? null : typeof input[kind] === 'string' ? input[kind] as string : JSON.stringify(input[kind])
    const contentHash = content === null ? null : hash(content)
    documents[kind] = { authority: 'file', content, contentHash, revision: null, ...decodeEventSourceDocument(kind, content) }
    files[kind] = { base64: content === null ? null : Buffer.from(content).toString('base64'), hash: contentHash, byteLength: content === null ? 0 : Buffer.byteLength(content) }
    mirrors[kind] = null
  }
  return freeze({ version: 1, scope: { workItemId: 'book', root: 'canonical-test-root', generation: 1 },
    database: { projectId: 'project-one', schemaVersion: 40, storageMode: 'sqlite', hasMigrationEvidence: false },
    documents, files, mirrors, eventHistory: [], chapterCatalog: { manuscripts: 'sqlite', outlines: 'sqlite', entries: [] }, fingerprint: hash(JSON.stringify(files)) })
}
function all<T>(read: (offset: number) => EventMigrationReviewPage<T>): T[] {
  const result: T[] = []; let offset: number | null = 0
  while (offset !== null) { const page = read(offset); result.push(...page.items); offset = page.nextOffset }
  return result
}
function decisions(snapshot: EventSourceSnapshot): EventMigrationDecisionsInput {
  const review = inspectEventMigrationSources(snapshot)
  return { fingerprint: snapshot.fingerprint, rows: all(review.rowsPage).map(row => ({ rowIndex: row.index, disposition: row.ref.source === 'sources' ? 'retain-source' : 'keep-separate' })),
    acknowledgedGroups: all(review.groupsPage).filter(group => group.severity === 'review').map(group => group.id),
    acknowledgedPlanningFindings: all(review.planningFindingsPage).flatMap((finding, index) => finding.severity === 'review' ? [index] : []),
    acknowledgedMirrors: [...eventMigrationMirrorAcknowledgements(snapshot)] }
}
function harness(initial = retained()) {
  const state = { snapshot: initial, scope: { ...initial.scope }, now: 1000, calls: 0, nonce: 0,
    capture: async () => state.snapshot, scopeRead: async () => ({ ...state.scope }) }
  const session = new EventMigrationReviewSession({ capture: async () => { state.calls++; return state.capture() } }, () => state.scopeRead(),
    { nonce: () => `test-nonce-${++state.nonce}`, sha256: hash, now: () => state.now })
  const ready = async () => { const preview = await session.preview(); const grant = await session.review(preview.previewId, decisions(state.snapshot)); return { preview, grant } }
  return { session, state, ready }
}
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail }); return { promise, resolve, reject } }

test('all rows and exact occurrence refs are retained; decisions do not grant authority or invent target IDs', () => {
  const snapshot = retained({ sources: { version: 1, sources: [source] }, events: { version: 1, events: [event] }, timeline: { events: [direct('same'), direct('same')] } })
  const before = JSON.stringify(snapshot), plan = reviewEventMigrationDecisions(snapshot, decisions(snapshot))
  assert.equal(plan.rows.length, 4)
  assert.deepEqual(plan.rows.map(row => row.ref.originalId), [source.id, event.id, 'same', 'same'])
  assert.deepEqual(plan.rows.slice(2).map(row => row.ref.ordinal), [0, 1])
  assert.equal(JSON.stringify(snapshot), before); assert.equal(event.status, 'candidate')
  assert.equal('token' in plan, false); assert.equal('eventId' in plan.rows[3]!, false)
  assert.throws(() => { (plan.rows[0]!.ref as { originalId: string }).originalId = 'forged' }, TypeError)
})

test('row/acknowledgement input ordering is normalized without reordering source occurrences', () => {
  const snapshot = retained(), first = decisions(snapshot), shuffled = decisions(snapshot)
  shuffled.rows.reverse(); shuffled.acknowledgedGroups.reverse()
  assert.equal(JSON.stringify(reviewEventMigrationDecisions(snapshot, first)), JSON.stringify(reviewEventMigrationDecisions(snapshot, shuffled)))
})

test('confirmation exposes deterministic source order with forward-linked identities at their first occurrence', async () => {
  const snapshot = retained({ sources: { version: 1, sources: [source] }, events: { version: 1, events: [event] },
    timeline: { events: [direct('a'), direct('b'), direct('a')] } })
  const { session } = harness(snapshot)
  const preview = await session.preview(), input = decisions(snapshot)
  input.rows[2] = { rowIndex: 2, disposition: 'link-existing', targetRowIndex: 4 }
  input.rows.reverse()
  const result = await session.review(preview.previewId, input)
  assert.deepEqual(result.displayOrderRowIndices, [1, 4, 3])
  assert.ok(Object.isFrozen(result.displayOrderRowIndices))
})

for (const [name, mutate] of [
  ['missing row', (v: EventMigrationDecisionsInput) => v.rows.pop()],
  ['duplicate row', (v: EventMigrationDecisionsInput) => { v.rows[1] = v.rows[0]! }],
  ['unknown row', (v: EventMigrationDecisionsInput) => { v.rows[0]!.rowIndex = 88 }],
  ['missing duplicate acknowledgement', (v: EventMigrationDecisionsInput) => { v.acknowledgedGroups = [] }],
  ['duplicate acknowledgement', (v: EventMigrationDecisionsInput) => v.acknowledgedGroups.push(v.acknowledgedGroups[0]!)],
  ['unknown acknowledgement', (v: EventMigrationDecisionsInput) => { v.acknowledgedGroups[0] = 999 }],
] as const) test(`rejects ${name} rather than approving a partial review`, () => {
  const snapshot = retained(), input = decisions(snapshot); mutate(input)
  assert.throws(() => reviewEventMigrationDecisions(snapshot, input), { code: 'VALIDATION_ERROR' })
})

for (const value of [null, [], 'keep-separate', {}, { fingerprint: 'bad' }]) test(`malformed request ${JSON.stringify(value)} fails safely`, () => {
  assert.throws(() => reviewEventMigrationDecisions(retained(), value), { code: 'VALIDATION_ERROR' })
})
test('unknown fields, coerced enums and invalid numeric indexes cannot change the reviewed plan', () => {
  const snapshot = retained(), base = decisions(snapshot)
  for (const row of [{ ...base.rows[0], approved: true }, { ...base.rows[0], disposition: ['keep-separate'] },
    { ...base.rows[0], targetRowIndex: 1 }, { ...base.rows[0], rowIndex: '0' }, { ...base.rows[0], rowIndex: NaN }, { ...base.rows[0], rowIndex: 0.5 }]) {
    assert.throws(() => reviewEventMigrationDecisions(snapshot, { ...base, rows: [row, base.rows[1]] }), { code: 'VALIDATION_ERROR' })
  }
  assert.throws(() => reviewEventMigrationDecisions(snapshot, { ...base, content: 'forged' }), { code: 'VALIDATION_ERROR' })
  assert.throws(() => reviewEventMigrationDecisions(snapshot, { ...base, fingerprint: 'b'.repeat(64) }), { code: 'CONFLICT' })
})

test('invalid rows, ambiguous evidence and broken placement ledgers remain blockers despite acknowledgements', () => {
  for (const snapshot of [retained({ timeline: { events: [{ ...direct(), characters: '' }] } }),
    retained({ events: { version: 1, events: [event] } }),
    retained({ sources: { version: 1, sources: [source, source] }, events: { version: 1, events: [event] } }),
    retained({ planning: { version: 1, total: {}, assignments: [], chapters: [] } })]) {
    assert.throws(() => reviewEventMigrationDecisions(snapshot, decisions(snapshot)), { code: 'CONFLICT' })
  }
})

test('exact direct links preserve every source occurrence and never allocate a replacement for canonical identities', () => {
  const snapshot = retained(), input = decisions(snapshot)
  input.rows[1] = { rowIndex: 1, disposition: 'link-existing', targetRowIndex: 0 }
  const plan = reviewEventMigrationDecisions(snapshot, input)
  assert.equal(plan.rows.length, 2); assert.equal(plan.rows[1]!.targetRowIndex, 0)
  const canonical = retained({ sources: { version: 1, sources: [source] }, events: { version: 1, events: [event] } })
  const forbidden = decisions(canonical); forbidden.rows[1] = { rowIndex: 1, disposition: 'link-existing', targetRowIndex: 0 }
  assert.throws(() => reviewEventMigrationDecisions(canonical, forbidden), { code: 'VALIDATION_ERROR' })
})

for (const [name, change] of [
  ['title', { title: 'different' }], ['raw character separator', { characters: '和田,林与舟' }],
  ['result absence', { result: undefined }], ['status', { status: 'candidate' }], ['evidence', { evidenceRefs: [{ sourceId: 'other', excerpt: 'different' }] }],
  ['unknown field', { unknown: { nested: 'different' } }], ['order', { characters: '林与舟、和田' }], ['whitespace', { time: ' 第一夜 ' }]
] as const) test(`explicit link rejects different ${name}; keep-separate still preserves it`, () => {
  const snapshot = retained({ timeline: { events: [direct(), { ...direct('second'), ...change }] } }), input = decisions(snapshot)
  reviewEventMigrationDecisions(snapshot, input)
  input.rows[1] = { rowIndex: 1, disposition: 'link-existing', targetRowIndex: 0 }
  assert.throws(() => reviewEventMigrationDecisions(snapshot, input), { code: 'CONFLICT' })
})

test('equal extension objects compare by keys but ordered arrays and nested IDs remain meaningful', () => {
  const snapshot = retained({ timeline: { events: [{ ...direct(), extra: { a: '甲', b: ['乙'], id: 'nested' } },
    { ...direct('second'), extra: { id: 'nested', b: ['乙'], a: '甲' } }] } })
  const input = decisions(snapshot); input.rows[1] = { rowIndex: 1, disposition: 'link-existing', targetRowIndex: 0 }
  assert.equal(reviewEventMigrationDecisions(snapshot, input).rows[1]!.targetRowIndex, 0)
})

test('self links, link chains, cycles and out-of-range targets are rejected', () => {
  const snapshot = retained({ timeline: { events: [direct(), direct('two'), direct('three')] } })
  for (const target of [1, 99]) { const input = decisions(snapshot); input.rows[1] = { rowIndex: 1, disposition: 'link-existing', targetRowIndex: target }; assert.throws(() => reviewEventMigrationDecisions(snapshot, input), { code: 'CONFLICT' }) }
  const chain = decisions(snapshot); chain.rows[1] = { rowIndex: 1, disposition: 'link-existing', targetRowIndex: 0 }; chain.rows[2] = { rowIndex: 2, disposition: 'link-existing', targetRowIndex: 1 }
  assert.throws(() => reviewEventMigrationDecisions(snapshot, chain), { code: 'CONFLICT' })
  chain.rows[1]!.targetRowIndex = 2
  assert.throws(() => reviewEventMigrationDecisions(snapshot, chain), { code: 'CONFLICT' })
})

test('duplicate JSON keys and lossy numbers cannot be used as equality proof for linking', () => {
  for (const raw of [
    `{"events":[${JSON.stringify(direct()).slice(0, -1)},"extra":9007199254740993},${JSON.stringify(direct('two')).slice(0, -1)},"extra":9007199254740992}]}`,
    `{"events":[${JSON.stringify(direct()).slice(0, -1)},"extra":"lost","extra":"same"},${JSON.stringify(direct('two')).slice(0, -1)},"extra":"same"}]}`]) {
    const snapshot = retained({ timeline: raw }), input = decisions(snapshot)
    reviewEventMigrationDecisions(snapshot, input)
    input.rows[1] = { rowIndex: 1, disposition: 'link-existing', targetRowIndex: 0 }
    assert.throws(() => reviewEventMigrationDecisions(snapshot, input), { code: 'CONFLICT' })
  }
})

test('pretty JSON preserves whitespace inside strings and can still prove an exact direct link', () => {
  const snapshot = retained({ timeline: JSON.stringify({ events: [direct(), direct('two')] }, null, 2) }), input = decisions(snapshot)
  input.rows[1] = { rowIndex: 1, disposition: 'link-existing', targetRowIndex: 0 }
  assert.equal(reviewEventMigrationDecisions(snapshot, input).rows[1]!.targetRowIndex, 0)
})

test('mirror warnings and stale planning findings require exact acknowledgement without reconfirming the ledger', () => {
  const base = retained({ planning: { version: 1, total: { revision: 2, hash: 'a'.repeat(64), updatedAt: stamp }, assignments: [], chapters: [
    { chapterId: 7, volume: 1, basedOnTotalRevision: 1, basedOnVolumeRevision: 1, outlineHash: 'c'.repeat(64), savedAt: stamp }],
    volumes: [{ volume: 1, title: '卷一', eventIds: [], revision: 2, outlineHash: 'b'.repeat(64), createdAt: stamp, updatedAt: stamp }],
    chapterPlacements: [{ chapterId: 7, volume: 1, assignedAt: stamp, updatedAt: stamp }] } })
  const snapshot = freeze({ ...base, chapterCatalog: { manuscripts: 'sqlite' as const, outlines: 'sqlite' as const,
    entries: [{ kind: 'outline' as const, chapterId: 7, status: 'active' as const, revision: 'outline-v1' }] },
    mirrors: { ...base.mirrors, timeline: { relativePath: 'config/timeline.json', contentHash: 'b'.repeat(64), status: 'conflict' as const } } })
  const input = decisions(snapshot), before = JSON.stringify(snapshot)
  assert.ok(input.acknowledgedPlanningFindings.length > 0)
  assert.deepEqual(input.acknowledgedMirrors, ['timeline'])
  assert.throws(() => reviewEventMigrationDecisions(snapshot, { ...input, acknowledgedPlanningFindings: [] }), { code: 'VALIDATION_ERROR' })
  assert.throws(() => reviewEventMigrationDecisions(snapshot, { ...input, acknowledgedMirrors: [] }), { code: 'VALIDATION_ERROR' })
  reviewEventMigrationDecisions(snapshot, input); assert.equal(JSON.stringify(snapshot), before)
})

test('5,000 decisions and explicit links account for the complete retained set, not just one page', context => {
  const start = performance.now(), snapshot = retained({ timeline: { events: Array.from({ length: 5000 }, (_, id) => direct(String(id))) } }), input = decisions(snapshot)
  for (let index = 1; index < input.rows.length; index++) input.rows[index] = { rowIndex: index, disposition: 'link-existing', targetRowIndex: 0 }
  const plan = reviewEventMigrationDecisions(snapshot, input)
  assert.equal(plan.rows.length, 5000); assert.equal(plan.rows[4999]!.ref.ordinal, 4999)
  assert.throws(() => reviewEventMigrationDecisions(snapshot, { ...input, rows: input.rows.slice(0, 100) }), { code: 'VALIDATION_ERROR' })
  context.diagnostic(`5,000 all-row decisions + explicit exact links: ${Math.round(performance.now() - start)} ms; no UI/commit performance claim`)
})

test('empty preview requires review before a one-use grant and never exposes raw snapshot in summaries', async () => {
  const h = harness(retained({})), preview = await h.session.preview()
  assert.equal(preview.summary.rowCount, 0); assert.equal('token' in preview, false); assert.equal('snapshot' in preview, false)
  const grant = await h.session.review(preview.previewId, decisions(h.state.snapshot))
  const claimed = await h.session.claimConfirmation(grant.token)
  assert.equal(claimed.snapshot, h.state.snapshot); assert.equal(claimed.plan.rows.length, 0); assert.equal(h.state.calls, 2)
  await assert.rejects(h.session.claimConfirmation(grant.token), { code: 'CONFLICT' })
})

test('confirmation fingerprint binds all normalized decisions and returns the ORIGINAL reviewed snapshot', async () => {
  const h = harness(), { grant } = await h.ready(), original = h.state.snapshot
  h.state.snapshot = freeze(structuredClone(original))
  const claim = await h.session.claimConfirmation(grant.token)
  assert.equal(claim.snapshot, original); assert.notEqual(claim.snapshot, h.state.snapshot)
  assert.equal(claim.decisionFingerprint, hash(JSON.stringify(claim.plan)))
})

test('invalid re-review consumes the previous authorization; a new valid review gets a distinct token', async () => {
  const h = harness(), { preview, grant } = await h.ready()
  await assert.rejects(h.session.review(preview.previewId, { ...decisions(h.state.snapshot), rows: [] }), { code: 'VALIDATION_ERROR' })
  await assert.rejects(h.session.claimConfirmation(grant.token), { code: 'CONFLICT' })
  const next = await h.session.review(preview.previewId, decisions(h.state.snapshot))
  assert.notEqual(next.token, grant.token); assert.notEqual(next.operationId, grant.operationId)
  await h.session.claimConfirmation(next.token)
})

for (const action of ['cancel', 'clear', 'new-preview', 'expires', 'book', 'root', 'generation'] as const) test(`${action} invalidates a previous grant before claiming`, async () => {
  const h = harness(), { preview, grant } = await h.ready()
  switch (action) {
    case 'cancel': h.session.cancel(preview.previewId); break
    case 'clear': h.session.clear(); break
    case 'new-preview': await h.session.preview(); break
    case 'expires': h.state.now += EVENT_MIGRATION_REVIEW_TTL_MS; break
    case 'book': h.state.scope.workItemId = 'other'; break
    case 'root': h.state.scope.root = 'other-root'; break
    case 'generation': h.state.scope.generation++; break
  }
  await assert.rejects(h.session.claimConfirmation(grant.token), { code: 'CONFLICT' })
})

test('simultaneous claims consume before awaiting the source; only one can succeed', async () => {
  const h = harness(), { grant } = await h.ready(), pending = deferred<EventSourceSnapshot>()
  h.state.capture = () => pending.promise
  const first = h.session.claimConfirmation(grant.token)
  await assert.rejects(h.session.claimConfirmation(grant.token), { code: 'CONFLICT' })
  pending.resolve(h.state.snapshot); await first
})

for (const action of ['source', 'cancel', 'expire', 'switch-book', 'new-preview'] as const) test(`${action} during claim source refresh rejects without reusable authorization`, async () => {
  const h = harness(), { preview, grant } = await h.ready(), pending = deferred<EventSourceSnapshot>(), entered = deferred<void>()
  h.state.capture = () => { entered.resolve(); return pending.promise }
  const claiming = h.session.claimConfirmation(grant.token)
  const rejected = assert.rejects(claiming, { code: 'CONFLICT' }); await entered.promise
  if (action === 'source') h.state.snapshot = freeze({ ...h.state.snapshot, fingerprint: 'c'.repeat(64) })
  if (action === 'cancel') h.session.cancel(preview.previewId)
  if (action === 'expire') h.state.now += EVENT_MIGRATION_REVIEW_TTL_MS
  if (action === 'switch-book') h.state.scope.workItemId = 'other'
  if (action === 'new-preview') { h.state.capture = async () => h.state.snapshot; await h.session.preview() }
  pending.resolve(h.state.snapshot); await rejected
  await assert.rejects(h.session.claimConfirmation(grant.token), { code: 'CONFLICT' })
})

test('late old-book source error is a conflict; ordinary source failure is safely wrapped and consumes the token', async () => {
  const h = harness(), { grant } = await h.ready()
  h.state.capture = async () => { throw new Error('private-book-path and secret-body') }
  await assert.rejects(h.session.claimConfirmation(grant.token), error => {
    assert.equal((error as { code: string }).code, 'STORAGE_ERROR'); assert.doesNotMatch(String(error), /private-book-path|secret-body/); return true
  })
  await assert.rejects(h.session.claimConfirmation(grant.token), { code: 'CONFLICT' })
  const next = harness()
  next.state.capture = async () => { next.state.scope.workItemId = 'other'; throw new Error('old source failure') }
  await assert.rejects(next.session.preview(), { code: 'CONFLICT' })
})

for (const action of ['inspection', 'review', 'claim'] as const) test(`${action} safely wraps an unavailable current scope`, async () => {
  const h = harness(), { preview, grant } = await h.ready()
  h.state.scopeRead = async () => { throw new Error('private-scope-path and secret-body') }
  const operation = action === 'inspection' ? h.session.inspection(preview.previewId)
    : action === 'review' ? h.session.review(preview.previewId, decisions(h.state.snapshot)) : h.session.claimConfirmation(grant.token)
  await assert.rejects(operation, error => {
    assert.equal((error as { code: string }).code, 'STORAGE_ERROR'); assert.doesNotMatch(String(error), /private-scope-path|secret-body/); return true
  })
  h.state.scopeRead = async () => h.state.scope
  if (action !== 'inspection') await assert.rejects(h.session.claimConfirmation(grant.token), { code: 'CONFLICT' })
})

test('new preview supersedes slow old capture and limits retained/in-flight acquisition work', async () => {
  const h = harness(), jobs = [deferred<EventSourceSnapshot>(), deferred<EventSourceSnapshot>(), deferred<EventSourceSnapshot>()], started = deferred<void>()
  let count = 0
  h.state.capture = () => { const job = jobs[count++]!; if (count === 3) started.resolve(); return job.promise }
  const first = h.session.preview(); const firstRejected = assert.rejects(first, { code: 'CONFLICT' })
  while (count < 1) await new Promise(resolve => setImmediate(resolve))
  const second = h.session.preview(); const secondRejected = assert.rejects(second, { code: 'CONFLICT' })
  while (count < 2) await new Promise(resolve => setImmediate(resolve))
  const third = h.session.preview(); const thirdRejected = assert.rejects(third, { code: 'CONFLICT' }); await started.promise
  await assert.rejects(h.session.preview(), { code: 'CONFLICT' })
  for (const job of jobs) job.resolve(h.state.snapshot)
  await Promise.all([firstRejected, secondRejected, thirdRejected])
  h.state.capture = async () => h.state.snapshot; await h.session.preview()
})

test('concurrent re-reviews cannot publish an older decision after the newer one', async () => {
  const h = harness(), { preview } = await h.ready(), scope = deferred<EventSnapshotScope>()
  h.state.scopeRead = () => scope.promise
  const first = h.session.review(preview.previewId, decisions(h.state.snapshot)); const rejected = assert.rejects(first, { code: 'CONFLICT' })
  const second = h.session.review(preview.previewId, decisions(h.state.snapshot)); scope.resolve(h.state.scope)
  await rejected; const grant = await second
  h.state.scopeRead = async () => h.state.scope; await h.session.claimConfirmation(grant.token)
})

test('forged and previous-instance tokens are rejected, including an accidentally repeated nonce within one session', async () => {
  const snapshot = retained(), session = new EventMigrationReviewSession({ capture: async () => snapshot }, async () => snapshot.scope,
    { nonce: () => 'same-injected-test-nonce', sha256: hash, now: () => 1000 })
  const preview = await session.preview(), first = await session.review(preview.previewId, decisions(snapshot)), second = await session.review(preview.previewId, decisions(snapshot))
  assert.notEqual(first.token, second.token)
  await assert.rejects(session.claimConfirmation(first.token), { code: 'CONFLICT' })
  await assert.rejects(session.claimConfirmation('forged'), { code: 'CONFLICT' })
  const restarted = harness(snapshot)
  await assert.rejects(restarted.session.claimConfirmation(second.token), { code: 'CONFLICT' })
  await session.claimConfirmation(second.token)
})

async function fixture(context: TestContext) {
  const parent = await canonicalDirectory(tmpdir()), root = await canonicalDirectory(await mkdtemp(join(parent, 'novel-event-review-session-')))
  context.after(async () => { assert.equal(dirname(root), parent); assert.ok(root.startsWith(join(parent, 'novel-event-review-session-'))); assert.equal(await canonicalDirectory(root), root); await rm(root, { recursive: true, force: true }) })
  const factory = new SqliteWorkspaceDatabaseFactory(() => new Date(stamp)); (await factory.open(root)).close()
  const path = join(root, '.webnovel', 'workspace.sqlite'), db = new DatabaseSync(path)
  db.prepare("INSERT INTO projects (id,name,status,legacy_manifest_hash,storage_mode,created_at,updated_at) VALUES ('project-one','隔离核对','active',?,'sqlite',?,?)").run(hash('manifest'), stamp, stamp); db.close()
  await mkdir(join(root, '.webnovel', 'config'), { recursive: true })
  const timeline = join(root, '.webnovel', 'config', 'timeline.json')
  await writeFile(timeline, '\ufeff' + JSON.stringify({ events: [direct(), direct('second')] }, null, 2) + '\r\n')
  await writeFile(join(root, 'notes.md'), '不能改写原稿。\r\n')
  const scope = { root, workItemId: root, generation: 1 }, sourceService = new EventSourceSnapshotService(new LocalEventSourceSnapshotReader(factory), async () => scope, new WorkspaceWriteCoordinator())
  const session = new EventMigrationReviewSession(sourceService, async () => scope, { nonce: randomUUID, sha256: hash, now: () => 1000 })
  return { root, path, timeline, factory, scope, sourceService, session }
}
async function files(root: string, dir = root): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  for (const item of await readdir(dir, { withFileTypes: true })) { const path = join(dir, item.name); if (item.isDirectory()) Object.assign(result, await files(root, path)); else result[relative(root, path)] = hash(await readFile(path)) }
  return result
}

test('real SQLite/file preview, decision and claim remain zero-write and preserve BOM, raw fields and every occurrence', async context => {
  const f = await fixture(context), before = await files(f.root), snapshot = await f.sourceService.capture(), preview = await f.session.preview()
  assert.equal(snapshot.database!.hasMigrationEvidence, false)
  const inspection = await f.session.inspection(preview.previewId); assert.equal(all(inspection.rowsPage).length, 2)
  const grant = await f.session.review(preview.previewId, decisions(snapshot)), claim = await f.session.claimConfirmation(grant.token)
  assert.equal(claim.plan.rows.length, 2); assert.equal(claim.snapshot.files.timeline.base64, snapshot.files.timeline.base64)
  assert.deepEqual(await files(f.root), before)
})

test('real source edit rejects old authorization with all changed bytes preserved, then a fresh preview can review it', async context => {
  const f = await fixture(context), snapshot = await f.sourceService.capture(), preview = await f.session.preview()
  const grant = await f.session.review(preview.previewId, decisions(snapshot))
  await writeFile(f.timeline, JSON.stringify({ events: [{ ...direct(), title: '外部修改' }] }))
  const changed = await files(f.root)
  await assert.rejects(f.session.claimConfirmation(grant.token), { code: 'CONFLICT' })
  assert.deepEqual(await files(f.root), changed)
  const next = await f.session.preview(), fresh = await f.sourceService.capture(); await f.session.review(next.previewId, decisions(fresh))
})

test('any stored migration evidence changes the same-snapshot fingerprint and blocks issuing a new migration grant', async context => {
  const f = await fixture(context), before = await f.sourceService.capture(), preview = await f.session.preview()
  const grant = await f.session.review(preview.previewId, decisions(before)), db = new DatabaseSync(f.path)
  try { db.prepare("INSERT INTO event_migration_receipts VALUES ('existing','project-one',?,?,?,'{}',0,?)").run(hash('source'), hash('decision'), hash('{}'), stamp) } finally { db.close() }
  const original = await files(f.root), after = await f.sourceService.capture()
  assert.equal(after.database!.hasMigrationEvidence, true); assert.notEqual(after.fingerprint, before.fingerprint)
  await assert.rejects(f.session.claimConfirmation(grant.token), { code: 'CONFLICT' })
  await assert.rejects(f.session.preview(), { code: 'FEATURE_UNAVAILABLE' })
  assert.deepEqual(await files(f.root), original)
})

test('file/shadow/unknown-evidence snapshots never get a database migration confirmation', async () => {
  const base = retained({})
  for (const database of [null, { ...base.database!, storageMode: 'shadow' as const }, { ...base.database!, hasMigrationEvidence: true }]) {
    const h = harness(freeze({ ...base, database })); await assert.rejects(h.session.preview(), { code: 'FEATURE_UNAVAILABLE' })
  }
})
