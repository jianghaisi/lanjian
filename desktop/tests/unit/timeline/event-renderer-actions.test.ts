import assert from 'node:assert/strict'
import test from 'node:test'
import { WorkspaceRequestGuard } from '../../../src/contracts/library/workspace-request-guard'
// @ts-expect-error Renderer composition modules are JavaScript and intentionally have no declaration emit.
import { createTimelineEditingActions } from '../../../src/renderer/features/timeline/composables/create-editing-actions.js'
// @ts-expect-error Renderer view adapters are JavaScript and intentionally have no declaration emit.
import { activeEventRows, archivedEventRows, candidateEventRows } from '../../../src/renderer/features/timeline/event-projection-view.js'
// @ts-expect-error Renderer composition modules are JavaScript and intentionally have no declaration emit.
import { createEventMigrationActions } from '../../../src/renderer/features/timeline/composables/create-migration-actions.js'

const content = { title: '旧城回音', time: '第一夜', characters: ['和田'], rawCharacters: '和田', location: '旧城',
  event: '听见回音', result: '决定追查', evidenceRefs: [], confidence: 1 }

test('both timeline routes discard an A→B→A stale candidate and preserve the new A request loading state', async () => {
  for (const unified of [false, true]) {
    const workspaceRequests = new WorkspaceRequestGuard(), book = { id: 'book-a', path: '/book-a' }, pending: Array<(value: unknown) => void> = []
    const current = { value: book }; workspaceRequests.begin(book)
    const refs = { current, unifiedEventMode: { value: unified }, timelineAiGenerating: { value: false }, timelineAiCandidates: { value: [] as any[] }, expandedTimelineEntry: { value: '' }, approvedEvents: { value: [] }, timeline: { value: [] }, bookProfile: { value: {} }, foundation: { value: { sourceNotes: '', worldView: '' } }, totalOutline: { value: '' } }
    const complete = () => new Promise(resolve => pending.push(resolve))
    const actions = createTimelineEditingActions({ ...refs, workspaceRequests, guard: (fn: () => unknown) => fn(), plainDto: (value: unknown) => value, desktop: { ai: { complete }, events: { generateModelCandidates: complete } } })
    const old = actions.generateTimelineCandidates(); workspaceRequests.begin({ id: 'book-b', path: '/book-b' }); workspaceRequests.begin(book)
    const fresh = actions.generateTimelineCandidates()
    const output = (title: string) => unified ? { taskId: title, artifactId: title, artifactHash: 'a'.repeat(64), candidates: [{ id: title, title, time: '次日', characters: '资料员', location: '档案室', event: title, result: '待审', candidateIndex: 0 }] } : { content: JSON.stringify([{ title, time: '次日', characters: '资料员', location: '档案室', event: title, result: '待审' }]) }
    pending[0](output('stale')); await old; assert.equal(refs.timelineAiCandidates.value.length, 0); assert.equal(refs.timelineAiGenerating.value, true)
    pending[1](output('fresh')); await fresh; assert.equal(refs.timelineAiCandidates.value[0]?.title, 'fresh'); assert.equal(refs.timelineAiGenerating.value, false)
  }
})

function projected(eventId = 'event-one', versionId = 'version-one', value: any = content) {
  return { eventId, versionId, version: 1, content: value, granularity: 'macro', phase: 'planned', creator: 'author', sources: [],
    createdAt: '2026-09-20T00:00:00.000Z' }
}

function projection(value = content) {
  return { version: 1, workItemId: 'book-one', revision: 'revision-one', approvedRevision: 'a'.repeat(64), candidateRevision: 'b'.repeat(64),
    operationId: 'operation-one:1', committedAt: '2026-09-20T00:00:00.000Z', ordering: 'author-display',
    state: { order: { id: 'order-one', revision: 1, eventIds: ['event-one'], contentHash: 'c'.repeat(64), createdAt: '2026-09-20T00:00:00.000Z' },
      lifecycles: [{ id: 'lifecycle-one', eventId: 'event-one', revision: 1, expectedEventVersionId: 'version-one', state: 'active', createdAt: '2026-09-20T00:00:00.000Z' }] },
    approved: [projected('event-one', 'version-one', value)], candidates: [], archived: [], mirror: null }
}

