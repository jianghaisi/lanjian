import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import test from 'node:test'
import { AppError } from '../../../src/main/core/errors/app-error'
import { inspectEventMigrationSources, EVENT_REVIEW_PAGE_SIZE, type EventMigrationReviewPage } from '../../../src/main/modules/timeline/domain/event-migration-review'
import { decodeEventSourceDocument, EVENT_SOURCE_KINDS, type EventSourceSnapshot, type EventSourceKind } from '../../../src/main/modules/timeline/domain/event-source-snapshot'
import { assertCanonicalEvents, assertMaterialSources, normalizedMaterialUrl } from '../../../src/main/modules/worldbuilding/domain/legacy-research-validation'
import { LocalEventSourceSnapshotReader } from '../../../src/main/modules/timeline/adapters/event-source-snapshot'
import { canonicalDirectory } from '../../../src/main/platform/storage/project-path'
import { SqliteWorkspaceDatabaseFactory } from '../../../src/main/platform/storage/workspace-database'

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const stamp = '2026-09-11T12:00:00.000Z'
const source = (id = 'source-one') => ({ id, provider: 'manual', sourceType: 'manual', title: '原始素材', capturedAt: stamp,
  excerpt: '和田、林与舟在旧城发现回音。', userNotes: '', contentHash: hash(id) })
const canonical = (id = 'event-one') => ({ id, time: '第一夜', characters: ['和田', '林与舟'], location: '旧城', event: '发现回音',
  evidenceRefs: [{ sourceId: 'source-one', excerpt: '在旧城发现回音' }], confidence: 1, status: 'approved', createdAt: stamp })
const direct = (id = 'direct-one') => ({ id, title: ' 原始标题 ', time: ' 第一夜 ', characters: '和田、林与舟', location: '旧城', event: '发现回音' })

function retained(input: Partial<Record<EventSourceKind, unknown>> = {}): EventSourceSnapshot {
  const documents = {} as EventSourceSnapshot['documents']
  const files = {} as EventSourceSnapshot['files']
  const mirrors = {} as EventSourceSnapshot['mirrors']
  for (const kind of EVENT_SOURCE_KINDS) {
    const content = input[kind] === undefined ? null : JSON.stringify(input[kind])
    const contentHash = content === null ? null : hash(content)
    documents[kind] = { authority: 'file', content, contentHash, revision: null, ...decodeEventSourceDocument(kind, content) }
    files[kind] = { base64: content === null ? null : Buffer.from(content).toString('base64'), hash: contentHash,
      byteLength: content === null ? 0 : Buffer.byteLength(content) }
    mirrors[kind] = null
  }
  const snapshot: EventSourceSnapshot = { version: 1, scope: { workItemId: 'isolated-book', root: 'isolated-root', generation: 1 },
    database: null, documents, files, mirrors, eventHistory: [], chapterCatalog: { manuscripts: 'unavailable', outlines: 'unavailable', entries: [] }, fingerprint: hash(JSON.stringify(files)) }
  const pending: object[] = [snapshot]
  while (pending.length) {
    const value = pending.pop()!
    for (const child of Object.values(value)) if (child && typeof child === 'object') pending.push(child)
    Object.freeze(value)
  }
  return snapshot
}
function ledger(events: unknown[] = [canonical()], sources: unknown[] = [source()], extra: Partial<Record<EventSourceKind, unknown>> = {}) {
  return retained({ sources: { version: 1, sources }, events: { version: 1, events }, ...extra })
}
function all<T>(read: (offset?: number) => EventMigrationReviewPage<T>): T[] {
  const items: T[] = []
  let offset: number | null = 0
  while (offset !== null) {
    const page = read(offset)
    assert.ok(page.items.length <= EVENT_REVIEW_PAGE_SIZE)
    items.push(...page.items)
    offset = page.nextOffset
  }
  return items
}
const validation = (error: unknown) => error instanceof AppError && error.code === 'VALIDATION_ERROR'

test('empty input remains an author-review proposal, never permission to switch an empty module', () => {
  const review = inspectEventMigrationSources(retained())
  assert.equal(review.summary.rowCount, 0)
  assert.equal(review.summary.authorReviewRequired, true)
  assert.equal(review.summary.planningCoverage, 'ledger-and-chapter-identities')
  assert.equal(review.rowsPage().nextOffset, null)
  assert.ok(!('canCommit' in review) && !('token' in review) && !('commit' in review))
})

