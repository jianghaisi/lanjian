import {
  ARMS, CHARACTER_RULE, GENRES, TARGET_CHARACTERS, WRITING_QUALITY_PURPOSE,
  canonicalJson, narrativeCharacterCount, sha256,
  type Genre, type QualitySlot, type TokenUsage, type TrialManifestV1
} from './writing-quality-protocol'

export type WritingQualityFixture = {
  storyId: string
  genre: Genre
  title: string
  premise: string
  protagonist: string
  setting: string
  incitingEvent: string
  requiredFacts: string[]
  constraints: string[]
}

export type FrozenSlotInput = {
  runId: string
  seed: number
  slot: QualitySlot
  fixture: WritingQualityFixture
  inputHash: string
}

export type OfflineGenerationResult = { content: string; usage: TokenUsage }
export type OfflineGenerationAdapter = {
  generate(input: FrozenSlotInput, signal: AbortSignal): Promise<OfflineGenerationResult>
}

export const WRITING_QUALITY_RUBRIC = {
  version: 'writing-quality-rubric-v1',
  dimensions: ['plot-coherence', 'character-motivation', 'genre-promise', 'prose-readability', 'ending-payoff'],
  scale: { minimum: 1, maximum: 5 },
  instruction: '盲评者只比较同一题材、同一公共设定下的两个匿名候选；离线合成文本不得用于文学质量结论。'
} as const

export const WRITING_QUALITY_FIXTURES: readonly WritingQualityFixture[] = [
  {
    storyId: 'xuanhuan-stone-bell', genre: 'xuanhuan', title: '石钟试炼', protagonist: '林澈', setting: '灵脉枯竭的青崖宗',
    premise: '外门弟子在宗门试炼前夜听见废弃石钟传出只有自己能辨认的警告。',
    incitingEvent: '石钟预告护山阵会在次日正午反噬，而掌阵长老正是主角唯一的恩人。',
    requiredFacts: ['主角修为低微，不能正面对抗长老', '石钟每次示警都会抹去主角一段记忆', '试炼胜者可进入阵眼'],
    constraints: ['必须出现一次有代价的选择', '结尾揭示警告只说了一半真相', '不得凭空升级修为']
  },
  {
    storyId: 'xuanyi-last-elevator', genre: 'xuanyi', title: '停在十三层的电梯', protagonist: '周闻', setting: '即将拆除的旧商住楼',
    premise: '失踪案记者收到一段监控，画面里没有十三层的电梯却在十三层开门。',
    incitingEvent: '记者认出走出电梯的人是三年前被宣告死亡的妹妹。',
    requiredFacts: ['楼层记录可被物业后台修改', '妹妹生前患有短时记忆障碍', '拆楼时间被提前到天亮'],
    constraints: ['线索必须能回看验证', '至少保留一个合理误导', '结尾回答电梯为何停靠']
  },
  {
    storyId: 'dushi-night-route', genre: 'dushi', title: '末班车改线', protagonist: '许遥', setting: '暴雨中的临江城',
    premise: '网约车司机接到一个跨城急单，乘客要求沿早已停用的公交路线行驶。',
    incitingEvent: '司机发现乘客携带的旧照片里有年轻时的父亲，而拍摄日期是明天。',
    requiredFacts: ['主角正面临车辆被收回的债务压力', '旧路线终点是关闭的江堤医院', '乘客拒绝解释照片来源'],
    constraints: ['都市现实逻辑优先', '关系转变必须由行动触发', '结尾保留克制而明确的余波']
  }
] as const

const PROTOCOL_DESCRIPTOR = {
  version: 1, purpose: WRITING_QUALITY_PURPOSE, mode: 'offline', characterRule: CHARACTER_RULE,
  targetCharacters: TARGET_CHARACTERS, genres: GENRES, arms: ARMS,
  pairings: [['direct', 'outline-first'], ['direct', 'v3-full-flow'], ['outline-first', 'v3-full-flow']]
}

export function createOfflineManifest(runId: string, seed: number, ceilings: { perStory?: number; wholeRun?: number } = {}): TrialManifestV1 {
  const slots = WRITING_QUALITY_FIXTURES.flatMap(fixture => ARMS.map(arm => ({ storyId: fixture.storyId, genre: fixture.genre, arm })))
  return {
    version: 1, purpose: WRITING_QUALITY_PURPOSE, runId, mode: 'offline', seed,
    protocolHash: sha256(PROTOCOL_DESCRIPTOR), fixtureHash: sha256(WRITING_QUALITY_FIXTURES), rubricHash: sha256(WRITING_QUALITY_RUBRIC),
    characterRule: CHARACTER_RULE, targetCharacters: TARGET_CHARACTERS, slots,
    syntheticPriceBasis: { currency: 'CNY', inputPerMillionTokens: 1, outputPerMillionTokens: 2 },
    perStoryCeilingCny: ceilings.perStory ?? 0.02,
    wholeRunCeilingCny: ceilings.wholeRun ?? 0.18
  }
}

