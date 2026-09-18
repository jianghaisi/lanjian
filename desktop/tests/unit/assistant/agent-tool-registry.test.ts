import assert from 'node:assert/strict'
import test from 'node:test'
import { AgentToolRegistry } from '../../../src/main/modules/assistant/application/agent-tool-registry'

const scope = {
  workItemId: 'project-a',
  workItemPath: 'C:/books/project-a',
  chapterId: 7
}

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
