import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MANUSCRIPT_RECOVERY_STORAGE_KEY,
  PLANNED_OUTLINE_RECOVERY_STORAGE_KEY,
  createManuscriptRecoveryStore,
  recoveryDraftMatchesActiveEditor,
  type ManuscriptRecoveryStorage
} from '../../../src/renderer/features/manuscript/services/manuscript-recovery-store'

class MemoryStorage implements ManuscriptRecoveryStorage {
  readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }
}

test('keeps the active editor crash snapshot without classifying it as an interruption', () => {
  const { store } = fixture()
  const draft = store.write({
    workItemId: 'book-a',
    chapterId: 17,
    title: '巧克力不是万能道歉券',
    content: '正式归档后又写了三个字'
  })

  assert.equal(recoveryDraftMatchesActiveEditor(draft, {
    chapterId: 17,
    title: '巧克力不是万能道歉券',
    content: '正式归档后又写了三个字'
  }), true)
  assert.equal(store.read('book-a', 17)?.content, '正式归档后又写了三个字')
  assert.equal(recoveryDraftMatchesActiveEditor(draft, {
    chapterId: 17,
    title: '巧克力不是万能道歉券',
    content: '重开后加载的正式正文'
  }), false)
  assert.equal(recoveryDraftMatchesActiveEditor(draft, {
    chapterId: 18,
    title: draft.title,
    content: draft.content
  }), false)
})

function fixture() {
  const storage = new MemoryStorage()
  let tick = 0
  const store = createManuscriptRecoveryStore(storage, {
    now: () => new Date(Date.UTC(2026, 8, 2, 8, 0, tick++)),
    operationId: () => `operation-${tick}`
  })
  return { storage, store }
}

test('stores drafts independently by work item and chapter while serializing only recovery fields', () => {
  const { storage, store } = fixture()
  const baseRevision = 'a'.repeat(64)
  store.write({ workItemId: 'book-a', chapterId: 1, title: '第一章', content: '甲稿', baseRevision })
  store.write({ workItemId: 'book-a', chapterId: 2, title: '第二章', content: '乙稿', baseRevision })
  store.write({ workItemId: 'book-b', chapterId: 1, title: '第一章', content: '丙稿', baseRevision, apiKey: 'must-not-persist' } as Parameters<typeof store.write>[0])

  assert.equal(store.read('book-a', 1)?.content, '甲稿')
  assert.equal(store.read('book-a', 2)?.content, '乙稿')
  assert.equal(store.read('book-b', 1)?.content, '丙稿')
  assert.deepEqual(store.list('book-a').map((item) => item.chapterId), [2, 1])
  assert.equal(storage.getItem(MANUSCRIPT_RECOVERY_STORAGE_KEY)?.includes('must-not-persist'), false)
})

test('clears only the exact snapshot acknowledged by a successful formal save', () => {
  const { store } = fixture()
  const baseRevision = 'b'.repeat(64)
  const saving = store.write({ workItemId: 'book-a', chapterId: 7, title: '旧标题', content: '准备保存', baseRevision })
  const newer = store.write({ workItemId: 'book-a', chapterId: 7, title: '新标题', content: '保存途中继续修改', baseRevision })

  assert.equal(store.clearIfSnapshotMatches(saving), false)
  assert.deepEqual(store.read('book-a', 7), newer)
  assert.equal(store.clearIfSnapshotMatches({ ...newer, content: '并非同一快照' }), false)
  assert.equal(store.clearIfSnapshotMatches(newer), true)
  assert.equal(store.read('book-a', 7), null)
})

test('discard removes only the requested chapter', () => {
  const { store } = fixture()
  store.write({ workItemId: 'book-a', chapterId: 1, title: '一', content: '甲' })
  store.write({ workItemId: 'book-a', chapterId: 2, title: '二', content: '乙' })
  store.write({ workItemId: 'book-b', chapterId: 1, title: '一', content: '丙' })

  assert.equal(store.discard('book-a', 1), true)
  assert.equal(store.discard('book-a', 1), false)
  assert.equal(store.read('book-a', 1), null)
  assert.equal(store.read('book-a', 2)?.content, '乙')
  assert.equal(store.read('book-b', 1)?.content, '丙')
})

test('malformed or structurally damaged persisted data degrades to an empty readable store', () => {
  const { storage, store } = fixture()
  storage.setItem(MANUSCRIPT_RECOVERY_STORAGE_KEY, '{broken-json')
  assert.doesNotThrow(() => store.list('book-a'))
  assert.deepEqual(store.list('book-a'), [])
  assert.equal(store.read('book-a', 1), null)

  storage.setItem(MANUSCRIPT_RECOVERY_STORAGE_KEY, JSON.stringify({ version: 1, drafts: [{ chapterId: -1, content: '损坏' }] }))
  assert.deepEqual(store.list('book-a'), [])
  assert.equal(store.discard('book-a', 1), false)

  const recovered = store.write({ workItemId: 'book-a', chapterId: 1, title: '重建', content: '新的有效草稿' })
  assert.deepEqual(store.read('book-a', 1), recovered)
})

