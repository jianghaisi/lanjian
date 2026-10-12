import assert from 'node:assert/strict'
import test from 'node:test'
import { ref } from 'vue'
import type { Chapter } from '../../../src/contracts/manuscript/types'
import type { ReviewSaveResult } from '../../../src/contracts/document-review/api'
import { WorkspaceRequestGuard } from '../../../src/contracts/library/workspace-request-guard'
import { ManuscriptSaveQueue } from '../../../src/renderer/features/manuscript/services/manuscript-save-queue'
import { measureManuscript } from '../../../src/contracts/manuscript/manuscript-metrics'

const { createManuscriptPersistenceActions } = await import(new URL('../../../src/renderer/features/manuscript/composables/create-persistence-actions.js', import.meta.url).href)
const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
Object.defineProperty(globalThis, 'window', { configurable: true, value: { setTimeout: () => 1, clearTimeout() {} } })
test.after(() => { if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow); else Reflect.deleteProperty(globalThis, 'window') })
const tick = () => new Promise(resolve => setImmediate(resolve))
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
function fixture() {
  const old: Chapter = { id: 1, position: 3, title: '旧标题', content: '旧正文', word_count: 3, summary: '已有摘要', revision: 'r1', bodyVersionId: 'v1', storageMode: 'sqlite', mirrorStatus: 'synced' }
  const saved: Chapter = { ...old, title: '新标题', content: '确认稿 abc 123。', revision: 'r2', bodyVersionId: 'v2', word_count: 5 }
  const result: ReviewSaveResult = { snapshot: { ref: { workItemId: 'A', kind: 'body', documentId: 'body-1' }, legacyId: 1, title: saved.title, content: saved.content, revision: 'r2', versionId: 'v2', hash: 'hash' }, receipt: null }
  const hooks = { save: async (): Promise<ReviewSaveResult | null> => result, read: async () => saved }
  const calls: string[] = [], updates: Array<{ expectedRevision?: string; baseBodyVersionId?: string }> = []
  const current = ref({ id: 'A', path: 'A-path' }), workspaceRequests = new WorkspaceRequestGuard()
  workspaceRequests.begin(current.value)
  const ports = {
    current, workspaceRequests, chapterSelectionGeneration: 1, selectedId: ref(1), chapters: ref([old]), chapterOrderIssue: ref(''),
    chapterTitle: ref(saved.title), chapterContent: ref(saved.content), lastSavedChapter: { ...old },
    manuscriptEditor: ref({ saveReviewedDraft: () => { calls.push('review'); return hooks.save() } }),
    manuscriptSaves: new ManuscriptSaveQueue(), saveState: ref('dirty'), manuscriptSaveError: ref<unknown>(null), manuscriptConflict: ref<unknown>(null), lastSavedAt: ref<Date | null>(null),
    activeAutosaveCheckpoint: null, autosaveTimer: null, autosaveFinalizeTimer: null, pendingSaveReason: 'autosave',
    pendingAiSourceTaskIds: ref({}), pendingCharacterSettlements: ref({}), bookProfile: ref({ autosaveEnabled: true }),
    manuscriptRecoveryStore: { read: () => ({ operationId: 'recovery' }), write: () => { calls.push('write-recovery'); return {} }, clearIfSnapshotMatches: () => { calls.push('clear-recovery') } },
    notice: (message: string) => calls.push(message),
    desktop: { chapters: {
      get: async () => { calls.push('metadata'); return hooks.read() },
      update: async (_id: number, input: typeof updates[number]) => { updates.push(input); return saved },
      stageAutosave: async (_id: number, input: typeof updates[number]) => { updates.push(input); return { storageMode: 'files', checkpoint: null, chapter: saved } }
    } }
  }
  return { old, saved, result, ports, hooks, calls, updates, actions: createManuscriptPersistenceActions(ports) }
}

test('confirmed prose save survives failed metadata read and readonly retry preserves later input', async () => {
  const f = fixture(); f.hooks.read = async () => { throw new Error('章节信息暂不可读') }
  await f.actions.persistChapter('manual'); await tick()
  assert.equal(f.ports.saveState.value, 'saved'); assert.equal(f.ports.manuscriptSaveError.value, null)
  assert.equal(f.ports.lastSavedChapter.revision, 'r2'); assert.equal(f.ports.lastSavedChapter.bodyVersionId, 'v2')
  assert.equal(f.ports.chapters.value[0].word_count, measureManuscript(f.saved.content).wordCount)
  assert.equal(f.ports.chapters.value[0].mirrorStatus, undefined)
  assert.equal(f.calls.filter(call => call === 'clear-recovery').length, 1)
  f.ports.chapterTitle.value = '继续改名'; f.ports.chapterContent.value = '继续输入'
  f.hooks.read = async () => f.saved
  assert.equal(await f.actions.refreshSavedChapterInfo(), true)
  assert.equal(f.ports.chapters.value[0].mirrorStatus, 'synced')
  assert.equal(f.ports.chapterContent.value, '继续输入'); assert.equal(f.ports.chapterTitle.value, '继续改名')
  assert.equal(f.calls.filter(call => call === 'review').length, 1); assert.equal(f.updates.length, 0)
})

