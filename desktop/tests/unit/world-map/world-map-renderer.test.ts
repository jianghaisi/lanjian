import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorldMapWorkspace } from '../../../src/renderer/features/world-map/composables/world-map-workspace'
import { WorkspaceRequestGuard, type WorkspaceIdentity } from '../../../src/contracts/library/workspace-request-guard'
import type { WorldMapImageCandidate, WorldMapLayoutView, WorldMapView } from '../../../src/contracts/world-map/world-map'

const fixture = (workItemId = 'a', revision = 'a'.repeat(64)): WorldMapView => ({
  workItemId, revision, document: { version: 1, markers: [] }, mirrorStatus: null, events: [], chapters: []
})
const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b })
  return { promise, resolve, reject }
}

test('an unresolved read is cancellable immediately and its late view cannot re-enter the page', async () => {
  const current = { id: 'a', path: 'book-a' }, guard = new WorkspaceRequestGuard(); guard.begin(current)
  const read = deferred<WorldMapView>()
  const state = createWorldMapWorkspace({ getWorldMap: () => read.promise, saveWorldMap: async () => fixture() }, () => current, guard, () => {})
  const waiting = state.load()
  assert.equal(state.loading.value, true); assert.equal(state.canLeave(), true)
  state.cancelRead()
  assert.equal(state.loading.value, false)
  read.resolve(fixture()); await waiting
  assert.equal(state.view.value, null)
})

test('reload during generation cannot invalidate its completion or leave a permanent busy flag', async () => {
  const current = { id: 'a', path: 'book-a' }, guard = new WorkspaceRequestGuard(); guard.begin(current)
  const generated = deferred<WorldMapImageCandidate>(); let reads = 0
  const state = createWorldMapWorkspace({ getWorldMap: async () => { reads++; return fixture() }, saveWorldMap: async () => fixture(), generateWorldMapImage: () => generated.promise }, () => current, guard, () => {})
  await state.load()
  const running = state.generate({ connectionId: 'provider', model: 'test', stylePreset: 'paper-atlas' })
  await state.load()
  assert.equal(reads, 1)
  generated.reject(new Error('test failure')); await running
  assert.equal(state.generating.value, false); assert.equal(state.canLeave(), true)
})

test('reload cannot strand adoption completion and formal writes still protect navigation', async () => {
  const current = { id: 'a', path: 'book-a' }, guard = new WorkspaceRequestGuard(); guard.begin(current)
  const receipt = deferred<WorldMapLayoutView>(); let reads = 0
  const state = createWorldMapWorkspace({ getWorldMap: async () => { reads++; return fixture() }, saveWorldMap: async () => fixture(), adoptWorldMapImage: () => receipt.promise }, () => current, guard, () => {})
  await state.load()
  state.candidate.value = { candidateId: 'e'.repeat(64), workItemId: 'a', expectedRevision: 'a'.repeat(64), sourceFingerprint: 'f'.repeat(64), stylePreset: 'paper-atlas', model: 'test', connectionName: 'test', promptSummary: { locations: 1, events: 1, characters: 0, sentCharacters: 10 }, image: { dataUrl: 'data:image/png;base64,test', format: 'png', width: 1536, height: 1024 } }
  const adopting = state.adopt()
  assert.equal(state.canLeave(), false)
  await state.load(); assert.equal(reads, 1)
  receipt.resolve(fixture('a', 'b'.repeat(64))); await adopting
  assert.equal(state.adopting.value, false); assert.equal(state.canLeave(), true)
  assert.equal(state.view.value?.revision, 'b'.repeat(64))
})

test('cancel generation releases local navigation even if cancel IPC never returns', async () => {
  const current = { id: 'a', path: 'book-a' }, guard = new WorkspaceRequestGuard(); guard.begin(current)
  const generated = deferred<WorldMapImageCandidate>(), cancel = deferred<{ cancelled: boolean }>()
  const state = createWorldMapWorkspace({ getWorldMap: async () => fixture(), saveWorldMap: async () => fixture(), generateWorldMapImage: () => generated.promise, cancelWorldMapImage: () => cancel.promise }, () => current, guard, () => {})
  await state.load()
  const running = state.generate({ connectionId: 'provider', model: 'test', stylePreset: 'paper-atlas' })
  await state.cancelGeneration()
  assert.equal(state.generating.value, false); assert.equal(state.canLeave(), true)
  generated.reject(new Error('late failure')); await running
  assert.match(state.generationError.value, /已停止等待/)
  cancel.reject(new Error('late cancel failure')); await Promise.resolve()
})

