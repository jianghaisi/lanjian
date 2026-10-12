import assert from 'node:assert/strict'
import test from 'node:test'
import { WorkspaceWriteCoordinator } from '../../../src/main/core/application/workspace-write-coordinator'
import { EventProjectionService } from '../../../src/main/modules/timeline/application/event-projection-service'
import { SqliteManuscriptService } from '../../../src/main/modules/manuscript/application/sqlite-manuscript-service'
const pause = () => new Promise<void>(resolve => setTimeout(resolve, 10))

test('read-only formal snapshot acquisition inside a held write lane completes without self-waiting', async () => {
  const writes = new WorkspaceWriteCoordinator(), root = 'C:/isolated/book-a', order: string[] = []
  const projection = new EventProjectionService({ openEventReadOnly: async () => { order.push('snapshot'); return null } }, async () => ({ root, workItemId: 'book-a', generation: 0 }), writes)
  await writes.run(root, async () => {
    order.push('write-start'); assert.equal(await projection.readForConsumer(), null); order.push('write-end')
  })
  assert.deepEqual(order, ['write-start', 'snapshot', 'write-end']); assert.equal(writes.pending(root), false)
})

test('formal legacy timeline and outline-state snapshot consumers also reuse the held lane', async () => {
  const writes = new WorkspaceWriteCoordinator(), root = 'C:/isolated/book-a'
  let reads = 0
  const manuscripts = new SqliteManuscriptService({ openEventReadOnly: async () => { reads++; return null } } as never, undefined, writes)
  await writes.run(root, async () => {
    assert.equal(await manuscripts.readTimelineConfig(root), null)
    assert.equal(await manuscripts.readCanonicalEvents(root), null)
  })
  assert.equal(reads, 2); assert.equal(writes.pending(root), false)
})

test('unrelated reads and nested writes still wait; another book has an independent lane', async () => {
  const writes = new WorkspaceWriteCoordinator(), root = 'C:/isolated/book-a', order: string[] = []
  let release!: () => void, nested!: Promise<void>
  const first = writes.run(root, async () => {
    order.push('start'); nested = writes.run(root, () => { order.push('nested-write') })
    await writes.read('C:/isolated/book-b', () => { order.push('other-book') })
    await new Promise<void>(r => { release = r }); order.push('end')
  })
  while (!release) await pause()
  const read = writes.read(root, () => { order.push('outside-read') })
  await pause(); assert.deepEqual(order, ['start', 'other-book'])
  release(); await Promise.all([first, read, nested]); assert.deepEqual(order, ['start', 'other-book', 'end', 'nested-write', 'outside-read'])
})

test('a delayed inherited context cannot bypass a newer write after its original lease closes', async () => {
  const writes = new WorkspaceWriteCoordinator(), root = 'C:/isolated/book-a', order: string[] = []
  let resumeLate!: () => void, late!: Promise<void>, releaseNew!: () => void
  await writes.run(root, () => {
    late = (async () => { await new Promise<void>(r => { resumeLate = r }); await writes.read(root, () => { order.push('late-read') }) })()
  })
  const next = writes.run(root, async () => { order.push('new-start'); await new Promise<void>(r => { releaseNew = r }); order.push('new-end') })
  while (!releaseNew) await pause()
  resumeLate(); await pause(); assert.deepEqual(order, ['new-start'])
  releaseNew(); await Promise.all([next, late]); assert.deepEqual(order, ['new-start', 'new-end', 'late-read'])
})

test('failed held operations release the lane and invalidate inherited read reuse', async () => {
  const writes = new WorkspaceWriteCoordinator(), root = 'C:/isolated/book-a'
  await assert.rejects(writes.run(root, async () => { await writes.read(root, () => {}); throw Error('failure') }), /failure/)
  assert.equal(writes.pending(root), false); assert.equal(await writes.read(root, () => 'read-only'), 'read-only')
})
