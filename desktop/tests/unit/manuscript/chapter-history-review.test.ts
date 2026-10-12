import assert from 'node:assert/strict'
import test from 'node:test'
import { ChapterDraftService, extractFactClaimCandidates } from '../../../src/main/modules/manuscript/application/chapter-draft-service'

const history = '老班长为了保住我当班的差事，提笔拿墨把那几行字全盖死了，改报成了机械滞涩、检修误鸣。'
const canon = '周叔曾违背当班指令敲钟，让渡船改靠高岸。'
const content = `周叔说：“${history}”\n\n${'沈砚望着窗外，雨水顺着窗台流下来。\n\n'.repeat(25)}`

for (const { approved, invalidQuote, repair } of [
  { approved: false }, { approved: true },
  { approved: false, invalidQuote: true },
  { approved: false, invalidQuote: true, repair: true }
]) {
  test(`unseeded history: approved=${approved}, invalidQuote=${!!invalidQuote}, repair=${!!repair}`, async () => {
    assert.deepEqual(extractFactClaimCandidates(history), [], 'this actual missed claim has no keyword seed')
    let calls = 0
    const context = approved ? `${canon}\n${history}` : canon
    const ai = {
      complete: async (instruction: string, _draft: string, formal: string, task: string) => {
        calls++
        if (calls > 2) assert.ok(formal.startsWith(context), 'repair retains the same formal context')
        else assert.equal(formal, context)
        if (task === 'prose') {
          assert.match(instruction, /人物口述也不能绕过此边界/)
          return { content }
        }
        assert.equal(task, 'review')
        assert.match(instruction, /人物前史、既往关系、秘密成因/)
        assert.match(instruction, /参与者、行为、动机、结果分别比对/)
        assert.doesNotMatch(instruction, /周文衡/)
        return { content: JSON.stringify({
          summary: '节点已完成', passed: true,
          beats: [{ id: 'B1', status: 'covered', evidence: '周叔解释旧事' }],
          boundary: { entryRespected: true, exitReached: true },
          violations: [], introducedFacts: [], foreshadowing: [], literaryFindings: [],
          factClaims: [{ claim: '老班长涂改记录包庇周叔', evidence: invalidQuote && calls === 2 ? '老班长为了保住差事……改报成检修误鸣。' : history,
            status: approved ? 'supported' : 'unsupported', supportEvidence: approved ? history : '' }]
        }) }
      }
    }
    const documents = {
      chapter: async () => ({ id: 3, position: 3 }),
      chapterOutline: async () => ({ content: '进入状态：三人在钟楼\n1. 周叔解释旧事\n退出状态：留在平台\n允许扩写：当前动作和对白' })
    }
    const workspace = {
      foundationStatus: async () => ({ readyForProse: true, missing: [] }),
      chapterEvents: async () => [],
      chapterContractVersion: async () => ({ fingerprint: 'contract', totalFingerprint: 'total', outlineHash: 'outline', eventIds: [], confirmedAt: '2026-09-28T00:00:00Z' }),
      bookProfile: async () => ({ targetWordsPerChapter: 400, proseExpansionMode: 'balanced', reviewStrictness: 'balanced' }),
      promptContext: async () => context,
      contextBudgetPreferences: async () => ({ structuredRepairAttempts: repair ? 1 : 0 })
    }
    const draft = () => new ChapterDraftService(ai as never, documents as never, workspace as never).draft(3, '继续')
    if (invalidQuote && !repair) {
      await assert.rejects(draft, (error: { code?: string }) => error.code === 'AI_RESPONSE_INVALID')
      assert.equal(calls, 2)
      return
    }
    const result = await draft()
    assert.equal(calls, repair ? 3 : 2, 'no new generation when repairing the review')
    assert.equal(result.content, content, 'review never rewrites model prose')
    assert.equal(result.report.passed, approved, 'the model passed flag cannot override unsupported history')
    assert.equal(result.report.introducedFacts.length, approved ? 0 : 1)
    if (!approved) {
      assert.match(result.report.introducedFacts[0], /老班长涂改记录包庇周叔/)
      assert.match(result.report.summary, /未通过审校/)
    }
  })
}