test('keeps valid drafts when another persisted entry is invalid and ignores storage read failures', () => {
  const storage = new MemoryStorage()
  storage.setItem(MANUSCRIPT_RECOVERY_STORAGE_KEY, JSON.stringify({
    version: 1,
    drafts: [
      {
        version: 1,
        workItemId: 'book-a',
        chapterId: 3,
        title: '第三章',
        content: '有效恢复稿',
        baseRevision: null,
        operationId: 'operation-valid',
        updatedAt: '2026-09-02T08:00:00.000Z'
      },
      { version: 1, workItemId: '', chapterId: 4, title: '损坏', content: '损坏' }
    ]
  }))
  const store = createManuscriptRecoveryStore(storage)
  assert.equal(store.read('book-a', 3)?.content, '有效恢复稿')

  const unavailable = createManuscriptRecoveryStore({
    getItem: () => { throw new Error('storage unavailable') },
    setItem: () => { throw new Error('storage unavailable') },
    removeItem: () => { throw new Error('storage unavailable') }
  })
  assert.doesNotThrow(() => unavailable.list('book-a'))
  assert.deepEqual(unavailable.list('book-a'), [])
})

test('planned outline drafts survive store recreation without mixing with manuscript drafts', () => {
  const storage = new MemoryStorage()
  const manuscript = createManuscriptRecoveryStore(storage)
  const outline = createManuscriptRecoveryStore(storage, { kind: 'planned-outline' })
  manuscript.write({ workItemId: 'book-a', chapterId: 9, title: '正文', content: '不能改动的正文。' })
  const bodyBytes = storage.getItem(MANUSCRIPT_RECOVERY_STORAGE_KEY)
  const saved = outline.write({ workItemId: 'book-a', chapterId: 9, title: '章纲', content: '第一段。\n第二段：吐槽。', baseRevision: 'a'.repeat(64) })
  outline.write({ workItemId: 'book-b', chapterId: 9, title: '另一本', content: '另一部作品。' })
  const reopened = createManuscriptRecoveryStore(storage, { kind: 'planned-outline' })
  assert.deepEqual(reopened.read('book-a', 9), saved)
  const newer = reopened.write({ ...saved, content: '保存时继续写下的新内容。' })
  assert.equal(reopened.clearIfSnapshotMatches(saved), false)
  assert.deepEqual(reopened.read('book-a', 9), newer)
  assert.equal(reopened.clearIfSnapshotMatches(newer), true)
  assert.equal(reopened.read('book-b', 9)?.content, '另一部作品。')
  assert.equal(storage.getItem(MANUSCRIPT_RECOVERY_STORAGE_KEY), bodyBytes)
})

test('damaged planned recovery bytes cannot be overwritten or partially discarded', () => {
  const storage = new MemoryStorage()
  const store = createManuscriptRecoveryStore(storage, { kind: 'planned-outline' })
  const input = { workItemId: 'book-a', chapterId: 9, title: '章纲', content: '恢复文本。' }
  const draft = store.write(input)
  for (const bytes of ['', '{broken-json', 'null', JSON.stringify({ version: 2, drafts: [] }),
    JSON.stringify({ version: 1, drafts: [draft, { chapterId: -1 }] }),
    JSON.stringify({ version: 1, drafts: [draft, draft] })]) {
    storage.setItem(PLANNED_OUTLINE_RECOVERY_STORAGE_KEY, bytes)
    for (const operation of [() => store.list('book-a'), () => store.read('book-a', 9), () => store.write(input),
      () => store.discard('book-a', 9), () => store.clearIfSnapshotMatches(draft)]) {
      assert.throws(operation, /原始数据已保留/)
      assert.equal(storage.getItem(PLANNED_OUTLINE_RECOVERY_STORAGE_KEY), bytes)
    }
  }
})

test('planned recovery reports read and quota errors while keeping the previous snapshot', () => {
  const storage = new MemoryStorage()
  const input = { workItemId: 'book-a', chapterId: 1, title: '原章纲', content: '仍可恢复。' }
  const original = createManuscriptRecoveryStore(storage, { kind: 'planned-outline' }).write(input)
  let failRead = true
  const failing = createManuscriptRecoveryStore({
    getItem: key => { if (failRead) throw new Error('unavailable'); return storage.getItem(key) },
    setItem: () => { throw new Error('quota exceeded') },
    removeItem: () => { throw new Error('cannot remove') }
  }, { kind: 'planned-outline' })
  assert.throws(() => failing.write({ ...input, content: '新内容' }), /无法读取/)
  failRead = false
  assert.throws(() => failing.write({ ...input, content: '新内容' }), /存储空间不足/)
  assert.throws(() => failing.clearIfSnapshotMatches(original), /未能写入或清理/)
  assert.deepEqual(createManuscriptRecoveryStore(storage, { kind: 'planned-outline' }).read('book-a', 1), original)
})
