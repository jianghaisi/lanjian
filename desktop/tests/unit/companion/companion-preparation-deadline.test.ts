import assert from 'node:assert/strict'
import test from 'node:test'
import { PreparationDeadline, VOICE_PREPARATION_LIMIT_MS, VOICE_REQUEST_TIMEOUT_MS } from '../../../src/main/modules/companion/adapters/companion-voice/preparation-deadline'
import { companionPreparationError } from '../../../src/main/modules/companion/application/companion-preparation-error'

test('real stage advances permit a healthy cold preparation beyond the ordinary three-minute limit', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const failures: string[] = [], deadline = new PreparationDeadline(reason => failures.push(reason))
  for (const stage of ['verify', 'runtime', 'weights', 'warmup']) {
    deadline.advance(stage)
    t.mock.timers.tick(130_000)
    assert.deepEqual(failures, [])
  }
  deadline.clear(); t.mock.timers.tick(600_000)
  assert.deepEqual(failures, [])
})

test('duplicate progress cannot conceal a stalled stage; total timeout and explicit cancellation stay bounded', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const failures: string[] = [], deadline = new PreparationDeadline(reason => failures.push(reason))
  deadline.advance('runtime'); t.mock.timers.tick(VOICE_REQUEST_TIMEOUT_MS - 1)
  deadline.advance('runtime'); t.mock.timers.tick(1)
  assert.deepEqual(failures, ['VOICE_PREPARATION_STALLED:runtime'])
  const total = new PreparationDeadline(reason => failures.push(reason))
  for (const stage of ['verify', 'runtime', 'weights']) { total.advance(stage); t.mock.timers.tick(170_000) }
  total.advance('warmup'); t.mock.timers.tick(VOICE_PREPARATION_LIMIT_MS - 510_000)
  assert.equal(failures.at(-1), 'VOICE_PREPARATION_TIMEOUT')
  const cancelled = new PreparationDeadline(reason => failures.push(reason))
  cancelled.clear(); const count = failures.length
  t.mock.timers.tick(900_000); assert.equal(failures.length, count)
})

test('progress validation and preparation errors fail safely without arbitrary diagnostics', () => {
  const deadline = new PreparationDeadline(() => {})
  try {
    assert.throws(() => deadline.advance('secret/path'))
    deadline.advance('weights'); assert.throws(() => deadline.advance('verify'))
  } finally { deadline.clear() }
  assert.match(companionPreparationError(new Error('VOICE_PREPARATION_STALLED:weights')).message, /载入语音模型/)
  assert.match(companionPreparationError(new Error('VOICE_MEMORY')).message, /内存或显存不足/)
  assert.match(companionPreparationError(new Error('VOICE_CUDA_UNAVAILABLE')).message, /显卡/)
  assert.match(companionPreparationError(new Error('VOICE_ASSETS_INVALID')).message, /校验/)
  assert.equal(companionPreparationError(new Error('VOICE_CANCELLED')).code, 'CONFLICT')
  assert.doesNotMatch(JSON.stringify(companionPreparationError(new Error('secret/path manuscript password'))), /secret|manuscript|password/)
})
