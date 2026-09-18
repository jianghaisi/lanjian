import { auditCharacterContinuity } from '../../characters/domain/character-continuity'
import { auditLiterarySuggestions } from './literary-suggestions'
import type { CharacterStateEvent, CharacterStateView, RealmLevel } from '../../../../contracts/index'

export type EvaluationLayer = 'deterministic' | 'semantic' | 'literary'
export type EvaluationCategory =
  | '时间与顺序'
  | '地点与移动'
  | '人物生死/伤势/身份'
  | '资源/物品'
  | '世界规则'
  | '知情边界'
  | '能力边界'
  | '因果与动机'
  | '视角/文学性建议'
  | '正常但容易误报的反例'

export type SemanticPredictions = Readonly<Record<string, readonly string[]>>

export type SemanticEvaluationItem = Pick<FixedEvaluationSample, 'id' | 'category' | 'evidence'>

export type FixedEvaluationSample = {
  id: string
  layer: EvaluationLayer
  category: EvaluationCategory
  expectedCode: string | null
  evidence: string
  evaluator: 'character-continuity-v1' | 'literary-suggestions-v1' | 'semantic-model'
  evaluate: (semanticPredictions?: SemanticPredictions) => readonly string[] | null
}

export type EvaluationMetric = {
  layer: EvaluationLayer
  category: EvaluationCategory
  sampleCount: number
  evaluatedCount: number
  expectedFindingCount: number
  truePositive: number
  trueNegative: number
  falsePositive: number
  falseNegative: number
  unableToJudge: number
  detectionRate: number | null
  missRate: number | null
  falsePositiveRate: number | null
  unableToJudgeRate: number
  failedSampleIds: string[]
  unableSampleIds: string[]
}

export type FixedEvaluationReport = {
  suite: 'consistency-fixed-v2'
  suiteVersion: 3
  scope: string
  sampleCount: number
  evaluatedCount: number
  unableToJudgeCount: number
  evaluators: Array<{
    layer: EvaluationLayer
    implementation: string
    version: string
    status: 'evaluated' | 'not-configured'
  }>
  metrics: EvaluationMetric[]
}

const realms: RealmLevel[] = [
  { id: 'r1', name: '炼气一层', description: '' },
  { id: 'r2', name: '炼气二层', description: '' },
  { id: 'r3', name: '炼气三层', description: '' },
  { id: 'r4', name: '筑基初期', description: '' }
]
const locations = ['临江酒馆', '北境雪原', '南岭矿场', '云台书院', '赤水渡口', '青石城门']

export function buildFixedConsistencySamples(): FixedEvaluationSample[] {
  return [
    ...locationSamples(),
    ...capabilitySamples(),
    ...vitalitySamples(),
    ...literarySamples(),
    ...semanticSamples()
  ]
}