test('all occurrences retain source hash, ordinal, original ID, order, raw metadata and result presence', () => {
  const snapshot = ledger([canonical(), { ...canonical('candidate'), status: 'candidate' }], [source()], {
    timeline: { events: [{ ...direct('same'), result: '', extra: { nested: ['甲'] } }, direct('same')] }
  })
  const before = JSON.stringify(snapshot)
  const review = inspectEventMigrationSources(snapshot)
  const rows = all(review.rowsPage)
  assert.equal(rows.length, 5)
  assert.deepEqual(rows.map(row => row.legacyStatus), ['source', 'approved', 'candidate', 'direct-unconfirmed', 'direct-unconfirmed'])
  assert.deepEqual(rows.slice(3).map(row => row.ref.ordinal), [0, 1])
  assert.equal(rows[3]!.ref.originalId, 'same')
  assert.equal(rows[3]!.ref.contentHash, snapshot.documents.timeline.contentHash)
  assert.ok(rows.slice(1).every(row => row.defaultDisposition === 'keep-separate'))
  assert.equal(JSON.stringify(snapshot), before)
  assert.throws(() => { rows[3]!.groupIds.push(99) }, TypeError)
  assert.throws(() => { rows[3]!.proposedCharacters!.reverse() }, TypeError)
})

test('visible character delimiters preserve Chinese conjunctions and repeated names', () => {
  const review = inspectEventMigrationSources(retained({ timeline: { events: [{ ...direct(), characters: ' 和田、林与舟；及川/和田|小和\n乙丙 ' }] } }))
  assert.deepEqual(review.rowsPage().items[0]!.proposedCharacters, ['和田', '林与舟', '及川', '和田', '小和', '乙丙'])
})

test('possible duplicates do not erase differing title, result, character order, evidence, status or unknown fields', () => {
  const snapshot = ledger([canonical(), { ...canonical('candidate'), status: 'candidate', result: '',
    characters: ['林与舟', '和田'], evidenceRefs: [{ sourceId: 'source-one', excerpt: '另一段真实摘录' }], unknown: '保留' }], [source()], {
    timeline: { events: [direct(), { ...direct('other'), title: '不同标题', result: '没有发现回音', unknown: { retained: true } }] }
  })
  const review = inspectEventMigrationSources(snapshot)
  const groups = all(review.groupsPage)
  const duplicate = groups.find(group => group.kind === 'possible-duplicate')!
  assert.equal(duplicate.memberCount, 4)
  assert.equal(duplicate.severity, 'review')
  assert.equal(groups.filter(group => group.kind === 'possible-slot-conflict').length, 0)
  assert.deepEqual(all(offset => review.groupMembersPage(duplicate.id, offset)), [1, 2, 3, 4])
  assert.equal(review.summary.rowCount, 5)
  assert.equal(review.summary.invalidRowCount, 0)
  assert.equal(all(review.rowsPage)[2]!.legacyStatus, 'candidate')
})

test('same structured time, place and character slot with different event text remains a review warning', () => {
  const review = inspectEventMigrationSources(retained({ timeline: { events: [direct(), { ...direct('other'), event: '摧毁回音装置' }] } }))
  assert.deepEqual(all(review.groupsPage).map(group => [group.kind, group.severity]), [['possible-slot-conflict', 'review']])
  assert.equal(review.summary.blockedRowCount, 0)
})

test('repeated canonical and source IDs block; repeated direct IDs are separate author-review occurrences', () => {
  const review = inspectEventMigrationSources(ledger([canonical(), canonical()], [source(), source()], { timeline: { events: [direct(), direct()] } }))
  const groups = all(review.groupsPage)
  assert.equal(groups.find(group => group.kind === 'repeated-source-id')?.severity, 'blocking')
  assert.equal(groups.find(group => group.kind === 'repeated-canonical-id')?.severity, 'blocking')
  assert.equal(groups.find(group => group.kind === 'repeated-direct-id')?.severity, 'review')
  assert.equal(review.summary.rowCount, 6)
  assert.equal(review.summary.blockedRowCount, 4)
  assert.ok(all(review.referencesPage).every(reference => reference.result === 'ambiguous-target'))
})

test('material hash and normalized URL uniqueness remain blockers without discarding source records', () => {
  const review = inspectEventMigrationSources(ledger([canonical()], [
    { ...source(), url: 'HTTPS://example.invalid/ref/' },
    { ...source('other'), contentHash: source().contentHash, url: 'https://example.invalid/ref' }
  ]))
  assert.ok(all(review.groupsPage).some(group => group.kind === 'source-hash-collision'))
  assert.ok(all(review.groupsPage).some(group => group.kind === 'source-url-collision'))
  assert.equal(review.summary.rowCount, 3)
  assert.equal(review.referencesPage().items[0]!.result, 'invalid-target')
})

