import assert from 'node:assert/strict'
import test from 'node:test'
import { completeStoryOutline } from '../../../src/main/modules/planning/application/story-outline-review'
import { StructuredResponseFailure } from '../../../src/main/modules/assistant/application/structured-response-repair'

const parent = '程见微和姜听澜在活动室遇到许嘉树。周子昂是许嘉树的室友。'
const finding = (quote: string, needsAuthor = false) => JSON.stringify({ issues: [{
  category: 'character-name', quote, parentQuote: '程见微和姜听澜在活动室遇到许嘉树。',
  reason: needsAuthor ? '两个人物同时出现，指代不能确定。' : '已命名人物需要完整姓名和明确行动者。', needsAuthor
}] })
function run(responses: unknown[], source = parent, reviewNames = true) {
  const calls: string[] = []
  const ai = { complete: async (instruction: string) => {
    calls.push(instruction)
    const next = responses.shift()
    assert.notEqual(next, undefined, 'bounded response sequence exhausted')
    return { content: typeof next === 'string' ? next : JSON.stringify(next) }
  } }
  return { calls, result: completeStoryOutline({ ai, task: 'chapterOutline', instruction: '展开当前故事', systemContext: '本书有效资料',
    parent: source, reviewNames, repairAttempts: 0, parse: JSON.parse }) }
}

test('a complete multi-character candidate is corrected once without replacing every pronoun with one name', async () => {
  const old = { content: '程见微看见她拿手机，许答应都加。' }
  const next = { content: '程见微取出许嘉树的手机。姜听澜要求由许嘉树选择，许嘉树同意分别添加程见微和姜听澜。' }
  const f = run([old, finding('许答应'), next, { issues: [] }])
  assert.deepEqual(await f.result, next)
  assert.equal(f.calls.length, 4)
  assert.match(f.calls[2], /完整旧候选/)
})

test('ambiguous actors stop before repair and retain the actual source and failed candidate', async () => {
  const candidate = { storyContent: '程见微和姜听澜停下，她拿过手机。' }
  const f = run([candidate, finding('她拿过手机', true)])
  await assert.rejects(f.result, error => error instanceof StructuredResponseFailure
    && error.originalContent === JSON.stringify(candidate) && error.lastContent.includes('full-names-v1')
    && error.lastContent.includes('指代不能确定'))
  assert.equal(f.calls.length, 2)
})

test('name review checks a character list and a reconstructed outline, including the end', async () => {
  for (const candidate of [{ chapters: [{ coreEvent: '午饭', characters: ['许', '程见微'], result: '同行' }] },
    { candidate: '许嘉树完成拍摄。\n\n程见微提出吃饭，她等答复。' }]) {
    const quote = 'candidate' in candidate ? '她等答复' : '许'
    const f = run([candidate, finding(quote), candidate, finding(quote)])
    await assert.rejects(f.result, /故事内容复核未通过/)
    assert.equal(f.calls.length, 4)
  }
})

test('ordinary words, fixed titles, an incomplete roster and unnamed extras survive unchanged', async () => {
  const candidate = { title: '《我的邻居都是发明家》', content: '周子昂在他乡买了吉他，店员请其他成员搬箱子。',
    characters: ['周子昂', '店员'], id: '她-id', quote: '她曾说过' }
  const f = run([candidate, { issues: [] }], parent)
  assert.deepEqual(await f.result, candidate)
  for (const quote of ['其他', '吉他', '他乡', '《我的邻居都是发明家》', '她-id', '她曾说过']) {
    const falseFinding = run([candidate, finding(quote)])
    await assert.rejects(falseFinding.result, error => error instanceof StructuredResponseFailure
      && error.originalContent === JSON.stringify(candidate), 'invalid name evidence must not cause a story rewrite')
    assert.equal(falseFinding.calls.length, 2)
  }
})

test('pure execution extraction cannot silently request renaming the source story', async () => {
  const f = run([{ beats: ['她走到门口'] }, finding('她走到门口')], parent, false)
  await assert.rejects(f.result, /证据与候选或父级不符/)
  assert.equal(f.calls.length, 2)
})

test('blueprint story fields and character roles participate in the same bounded name review', async () => {
  for (const field of ['premise', 'worldView', 'powerSystem', 'cheatSystem', 'rationale', 'role']) {
    const oldText = '程见微邀请许嘉树，她负责联系活动室。'
    const nextText = '程见微邀请许嘉树，程见微负责联系活动室。'
    const candidate = field === 'role'
      ? { characters: [{ name: '程见微', role: oldText, arcSeed: '程见微希望完成拍摄。' }] }
      : { [field]: oldText }
    const corrected = field === 'role'
      ? { characters: [{ name: '程见微', role: nextText, arcSeed: '程见微希望完成拍摄。' }] }
      : { [field]: nextText }
    const f = run([candidate, finding('她负责联系活动室'), corrected, { issues: [] }])
    assert.deepEqual(await f.result, corrected)
    assert.equal(f.calls.length, 4)
    assert.ok(f.calls[1].includes(`姓名专项只检查下列人读字段：[${field === 'role' ? '"程见微",' : ''}"${oldText}"`))
  }
})

test('same names in different books retain their own source instead of sharing a name cache', async () => {
  for (const source of ['周文衡在现代高中，看见私人怪物视觉。', '周文衡从四岁开始成长，按本书境界提升。']) {
    const candidate = { content: source }
    const f = run([candidate, { issues: [] }], source)
    assert.deepEqual(await f.result, candidate)
    assert.ok(f.calls[1].includes(source))
  }
})