export function evaluateFixedConsistencySamples(input: {
  semanticPredictions?: SemanticPredictions
  semanticModelVersion?: string
} = {}): FixedEvaluationReport {
  const samples = buildFixedConsistencySamples()
  const buckets = new Map<string, EvaluationMetric>()
  for (const sample of samples) {
    const key = `${sample.layer}:${sample.category}`
    const metric = buckets.get(key) ?? emptyMetric(sample.layer, sample.category)
    metric.sampleCount += 1
    if (sample.expectedCode) metric.expectedFindingCount += 1
    const actualCodes = sample.evaluate(input.semanticPredictions)
    if (actualCodes === null) {
      metric.unableToJudge += 1
      metric.unableSampleIds.push(sample.id)
      buckets.set(key, metric)
      continue
    }
    metric.evaluatedCount += 1
    if (sample.expectedCode) {
      if (actualCodes.includes(sample.expectedCode)) metric.truePositive += 1
      else {
        metric.falseNegative += 1
        metric.failedSampleIds.push(sample.id)
      }
    } else if (actualCodes.length) {
      metric.falsePositive += 1
      metric.failedSampleIds.push(sample.id)
    } else metric.trueNegative += 1
    buckets.set(key, metric)
  }
  const metrics = [...buckets.values()]
    .map(finalizeMetric)
    .sort((left, right) => layerOrder(left.layer) - layerOrder(right.layer)
      || categoryOrder(left.category) - categoryOrder(right.category))
  const unableToJudgeCount = metrics.reduce((total, metric) => total + metric.unableToJudge, 0)
  return {
    suite: 'consistency-fixed-v2',
    suiteVersion: 3,
    scope: '固定样本只衡量指定版本检查器在本数据集上的结果；文学性提示不代表质量评分，未提供语义模型预测的样本计入无法判断，不伪装为通过。',
    sampleCount: samples.length,
    evaluatedCount: samples.length - unableToJudgeCount,
    unableToJudgeCount,
    evaluators: [
      { layer: 'deterministic', implementation: 'auditCharacterContinuity', version: 'character-continuity-v1', status: 'evaluated' },
      {
        layer: 'semantic', implementation: 'external semantic prediction set',
        version: input.semanticModelVersion?.trim() || 'not-configured',
        status: input.semanticPredictions ? 'evaluated' : 'not-configured'
      },
      { layer: 'literary', implementation: 'auditLiterarySuggestions', version: 'literary-suggestions-v1', status: 'evaluated' }
    ],
    metrics
  }
}

export function semanticEvaluationBatches(batchSize = 12): SemanticEvaluationItem[][] {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 20) throw new Error('语义评测批次必须是 1—20 条。')
  const samples = buildFixedConsistencySamples()
    .filter((sample) => sample.layer === 'semantic')
    .map(({ id, category, evidence }) => ({ id, category, evidence }))
    .sort((a, b) => blindOrder(a.id) - blindOrder(b.id) || a.id.localeCompare(b.id))
  const batches: SemanticEvaluationItem[][] = []
  for (let index = 0; index < samples.length; index += batchSize) batches.push(samples.slice(index, index + batchSize))
  return batches
}

export function semanticEvaluationPrompt(samples: readonly SemanticEvaluationItem[]): string {
  if (!samples.length || samples.length > 20) throw new Error('单次语义评测必须包含 1—20 条样本。')
  return `请判断以下小说连续性样本是否存在明确冲突。只返回 JSON，不要 Markdown、解释或额外字段：
{"results":[{"id":"样本 ID","codes":["冲突代码"]}]}

允许的冲突代码只有：TIME_ORDER_CONFLICT、IDENTITY_OR_INJURY_CONFLICT、RESOURCE_CONFLICT、WORLD_RULE_CONFLICT、KNOWLEDGE_CONFLICT、CAUSAL_OR_MOTIVATION_CONFLICT。
没有足够证据或属于正常表达时 codes 必须是 []。每个输入样本必须且只能返回一次，不得改写 ID，不得根据题材偏好额外审查。

样本：
${JSON.stringify(anonymousSamples(samples))}`
}

// This deterministic permutation is for reproducible blind evaluation, not security.
function blindOrder(id: string): number {
  let hash = 2166136261
  for (const character of id) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619)
  return hash >>> 0
}

function anonymousSamples(samples: readonly SemanticEvaluationItem[]) {
  return samples.map((sample, index) => ({
    id: `sample-${String(index + 1).padStart(2, '0')}`,
    // The fixture's prefix describes its answer class, not story evidence.
    evidence: sample.evidence.replace(/^第\d+个反例：/, '')
  }))
}

