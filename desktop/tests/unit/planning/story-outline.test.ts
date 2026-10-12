import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { completeStoryOutline } from '../../../src/main/modules/planning/application/story-outline-review'
import { StructuredResponseFailure } from '../../../src/main/modules/assistant/application/structured-response-repair'
import { renderPlanningChapterDetail, chapterDetailFingerprint } from '../../../src/main/modules/planning/domain/planning-chapter-detail'
import { renderPlanningVolumeOutline, renderPlanningVolumePlan } from '../../../src/main/modules/planning/application/planning-package-service'
import { parseChapterSkeletonVolume } from '../../../src/main/modules/planning/application/chapter-skeleton-service'
import { parseOutlineExpansion } from '../../../src/main/modules/planning/application/planning-draft-service'
import { buildChapterContract } from '../../../src/main/modules/manuscript/application/chapter-draft-service'
import { decodeChapterStoryConstraints } from '../../../src/contracts/planning/chapter-story-contract'
import { decodePlanningPackageArgs } from '../../../src/contracts/planning/ipc'
import type { PlanningPackageProposal } from '../../../src/contracts/index'
const hash = (s: string) => createHash('sha256').update(s).digest('hex')
const constraints = { entryState: '许嘉树完成样例，准备离开。', beats: ['程见微提出一起吃饭。', '许嘉树以为是聚餐，招呼林小满。'], exitState: '三人同行，程未能独处。', allowedFacts: ['沿途选择实惠餐厅。'], forbiddenEvents: ['许嘉树知道游戏影响现实。'], foreshadowActions: [] }
const detail = { chapter: 4, volume: 1, volumeChapter: 4, title: '午饭邀请', ...constraints }