test('renderer projection rows preserve version, lifecycle, candidate and archive identities', () => {
  const base = projection()
  const candidate = projected('candidate-one', 'candidate-version', { ...content, event: '候选事件' })
  const archived = projected('archived-one', 'archived-version', { ...content, event: '归档事件' })
  const value = { ...base,
    state: { ...base.state, lifecycles: [...base.state.lifecycles,
      { id: 'candidate-life', eventId: 'candidate-one', revision: 1, expectedEventVersionId: 'candidate-version', state: 'active', createdAt: base.committedAt },
      { id: 'archived-life', eventId: 'archived-one', revision: 2, expectedEventVersionId: 'archived-version', state: 'archived', createdAt: base.committedAt }] },
    candidates: [candidate], archived: [{ lifecycle: { id: 'archived-life', eventId: 'archived-one', revision: 2,
      expectedEventVersionId: 'archived-version', state: 'archived', createdAt: base.committedAt }, approved: archived, candidate: null }] }
  assert.equal(activeEventRows(value)[0]?.lifecycleId, 'lifecycle-one')
  assert.equal(candidateEventRows(value)[0]?._unifiedCandidate, true)
  assert.equal(archivedEventRows(value)[0]?.versionId, 'archived-version')
})

test('unified chronicle edit commits through desktop.events and refreshes its projection', async () => {
  const values = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key)
  } })
  let currentProjection = projection()
  let previewInput: any = null
  let workflowRefreshes = 0
  const refs = {
    expandedTimelineEntry: { value: '' }, timeline: { value: [] as any[] }, eventProjection: { value: currentProjection as any },
    unifiedEvents: { value: activeEventRows(currentProjection) as any[] }, archivedUnifiedEvents: { value: [] as any[] },
    unifiedEventCandidates: { value: [] as any[] }, unifiedEventMode: { value: true }, timelineAiCandidates: { value: [] as any[] },
    timelineAiGenerating: { value: false }, approvedEvents: { value: [] as any[] }, current: { value: { id: 'book-one' } },
    bookProfile: { value: {} }, foundation: { value: { sourceNotes: '', worldView: '' } }, totalOutline: { value: '' }, busy: { value: false },
    active: { value: '' }, materialSection: { value: '' }, eventDraft: { value: {} }, canonicalEvents: { value: [] as any[] }
  }
  const ports = { ...refs,
    desktop: { events: {
      previewOperation: async (input: any) => { previewInput = input; return { token: 'token:1', operationId: 'operation:1', requestHash: 'd'.repeat(64) } },
      commitOperation: async () => {
        const nextContent = previewInput.content
        currentProjection = { ...projection(nextContent), revision: 'revision-two', state: { ...projection(nextContent).state,
          order: { ...projection(nextContent).state.order, id: 'order-two' },
          lifecycles: [{ ...projection(nextContent).state.lifecycles[0], id: 'lifecycle-two', expectedEventVersionId: 'version-two' }] },
          approved: [projected('event-one', 'version-two', nextContent)] }
        return { receipt: { operationId: 'operation:1', kind: 'edit', requestHash: 'd'.repeat(64), eventId: 'event-one',
          versionId: 'version-two', lifecycleId: 'lifecycle-two', orderId: 'order-two', noOp: false, committedAt: currentProjection.committedAt },
          mirror: { status: 'synced', issue: 'none' } }
      },
      projection: async () => currentProjection
    }, workspace: { saveTimeline: async () => assert.fail('legacy timeline writer must not run') } },
    guard: async (operation: () => Promise<any>) => operation(), notice: () => {}, plainDto: (value: any) => structuredClone(value),
    workspaceRequests: { capture: () => ({ workItemId: 'book-one' }), isCurrent: () => true },
    refreshWorkflow: async () => { workflowRefreshes += 1 }
  }
  const actions = createTimelineEditingActions(ports as any)
  actions.updateChronicleField('formal', 'event-one', 'result', '循声进入钟楼')
  await actions.saveTimeline()

  assert.equal(previewInput.kind, 'edit')
  assert.equal(previewInput.expectedVersionId, 'version-one')
  assert.equal(previewInput.content.result, '循声进入钟楼')
  assert.equal(refs.eventProjection.value.revision, 'revision-two')
  assert.equal(refs.unifiedEvents.value[0]?.versionId, 'version-two')
  assert.equal(workflowRefreshes, 1)
  assert.equal(values.size, 0)
})

