import assert from 'node:assert/strict'
import test from 'node:test'
import { ChapterDraftService } from '../../../src/main/modules/manuscript/application/chapter-draft-service'

test('review input reserve includes actual contract instructions, existing prose and future output', async () => {
  let forbidden = '提前进入钟楼'
  let modelCalls = 0
  const service = new ChapterDraftService({ complete: async () => { modelCalls++; throw Error('must not dispatch') } } as never,
    { chapter: async () => ({ id: 1, position: 1 }), chapterOutline: async () => ({ content: `进入状态：沈砚在桥边\n1. 核对怀表\n退出状态：决定次日查记录\n允许扩写：对白\n禁止：${forbidden}` }) } as never,
    { chapterEvents: async () => [], chapterContractVersion: async () => ({ fingerprint: 'contract', totalFingerprint: 'total', outlineHash: 'outline', eventIds: [], confirmedAt: '2026-09-28T00:00:00Z' }) } as never)
  const base = await service.reviewInputReserve(1, '', 2048)
  assert.ok(base > 2048, 'real review instructions need input space too')
  const withDraft = await service.reviewInputReserve(1, '沈砚站在石桥边核对怀表。'.repeat(100), 2048)
  assert.ok(withDraft > base + 1000, 'the review reads the existing draft as well as the continuation')
  assert.equal(await service.reviewInputReserve(1, '', 3072), base + 1024)
  forbidden += '不得把听说当成已经验证的事实。'.repeat(30)
  assert.ok(await service.reviewInputReserve(1, '', 2048) > base, 'changing the actual contract changes the reserve')
  assert.equal(modelCalls, 0)
})
