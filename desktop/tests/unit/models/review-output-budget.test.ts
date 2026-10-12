import test from 'node:test'
import assert from 'node:assert/strict'
import { AiClient } from '../../../src/main/modules/models/application/ai-client'
import type { ModelSettingsResolver } from '../../../src/main/modules/models/domain/model-provider'

test('review budgeting reads the frozen remote output ceiling without sending requests', async t => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('budget inspection must not send HTTP') })
  const profile = { connectionId: 'remote-test', model: 'test-model', temperature: .6, topP: .9, maxTokens: 2048 }
  let resolutions = 0
  const settings: ModelSettingsResolver = {
    resolve: async () => {
      resolutions++
      return { kind: 'openai-compatible', connectionId: 'remote-test', connectionName: 'Synthetic', baseUrl: 'https://unused.invalid/v1', apiKey: 'synthetic-only', profile }
    },
    resolveConnection: async () => { throw new Error('unexpected credential lookup') }
  }
  const client = new AiClient(settings)
  const captured = await client.captureRun(['prose', 'review'])
  assert.equal(resolutions, 2)
  profile.maxTokens = 8192
  assert.equal(await captured.outputTokensFor('prose'), 2048)
  assert.equal(await captured.outputTokensFor('review'), 2048)
  assert.equal(resolutions, 2, 'budget inspection reuses captured routes')
  await assert.rejects(captured.outputTokensFor('outline'), { code: 'CONFLICT' })
})