test('unified material candidates use reviewed create and exact-version adoption instead of legacy research writes', async () => {
  const values = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key)
  } })
  let currentProjection: any = projection()
  let materialInput: any = null
  let operationInput: any = null
  let commitKind: 'create' | 'adopt' = 'create'
  const candidateContent = { ...content, time: '第三夜', event: '查阅地方志',
    evidenceRefs: [{ sourceId: 'source-one', excerpt: '旧钟楼每逢无月会多响一声。' }] }
  const candidate = projected('event-two', 'candidate-version', candidateContent)
  const candidateLifecycle = { id: 'candidate-life', eventId: 'event-two', revision: 1,
    expectedEventVersionId: 'candidate-version', state: 'active', createdAt: currentProjection.committedAt }
  const refs = {
    expandedTimelineEntry: { value: '' }, timeline: { value: [] as any[] }, eventProjection: { value: currentProjection },
    unifiedEvents: { value: activeEventRows(currentProjection) as any[] }, archivedUnifiedEvents: { value: [] as any[] },
    unifiedEventCandidates: { value: [] as any[] }, unifiedEventMode: { value: true }, timelineAiCandidates: { value: [] as any[] },
    timelineAiGenerating: { value: false }, approvedEvents: { value: [] as any[] }, current: { value: { id: 'book-one' } },
    bookProfile: { value: {} }, foundation: { value: { sourceNotes: '', worldView: '' } }, totalOutline: { value: '' }, busy: { value: false },
    active: { value: '' }, materialSection: { value: '' },
    eventDraft: { value: { sourceId: 'source-one', time: '第三夜', characters: '和田', location: '旧城', event: '查阅地方志', result: '' } },
    canonicalEvents: { value: [] as any[] }
  }
  const candidateRecord = { id: 'event-two', time: candidateContent.time, characters: candidateContent.characters,
    location: candidateContent.location, event: candidateContent.event, evidenceRefs: candidateContent.evidenceRefs,
    confidence: 1, status: 'candidate', createdAt: currentProjection.committedAt }
  const ports = { ...refs,
    desktop: { events: {
      previewMaterialCandidate: async (input: any) => { materialInput = input; return { token: 'candidate-token:1', operationId: 'candidate-operation:1', kind: 'create', requestHash: 'e'.repeat(64) } },
      previewOperation: async (input: any) => { operationInput = input; return { token: 'adopt-token:1', operationId: 'adopt-operation:1', kind: 'adopt', requestHash: 'f'.repeat(64) } },
      commitOperation: async () => {
        if (commitKind === 'create') {
          currentProjection = { ...currentProjection, revision: 'candidate-revision', candidateRevision: 'd'.repeat(64),
            state: { order: { ...currentProjection.state.order, id: 'order-two', revision: 2, eventIds: ['event-one', 'event-two'] },
              lifecycles: [...currentProjection.state.lifecycles, candidateLifecycle] }, candidates: [candidate] }
          return { receipt: { operationId: 'candidate-operation:1', kind: 'create', requestHash: 'e'.repeat(64), eventId: 'event-two',
            versionId: 'candidate-version', lifecycleId: 'candidate-life', orderId: 'order-two', noOp: false, committedAt: currentProjection.committedAt }, mirror: { status: 'synced', issue: 'none' } }
        }
        const approved = { ...candidate, versionId: 'approved-version', version: 2 }
        currentProjection = { ...currentProjection, revision: 'approved-revision', approvedRevision: 'e'.repeat(64),
          approved: [...currentProjection.approved, approved], candidates: [],
          state: { ...currentProjection.state, lifecycles: currentProjection.state.lifecycles.map((item: any) => item.eventId === 'event-two'
            ? { ...item, expectedEventVersionId: 'approved-version' } : item) } }
        return { receipt: { operationId: 'adopt-operation:1', kind: 'adopt', requestHash: 'f'.repeat(64), eventId: 'event-two',
          versionId: 'approved-version', lifecycleId: 'candidate-life', orderId: 'order-two', noOp: false, committedAt: currentProjection.committedAt }, mirror: { status: 'synced', issue: 'none' } }
      },
      projection: async () => currentProjection
    }, research: {
      createEventCandidate: async () => assert.fail('legacy candidate writer must not run'),
      approveEvent: async () => assert.fail('legacy candidate approval must not run'),
      listEvents: async () => ({ events: [{ ...candidateRecord, status: commitKind === 'create' ? 'candidate' : 'approved',
        ...(commitKind === 'adopt' ? { approvedAt: currentProjection.committedAt } : {}) }] })
    } },
    guard: async (operation: () => Promise<any>) => operation(), notice: () => {}, plainDto: (value: any) => structuredClone(value),
    workspaceRequests: { capture: () => ({ workItemId: 'book-one' }), isCurrent: () => true }, refreshWorkflow: async () => {}
  }

  const actions = createTimelineEditingActions(ports as any)
  await actions.createEventCandidate()
  assert.equal(materialInput.expectedOrderId, 'order-one')
  assert.equal(materialInput.sourceId, 'source-one')
  assert.deepEqual(materialInput.characters, ['和田'])
  assert.equal(refs.unifiedEventCandidates.value[0]?.versionId, 'candidate-version')
  assert.equal(refs.canonicalEvents.value[0]?.status, 'candidate')

  commitKind = 'adopt'
  await actions.approveCanonicalEvent('event-two')
  assert.deepEqual(operationInput, { kind: 'adopt', expectedOrderId: 'order-two', eventId: 'event-two',
    expectedVersionId: 'candidate-version', expectedLifecycleId: 'candidate-life' })
  assert.equal(refs.unifiedEventCandidates.value.length, 0)
  assert.equal(refs.unifiedEvents.value.at(-1)?.versionId, 'approved-version')
  assert.equal(refs.canonicalEvents.value[0]?.status, 'approved')
  assert.equal(values.size, 0)
})