test('old render and volume fingerprints remain byte-identical; new narrative excludes execution fields', () => {
  const old = renderPlanningChapterDetail(detail)
  assert.equal(old, '进入状态：许嘉树完成样例，准备离开。\n1. 程见微提出一起吃饭。\n2. 许嘉树以为是聚餐，招呼林小满。\n退出状态：三人同行，程未能独处。\n允许扩写：沿途选择实惠餐厅。\n禁止：许嘉树知道游戏影响现实。')
  assert.equal(chapterDetailFingerprint(detail), hash(old))
  const next = { ...detail, storyContent: '程见微见他要走，提出一起吃饭。许以为是工作组聚餐，叫上林小满。程没法当面解释，三人一起出门。' }
  assert.match(renderPlanningChapterDetail(next), /第 4 章.*午饭邀请/)
  assert.doesNotMatch(renderPlanningChapterDetail(next), /允许扩写|禁止：|进入状态：/)
  assert.notEqual(chapterDetailFingerprint(next), chapterDetailFingerprint({ ...next, forbiddenEvents: ['改变约束'] }))
  const volume = { order: 1, title: '初遇', goal: '工作', summary: '事件', ending: '同行' }
  assert.equal(renderPlanningVolumeOutline(volume), '# 第 1 卷 · 初遇\n\n> 本卷目标：工作\n\n## 事件链\n\n事件\n\n## 卷末状态\n\n同行\n')
  assert.equal(renderPlanningVolumePlan({ volumes: [volume] } as PlanningPackageProposal), JSON.stringify([volume]))
  assert.notEqual(renderPlanningVolumePlan({ volumes: [{ ...volume, storyContent: '具体故事' }] } as PlanningPackageProposal), JSON.stringify([volume]))
})
test('new counts follow scenes; old parsing requires exact count and continuous identities', () => {
  const chapters = JSON.stringify({ chapters: [{ volumeChapter: 1, title: '邀请', coreEvent: '提出吃饭，对方叫来同伴', characters: ['程', '许', '林'], location: '活动室', result: '三人同行' }] })
  assert.equal(parseChapterSkeletonVolume(chapters, 1, 18, 4, true)[0].chapter, 4)
  assert.throws(() => parseChapterSkeletonVolume(chapters, 1, 18, 4))
  assert.throws(() => parseChapterSkeletonVolume('{"chapters":[]}', 1, 18, 4, true))
  assert.throws(() => parseChapterSkeletonVolume(chapters.replace('"volumeChapter":1', '"volumeChapter":2'), 1, 18, 4, true))
  const children = JSON.stringify({ children: [{ title: '邀请', content: '完整故事', events: [{ time: '午间', characters: ['程'], location: '教室', event: '提出邀请' }] }] })
  assert.equal(parseOutlineExpansion(children, 5, true).length, 1)
  assert.throws(() => parseOutlineExpansion(children, 5))
})
test('writing constraints cannot be guessed from first and last narrative sentences', () => {
  const outline = '许完成工作后准备走。程提出吃饭，许叫来林小满。三人出门。'
  const version = { fingerprint: hash('v'), totalFingerprint: hash('t'), outlineHash: hash(outline), eventIds: [], confirmedAt: new Date().toISOString() }
  assert.throws(() => buildChapterContract(4, outline, version), /尚未准备/)
  const contract = buildChapterContract(4, outline, { ...version, storyConstraints: constraints })
  assert.equal(contract.beats.length, 2)
  assert.equal(contract.outlineSnapshot, outline)
  assert.throws(() => buildChapterContract(4, `${outline}作者新改了结局`, { ...version, storyConstraints: constraints }), /版本不符/)
  assert.throws(() => decodeChapterStoryConstraints({ ...constraints, approved: true }))
  assert.throws(() => decodeChapterStoryConstraints({ ...constraints, beats: [] }))
})
const run = (responses: string[], parent = '程提出午饭邀请。') => {
  const calls: string[] = []
  const ai = { complete: async (instruction: string) => { calls.push(instruction); return { content: responses.shift()! } } }
  const promise = completeStoryOutline({ ai, instruction: '生成本层自然段故事', systemContext: '冻结设定', task: 'outline', repairAttempts: 0, parent, parse: text => JSON.parse(text) as { content: string } })
  return { calls, promise }
}
const issue = (needsAuthor = false) => JSON.stringify({ issues: [{ category: needsAuthor ? 'upstream-gap' : 'concrete-events', quote: '推进关系', parentQuote: '程提出午饭邀请。', reason: '没有写人物怎样回应邀请。', needsAuthor }] })
test('review corrects a tag into actual story once and rechecks', async () => {
  const r = run(['{"content":"推进关系"}', issue(), '{"content":"程提出邀请，许以为聚餐，叫来林。三人同行。"}', '{"issues":[]}'])
  assert.match((await r.promise).content, /叫来林/)
  assert.equal(r.calls.length, 4)
  assert.match(r.calls[2], /不新增上游重要剧情/)
})
test('unresolved and upstream issues retain candidate evidence and stop at bounded calls', async () => {
  const r = run(['{"content":"推进关系"}', issue(), '{"content":"推进关系"}', issue()])
  await assert.rejects(r.promise, e => e instanceof StructuredResponseFailure && e.originalContent.includes('推进关系') && e.lastContent.includes('没有写人物怎样回应'))
  assert.equal(r.calls.length, 4)
  const upstream = run(['{"content":"推进关系"}', issue(true)])
  await assert.rejects(upstream.promise, /内容复核未通过/)
  assert.equal(upstream.calls.length, 2)
})
test('review evidence must be located; network and stop do not become semantic retries', async () => {
  const forged = run(['{"content":"邀请"}', issue()])
  await assert.rejects(forged.promise, /证据与候选或父级不符/)
  let count = 0
  await assert.rejects(completeStoryOutline({ ai: { complete: async () => { count++; throw new Error('network') } }, instruction: '生成', systemContext: '', task: 'outline', repairAttempts: 1, parent: '', parse: JSON.parse }), /network/)
  assert.equal(count, 1)
  const controller = new AbortController()
  await assert.rejects(completeStoryOutline({ ai: { complete: async () => { controller.abort(); return { content: '{"content":"邀请"}' } } }, signal: controller.signal, instruction: '生成', systemContext: '', task: 'outline', repairAttempts: 1, parent: '', parse: JSON.parse }), /abort/i)
})
test('optional legacy bodies survive IPC while empty or oversized new bodies reject', () => {
  const proposal = { id: 'sample', workItemId: 'book', createdAt: new Date().toISOString(), basedOn: { inputFingerprint: hash('i'), blueprintFingerprint: hash('b'), totalOutlineFingerprint: hash('t') }, blueprint: { premise: '命题', worldView: '世界', characters: [{ name: '许', role: '男主', arcSeed: '相遇' }], powerSystem: '', cheatSystem: '', rationale: '理由' }, totalOutline: { title: '总纲', summary: '相遇', content: '完整故事' }, volumes: [{ order: 1, title: '一卷', goal: '相遇', summary: '邀请', ending: '同行' }] }
  assert.equal(decodePlanningPackageArgs([proposal])[0].volumes[0].storyContent, undefined)
  for (const bad of ['', 4, 'x'.repeat(100001)]) assert.throws(() => decodePlanningPackageArgs([{ ...proposal, volumes: [{ ...proposal.volumes[0], storyContent: bad }] }]))
})


test('malformed review retains the actual generated story and review failure together', async () => {
  const candidate = '{"content":"程提出午饭邀请，许叫来林，三人一起去吃饭。"}'
  const r = run([candidate, '{"wrong":"missing issues"}'])
  await assert.rejects(r.promise, error => error instanceof StructuredResponseFailure
    && error.originalContent === candidate && error.lastContent.includes('reviewFailure') && error.lastContent.includes('missing issues'))
  assert.equal(r.calls.length, 2)
})
