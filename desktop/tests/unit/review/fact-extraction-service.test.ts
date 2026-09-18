import assert from 'node:assert/strict'
import test from 'node:test'
import { FactExtractionService } from '../../../src/main/modules/review/application/fact-extraction-service'

const chapter = {
  id: 1, position: 1, title: '雨夜', content: '沈砚在临江酒馆门前发现半枚铜符。', word_count: 16, summary: '', bodyVersionId: 'body-1', revision: 'revision-1'
}

test('creates fact candidates only when every extracted change is backed by the saved body', async () => {
  const service = new FactExtractionService({
    complete: async () => ({ content: JSON.stringify([
      { character: '沈砚', field: 'possession', value: '半枚铜符', evidence: '沈砚在临江酒馆门前发现半枚铜符。' },
      { character: '沈砚', field: 'power', value: '突破九品', evidence: '沈砚悄然突破九品。' }
    ]) })
  } as never)
  const changes = await service.extract(chapter)
  assert.deepEqual(changes, [{ character: '沈砚', field: 'possession', value: '半枚铜符', evidence: '沈砚在临江酒馆门前发现半枚铜符。' }])
})

test('rejects malformed model output before any fact batch can be created', async () => {
  let calls = 0
  const service = new FactExtractionService({ complete: async () => { calls += 1; return { content: '不是 JSON' } } } as never)
  await assert.rejects(service.extract(chapter), (error: { code?: string; message?: string }) => error.code === 'AI_RESPONSE_INVALID' && /原始结果已保留/.test(error.message || ''))
  assert.equal(calls, 2)
})

test('keeps bounded importance and low-value classification for later project filtering', async () => {
  const service = new FactExtractionService({
    complete: async () => ({ content: JSON.stringify([{
      character: '沈砚', field: 'knowledge', value: '路边店铺正在换招牌', evidence: '沈砚看见路边店铺正在换招牌。',
      event: '路过店铺', importance: 'low', reviewClass: 'low_value'
    }]) })
  } as never)
  const source = { ...chapter, content: '沈砚看见路边店铺正在换招牌。' }
  assert.deepEqual(await service.extract(source), [{
    character: '沈砚', field: 'knowledge', value: '路边店铺正在换招牌', evidence: '沈砚看见路边店铺正在换招牌。',
    event: '路过店铺', importance: 'low', reviewClass: 'low_value'
  }])
})