export function parseSemanticEvaluationResponse(raw: string, samples: readonly SemanticEvaluationItem[]): Record<string, string[]> {
  const expected = new Set(samples.map((sample) => sample.id))
  if (!expected.size || expected.size !== samples.length) throw new Error('语义评测样本 ID 重复或为空。')
  const sourceIds = new Map(anonymousSamples(samples).map((sample, index) => [sample.id, samples[index].id]))
  const allowedCodes = new Set([
    'TIME_ORDER_CONFLICT', 'IDENTITY_OR_INJURY_CONFLICT', 'RESOURCE_CONFLICT',
    'WORLD_RULE_CONFLICT', 'KNOWLEDGE_CONFLICT', 'CAUSAL_OR_MOTIVATION_CONFLICT'
  ])
  const value = parseJsonObject(raw)
  if (Object.keys(value).length !== 1 || !Array.isArray(value.results)) throw new Error('语义评测结果必须只包含 results 数组。')
  const predictions: Record<string, string[]> = {}
  for (const entry of value.results) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('语义评测结果项格式无效。')
    const record = entry as Record<string, unknown>
    if (Object.keys(record).some((key) => key !== 'id' && key !== 'codes') || typeof record.id !== 'string' || !sourceIds.has(record.id) || !Array.isArray(record.codes)) {
      throw new Error('语义评测结果包含未知样本或字段。')
    }
    const sourceId = sourceIds.get(record.id)!
    if (predictions[sourceId]) throw new Error(`语义评测样本 ${record.id} 被重复返回。`)
    if (record.codes.length > 1 || record.codes.some((code) => typeof code !== 'string' || !allowedCodes.has(code))) {
      throw new Error(`语义评测样本 ${record.id} 返回了无效冲突代码。`)
    }
    predictions[sourceId] = [...new Set(record.codes as string[])]
  }
  if (Object.keys(predictions).length !== expected.size) throw new Error('语义评测结果缺少输入样本。')
  return predictions
}

function locationSamples(): FixedEvaluationSample[] {
  const output: FixedEvaluationSample[] = []
  for (let index = 0; index < 20; index += 1) {
    const before = locations[index % locations.length]
    const after = locations[(index + 1) % locations.length]
    output.push(characterSample(`location-abrupt-${index + 1}`, '地点与移动', 'LOCATION_JUMP', [
      event(1, { location: before }, `沈砚留在${before}。`), event(2, { location: after }, `沈砚出现在${after}。`)
    ]))
    output.push(characterSample(`location-explained-${index + 1}`, '地点与移动', null, [
      event(1, { location: before }, `沈砚留在${before}。`), event(2, { location: after }, `沈砚连夜赶赴${after}。`)
    ]))
  }
  return output
}

function capabilitySamples(): FixedEvaluationSample[] {
  const output: FixedEvaluationSample[] = []
  for (let index = 0; index < 20; index += 1) {
    output.push(characterSample(`capability-skip-${index + 1}`, '能力边界', 'POWER_SKIP', [
      event(1, { power: '炼气一层' }, '沈砚稳在炼气一层。'), event(2, { power: '筑基初期' }, '沈砚已是筑基初期。')
    ]))
    output.push(characterSample(`capability-adjacent-${index + 1}`, '能力边界', null, [
      event(1, { power: '炼气一层' }, '沈砚稳在炼气一层。'), event(2, { power: '炼气二层' }, '沈砚突破至炼气二层。')
    ]))
  }
  return output
}

function vitalitySamples(): FixedEvaluationSample[] {
  const output: FixedEvaluationSample[] = []
  for (let index = 0; index < 10; index += 1) {
    output.push(characterSample(`vitality-unexplained-${index + 1}`, '人物生死/伤势/身份', 'UNEXPLAINED_REVIVAL', [
      event(1, { vitality: 'dead' }, '沈砚气绝身亡。'), event(2, { vitality: 'alive' }, '沈砚睁开眼睛。')
    ]))
    output.push(characterSample(`vitality-explained-${index + 1}`, '人物生死/伤势/身份', null, [
      event(1, { vitality: 'dead' }, '沈砚气绝身亡。'), event(2, { vitality: 'alive' }, '沈砚服下还魂丹后复活。')
    ]))
  }
  return output
}