test('unified AI timeline generation uses persisted model Artifacts before candidate creation and adoption', async () => {
  const values = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key)
  } })
  let currentProjection: any = projection(), generatedInput: any = null, modelPreviewInput: any = null, operationInput: any = null
  let commitKind: 'model-create' | 'adopt' = 'model-create'
  const modelContent = { ...content, title: '钟楼异响', time: '第三夜', characters: ['和田', '顾岚'], rawCharacters: undefined,
    event: '两人在封锁后听见第十三声钟响', result: '确认旧案并未结束' }
  delete modelContent.rawCharacters
  const modelCandidate = { ...projected('event-model', 'model-version', modelContent), creator: 'model-candidate' }
  const modelLifecycle = { id: 'model-life', eventId: 'event-model', revision: 1,
    expectedEventVersionId: 'model-version', state: 'active', createdAt: currentProjection.committedAt }
  const refs = {
    expandedTimelineEntry: { value: '' }, timeline: { value: [] as any[] }, eventProjection: { value: currentProjection },
    unifiedEvents: { value: activeEventRows(currentProjection) as any[] }, archivedUnifiedEvents: { value: [] as any[] },
    unifiedEventCandidates: { value: [] as any[] }, unifiedEventMode: { value: true }, timelineAiCandidates: { value: [] as any[] },
    timelineAiGenerating: { value: false }, approvedEvents: { value: [] as any[] },
    current: { value: { id: 'book-one', title: '旧城疑案' } },
    bookProfile: { value: { genre: '悬疑', subgenre: '', coreIdea: '追查旧案', plannedVolumes: 3, chaptersPerVolume: 20, targetWordsPerChapter: 3000 } },
    foundation: { value: { sourceNotes: '', worldView: '旧城' } }, totalOutline: { value: '钟楼旧案贯穿全书' }, busy: { value: false },
    active: { value: '' }, materialSection: { value: '' }, eventDraft: { value: {} }, canonicalEvents: { value: [] as any[] }
  }
  const ports = { ...refs,
    desktop: {
      ai: { complete: async () => assert.fail('generic renderer AI route must not run in unified mode') },
      events: {
        generateModelCandidates: async (input: any) => {
          generatedInput = input
          return { operationId: input.operationId, taskId: 'task-model', artifactId: 'artifact-model', artifactHash: 'a'.repeat(64),
            model: 'fixture-model', candidates: [{ id: 'task-model:0', candidateIndex: 0, title: '钟楼异响', time: '第三夜',
              characters: '和田、顾岚', location: '旧城', event: modelContent.event, result: modelContent.result }] }
        },
        previewModelCandidate: async (input: any) => { modelPreviewInput = input
          return { token: 'model-token:1', operationId: 'model-operation:1', kind: 'create', requestHash: 'e'.repeat(64) } },
        previewOperation: async (input: any) => { operationInput = input
          return { token: 'adopt-token:1', operationId: 'adopt-operation:1', kind: 'adopt', requestHash: 'f'.repeat(64) } },
        commitOperation: async () => {
          if (commitKind === 'model-create') {
            currentProjection = { ...currentProjection, revision: 'model-candidate-revision', candidateRevision: 'd'.repeat(64),
              state: { order: { ...currentProjection.state.order, id: 'order-model', revision: 2, eventIds: ['event-one', 'event-model'] },
                lifecycles: [...currentProjection.state.lifecycles, modelLifecycle] }, candidates: [modelCandidate] }
            commitKind = 'adopt'
            return { receipt: { operationId: 'model-operation:1', kind: 'create', requestHash: 'e'.repeat(64), eventId: 'event-model',
              versionId: 'model-version', lifecycleId: 'model-life', orderId: 'order-model', noOp: false, committedAt: currentProjection.committedAt },
              mirror: { status: 'synced', issue: 'none' } }
          }
          const approved = { ...modelCandidate, versionId: 'model-approved-version', version: 2, creator: 'author' }
          currentProjection = { ...currentProjection, revision: 'model-approved-revision', approvedRevision: 'e'.repeat(64),
            approved: [...currentProjection.approved, approved], candidates: [], state: { ...currentProjection.state,
              lifecycles: currentProjection.state.lifecycles.map((item: any) => item.eventId === 'event-model'
                ? { ...item, expectedEventVersionId: 'model-approved-version' } : item) } }
          return { receipt: { operationId: 'adopt-operation:1', kind: 'adopt', requestHash: 'f'.repeat(64), eventId: 'event-model',
            versionId: 'model-approved-version', lifecycleId: 'model-life', orderId: 'order-model', noOp: false, committedAt: currentProjection.committedAt },
            mirror: { status: 'synced', issue: 'none' } }
        },
        projection: async () => currentProjection
      }
    },
    guard: async (operation: () => Promise<any>) => operation(), notice: () => {}, plainDto: (value: any) => structuredClone(value),
    workspaceRequests: { capture: () => ({ workItemId: 'book-one' }), isCurrent: () => true }, refreshWorkflow: async () => {}
  }

  const actions = createTimelineEditingActions(ports as any)
  await actions.generateTimelineCandidates()
  assert.equal(generatedInput.context.genre, '悬疑')
  assert.equal(refs.timelineAiCandidates.value[0]?._modelCandidate.artifactId, 'artifact-model')
  await actions.adoptTimelineCandidate(refs.timelineAiCandidates.value[0])
  assert.deepEqual(modelPreviewInput, { expectedOrderId: 'order-one', taskId: 'task-model', artifactId: 'artifact-model', candidateIndex: 0 })
  assert.deepEqual(operationInput, { kind: 'adopt', expectedOrderId: 'order-model', eventId: 'event-model',
    expectedVersionId: 'model-version', expectedLifecycleId: 'model-life' })
  assert.equal(refs.timelineAiCandidates.value.length, 0)
  assert.equal(refs.unifiedEvents.value.at(-1)?.versionId, 'model-approved-version')
  assert.equal(values.size, 0)
})

