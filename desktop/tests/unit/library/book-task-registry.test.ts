import assert from 'node:assert/strict'
import test from 'node:test'
import { AsyncLocalStorage } from 'node:async_hooks'
import { BookTaskRegistry } from '../../../src/main/modules/library/application/book-task-registry'

test('global task projection restores each captured book context, keys same IDs by book and exposes no draft', async () => {
  const registry = new BookTaskRegistry(), scope = new AsyncLocalStorage<string>()
  for (const path of ['A', 'B']) scope.run(path, () => registry.track({ id: 'same-task', status: 'running' }, { id: path, path, title: path }, '正文写作', async () => {
    assert.equal(scope.getStore(), path)
    return { id: 'same-task', status: path === 'A' ? 'succeeded' : 'streaming', content: 'private text', key: 'never expose' }
  }))
  const result = await registry.list()
  assert.equal(result.length, 2)
  assert.deepEqual(result.map(item => [item.bookId, item.status]), [['A', 'succeeded'], ['B', 'streaming']])
  assert.ok(!JSON.stringify(result).includes('private text'))
  assert.ok(!JSON.stringify(result).includes('never expose'))
  assert.equal(scope.getStore(), undefined)
})
