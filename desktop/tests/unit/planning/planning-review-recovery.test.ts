import assert from 'node:assert/strict'
import test from 'node:test'
import { completeStoryOutline, type StoryReviewState } from '../../../src/main/modules/planning/application/story-outline-review'
import { parseStoryReview } from '../../../src/main/modules/planning/application/story-review-report'
import { StructuredResponseFailure } from '../../../src/main/modules/assistant/application/structured-response-repair'
const issue = (quote: unknown, parentQuote = '') => JSON.stringify({ issues: [{ category: 'continuity', quote, parentQuote, reason: '需要核对动作。', needsAuthor: false }] })
test('structured evidence decodes JSON escapes and CRLF but rejects paraphrase, keys and cross-field quotes', () => {
  const source = { content: '张三推门\r\n进入“房间”。', other: '门外无人' }
  assert.equal(parseStoryReview(issue('张三推门\n进入“房间”。'), source, '', []).length, 1)
  for (const quote of ['张三走进屋里', 'content', '房间”。门外无人', 42]) assert.throws(() => parseStoryReview(issue(quote), source, '', []), /quote/)
  assert.equal(parseStoryReview(issue('', '张三推门\n进入“房间”。'), {}, JSON.stringify(source), []).length, 1)
  for (const p of ['content', '房间”。门外无人']) assert.throws(() => parseStoryReview(issue('', p), {}, JSON.stringify(source), []), /parentQuote/)
  assert.throws(() => parseStoryReview('{"issues":[{"category":"continuity"}]}', source, '', []), /第 1 项.*quote/)
})
for (const budget of [0, 1, 2, 3]) test(`review repair budget ${budget} counts extra calls, keeps candidate and resumes without regeneration`, async () => {
  const raw = JSON.stringify({ content: '张三推门进入房间。' })
  let saved: StoryReviewState | undefined
  const prompts: string[] = []
  const input = { instruction: '生成', systemContext: '', task: 'outline' as const, repairAttempts: budget, parent: '房间空无一人。', parse: JSON.parse }
  await assert.rejects(completeStoryOutline({ ...input, recovery: { save: async s => { saved = s } }, ai: { complete: async prompt => {
    prompts.push(prompt); return { content: prompts.length === 1 ? raw : issue('张三走进屋里') }
  } } }), e => e instanceof StructuredResponseFailure && e.repairAttempts === budget && e.message.includes(`已尝试自动修复 ${budget} 次`))
  assert.equal(prompts.length, budget + 2)
  assert.equal(saved!.last, raw); assert.equal(saved!.phase, 'review')
  if (budget) assert.match(prompts[2], /quote 在草稿中找不到逐字原句/)
  let resumed = 0
  const candidate = await completeStoryOutline({ ...input, recovery: { state: saved, save: async s => { saved = s } }, ai: { complete: async prompt => {
    resumed++; assert.match(prompt, /候选：.*张三推门/); return { content: '{"issues":[]}' }
  } } })
  assert.equal(resumed, 1); assert.equal(candidate.content, '张三推门进入房间。'); assert.equal(saved!.phase, 'complete')
})
test('long review context fails without truncation or requesting a report', async () => {
  let calls = 0
  await assert.rejects(completeStoryOutline({ instruction: '生成', systemContext: '', task: 'outline', repairAttempts: 3, parent: '甲'.repeat(200000), parse: JSON.parse,
    ai: { complete: async () => { calls++; return { content: '{"content":"故事"}' } } } }), /未截断证据/)
  assert.equal(calls, 1)
})
test('retry cancellation cannot send another repair request', async () => {
  const abort = new AbortController(); let calls = 0
  await assert.rejects(completeStoryOutline({ instruction: '生成', systemContext: '', task: 'outline', repairAttempts: 3, parent: '', parse: JSON.parse, signal: abort.signal,
    ai: { complete: async () => { calls++; if (calls === 2) abort.abort(); return { content: calls === 1 ? '{"content":"草稿"}' : issue('不存在') } } } }), /abort/i)
  assert.equal(calls, 2)
})
for (const after of [1, 2, 3]) test(`valid report on repair ${after} stops immediately`, async () => {
  let calls = 0
  const result = await completeStoryOutline({ instruction: '生成', systemContext: '', task: 'outline', repairAttempts: 3, parent: '', parse: JSON.parse,
    ai: { complete: async () => { calls++; return { content: calls === 1 ? '{"content":"草稿"}' : calls === after + 2 ? '{"issues":[]}' : issue('不存在') } } } })
  assert.equal(result.content, '草稿'); assert.equal(calls, after + 2)
})
test('a resumed semantic revision cannot reset the one-revision allowance', async () => {
  let calls = 0, saved: StoryReviewState | undefined
  const raw = '{"content":"草稿"}'
  await assert.rejects(completeStoryOutline({ instruction: '生成', systemContext: '', task: 'outline', repairAttempts: 0, parent: '', parse: JSON.parse,
    recovery: { state: { version: 1, phase: 'review', revisions: 1, original: raw, last: raw, reports: [] }, save: async s => { saved = s } },
    ai: { complete: async () => { calls++; return { content: issue('草稿') } } } }), /内容复核未通过/)
  assert.equal(calls, 1); assert.equal(saved!.phase, 'blocked')
})