test('unified chronicle recovers a durable archive receipt when commit response remains pending', async () => {
  const values = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key)
  } })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { confirm: () => true } })
  const initial = projection()
  const archivedVersion = projected()
  let currentProjection: any = initial
  let previewInput: any = null
  const refs = {
    expandedTimelineEntry: { value: '' }, timeline: { value: [] as any[] }, eventProjection: { value: initial as any },
    unifiedEvents: { value: activeEventRows(initial) as any[] }, archivedUnifiedEvents: { value: [] as any[] },
    unifiedEventCandidates: { value: [] as any[] }, unifiedEventMode: { value: true }, timelineAiCandidates: { value: [] as any[] },
    timelineAiGenerating: { value: false }, approvedEvents: { value: [] as any[] }, current: { value: { id: 'book-one' } },
    bookProfile: { value: {} }, foundation: { value: { sourceNotes: '', worldView: '' } }, totalOutline: { value: '' }, busy: { value: false },
    active: { value: '' }, materialSection: { value: '' }, eventDraft: { value: {} }, canonicalEvents: { value: [] as any[] }
  }
  const receipt = { operationId: 'archive-operation:1', kind: 'archive', requestHash: 'e'.repeat(64), eventId: 'event-one',
    versionId: 'version-one', lifecycleId: 'lifecycle-two', orderId: 'order-one', noOp: false, committedAt: initial.committedAt }
  let projectionReads = 0
  const ports = { ...refs, eventOperationResponseTimeoutMs: 1,
    desktop: { events: {
      previewOperation: async (input: any) => { previewInput = input; return { token: 'archive-token:1', operationId: receipt.operationId, requestHash: receipt.requestHash } },
      commitOperation: async () => new Promise(() => {}),
      operationReceipt: async () => {
        currentProjection = { ...initial, revision: 'revision-archived', approved: [],
          state: { ...initial.state, lifecycles: [{ ...initial.state.lifecycles[0], id: 'lifecycle-two', revision: 2, state: 'archived' }] },
          archived: [{ lifecycle: { ...initial.state.lifecycles[0], id: 'lifecycle-two', revision: 2, state: 'archived' }, approved: archivedVersion, candidate: null }] }
        return receipt
      },
      projection: async () => ++projectionReads === 1 ? initial : currentProjection
    } },
    guard: async (operation: () => Promise<any>) => operation(), notice: () => {}, plainDto: (value: any) => structuredClone(value),
    workspaceRequests: { capture: () => ({ workItemId: 'book-one' }), isCurrent: () => true }, refreshWorkflow: async () => {}
  }

  const actions = createTimelineEditingActions(ports as any)
  await actions.archiveTimelineEvent('event-one')

  assert.equal(previewInput.kind, 'archive')
  assert.equal(refs.eventProjection.value.revision, 'revision-archived')
  assert.equal(refs.unifiedEvents.value.length, 0)
  assert.equal(refs.archivedUnifiedEvents.value[0]?.lifecycleId, 'lifecycle-two')
  assert.equal(projectionReads, 2)
  assert.equal(values.size, 0)
})