test('map renderer rejects old same-book reload, switched path and late errors', async () => {
  let current: WorkspaceIdentity | null = { id: 'a', path: 'book-a' }
  const guard = new WorkspaceRequestGuard(); guard.begin(current)
  const responses = [deferred<WorldMapView>(), deferred<WorldMapView>(), deferred<WorldMapView>()]
  let count = 0
  const state = createWorldMapWorkspace({ getWorldMap: () => responses[count++]!.promise, saveWorldMap: async () => fixture() }, () => current, guard, () => {})
  const old = state.load(), latest = state.load()
  responses[1]!.resolve(fixture('a', 'b'.repeat(64))); await latest
  responses[0]!.resolve(fixture()); await old
  assert.equal(state.view.value?.revision, 'b'.repeat(64))
  const lateError = state.load()
  current = { id: 'a', path: 'copied-a' }; guard.begin(current); state.reset()
  responses[2]!.reject(new Error('late failure')); await lateError
  assert.equal(state.view.value, null); assert.equal(state.error.value, '')
  assert.equal(state.loading.value, false)
})

test('map renderer keeps unsaved work on failure and blocks departure and duplicate save', async () => {
  const current = { id: 'a', path: 'book-a' }, guard = new WorkspaceRequestGuard()
  guard.begin(current)
  const pending = deferred<WorldMapView>(), notices: string[] = []
  let writes = 0
  const state = createWorldMapWorkspace({ getWorldMap: async () => fixture(), saveWorldMap: async input => {
    writes += 1; assert.equal(input.workItemId, 'a'); assert.equal(input.expectedRevision, 'a'.repeat(64))
    return pending.promise
  } }, () => current, guard, message => notices.push(message))
  await state.load(); state.dirty.value = true
  assert.equal(state.canLeave(), false)
  const document = { version: 1 as const, markers: [{ location: '旧城', x: 25, y: 40 }] }
  const save = state.save(document)
  await state.save(document)
  assert.equal(writes, 1); assert.equal(state.canLeave(), false)
  pending.reject({ code: 'CONFLICT' }); await save
  assert.equal(state.dirty.value, true); assert.match(state.saveError.value, /版本已变化/)
  assert.equal(state.saving.value, false); assert.equal(notices.some(message => message.includes('已保存')), false)
})

test('map renderer stale save receipt cannot replace new work', async () => {
  let current = { id: 'a', path: 'book-a' }
  const guard = new WorkspaceRequestGuard(); guard.begin(current)
  const pending = deferred<WorldMapView>(), notices: string[] = []
  const state = createWorldMapWorkspace({ getWorldMap: async () => fixture(current.id), saveWorldMap: () => pending.promise }, () => current, guard, message => notices.push(message))
  await state.load(); state.dirty.value = true
  const save = state.save({ version: 1, markers: [] })
  current = { id: 'b', path: 'book-b' }; guard.begin(current); state.reset(); await state.load()
  pending.resolve(fixture('a', 'b'.repeat(64))); await save
  assert.equal(state.view.value?.workItemId, 'b'); assert.deepEqual(notices, [])
})

test('map load failure is explicit, never an empty successful projection or draft reset', async () => {
  const current = { id: 'a', path: 'book-a' }, guard = new WorkspaceRequestGuard()
  guard.begin(current); let failed = false
  const state = createWorldMapWorkspace({ getWorldMap: async () => { if (failed) throw new Error('unreadable'); return fixture() }, saveWorldMap: async () => fixture() }, () => current, guard, () => {})
  await state.load(); const before = state.view.value; state.dirty.value = true; failed = true
  await state.load()
  assert.equal(state.view.value, before); assert.equal(state.dirty.value, true); assert.match(state.error.value, /读取失败/)
})