test('missing or invalid material evidence prevents a placed approved event from appearing resolved', () => {
  for (const sources of [[], [{ ...source(), title: '' }]]) {
    const review = inspectEventMigrationSources(ledger([canonical()], sources, {
      planning: { version: 1, assignments: [{ eventId: 'event-one', assignedAt: stamp }] }
    }))
    const refs = all(review.referencesPage)
    assert.equal(refs[0]!.result, sources.length ? 'invalid-target' : 'missing-target')
    assert.equal(refs[1]!.result, 'invalid-target')
    assert.equal(review.summary.blockedReferenceCount, 2)
  }
})

test('even a malformed same-ID source makes evidence ambiguous; validity never selects the first row', () => {
  const review = inspectEventMigrationSources(ledger([canonical()], [source(), { id: 'source-one' }]))
  assert.equal(review.referencesPage().items[0]!.result, 'ambiguous-target')
  assert.equal(review.referencesPage().items[0]!.targetRowIndex, null)
})

test('legacy planning references resolve only approved canonical IDs, never same-ID direct rows', () => {
  const review = inspectEventMigrationSources(ledger([{ ...canonical(), status: 'candidate' }], [source()], {
    timeline: { events: [direct('event-one'), direct('direct-only')] },
    planning: { version: 1, assignments: [{ eventId: 'event-one' }, { eventId: 'direct-only' }] }
  }))
  assert.deepEqual(all(review.referencesPage).map(reference => reference.result), ['resolved', 'candidate-target', 'missing-target'])
})

test('a direct ID collision cannot steal a canonical placement or manufacture an ambiguity', () => {
  const review = inspectEventMigrationSources(ledger([canonical()], [source()], {
    timeline: { events: [direct('event-one')] }, planning: { version: 1, assignments: [{ eventId: 'event-one' }] }
  }))
  const reference = all(review.referencesPage)[1]!
  assert.equal(reference.result, 'resolved')
  assert.equal(reference.targetRowIndex, 1)
  assert.equal(all(review.rowsPage)[reference.targetRowIndex]!.ref.source, 'events')
})

test('all known planning event-reference collections retain every reference including repeated IDs', () => {
  const planning = { version: 1, assignments: [{ eventId: 'event-one' }],
    volumes: [{ volume: 2, eventIds: ['event-one', 'event-one'] }],
    eventChapterPlacements: [{ eventId: 'event-one', chapterId: 7 }],
    chapterConfirmations: [{ chapterId: 7, eventIds: ['event-one', 'missing'] }], unknown: ['保留'] }
  const snapshot = ledger([canonical()], [source()], { planning })
  const before = JSON.stringify(snapshot)
  const review = inspectEventMigrationSources(snapshot)
  const refs = all(review.referencesPage).filter(reference => reference.owner.source === 'planning')
  assert.equal(refs.length, 6)
  assert.deepEqual(refs.map(reference => reference.owner.path), ['assignments[0].eventId', 'volumes[0].eventIds[0]',
    'volumes[0].eventIds[1]', 'eventChapterPlacements[0].eventId', 'chapterConfirmations[0].eventIds[0]', 'chapterConfirmations[0].eventIds[1]'])
  assert.equal(refs.at(-1)!.result, 'missing-target')
  assert.equal(JSON.stringify(snapshot), before)
  assert.equal(review.summary.planningCoverage, 'ledger-and-chapter-identities')
  assert.ok(review.summary.planningBlockingCount > 0) // this deliberately incomplete old fixture has no chapter identity evidence
})

test('malformed planning collections, owners and IDs are explicit findings, not empty successful references', () => {
  const review = inspectEventMigrationSources(ledger([canonical()], [source()], {
    planning: { version: 1, assignments: null, volumes: [null, { eventIds: 'bad' }, { eventIds: [null, '', 'event-one'] }],
      eventChapterPlacements: [{ eventId: 42 }], chapterConfirmations: 'bad' }
  }))
  assert.equal(all(review.planningFindingsPage).filter(finding => ['invalid-collection', 'invalid-reference-owner'].includes(finding.code)
    && finding.path !== 'chapters').length, 4)
  assert.equal(review.summary.blockedReferenceCount, 3)
  assert.equal(all(review.referencesPage).filter(reference => reference.result === 'resolved').length, 2)
})