test('desktop migration review requires every warning acknowledgement before switching projection', async () => {
  const migrated = projection()
  const state = { value: null as any }, error = { value: '' }, busy = { value: false }
  const eventProjection = { value: null as any }, unifiedEvents = { value: [] as any[] }, archived = { value: [] as any[] }
  const candidates = { value: [] as any[] }, timeline = { value: [{ id: 'legacy' }] as any[] }
  let reviewed: any = null
  const actions = createEventMigrationActions({
    desktop: { events: {
      previewMigration: async () => ({ previewId: 'preview:1', fingerprint: 'f'.repeat(64), expiresAt: 1,
        summary: { rowCount: 2, referenceCount: 0, groupCount: 1, invalidRowCount: 0, blockedRowCount: 0,
          blockingGroupCount: 0, blockedReferenceCount: 0, planningFindingCount: 1, inspectedUnits: 4,
          planningBlockingCount: 0, planningCoverage: 'ledger-and-chapter-identities', authorReviewRequired: true },
        requiredMirrorAcknowledgements: ['timeline'] }),
      migrationPage: async ({ kind }: any) => kind === 'rows'
        ? { items: [
          { index: 0, ref: { source: 'events', contentHash: 'a'.repeat(64), ordinal: 0, originalId: 'event-one' }, recordCheck: 'valid', recordProblem: null, legacyStatus: 'approved', proposedCharacters: ['和田'], groupIds: [7], defaultDisposition: 'keep-separate' },
          { index: 1, ref: { source: 'timeline', contentHash: 'b'.repeat(64), ordinal: 0, originalId: 'direct-one' }, recordCheck: 'valid', recordProblem: null, legacyStatus: 'direct-unconfirmed', proposedCharacters: ['林照'], groupIds: [7], defaultDisposition: 'keep-separate' }
        ], nextOffset: null }
        : kind === 'groups' ? { items: [{ id: 7, kind: 'possible-duplicate', severity: 'review', memberCount: 2 }], nextOffset: null }
          : { items: [{ path: 'volumes[0]', code: 'stale-confirmation', severity: 'review' }], nextOffset: null },
      reviewMigration: async (input: any) => { reviewed = input; return { token: 'grant:1', operationId: 'migration:1' } },
      commitMigration: async () => ({ receipt: {}, mirror: { status: 'synced', issue: 'none' } }),
      projection: async () => migrated,
      cancelMigration: async () => true
    } },
    current: { value: { id: 'book-one', path: 'book-one' } }, workspaceRequests: { capture: () => ({ workItemId: 'book-one' }), isCurrent: () => true },
    eventProjection, unifiedEvents, archivedUnifiedEvents: archived, unifiedEventCandidates: candidates,
    unifiedEventMode: { value: false }, timeline, eventMigrationState: state, eventMigrationBusy: busy, eventMigrationError: error,
    notice: () => {}, refreshWorkflow: async () => {}
  } as any)

  await actions.openEventMigration()
  assert.equal(actions.migrationReady(state.value), false)
  actions.toggleMigrationAcknowledgement('acknowledgedGroups', 7, true)
  actions.toggleMigrationAcknowledgement('acknowledgedPlanningFindings', 0, true)
  actions.toggleMigrationAcknowledgement('acknowledgedMirrors', 'timeline', true)
  assert.equal(actions.migrationReady(state.value), true)
  await actions.commitEventMigration()

  assert.deepEqual(reviewed.rows, [{ rowIndex: 0, disposition: 'keep-separate' }, { rowIndex: 1, disposition: 'keep-separate' }])
  assert.equal(eventProjection.value.revision, migrated.revision)
  assert.equal(unifiedEvents.value[0]?.id, 'event-one')
  assert.deepEqual(timeline.value, [])
  assert.equal(state.value, null)
})

