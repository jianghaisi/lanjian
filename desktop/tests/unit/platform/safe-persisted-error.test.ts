import assert from 'node:assert/strict'
import test from 'node:test'
import { AppError, isAppError } from '../../../src/main/core/errors/app-error'
import { safePersistedErrorMessage } from '../../../src/main/platform/errors/safe-persisted-error'

test('persists only branded application errors and rejects structurally spoofed provider messages', () => {
  const trusted = new AppError('FEATURE_UNAVAILABLE', '接口密钥无效或已经失效，请重新检查令牌。', { recoverable: true })
  const spoofed = Object.assign(new Error('provider echoed secret-smoke-key'), {
    name: 'AppError', code: 'FEATURE_UNAVAILABLE', recoverable: true
  })

  assert.equal(isAppError(trusted), true)
  assert.equal(safePersistedErrorMessage(trusted, '安全回退'), trusted.message)
  assert.equal(isAppError(spoofed), false)
  assert.equal(safePersistedErrorMessage(spoofed, '安全回退'), '安全回退')
})