test('invalid individual rows are retained and cannot receive a default destination', () => {
  const review = inspectEventMigrationSources(ledger([null, 7, [], { id: 'broken' }], [null, false, {}], {
    timeline: { events: [null, [], { id: 'timeline-broken' }] }
  }))
  assert.equal(review.summary.rowCount, 10)
  assert.equal(review.summary.invalidRowCount, 10)
  assert.ok(all(review.rowsPage).every(row => row.recordProblem && row.defaultDisposition === null && row.recordCheck === 'invalid'))
})

test('version and legacy limits reject blanks, NULs, invalid status, oversized fields and malformed evidence without normalization', () => {
  const cases = [
    { ...canonical(), time: ' ' }, { ...canonical(), location: 'x'.repeat(501) }, { ...canonical(), event: '\u0000' },
    { ...canonical(), status: 'realized' }, { ...canonical(), characters: ['\u0000'] },
    { ...canonical(), evidenceRefs: [null] }, { ...canonical(), evidenceRefs: [{ sourceId: 'source-one', excerpt: ' ' }] },
    { ...canonical(), confidence: 2 }, { ...canonical(), id: ' padded ' }, { ...canonical(), result: null }
  ]
  const snapshot = ledger(cases)
  const review = inspectEventMigrationSources(snapshot)
  assert.equal(review.summary.invalidRowCount, cases.length)
  assert.ok(all(review.rowsPage).slice(1).every(row => row.recordCheck === 'invalid'))
})

test('direct representation bounds block rather than truncating title, names or result', () => {
  const events = [{ ...direct(), title: 'x'.repeat(201) }, { ...direct(), characters: 'x'.repeat(201) },
    { ...direct(), characters: Array.from({ length: 101 }, () => '甲').join('、') },
    { ...direct(), characters: '甲'.repeat(20_001) }, { ...direct(), characters: ' ; | ' }, { ...direct(), result: 'x'.repeat(20_001) }]
  const snapshot = retained({ timeline: { events } })
  const before = JSON.stringify(snapshot)
  assert.equal(inspectEventMigrationSources(snapshot).summary.invalidRowCount, events.length)
  assert.equal(JSON.stringify(snapshot), before)
})

test('unchanged preview is deterministic; an unknown metadata-only change changes the occurrence binding', () => {
  const first = retained({ timeline: { events: [direct()] } })
  assert.deepEqual(inspectEventMigrationSources(first).rowsPage(), inspectEventMigrationSources(first).rowsPage())
  const changed = retained({ timeline: { events: [{ ...direct(), extra: { unknown: true } }] } })
  const next = inspectEventMigrationSources(changed)
  assert.notEqual(next.fingerprint, inspectEventMigrationSources(first).fingerprint)
  assert.notEqual(next.rowsPage().items[0]!.ref.contentHash, inspectEventMigrationSources(first).rowsPage().items[0]!.ref.contentHash)
})

test('5,000 duplicate/conflict occurrences and group memberships remain fully paged with linear membership storage', context => {
  const snapshot = retained({ timeline: { events: Array.from({ length: 5_000 }, (_, index) => ({ ...direct('same-id'),
    event: index % 2 ? '发现回音' : '摧毁回音装置', result: String(index), extra: { ordinal: index } })) } })
  const started = performance.now()
  const review = inspectEventMigrationSources(snapshot)
  const rows = all(review.rowsPage)
  assert.equal(rows.length, 5_000)
  assert.deepEqual(rows.map(row => row.ref.ordinal), Array.from({ length: 5_000 }, (_, index) => index))
  for (const group of all(review.groupsPage)) {
    const members = all(offset => review.groupMembersPage(group.id, offset))
    assert.equal(members.length, group.memberCount)
    assert.equal(new Set(members).size, members.length)
  }
  assert.ok(rows.reduce((total, row) => total + row.groupIds.length, 0) <= 3 * rows.length)
  assert.equal(review.summary.invalidRowCount, 0)
  context.diagnostic(`5,000 retained review occurrences and all pages: ${Math.round(performance.now() - started)} ms (not desktop responsiveness acceptance)`)
})

test('page bounds and immutable results reject forged offsets and group IDs', () => {
  const review = inspectEventMigrationSources(retained({ timeline: { events: [direct(), direct()] } }))
  for (const offset of [-1, 0.5, NaN, Infinity, 3, Number.MAX_SAFE_INTEGER]) assert.throws(() => review.rowsPage(offset), validation)
  for (const id of [-1, 0.5, NaN, Infinity, 999]) assert.throws(() => review.groupMembersPage(id), validation)
  assert.equal(review.rowsPage(2).items.length, 0)
  assert.throws(() => { (review.rowsPage().items as unknown[]).pop() }, TypeError)
  assert.throws(() => { review.rowsPage().items[0]!.legacyStatus = 'approved' }, TypeError)
})

