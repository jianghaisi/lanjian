import assert from 'node:assert/strict'
import test from 'node:test'
import type { ManuscriptAutosaveCheckpoint } from '../../../src/contracts/index'
import { WorkspaceRequestGuard, type WorkspaceIdentity } from '../../../src/contracts/library/workspace-request-guard'
import { createManuscriptRecoveryRefresh } from '../../../src/renderer/features/manuscript/services/manuscript-recovery-refresh'

function deferred() {
  let resolve!: (value: ManuscriptAutosaveCheckpoint[]) => void
  let reject!: (error: Error) => void
  const promise = new Promise<ManuscriptAutosaveCheckpoint[]>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function fixture() {
  const first = { id: 'book-a', path: 'E:\\fixtures\\a' }
  let current: WorkspaceIdentity | null = first
  const guard = new WorkspaceRequestGuard()
  guard.begin(first)
  const reads: ReturnType<typeof deferred>[] = []
  const applied: { drafts: ManuscriptAutosaveCheckpoint[]; workItemId: string }[] = []
  let clears = 0
  const refresh = createManuscriptRecoveryRefresh({
    current: () => current,
    guard,
    read: () => { const read = deferred(); reads.push(read); return read.promise },
    apply: (drafts, workItemId) => { applied.push({ drafts, workItemId }) },
    clear: () => { clears += 1 }
  })
  return { first, refresh, reads, applied, get clears() { return clears },
    switchTo(next: WorkspaceIdentity | null) {
      current = next
      if (next) guard.begin(next)
      else guard.invalidate()
    }
  }
}

test('late recovery reply cannot project into a different work item or touch its local drafts', async () => {
  const f = fixture()
  const pending = f.refresh()
  f.switchTo({ id: 'book-b', path: 'E:\\fixtures\\b' })
  f.reads[0]!.resolve([])
  await pending
  // apply owns both local-store cleanup and dialog publication; neither may run.
  assert.deepEqual(f.applied, [])
})

test('closing clears recovery UI and rejects the old reply after reopening the same book', async () => {
  const f = fixture()
  const old = f.refresh()
  f.switchTo(null)
  await f.refresh()
  assert.equal(f.clears, 1)
  assert.equal(f.reads.length, 1)
  f.switchTo(f.first)
  f.reads[0]!.resolve([])
  await old
  assert.deepEqual(f.applied, [])
})

test('a copied project with the same id does not inherit the original recovery reply', async () => {
  const f = fixture()
  const pending = f.refresh()
  f.switchTo({ ...f.first, path: 'E:\\fixtures\\copy' })
  f.reads[0]!.resolve([])
  await pending
  assert.deepEqual(f.applied, [])
})

test('a slower earlier refresh cannot overwrite the newer list in the same book', async () => {
  const f = fixture()
  const older = f.refresh()
  const newer = f.refresh()
  f.reads[1]!.resolve([])
  await newer
  f.reads[0]!.resolve([])
  await older
  assert.equal(f.applied.length, 1)
  assert.equal(f.applied[0]!.workItemId, f.first.id)
})

test('a current SQLite read failure still allows the local-only recovery projection', async () => {
  const f = fixture()
  const pending = f.refresh()
  f.reads[0]!.reject(new Error('SQLite unavailable'))
  await pending
  assert.deepEqual(f.applied, [{ drafts: [], workItemId: f.first.id }])
})

test('a current reply preserves the complete recovery payload without changing draft content', async () => {
  const f = fixture()
  const pending = f.refresh()
  const drafts: ManuscriptAutosaveCheckpoint[] = [{
    id: 'checkpoint-a', chapterId: 17, title: '待恢复章节', content: '尚未写入正式版本的草稿',
    contentHash: 'a'.repeat(64), status: 'conflict', baseBodyVersionId: 'body-1',
    mergeWindowMs: 30_000, windowStartedAt: '2026-09-07T00:00:00Z',
    windowEndsAt: '2026-09-07T00:00:30Z', updatedAt: '2026-09-07T00:00:20Z',
    conflictCurrentBodyVersionId: 'body-2', finalizedBodyVersionId: null, operationCount: 2
  }]
  f.reads[0]!.resolve(drafts)
  await pending
  assert.equal(f.applied.length, 1)
  assert.equal(f.applied[0]!.drafts, drafts)
  assert.equal(f.applied[0]!.workItemId, f.first.id)
})

test('a late SQLite failure cannot trigger local cleanup in a newly opened work item', async () => {
  const f = fixture()
  const pending = f.refresh()
  f.switchTo({ id: 'book-b', path: 'E:\\fixtures\\b' })
  f.reads[0]!.reject(new Error('old request failed'))
  await pending
  assert.deepEqual(f.applied, [])
})