function literarySamples(): FixedEvaluationSample[] {
  const output: FixedEvaluationSample[] = []
  for (let index = 0; index < 10; index += 1) {
    const duplicate = `雨水顺着第${index + 1}座旧城墙落下，沈砚停在没有灯火的门洞里。`
    output.push(literarySample(`literary-duplicate-${index + 1}`, 'DUPLICATE_PARAGRAPH', `${duplicate}\n\n守门人远远敲了三下木梆。\n\n${duplicate}`))
    output.push(literarySample(`literary-duplicate-clear-${index + 1}`, null, `雨水顺着第${index + 1}座旧城墙落下。\n\n守门人敲了三下木梆。\n\n沈砚绕开积水走向北门。`))
    output.push(literarySample(`literary-opening-${index + 1}`, 'REPEATED_PARAGRAPH_OPENING', `沈砚抬头看见第${index + 1}盏灯熄灭，脚步没有停。\n\n沈砚抬头看见鸦群越过北门，手仍按着刀柄。\n\n沈砚抬头看见天边泛白，才意识到快要破晓。`))
    output.push(literarySample(`literary-opening-clear-${index + 1}`, null, `雨水沿着檐角落下，沈砚走向北门。\n\n守门人抱紧长枪，只让出半步。\n\n远处鸦群惊起，马蹄声越来越近。`))
    output.push(literarySample(`literary-summary-${index + 1}`, 'SUMMARY_TONE_DENSITY', `总而言之，他必须离开第${index + 1}座城。\n\n由此可见，门后并不安全。\n\n事实上，他从未相信那封信。`))
    output.push(literarySample(`literary-summary-clear-${index + 1}`, null, `雨点砸在第${index + 1}块青石上。\n\n沈砚侧身让过巡夜人。\n\n北门外传来第一声鸡鸣。`))
  }
  return output
}

