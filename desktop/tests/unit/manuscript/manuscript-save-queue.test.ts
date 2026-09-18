import assert from 'node:assert/strict'
import test from 'node:test'
import { ManuscriptSaveQueue, supersededSave } from '../../../src/renderer/features/manuscript/services/manuscript-save-queue'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(settle => { resolve = settle })
  return { promise, resolve }
}

test('slow disk keeps one in flight and only the latest waiting text for the same book/document', async () => {
  const queue = new ManuscriptSaveQueue()
  const first = deferred<string>()
  const calls: string[] = []
  let active = 0
  let maxActive = 0
  const save = (text: string) => async () => {
    active++; maxActive = Math.max(maxActive, active); calls.push(text)
    const result = text === '一' ? await first.promise : text
    active--; return result
  }
  const a = queue.enqueue(save('一'), 'book-a:chapter-1')
  await Promise.resolve()
  const b = queue.enqueue(save('二'), 'book-a:chapter-1')
  const c = queue.enqueue(save('三'), 'book-a:chapter-1')
  assert.equal(await b, supersededSave)
  assert.deepEqual(calls, ['一'])
  first.resolve('一')
  assert.equal(await a, '一')
  assert.equal(await c, '三')
  await queue.idle()
  assert.deepEqual(calls, ['一', '三'])
  assert.equal(maxActive, 1)
})

test('manual saves, history finalization, other documents and AI adoption preserve ordered barriers', async () => {
  const queue = new ManuscriptSaveQueue()
  const gate = deferred<void>()
  const calls: string[] = []
  const first = queue.barrier(() => gate.promise)
  await Promise.resolve()
  const a = queue.enqueue(async () => { calls.push('A old'); return 'old' }, 'A')
  const b = queue.barrier(async () => { calls.push('manual'); return 'manual' })
  const c = queue.enqueue(async () => { calls.push('A next'); return 'next' }, 'A')
  const d = queue.enqueue(async () => { calls.push('B'); return 'B' }, 'B')
  const e = queue.enqueue(async () => { calls.push('A latest'); return 'latest' }, 'A')
  const end = queue.barrier(async () => { calls.push('AI'); return 'AI' })
  gate.resolve()
  await Promise.all([first, a, b, c, d, e, end])
  assert.deepEqual(calls, ['A old', 'manual', 'A next', 'B', 'A latest', 'AI'])
})

test('acknowledged revisions update before a pending save runs; failure is visible and latest draft can retry', async () => {
  const queue = new ManuscriptSaveQueue()
  let revision = 1
  const first = queue.enqueue(async () => 2, 'A')
  await Promise.resolve()
  const apply = first.then(value => { assert.equal(value, 2); revision = 2 })
  const second = queue.enqueue(async () => { assert.equal(revision, 2); throw new Error('disk full') }, 'A')
  await apply
  await assert.rejects(second, /disk full/)
  await queue.idle()
  const retainedDraft = 'latest author draft'
  assert.equal(await queue.barrier(async () => retainedDraft), retainedDraft)
})