export function freezeSlotInput(manifest: TrialManifestV1, slot: QualitySlot): FrozenSlotInput {
  const fixture = WRITING_QUALITY_FIXTURES.find(item => item.storyId === slot.storyId && item.genre === slot.genre)
  if (!fixture) throw new Error(`Missing fixture for ${slot.storyId}`)
  const frozen = { runId: manifest.runId, seed: manifest.seed, slot, fixture }
  return { ...frozen, inputHash: sha256(frozen) }
}

export class DeterministicOfflineWritingAdapter implements OfflineGenerationAdapter {
  async generate(input: FrozenSlotInput, signal: AbortSignal): Promise<OfflineGenerationResult> {
    if (signal.aborted) throw abortError()
    const content = syntheticNarrative(input)
    if (signal.aborted) throw abortError()
    const armIndex = ARMS.indexOf(input.slot.arm)
    const genreIndex = GENRES.indexOf(input.slot.genre)
    const inputTokens = 720 + genreIndex * 31 + armIndex * 47
    const outputTokens = 1280 + genreIndex * 53 + armIndex * 71
    return { content, usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens } }
  }
}

export function syntheticNarrative(input: FrozenSlotInput): string {
  const fixture = input.fixture
  const facts = fixture.requiredFacts.join('；')
  const constraints = fixture.constraints.join('；')
  const paragraphs = [
    `【离线合成样本】${fixture.title}。${fixture.premise}`,
    `${fixture.setting}里，${fixture.protagonist}先确认眼前能够验证的细节。${fixture.incitingEvent}他没有立刻相信最显眼的解释，而是把时间、人物、地点和事件逐项记下。`,
    `公开事实包括：${facts}。这些事实限制了选择，也让任何轻易的胜利显得可疑。${fixture.protagonist}沿着最小但可验证的线索行动，每一次判断都留下可以回看的原因。`,
    `局面推进时，旁人的反应改变了原先的推断。${constraints}。因此，主角付出明确代价，修正一次错误判断，再把新的证据与先前细节连接起来。`,
    `临近收束，${fixture.protagonist}面对两个都不完整的答案。他选择承担后果更清楚的一条路，并用行动验证关键事实。结果解决了眼前事件，也留下与题材承诺一致的余波。`,
    `本段只是用于验证长度、哈希、预算、恢复和盲评流程的确定性文字，不代表模型能力，不提供文学质量证据。样本校验码为${sha256(`${input.seed}:${input.slot.storyId}:${input.slot.arm}`).slice(0, 10)}。`
  ]
  const source = paragraphs.join('\n\n')
  let expanded = ''
  let round = 1
  while (narrativeCharacterCount(expanded) < 1950) {
    expanded += `${expanded ? '\n\n' : ''}${source}\n第${round}轮协议标记用于稳定复现。`
    round += 1
  }
  return takeNarrativeCharacters(expanded, 1950)
}

export function fixtureForGenre(genre: Genre): WritingQualityFixture {
  const fixture = WRITING_QUALITY_FIXTURES.find(item => item.genre === genre)
  if (!fixture) throw new Error(`Missing fixture for ${genre}`)
  return fixture
}

export function publicFixture(fixture: WritingQualityFixture): { title: string; premise: string; constraints: string[] } {
  return { title: fixture.title, premise: fixture.premise, constraints: [...fixture.constraints] }
}

function takeNarrativeCharacters(value: string, limit: number): string {
  let count = 0
  const result: string[] = []
  for (const character of Array.from(value.normalize('NFC'))) {
    if (!/\s/u.test(character)) count += 1
    if (count > limit) break
    result.push(character)
  }
  return result.join('').trimEnd()
}

function abortError(): Error {
  const error = new Error('Offline generation cancelled')
  error.name = 'AbortError'
  return error
}

export function canonicalFrozenInput(input: FrozenSlotInput): string {
  return canonicalJson({ runId: input.runId, seed: input.seed, slot: input.slot, fixture: input.fixture })
}