function semanticSamples(): FixedEvaluationSample[] {
  const groups: Array<{ category: EvaluationCategory; code: string; conflicts: string[]; clears: string[] }> = [
    {
      category: '时间与顺序', code: 'TIME_ORDER_CONFLICT',
      conflicts: [
        '第十二章周五放学时，林夏说校庆还有三天；紧接着的第十三章标明周六清晨，却写校庆昨天已经结束。',
        '飞船日志显示冬眠舱在星历九月十日才开启；九月八日的回忆中，刚苏醒的舰长已经参加了会议。',
        '王府婚宴明确安排在除夕夜，正文没有跳时；同一场追逐中人物却说元宵灯会刚散场。',
        '倒计时在爆炸前还有四十分钟，人物只走过一条街、对话五分钟，下一段警报却宣布爆炸已过去两小时。'
      ],
      clears: [
        '第十二章周五放学时，林夏说校庆还有三天；第十三章开头明确写“三天后”，众人准时参加校庆。',
        '飞船日志显示冬眠舱在星历九月十日才开启；九月八日出现的舰长是预录全息影像，不是本人苏醒。',
        '王府婚宴安排在除夕夜；故事跳过半个月后，人物在元宵灯会散场时继续追查。',
        '倒计时还有四十分钟，途中装置受损导致计时加速；警报随后宣布爆炸提前发生。'
      ]
    },
    {
      category: '人物生死/伤势/身份', code: 'IDENTITY_OR_INJURY_CONFLICT',
      conflicts: [
        '人物档案和前三章都确认顾川是顾家独子；第九章没有骗局或收养说明，却让他的同母亲哥哥出面作证。',
        '许棠在上一章右臂骨折并打上石膏，当晚未治疗、时间连续；下一章她用右手完成倒立射击且毫无不适。',
        '刑警已经核验死者齿痕并亲眼封棺；两小时后的封闭现场里，同一人正常值班，正文没有替身、复活或误认线索。',
        '开篇明确柳青从出生起双目失明且从未恢复；后文没有辅助设备，却写她凭颜色分辨出远处三面旗帜。'
      ],
      clears: [
        '人物档案称顾川是顾家独子；第九章来人自称亲哥哥，随后被指纹证据揭穿是假冒。',
        '许棠右臂骨折，当晚改用左手开枪；动作笨拙，并因后坐力牵动伤处。',
        '刑警亲眼封棺；值班室里出现的是佩戴死者面具的嫌疑人，叙述立即指出身高不符。',
        '柳青双目失明；她通过旗杆上不同节奏的金属铃声判断三支队伍，而非看见颜色。'
      ]
    },
    {
      category: '资源/物品', code: 'RESOURCE_CONFLICT',
      conflicts: [
        '唯一的铜钥匙在第六章被当众熔成铜水，期间无人重铸；第七章人物仍用“那把铜钥匙”打开旧门。',
        '队伍出发时只剩一支解毒针，苏遥已经把它完整注射给伤员；下一个房间里她又从同一药盒取出一支。',
        '账本确认公会现金只剩八十银币，采购也没有赊账；随后掌柜直接付出三百银币且余额仍写八十。',
        '密信原件被主角烧毁，灰烬也被冲入河中；没有抄本或留影，审判时他却交出了同一张原件。'
      ],
      clears: [
        '唯一的铜钥匙被熔毁；第七章锁匠根据蜡模重铸新钥匙，并说明旧钥匙已经不存在。',
        '队伍只剩一支解毒针并已用完；新房间的医疗柜里找到另一批不同编号的针剂。',
        '公会现金只剩八十银币；掌柜用自己的私人存款垫付三百，并留下借款凭据。',
        '密信原件被烧毁；审判时提交的是书记员此前认证过的拓印件，正文没有把它称为原件。'
      ]
    },
    {
      category: '世界规则', code: 'WORLD_RULE_CONFLICT',
      conflicts: [
        '世界规则反复说明传送门只能在两座固定石台之间开启；人物在荒野空地徒手开门，正文没有新能力或例外代价。',
        '设定确认机器人不得直接伤害注册公民，且该限制无法远程解除；家政机器人却因一句口令主动刺伤已注册主人。',
        '本书吸血鬼在日光下会立即化灰，遮挡可以避免；角色正午赤裸站在无遮广场十分钟，既无受伤也无解释。',
        '考试规则写明离开考场结界就永久失去资格；主角已经跨出结界，后来没有申诉或规则变更却继续参加决赛。'
      ],
      clears: [
        '传送门通常只能连接固定石台；人物消耗唯一的界锚在荒野临时生成石台，代价和持续时间均被写明。',
        '机器人不得伤害注册公民；调查随后发现受害者身份登记在前夜被人非法注销。',
        '吸血鬼在日光下会化灰；角色站在广场时上空覆盖着隔绝日光的投影穹顶，穹顶失效后她立刻撤离。',
        '离开考场结界会失去资格；主角跨出的其实是裁判制造的幻象边界，真实结界仍在三步之外。'
      ]
    },
    {
      category: '知情边界', code: 'KNOWLEDGE_CONFLICT',
      conflicts: [
        '暗室位置只在凶手独白中出现，陈舟没有在场也未得到记录；会合后他直接说出书柜后第三块砖是入口。',
        '医生一直隐瞒胎儿性别，检查报告密封在她手中；家属从未拆封，却提前用“女儿”准确称呼且叙述不表示猜测。',
        '反派改用无人知晓的新名字入住酒店，主角未调查、未见登记；第一次碰面就准确喊出这个新名字。',
        '作战计划只通过离线纸条交给甲队，乙队被彻底隔离；乙队长随后按计划中的秘密时间准时引爆桥梁。'
      ],
      clears: [
        '暗室位置原本只有凶手知道；陈舟从书柜磨损和地面拖痕推断入口，并逐步试出第三块砖。',
        '医生隐瞒胎儿性别；家属说“女儿”后马上补充自己只是随口猜的，后来证明猜错。',
        '反派改用新名字入住；主角事前买通前台看过登记簿，见面时因此喊出假名。',
        '计划原只给甲队；甲队侦察员冒险穿过封锁，把引爆时间亲口传给乙队长。'
      ]
    },
    {
      category: '因果与动机', code: 'CAUSAL_OR_MOTIVATION_CONFLICT',
      conflicts: [
        '周澄刚以母亲生命发誓绝不替财团工作；下一场戏没有威胁、欺骗或新利益，他却兴高采烈地主动签约。',
        '侦探锁定嫌疑人的唯一依据已被当场证明伪造；没有新增证据，他下一章仍说“所以只可能是她”并实施抓捕。',
        '村民此前宁死也不肯打开水闸，因为开闸会淹没全村；局势没有变化，他们忽然一致开闸且无人提出理由。',
        '主角冒险十年只为找到失踪父亲，终于获得确切地址；没有危险或价值冲突，他随手扔掉地址并永久放弃寻找。'
      ],
      clears: [
        '周澄发誓不替财团工作；财团绑走母亲后，他表面签约以便潜入营救，独白说明并未改变立场。',
        '原证据被证明伪造；侦探从伪造纸张的水印找到新线索，再据监控确认嫌疑人才实施抓捕。',
        '村民拒绝开闸以免淹村；山体滑坡改变河道、村庄已经撤空后，他们开闸保护下游城市。',
        '主角拿到父亲地址，却发现追踪器藏在纸中；他记住地址后烧掉纸张，转而绕路寻找。'
      ]
    }
  ]
  const output: FixedEvaluationSample[] = []
  for (const group of groups) {
    for (let index = 0; index < 4; index += 1) {
      output.push(semanticSample(`${slug(group.code)}-${index + 1}`, group.category, group.code, group.conflicts[index]))
      output.push(semanticSample(`${slug(group.code)}-clear-${index + 1}`, group.category, null, group.clears[index]))
    }
  }
  const counterexamples = [
    '程野被当众拆穿谎话，捂脸说自己“已经社会性死亡”；上下文明示这是夸张的尴尬感受，不是生死状态变化。',
    '老人称年轻掌柜为“我亲兄弟”，随后解释是一起逃荒结拜的称呼；人物档案中的独子身份没有改变。',
    '叙述先写“她不知道门后的秘密”，下一句转入十年前的回忆，由当时知情的母亲视角讲述门后情形。',
    '主角说绝不会再进赌场，后来走进已经改建成社区图书馆的原赌场旧址；他没有重新赌博。',
    '木盒里最后一枚金币已经花掉；后文人物收到的是雇主新支付的一枚金币，并非凭空恢复原物。',
    '校规禁止学生夜间离校；老师签发正式外出证后，学生在夜里去医院，不构成世界规则冲突。',
    '角色左腿受伤无法奔跑，危急时扶着墙快走了十米后跌倒；文本没有声称伤势痊愈。',
    '预言说王子“活不过二十岁”，生日当天众人以为他死亡；随后揭示预言中的“王子”是同名舰船。',
    '上一章结束于“天彻底黑了”，下一章开头写晨光照进窗户；章节间明确省略了一夜。',
    '苏眠没有听见密谈，但她看见泥脚印、断绳和空马厩后推断俘虏从北门被带走，属于现场推理。',
    '法术通常需要咒语，失声法师用提前录好的自己的声音施法；设定允许声音由媒介播放。',
    '船长曾拒绝驶入风暴，气象图更新显示风暴已经转向后才下令启航；动机和风险条件均发生变化。'
  ]
  counterexamples.forEach((evidence, index) => output.push(semanticSample(
    `normal-counterexample-${index + 1}`, '正常但容易误报的反例', null, evidence
  )))
  return output
}