test('reference and planning-owner counts participate in the hard limit; no partial review is returned', () => {
  const snapshot = ledger([canonical()], [source()], { planning: { version: 1, assignments: [],
    volumes: [{ eventIds: Array.from({ length: 100_000 }, () => 'event-one') }] } })
  assert.throws(() => inspectEventMigrationSources(snapshot), error => validation(error)
    && (error as AppError).details?.area === 'eventMigrationReview')
})

test('retained ordinal and content-hash invariant failures fail closed rather than silently reindexing', () => {
  const snapshot = retained({ timeline: { events: [direct()] } })
  for (const document of [
    { ...snapshot.documents.timeline, contentHash: null },
    { ...snapshot.documents.timeline, occurrences: [{ ...snapshot.documents.timeline.occurrences[0]!, ordinal: 1 }] }
  ]) {
    const corrupted = { ...snapshot, documents: { ...snapshot.documents, timeline: document } }
    assert.throws(() => inspectEventMigrationSources(corrupted), error => error instanceof AppError && error.code === 'INVALID_PROJECT_STATE')
  }
})

test('extracted legacy validators preserve compatibility collection dedup while allowing singleton review', () => {
  const event = canonical()
  assert.doesNotThrow(() => assertCanonicalEvents([event]))
  assert.throws(() => assertCanonicalEvents([event, { ...event, id: 'different', result: 'different' }]), error => error instanceof AppError && error.code === 'CONFLICT')
  assert.doesNotThrow(() => assertMaterialSources([source()]))
  assert.throws(() => assertMaterialSources([source(), { ...source(), id: 'different' }]), error => error instanceof AppError && error.code === 'CONFLICT')
  assert.equal(normalizedMaterialUrl(' HTTPS://example.invalid/ref/ '), 'https://example.invalid/ref')
  for (const value of [null, [], { references: [null] }]) assert.throws(() => assertMaterialSources([value]), validation)
  assert.throws(() => assertCanonicalEvents([{ ...event, evidenceRefs: [null] }]), validation)
  assert.throws(() => assertMaterialSources([{ ...source(), references: [null] }]), validation)
})

test('real retained file acquisition plus review leaves all source bytes and absent database unchanged', async context => {
  const parent = await canonicalDirectory(tmpdir())
  const root = await canonicalDirectory(await mkdtemp(join(parent, 'novel-event-review-')))
  context.after(async () => { assert.ok(root.startsWith(join(parent, 'novel-event-review-'))); await rm(root, { recursive: true, force: true }) })
  const paths = { sources: '.webnovel/research/sources.json', events: '.webnovel/research/events.json', timeline: '.webnovel/config/timeline.json' }
  const payloads = { sources: JSON.stringify({ version: 1, sources: [source(), { id: 'source-one' }] }),
    events: JSON.stringify({ version: 1, events: [canonical()] }),
    timeline: '\uFEFF' + JSON.stringify({ events: [{ ...direct(), result: '' }, direct(), null], extra: '原样保留' }) + '\r\n' }
  for (const kind of Object.keys(paths) as Array<keyof typeof paths>) {
    const target = join(root, paths[kind]); await mkdir(dirname(target), { recursive: true }); await writeFile(target, payloads[kind])
  }
  const manifest = async (directory = root): Promise<Record<string, string>> => {
    const result: Record<string, string> = {}
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) Object.assign(result, await manifest(path))
      else result[relative(root, path)] = hash(await readFile(path))
    }
    return result
  }
  const before = await manifest()
  const reader = new LocalEventSourceSnapshotReader(new SqliteWorkspaceDatabaseFactory())
  const snapshot = await reader.capture({ workItemId: root, root, generation: 1 })
  const review = inspectEventMigrationSources(snapshot)
  assert.equal(review.summary.rowCount, 6)
  assert.equal(review.summary.invalidRowCount, 2)
  assert.equal(review.referencesPage().items[0]!.result, 'ambiguous-target')
  assert.equal(snapshot.database, null)
  assert.deepEqual(await manifest(), before)
  assert.equal(Buffer.from(snapshot.files.timeline.base64!, 'base64').toString('utf8'), payloads.timeline)
})
