import assert from 'node:assert/strict'
import test from 'node:test'
import type { WritingAgentContextPreview, WritingAgentRequest } from '../../../src/contracts/index'
import { WritingAgentPreviewService } from '../../../src/main/modules/assistant/application/writing-agent-preview-service'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

const input: WritingAgentRequest = { chapterId: 7, message: '核对本章', currentDraft: '', preferredSkill: 'query' }
const result: WritingAgentContextPreview = {
  version: 1, workItemId: 'book-a', chapterId: 7, skill: 'query', status: 'ready',
  tokenBudget: 100, estimatedTokens: 10, remainingTokens: 90, truncated: false, contentHash: 'current', items: []
}
const conflict = { code: 'CONFLICT', recoverable: true }

function fixture() {
  const reads: Array<{ signal: AbortSignal; gate: ReturnType<typeof deferred<WritingAgentContextPreview>> }> = []
  const service = new WritingAgentPreviewService(
    { runInCurrentBook: async operation => operation() },
    { preview: async (_input, signal) => {
      assert.ok(signal)
      const gate = deferred<WritingAgentContextPreview>()
      reads.push({ signal, gate })
      return gate.promise
    } }
  )
  return { service, reads }
}

test('navigation cancels a pending preview and rejects requests until navigation ends', async () => {
  const { service, reads } = fixture()
  const old = assert.rejects(service.preview(input), conflict)
  service.beginNavigation()
  assert.equal(reads[0].signal.aborted, true)
  await old
  await assert.rejects(service.preview(input), conflict)
  assert.equal(reads.length, 1)
  service.endNavigation()
  const fresh = service.preview(input)
  reads[0].gate.resolve({ ...result, contentHash: 'stale' })
  reads[1].gate.resolve(result)
  assert.deepEqual(await fresh, result)
})

test('new preview supersedes old; old cleanup cannot lose the new controller', async () => {
  const { service, reads } = fixture()
  const old = assert.rejects(service.preview(input), conflict)
  const fresh = assert.rejects(service.preview({ ...input, chapterId: 8 }), conflict)
  await old
  assert.equal(reads[0].signal.aborted, true)
  assert.equal(reads[1].signal.aborted, false)
  service.cancel()
  assert.equal(reads[1].signal.aborted, true)
  await fresh
  reads[0].gate.resolve(result)
  reads[1].gate.resolve(result)
})

test('cancellation before book capture finishes prevents any source compilation', async () => {
  const capture = deferred<void>()
  let calls = 0
  const service = new WritingAgentPreviewService(
    { runInCurrentBook: async operation => { await capture.promise; return operation() } },
    { preview: async () => { calls++; return result } }
  )
  const old = assert.rejects(service.preview(input), conflict)
  service.beginNavigation()
  await old
  service.endNavigation()
  capture.resolve()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls, 0)
  assert.deepEqual(await service.preview(input), result)
})

test('A to B to A and a late failed read cannot resurrect the old preview', async () => {
  const { service, reads } = fixture()
  const old = assert.rejects(service.preview(input), conflict)
  service.beginNavigation(); service.endNavigation()
  service.beginNavigation(); service.endNavigation()
  const fresh = service.preview(input)
  await old
  reads[0].gate.reject(new Error('private old source failure'))
  reads[1].gate.resolve(result)
  assert.deepEqual(await fresh, result)
  assert.equal(reads[1].signal.aborted, false)
  service.cancel()
  assert.equal(reads[1].signal.aborted, false, 'settled preview has released its controller')
})

test('ordinary preview failure releases state and an explicit retry succeeds', async () => {
  const { service, reads } = fixture()
  const failed = assert.rejects(service.preview(input), { message: 'source unavailable' })
  reads[0].gate.reject(new Error('source unavailable'))
  await failed
  const fresh = service.preview(input)
  reads[1].gate.resolve(result)
  assert.deepEqual(await fresh, result)
})