function characterSample(id: string, category: EvaluationCategory, expectedCode: string | null, events: CharacterStateEvent[]): FixedEvaluationSample {
  return {
    id, layer: 'deterministic', category, expectedCode,
    evidence: events.map((entry) => entry.evidence).join(' / '),
    evaluator: 'character-continuity-v1',
    evaluate: () => auditCharacterContinuity(state(events), realms, 2).map((finding) => finding.code)
  }
}

function literarySample(id: string, expectedCode: string | null, content: string): FixedEvaluationSample {
  return {
    id, layer: 'literary', category: '视角/文学性建议', expectedCode, evidence: content,
    evaluator: 'literary-suggestions-v1',
    evaluate: () => auditLiterarySuggestions(content, 1).map((finding) => finding.code)
  }
}

function semanticSample(id: string, category: EvaluationCategory, expectedCode: string | null, evidence: string): FixedEvaluationSample {
  return {
    id, layer: 'semantic', category, expectedCode, evidence, evaluator: 'semantic-model',
    evaluate: (predictions) => predictions && Object.prototype.hasOwnProperty.call(predictions, id) ? [...predictions[id]] : null
  }
}

function event(chapterPosition: number, changes: Omit<CharacterStateEvent['changes'], 'present'>, evidence: string): CharacterStateEvent {
  return {
    id: `event-${chapterPosition}-${hashText(evidence)}`, characterId: 'shen-yan', chapterId: chapterPosition, chapterPosition,
    manuscriptRevision: 'a'.repeat(64), proposalId: `proposal-${chapterPosition}`,
    acceptedAt: `2026-09-02T00:${String(chapterPosition).padStart(2, '0')}:00.000Z`, evidence, active: true,
    changes: { present: true, ...changes },
    changeEvidence: Object.fromEntries(Object.keys(changes).map((key) => [key, evidence]))
  }
}

