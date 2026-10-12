import assert from 'node:assert/strict'
import { getEventListeners } from 'node:events'
import test from 'node:test'
import { AgentToolRegistry } from '../../../src/main/modules/assistant/application/agent-tool-registry'

const scope = {
  workItemId: 'project-a',
  workItemPath: 'C:/books/project-a',
  chapterId: 7
}

test('an author stop aborts source work without waiting for its tool deadline', async () => {
  const registry = new AgentToolRegistry({ compileContextSources: 100 })
  const grant = registry.grant({ ...scope, skill: 'continue' })
  const controller = new AbortController()
  let sourceSignal: AbortSignal | undefined
  const pending = registry.execute(grant, 'compileContextSources', scope, signal => {
    sourceSignal = signal
    controller.abort()
    return new Promise<never>(() => undefined)
  }, controller.signal)
  await assert.rejects(pending, (error: Error) => error.name === 'AbortError')
  assert.equal(sourceSignal?.aborted, true)
})

test('an already stopped task cannot start a tool read', async () => {
  const registry = new AgentToolRegistry()
  const grant = registry.grant({ ...scope, skill: 'continue' })
  let reads = 0
  await assert.rejects(registry.execute(grant, 'compileContextSources', scope, () => {
    reads += 1
    return []
  }, AbortSignal.abort()), (error: Error) => error.name === 'AbortError')
  assert.equal(reads, 0)
})

test('settled tools remove task stop listeners on success, failure and timeout', async () => {
  const registry = new AgentToolRegistry({ compileContextSources: 5 })
  const grant = registry.grant({ ...scope, skill: 'continue' })
  const controller = new AbortController()
  assert.deepEqual(await registry.execute(grant, 'compileContextSources', scope, () => [], controller.signal), [])
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0)
  await assert.rejects(registry.execute(grant, 'compileContextSources', scope, () => { throw Error('read failed') }, controller.signal))
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0)
  await assert.rejects(registry.execute(grant, 'compileContextSources', scope, () => new Promise<never>(() => undefined), controller.signal),
    (error: { code?: string }) => error.code === 'FEATURE_UNAVAILABLE')
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0)
})

test('registers a fixed non-model-callable tool catalog with schemas, timeouts and no formal side effects', () => {
  const registry = new AgentToolRegistry()
  const catalog = registry.list()
  assert.deepEqual(catalog.map((item) => item.id), [
    'compileContextSources',
    'currentChapter',
    'chapterContract',
    'contextFacts',
    'consistencyGate',
    'candidateDiff'
  ])
  for (const tool of catalog) {
    assert.equal(tool.modelCallable, false)
    assert.equal(tool.sideEffect, 'none')
    assert.ok(tool.timeoutMs > 0 && Number.isFinite(tool.timeoutMs))
    assert.equal(tool.inputSchema.type, 'object')
    assert.equal(tool.inputSchema.additionalProperties, false)
    assert.deepEqual(tool.inputSchema.required, ['workItemId', 'workItemPath', 'chapterId'])
    assert.ok(['object', 'array'].includes(tool.outputSchema.type))
  }
  assert.deepEqual(Object.fromEntries(catalog.map((tool) => [tool.id, tool.timeoutMs])), {
    compileContextSources: 60_000,
    currentChapter: 5_000,
    chapterContract: 10_000,
    contextFacts: 15_000,
    consistencyGate: 15_000,
    candidateDiff: 5_000
  })
})

test('grants only the fixed tools for a task template and refuses scope or permission escalation', async () => {
  const registry = new AgentToolRegistry()
  const writing = registry.grant({ ...scope, skill: 'rewrite' })
  assert.ok(writing.allowedToolIds.includes('candidateDiff'))
  assert.deepEqual(await registry.execute(writing, 'candidateDiff', scope, () => []), [])

  const readOnly = registry.grant({ ...scope, skill: 'query' })
  assert.ok(!readOnly.allowedToolIds.includes('candidateDiff'))
  await assert.rejects(
    registry.execute(readOnly, 'candidateDiff', scope, () => []),
    (error: { code?: string }) => error.code === 'VALIDATION_ERROR'
  )
  await assert.rejects(
    registry.execute(writing, 'currentChapter', { ...scope, chapterId: 8 }, () => ({ id: 8 })),
    (error: { code?: string }) => error.code === 'CONFLICT'
  )
  await assert.rejects(
    registry.execute({ ...writing, allowedToolIds: [...writing.allowedToolIds, 'candidateDiff'] }, 'currentChapter', scope, () => ({ id: 7 })),
    (error: { code?: string }) => error.code === 'DATABASE_INTEGRITY_FAILED'
  )
})

test('enforces registered output roots and bounded execution time', async () => {
  const registry = new AgentToolRegistry({ currentChapter: 5 })
  const grant = registry.grant({ ...scope, skill: 'continue' })
  await assert.rejects(
    registry.execute(grant, 'currentChapter', scope, () => ['not-an-object']),
    (error: { code?: string }) => error.code === 'DATABASE_INTEGRITY_FAILED'
  )
  await assert.rejects(
    registry.execute(grant, 'currentChapter', scope, () => new Promise(() => undefined)),
    (error: { code?: string }) => error.code === 'FEATURE_UNAVAILABLE'
  )
})

test('gives full-context compilation an independent bounded long-form budget', async () => {
  const registry = new AgentToolRegistry({ compileContextSources: 50, currentChapter: 5 })
  const grant = registry.grant({ ...scope, skill: 'continue' })

  const compiled = await registry.execute(grant, 'compileContextSources', scope, async () => {
    await new Promise((resolve) => setTimeout(resolve, 20))
    return []
  })
  assert.deepEqual(compiled, [])

  await assert.rejects(
    registry.execute(grant, 'compileContextSources', scope, () => new Promise(() => undefined)),
    (error: { code?: string; recoverable?: boolean }) => error.code === 'FEATURE_UNAVAILABLE' && error.recoverable === true
  )
})

test('timed-out source compilation requests cooperative stop before a retry', async () => {
  const registry = new AgentToolRegistry({ compileContextSources: 15 })
  const grant = registry.grant({ ...scope, skill: 'continue' })
  let aborted = false
  await assert.rejects(registry.execute(grant, 'compileContextSources', scope, signal => new Promise<never>((_resolve, reject) => {
    signal.addEventListener('abort', () => { aborted = true; reject(signal.reason) }, { once: true })
  })), (error: { code?: string }) => error.code === 'FEATURE_UNAVAILABLE')
  assert.equal(aborted, true)
})