test('desktop recovers an early migrated book through explicit state initialization and lost-response projection', async () => {
  const migrated = projection()
  const state = { value: null as any }, error = { value: '' }, busy = { value: false }
  const eventProjection = { value: null as any }, unifiedEvents = { value: [] as any[] }, archived = { value: [] as any[] }
  const candidates = { value: [] as any[] }, timeline = { value: [{ id: 'legacy' }] as any[] }
  let committed = ''
  const notices: string[] = []
  const actions = createEventMigrationActions({
    desktop: { events: {
      previewMigration: async () => { throw { code: 'FEATURE_UNAVAILABLE', message: '已有迁移证据' } },
      previewStateInitialization: async () => ({ token: 'state-token', migrationOperationId: 'migration-one',
        eventCount: 1, orderHash: 'a'.repeat(64), expiresAt: 1_800_000 }),
      commitStateInitialization: async (token: string) => { committed = token; throw { code: 'STORAGE_ERROR', message: 'response lost' } },
      projection: async () => migrated,
      cancelMigration: async () => true
    } },
    current: { value: { id: 'book-one', path: 'book-one' } },
    workspaceRequests: { capture: () => ({ workItemId: 'book-one' }), isCurrent: () => true },
    eventProjection, unifiedEvents, archivedUnifiedEvents: archived, unifiedEventCandidates: candidates,
    unifiedEventMode: { value: false }, timeline, eventMigrationState: state, eventMigrationBusy: busy, eventMigrationError: error,
    notice: (value: string) => notices.push(value), refreshWorkflow: async () => {}
  } as any)

  await actions.openEventMigration()
  assert.equal(state.value.kind, 'state-initialization')
  assert.equal(actions.migrationReady(state.value), true)
  await actions.commitEventMigration()
  assert.equal(committed, 'state-token')
  assert.equal(eventProjection.value.revision, migrated.revision)
  assert.equal(unifiedEvents.value[0]?.id, 'event-one')
  assert.deepEqual(timeline.value, [])
  assert.deepEqual(notices, ['事件顺序与归档状态已恢复'])
  assert.equal(error.value, '')
})