function state(events: CharacterStateEvent[]): CharacterStateView {
  return { version: 1, workItemId: 'evaluation-book', anchors: [{ id: 'shen-yan', name: '沈砚', sourceRefs: [] }], events, snapshots: [], pendingConflicts: [] }
}

function emptyMetric(layer: EvaluationLayer, category: EvaluationCategory): EvaluationMetric {
  return { layer, category, sampleCount: 0, evaluatedCount: 0, expectedFindingCount: 0, truePositive: 0, trueNegative: 0, falsePositive: 0, falseNegative: 0, unableToJudge: 0, detectionRate: null, missRate: null, falsePositiveRate: null, unableToJudgeRate: 0, failedSampleIds: [], unableSampleIds: [] }
}

function finalizeMetric(metric: EvaluationMetric): EvaluationMetric {
  const evaluatedPositive = metric.truePositive + metric.falseNegative
  const evaluatedNegative = metric.trueNegative + metric.falsePositive
  return {
    ...metric,
    detectionRate: evaluatedPositive ? ratio(metric.truePositive, evaluatedPositive) : null,
    missRate: evaluatedPositive ? ratio(metric.falseNegative, evaluatedPositive) : null,
    falsePositiveRate: evaluatedNegative ? ratio(metric.falsePositive, evaluatedNegative) : null,
    unableToJudgeRate: ratio(metric.unableToJudge, metric.sampleCount)
  }
}

function ratio(value: number, total: number): number { return total ? Number((value / total).toFixed(4)) : 0 }
function layerOrder(layer: EvaluationLayer): number { return ({ deterministic: 0, semantic: 1, literary: 2 })[layer] }
function categoryOrder(category: EvaluationCategory): number {
  return ['时间与顺序', '地点与移动', '人物生死/伤势/身份', '资源/物品', '世界规则', '知情边界', '能力边界', '因果与动机', '视角/文学性建议', '正常但容易误报的反例'].indexOf(category)
}
function hashText(value: string): string {
  let hash = 0
  for (const character of value) hash = ((hash * 31) + character.charCodeAt(0)) >>> 0
  return hash.toString(16)
}
function slug(value: string): string { return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') }

function parseJsonObject(raw: string): Record<string, unknown> {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('语义评测没有返回 JSON 对象。')
  const parsed: unknown = JSON.parse(cleaned.slice(start, end + 1))
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('语义评测返回值不是 JSON 对象。')
  return parsed as Record<string, unknown>
}
