import assert from 'node:assert/strict'
import test from 'node:test'
import { AppError } from '../../../src/main/core/errors/app-error'
import { completeStructured, StructuredResponseFailure } from '../../../src/main/modules/assistant/application/structured-response-repair'

const parseValue = (content: string): { value: string } => {
  try {
    const value = JSON.parse(content) as { value?: unknown }
    if (typeof value.value !== 'string' || !value.value.trim()) throw new Error('missing value')
    return { value: value.value }
  } catch {
    throw new AppError('AI_RESPONSE_INVALID', '结果必须包含非空 value。', { recoverable: true })
  }
}

const request = (complete: (instruction: string) => Promise<{ content: string }>, repairAttempts: number) => ({
  ai: { complete }, instruction: '只输出 {"value":"内容"}', systemContext: '结构化测试', task: 'outline' as const,
  repairAttempts, parse: parseValue
})

test('repairs one invalid structured response with the project starting suggestion', async () => {
  const prompts: string[] = []
  const result = await completeStructured(request(async (instruction) => {
    prompts.push(instruction)
    return { content: prompts.length === 1 ? 'not-json' : '{"value":"已修复"}' }
  }, 1))
  assert.deepEqual(result, { value: '已修复' })
  assert.equal(prompts.length, 2)
  assert.match(prompts[1]!, /校验失败原因/)
  assert.match(prompts[1]!, /not-json/)
})

test('honors zero and two repair attempts and retains the first invalid response', async () => {
  let calls = 0
  await assert.rejects(completeStructured(request(async () => {
    calls += 1
    return { content: 'first-invalid' }
  }, 0)), (error: unknown) => {
    assert.ok(error instanceof StructuredResponseFailure)
    assert.equal(error.originalContent, 'first-invalid')
    assert.equal(error.repairAttempts, 0)
    return true
  })
  assert.equal(calls, 1)

  calls = 0
  const result = await completeStructured(request(async () => {
    calls += 1
    return { content: calls < 3 ? `invalid-${calls}` : '{"value":"第三次通过"}' }
  }, 2))
  assert.equal(result.value, '第三次通过')
  assert.equal(calls, 3)
})

test('does not retry provider, network or cancellation failures', async () => {
  let calls = 0
  await assert.rejects(completeStructured(request(async () => {
    calls += 1
    throw new AppError('INTERNAL_ERROR', 'provider unavailable', { recoverable: true })
  }, 3)), /provider unavailable/)
  assert.equal(calls, 1)
})

test('all parser repairs use one retained provider and cannot reselect after revocation', async () => {
  let captures = 0, sends = 0
  const base = request(async () => assert.fail('unfrozen provider must not send'), 2)
  const ai = { ...base.ai, captureRun: async (tasks: string[]) => {
    captures++; assert.deepEqual(tasks, ['outline'])
    return { complete: async () => { if (++sends > 1) throw new AppError('CONFLICT', '模型授权已变化'); return { content: 'invalid-json' } } }
  } }
  await assert.rejects(completeStructured({ ...base, ai }), { code: 'CONFLICT' })
  assert.equal(captures, 1); assert.equal(sends, 2)
})