test('confirmed prose baseline uses the receipt, keeps later typing and latest chapter placement', async () => {
  const f = fixture(), gate = deferred<ReviewSaveResult>(); f.hooks.save = () => gate.promise
  const saving = f.actions.persistChapter('manual'); await tick()
  f.ports.chapterContent.value = '后来输入'; f.ports.chapterTitle.value = '后来标题'
  f.ports.chapters.value[0] = { ...f.old, position: 9, summary: '新摘要' }
  f.result.snapshot.content = '主进程确认正文'; f.result.snapshot.title = '主进程确认标题'
  gate.resolve(f.result); await saving
  assert.equal(f.ports.lastSavedChapter.content, '主进程确认正文'); assert.equal(f.ports.lastSavedChapter.title, '主进程确认标题')
  assert.equal(f.ports.chapterContent.value, '后来输入'); assert.equal(f.ports.chapterTitle.value, '后来标题')
  assert.equal(f.ports.saveState.value, 'dirty'); assert.equal(f.ports.chapters.value[0].position, 9); assert.equal(f.ports.chapters.value[0].summary, '新摘要')
})

test('a real review write failure retains unsaved input, revision and recovery', async () => {
  const f = fixture(); f.hooks.save = async () => { throw new Error('正式写入失败') }
  await assert.rejects(f.actions.persistChapter('manual'), /正式写入失败/)
  assert.equal(f.ports.saveState.value, 'error'); assert.equal(f.ports.lastSavedChapter.revision, 'r1')
  assert.equal(f.ports.chapterContent.value, f.saved.content); assert.deepEqual(f.calls, ['review'])
})

for (const reason of ['manual', 'autosave']) test(`next ${reason} save uses confirmed prose revision even when metadata failed`, async () => {
  const f = fixture(); f.hooks.read = async () => { throw new Error('读取失败') }
  await f.actions.persistChapter('manual'); await tick()
  f.hooks.save = async () => null; f.ports.chapterContent.value = '下一稿'
  await f.actions.persistChapter(reason)
  assert.equal(f.updates.length, 1); assert.equal(f.updates[0].expectedRevision, 'r2')
  if (reason === 'autosave') assert.equal(f.updates[0].baseBodyVersionId, 'v2')
})

for (const change of ['book', 'chapter', 'reopen', 'version'] as const) test(`slow prose metadata cannot delay saving or overwrite changed ${change}`, async () => {
  const f = fixture(), gate = deferred<Chapter>(); f.hooks.read = () => gate.promise
  await f.actions.persistChapter('manual')
  assert.equal(f.ports.saveState.value, 'saved')
  if (change === 'book') { f.ports.current.value = { id: 'B', path: 'B-path' }; f.ports.workspaceRequests.begin(f.ports.current.value) }
  if (change === 'chapter') { f.ports.selectedId.value = 2; f.ports.chapterSelectionGeneration++ }
  if (change === 'reopen') { f.ports.workspaceRequests.begin(f.ports.current.value); f.ports.chapterSelectionGeneration++ }
  if (change === 'version') f.ports.lastSavedChapter = { ...f.saved, revision: 'r3' }
  const before = f.ports.chapters.value[0]; gate.resolve(f.saved); await tick()
  assert.equal(f.ports.chapters.value[0], before)
})

test('newest prose metadata read wins and never resets the confirmed text baseline', async () => {
  const f = fixture(), older = deferred<Chapter>(), newer = deferred<Chapter>()
  f.hooks.read = () => older.promise; await f.actions.persistChapter('manual')
  f.hooks.read = () => newer.promise; const retry = f.actions.refreshSavedChapterInfo()
  newer.resolve({ ...f.saved, mirrorStatus: 'conflict' }); assert.equal(await retry, true)
  older.resolve(f.saved); await tick()
  assert.equal(f.ports.chapters.value[0].mirrorStatus, 'conflict'); assert.equal(f.ports.lastSavedChapter.revision, 'r2')
  f.hooks.read = async () => ({ ...f.saved, content: '外部稿', revision: 'r3', mirrorStatus: 'synced' })
  assert.equal(await f.actions.refreshSavedChapterInfo(), false)
  assert.equal(f.ports.chapters.value[0].mirrorStatus, 'conflict'); assert.equal(f.ports.lastSavedChapter.content, f.saved.content)
})

for (const success of [true, false]) test(`late prose save ${success ? 'success' : 'failure'} after reopening the book does not settle another editing session`, async () => {
  const f = fixture(), gate = deferred<void>()
  f.hooks.save = async () => { await gate.promise; if (!success) throw new Error('旧写入失败'); return f.result }
  const saving = f.actions.persistChapter('manual'); await tick()
  f.ports.workspaceRequests.begin(f.ports.current.value)
  f.ports.chapterContent.value = '重新打开后的输入'; f.ports.saveState.value = 'dirty'
  gate.resolve(); if (success) await saving; else await assert.rejects(saving, /旧写入失败/)
  assert.equal(f.ports.saveState.value, 'dirty'); assert.equal(f.ports.lastSavedChapter.revision, 'r1')
  assert.equal(f.ports.chapterContent.value, '重新打开后的输入'); assert.equal(f.ports.manuscriptSaveError.value, null)
  assert.deepEqual(f.calls, ['review'])
})