test('map renderer loads only the background referenced by the current map and adopts a preview explicitly', async () => {
  const current = { id: 'a', path: 'book-a' }, guard = new WorkspaceRequestGuard(), notices: string[] = []
  guard.begin(current)
  const backgroundRecord = { assetId: 'c'.repeat(64), format: 'png' as const, width: 1536, height: 1024, stylePreset: 'future-industrial' as const, model: 'gpt-image-1', generatedAt: '2026-09-09T08:00:00.000Z', sourceFingerprint: 'd'.repeat(64) }
  const initial: WorldMapView = { ...fixture(), document: { version: 2, markers: [], background: backgroundRecord }, events: [{ id: 'direct:one', source: 'direct', sourceId: 'one', title: '抵达', time: '夜晚', characters: ['林澈'], location: '旧校舍', event: '进入校舍', result: '', chapterId: null }] }
  const candidate: WorldMapImageCandidate = { candidateId: 'e'.repeat(64), workItemId: 'a', expectedRevision: initial.revision, sourceFingerprint: 'f'.repeat(64), stylePreset: 'future-industrial', model: 'gpt-image-1', connectionName: '图片接口', promptSummary: { locations: 1, events: 1, characters: 1, sentCharacters: 320 }, image: { dataUrl: 'data:image/png;base64,new-map', format: 'png', width: 1536, height: 1024 } }
  const adopted: WorldMapLayoutView = { workItemId: 'a', revision: 'b'.repeat(64), mirrorStatus: 'synced', document: { version: 2, markers: [], background: { ...backgroundRecord, assetId: 'e'.repeat(64) } } }
  let generated = 0, adoptedCount = 0
  const state = createWorldMapWorkspace({
    getWorldMap: async () => initial,
    saveWorldMap: async () => initial,
    getWorldMapBackground: async () => ({ workItemId: 'a', assetId: backgroundRecord.assetId, dataUrl: 'data:image/png;base64,old-map', width: 1536, height: 1024 }),
    generateWorldMapImage: async input => { generated += 1; assert.equal(input.workItemId, 'a'); assert.equal(input.expectedRevision, initial.revision); return candidate },
    adoptWorldMapImage: async input => { adoptedCount += 1; assert.equal(input.candidateId, candidate.candidateId); return adopted },
    cancelWorldMapImage: async () => ({ cancelled: true })
  }, () => current, guard, message => notices.push(message))
  await state.load()
  assert.equal(state.background.value, 'data:image/png;base64,old-map')
  await state.generate({ connectionId: 'provider', model: 'gpt-image-1', stylePreset: 'future-industrial' })
  assert.equal(generated, 1); assert.equal(state.candidate.value?.candidateId, candidate.candidateId)
  await state.adopt()
  assert.equal(adoptedCount, 1); assert.equal(state.background.value, candidate.image.dataUrl)
  assert.equal(state.view.value?.revision, adopted.revision); assert.equal(state.candidate.value, null)
  assert.deepEqual(notices, ['地图底图已采用。'])
})

test('map renderer cancellation releases navigation without accepting a late generated image', async () => {
  const current = { id: 'a', path: 'book-a' }, guard = new WorkspaceRequestGuard()
  guard.begin(current)
  const pending = deferred<WorldMapImageCandidate>(), cancelled: string[] = []
  const state = createWorldMapWorkspace({
    getWorldMap: async () => ({ ...fixture(), events: [{ id: 'direct:one', source: 'direct', sourceId: 'one', title: '', time: '', characters: [], location: '港区', event: '', result: '', chapterId: null }] }),
    saveWorldMap: async () => fixture(), generateWorldMapImage: async () => pending.promise,
    cancelWorldMapImage: async operationId => { cancelled.push(operationId); return { cancelled: true } }
  }, () => current, guard, () => {})
  await state.load()
  const generation = state.generate({ connectionId: 'provider', model: 'gpt-image-1', stylePreset: 'future-industrial' })
  assert.equal(state.canLeave(), false)
  await state.cancelGeneration()
  assert.equal(cancelled.length, 1); assert.equal(state.canLeave(), true)
  pending.resolve({ candidateId: 'e'.repeat(64), workItemId: 'a', expectedRevision: 'a'.repeat(64), sourceFingerprint: 'f'.repeat(64), stylePreset: 'future-industrial', model: 'gpt-image-1', connectionName: '图片接口', promptSummary: { locations: 1, events: 1, characters: 0, sentCharacters: 10 }, image: { dataUrl: 'data:image/png;base64,late', format: 'png', width: 1536, height: 1024 } })
  await generation
  assert.equal(state.candidate.value, null)
})
