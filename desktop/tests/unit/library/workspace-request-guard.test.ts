import assert from 'node:assert/strict'
import test from 'node:test'
import { WorkspaceRequestGuard } from '../../../src/contracts/library/workspace-request-guard'

test('rejects a slow response after another work item becomes current', () => {
  const guard = new WorkspaceRequestGuard()
  const first = { id: 'book-a', path: 'E:\\books\\A' }
  const second = { id: 'book-b', path: 'E:\\books\\B' }
  const firstRequest = guard.begin(first)
  const secondRequest = guard.begin(second)

  assert.equal(guard.isCurrent(firstRequest, second), false)
  assert.equal(guard.isCurrent(secondRequest, second), true)
})

test('treats matching ids at different paths as different work items', () => {
  const guard = new WorkspaceRequestGuard()
  const request = guard.begin({ id: 'same-id', path: 'E:\\books\\original' })
  assert.equal(guard.isCurrent(request, { id: 'same-id', path: 'E:\\books\\copy' }), false)
})

test('invalidates pending work when the current work item closes', () => {
  const guard = new WorkspaceRequestGuard()
  const workItem = { id: 'book-a', path: 'E:\\books\\A' }
  const request = guard.begin(workItem)
  guard.invalidate()
  assert.equal(guard.isCurrent(request, workItem), false)
  assert.equal(guard.isCurrent(request, null), false)
})
