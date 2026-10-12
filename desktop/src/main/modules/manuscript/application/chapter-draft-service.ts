import { worldbookContextVersion } from '../../characters/domain/worldbook-context'
import type { PolicySource } from '@lanjian/writing-plugin-contracts'
import { randomUUID } from 'node:crypto'
import type { AdherenceBeatResult, AdherenceForeshadowResult, AdherenceReport, ChapterBeat, ChapterContract, ChapterContractVersionRef, ChapterDraftProposal, CharacterDynamicChange, CharacterStableConflict, ProseExpansionMode, ReviewStrictness } from '../../../../contracts/index'
import { createHash } from 'node:crypto'
import { decodeChapterStoryConstraints } from '../../../../contracts/planning/chapter-story-contract'
import { decodeLiteraryFindings, literaryFindingCategories } from '../../../../contracts/review/literary-findings'
import type { LiteraryFinding } from '../../../../contracts/review/types'
import { parseChapterOutline } from '../../planning/domain/chapter-outline'
import { AiClient } from '../../models/application/ai-client'
import { DocumentService } from './document-service'
import { WorkspaceService } from '../../library/application/workspace-service'
import { completeStructured } from '../../assistant/application/structured-response-repair'
import { heuristicContextTokenEstimator } from '../../assistant/domain/context-compiler'
import { AppError } from '../../../core/errors/app-error'
import { narrativeConstraintGuidance } from '../../worldbuilding/domain/genre-writing'
import { creativePolicyRun, withCreativePolicy, type CaptureCreativePolicy, type CreativePolicyRun } from '../../writing-plugins/domain/creative-policy'
import { creativePolicyContext } from '../../writing-plugins/domain/creative-policy-context'

export class ChapterDraftService {
  constructor(
    private readonly ai: AiClient,
    private readonly documents: DocumentService,
    private readonly workspace: WorkspaceService,
    private readonly capturePolicy: CaptureCreativePolicy = async () => creativePolicyRun()
  ) {}

  /** The review receives the whole candidate in addition to the frozen world context. */
  async reviewInputReserve(chapterId: number, currentDraft: string, generatedTokens: number, methods?: readonly PolicySource[]): Promise<number> {
    const [outline, chapter, events, version] = await Promise.all([
      this.documents.chapterOutline(chapterId), this.documents.chapter(chapterId),
      this.workspace.chapterEvents(chapterId), this.workspace.chapterContractVersion(chapterId)
    ])
    assertContractEventVersions(version, events)
    const contract = buildChapterContract(chapterId, outline.content, version, events, chapter.position)
    // Prepared agent contexts already budget the selected methods as required sources.
    let methodContext = ''
    if (!methods) {
      const policy = await this.capturePolicy(), profile = await this.workspace.bookProfile?.()
      methodContext = creativePolicyContext([...policy.resolve('review'), ...policy.resolve('genre-guidance', { genre: profile?.genre || '', subgenre: profile?.subgenre || '' })])
      await policy.assertAuthorized?.()
    }
    return heuristicContextTokenEstimator.estimate([methodContext, reviewPrompt(contract, currentDraft)].join('\n\n')) + generatedTokens
  }

  async draft(
    chapterId: number,
    authorInstruction: string,
    currentDraft = '',
    signal?: AbortSignal,
    modelOverride?: string,
    options?: {
      ai?: AiClient
      policy?: CreativePolicyRun
      methods?: { prose: PolicySource[]; review: PolicySource[] }
      contexts?: { prose: string; review: string }
      onDelta?: (delta: string, content: string) => void | Promise<void>
    },
    connectionIdOverride?: string,
    maxTokensOverride?: number
  ): Promise<ChapterDraftProposal> {
    const provider = options?.ai ?? this.ai
    if (!Number.isInteger(chapterId) || chapterId < 1) throw new Error('章节编号无效')
    signal?.throwIfAborted()
    const status = await this.workspace.foundationStatus(chapterId)
    signal?.throwIfAborted()
    if (!status.readyForProse) throw new Error(`请先完善：${status.missing.join('、')}`)
    const ai = provider.captureRun ? await provider.captureRun(['prose', 'review'], connectionIdOverride) : provider
    const [outline, chapter, events, version, profile] = await Promise.all([
      this.documents.chapterOutline(chapterId),
      this.documents.chapter(chapterId),
      this.workspace.chapterEvents(chapterId),
      this.workspace.chapterContractVersion(chapterId),
      this.workspace.bookProfile()
    ])
    signal?.throwIfAborted()
    assertContractEventVersions(version, events)
    const contract = buildChapterContract(chapterId, outline.content, version, events, chapter.position)
    const policy = options?.policy ?? await this.capturePolicy()
    const methods = options?.methods ?? {
      prose: [...policy.resolve('prose'), ...policy.resolve('genre-guidance', { genre: profile.genre || '', subgenre: profile.subgenre || '' })],
      review: [...policy.resolve('review'), ...policy.resolve('genre-guidance', { genre: profile.genre || '', subgenre: profile.subgenre || '' })]
    }
    const context = options?.contexts?.prose || await this.workspace.promptContext(chapterId, 'prose', { policyManaged: true })
    const worldbookVersion = worldbookContextVersion(context)
    await this.assertContractCurrent(chapterId, version.fingerprint, worldbookVersion)
    signal?.throwIfAborted()
    const proseInstruction = [creativePolicyContext(methods.prose), prosePrompt(contract, authorInstruction, currentDraft, profile.targetWordsPerChapter, profile.proseExpansionMode)].join('\n\n')
    const generated = await withCreativePolicy(policy, () => options?.onDelta
      ? ai.streamComplete(proseInstruction, currentDraft, context, 'prose', signal, modelOverride, async (delta, content) => {
          await this.assertContractCurrent(chapterId, version.fingerprint, worldbookVersion)
          await policy.assertAuthorized?.()
          signal?.throwIfAborted()
          await options.onDelta!(delta, content)
        }, connectionIdOverride, maxTokensOverride)
      : ai.complete(proseInstruction, currentDraft, context, 'prose', signal, modelOverride, connectionIdOverride, maxTokensOverride))
    signal?.throwIfAborted()
    const fullCandidate = [currentDraft.trim(), generated.content.trim()].filter(Boolean).join('\n\n')
    const reviewContext = options?.contexts?.review || await this.workspace.promptContext(chapterId, 'review', { policyManaged: true })
    await this.assertContractCurrent(chapterId, version.fingerprint, worldbookVersion)
    const factCandidates = extractFactClaimCandidates(fullCandidate, profile.reviewStrictness)
    const repairAttempts = (await this.workspace.contextBudgetPreferences()).structuredRepairAttempts
    // A frozen prose model is not an override for a different review provider.
    // Only an explicitly paired connection/model applies to both phases.
    const reviewModel = connectionIdOverride ? modelOverride : undefined
    const reviewMethodContext = creativePolicyContext(methods.review)
    const guardedAi = { complete: (...args: Parameters<AiClient['complete']>) => withCreativePolicy(policy, () => ai.complete(...args)) }
    const [reviewed, factReviewed] = await Promise.all([
      completeStructured({
        ai: guardedAi, instruction: [reviewMethodContext, reviewPrompt(contract, fullCandidate)].join('\n\n'), systemContext: reviewContext,
        task: 'review', signal, model: reviewModel, connectionId: connectionIdOverride, maxTokensOverride, repairAttempts,
        parse: (content) => parseAdherenceReviewStrict(content, contract, fullCandidate, reviewContext, reviewMethodContext)
      }),
      factCandidates.length
        ? completeStructured({
            ai: guardedAi, instruction: factBoundaryPrompt(contract, factCandidates), systemContext: reviewContext,
            task: 'review', signal, model: reviewModel, connectionId: connectionIdOverride, maxTokensOverride, repairAttempts,
            parse: (content) => validateFactBoundaryResponse(content, factCandidates)
          })
        : Promise.resolve('{"items":[]}')
    ])
    signal?.throwIfAborted()
    await this.assertContractCurrent(chapterId, version.fingerprint, worldbookVersion)
    await policy.assertAuthorized?.()
    const report = applyDeterministicDraftChecks(
      applyFactBoundaryReview(
        reviewed,
        factReviewed,
        factCandidates,
        reviewContext
      ),
      fullCandidate,
      profile.targetWordsPerChapter
    )
    return {
      id: randomUUID(),
      chapterId,
      createdAt: new Date().toISOString(),
      content: generated.content,
      contract,
      report
    }
  }

  private async assertContractCurrent(chapterId: number, expectedFingerprint: string, expectedWorldbook: string | null): Promise<void> {
    if (expectedWorldbook && expectedWorldbook !== await this.workspace.currentWorldbookFingerprint()) {
      throw new AppError('CONFLICT', '世界书或章节顺序已变化，请重新生成。', { recoverable: true })
    }
    const current = await this.workspace.chapterContractVersion(chapterId)
    if (current.fingerprint !== expectedFingerprint) {
      throw new AppError('CONFLICT', '生成期间章纲或正式事件版本已变化，请重新生成。', { recoverable: true, details: { chapterId } })
    }
  }
}

function assertContractEventVersions(
  version: ChapterContractVersionRef,
  events: Array<{ id: string; versionId?: string; phase?: 'planned' | 'realized' | 'deviated' | 'legacy-unknown' }>
): void {
  const ids = [...events.map((event) => event.id)].sort()
  if (ids.length !== version.eventIds.length || ids.some((id, index) => id !== [...version.eventIds].sort()[index])) {
    throw new AppError('CONFLICT', '章纲确认引用的事件集合已经变化，请重新确认章纲。', { recoverable: true })
  }
  const actual = events
    .filter((event): event is typeof event & { versionId: string; phase: NonNullable<typeof event.phase> } => Boolean(event.versionId && event.phase))
    .map((event) => ({ eventId: event.id, versionId: event.versionId, phase: event.phase }))
    .sort((left, right) => left.eventId.localeCompare(right.eventId))
  const expected = [...(version.eventVersions ?? [])].sort((left, right) => left.eventId.localeCompare(right.eventId))
  if (actual.length !== expected.length || actual.some((item, index) => {
    const reference = expected[index]
    return reference?.eventId !== item.eventId || reference.versionId !== item.versionId || reference.phase !== item.phase
  })) {
    throw new AppError('CONFLICT', '章纲确认引用的正式事件版本已经变化，请重新确认章纲。', { recoverable: true })
  }
}

function parseAdherenceReviewStrict(content: string, contract: ChapterContract, candidateContent: string, formalContext: string, methodContext: string): AdherenceReport {
  // A fabricated/paraphrased quote is an invalid audit, not an empty list of findings.
  const match = content.match(/\{[\s\S]*\}/)
  if (match) {
    let raw: Record<string, unknown> | undefined
    try { raw = JSON.parse(match[0]) } catch { /* The ordinary parser handles malformed JSON below. */ }
    if (raw && raw.literaryFindings === undefined) {
      throw new AppError('AI_RESPONSE_INVALID', '本次完整审校缺少文学问题列表；无问题也必须返回空数组。', { recoverable: true })
    }
    if (raw?.factClaims !== undefined) {
      if (!Array.isArray(raw.factClaims) || raw.factClaims.length > 100 || raw.factClaims.some(value => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return true
        const item = value as Record<string, unknown>
        return typeof item.claim !== 'string' || !item.claim.trim() || item.claim.length > 500
          || typeof item.evidence !== 'string' || !item.evidence.trim() || item.evidence.length > 500
          || !candidateContent.includes(item.evidence.trim())
          || !['supported', 'unsupported', 'subjective'].includes(String(item.status))
          || typeof item.supportEvidence !== 'string' || item.supportEvidence.length > 500
      })) throw new AppError('AI_RESPONSE_INVALID', '事实审校必须返回合法声明和候选正文中的连续逐字证据；不得用省略号拼接或改写。', { recoverable: true })
    }
  }
  const parsed = parseAdherenceReview(content, contract, candidateContent, formalContext, methodContext)
  if (parsed.violations.includes('审校报告格式无效')) {
    throw new AppError('AI_RESPONSE_INVALID', '审校模型未返回可验证的结构化报告。', { recoverable: true })
  }
  return parsed
}

function validateFactBoundaryResponse(content: string, candidates: FactClaimCandidate[]): string {
  try {
    const match = content.match(/\{[\s\S]*\}/)
    if (!match) throw new Error('missing json')
    const raw = JSON.parse(match[0]) as { items?: unknown }
    if (!Array.isArray(raw.items) || raw.items.length !== candidates.length) throw new Error('items')
    const expected = new Set(candidates.map((item) => item.id))
    const actual = raw.items.map((item) => item && typeof item === 'object' && !Array.isArray(item) ? String((item as Record<string, unknown>).id || '') : '')
    if (new Set(actual).size !== actual.length || actual.some((id) => !expected.has(id))) throw new Error('ids')
    return content
  } catch (error) {
    throw new AppError('AI_RESPONSE_INVALID', '事实边界审校未返回完整的逐项结构化结果。', { recoverable: true, cause: error })
  }
}

export function buildChapterContract(chapterId: number, outline: string, version: ChapterContractVersionRef, assignedEvents: Array<{ id: string; time: string; characters: string[]; location: string; event: string; result?: string }> = [], chapterPosition = chapterId): ChapterContract {
  const parsed = parseChapterOutline(outline)
  if (version.storyConstraints && createHash('sha256').update(outline.replace(/\r\n?/g, '\n')).digest('hex') !== version.outlineHash) throw new Error('故事章纲与写作约束版本不符')
  const constraints = version.storyConstraints ? decodeChapterStoryConstraints(version.storyConstraints) : undefined
  if (!constraints && (!parsed.entryState || !parsed.exitState || !parsed.allowedFacts.length)) throw new Error('故事章纲尚未准备并确认写作约束')
  const { requirements, forbiddenEvents, entryState, exitState, allowedFacts, foreshadowActions } = constraints
    ? { ...constraints, requirements: constraints.beats, foreshadowActions: constraints.foreshadowActions.map((item, index) => ({ ...item, id: `F${index + 1}` })) }
    : parsed
  if (!requirements.length) throw new Error('当前章节大纲没有可执行的剧情节点')
  if (!entryState) throw new Error('当前章节大纲缺少进入状态')
  if (!exitState) throw new Error('当前章节大纲缺少退出状态')
  if (!allowedFacts.length) throw new Error('当前章节大纲缺少允许扩写范围')
  const beats: ChapterBeat[] = requirements.map((requirement, index) => ({ id: `B${index + 1}`, order: index + 1, requirement }))
  for (const event of assignedEvents) {
    const matched = beats.find((beat) => beat.requirement.includes(event.event) || event.event.includes(beat.requirement))
    if (matched) matched.eventRef = event.id
    else beats.push({
      id: `B${beats.length + 1}`,
      order: beats.length + 1,
      requirement: `[正式事件] ${event.time}，${event.characters.join('、')}在${event.location}${event.event}${event.result ? `；结果：${event.result}` : ''}`,
      eventRef: event.id
    })
  }
  return { chapterId, chapterPosition, outlineSnapshot: outline.trim(), beats, forbiddenEvents, entryState, exitState, allowedFacts, foreshadowActions, version }
}

function prosePrompt(contract: ChapterContract, authorInstruction: string, currentDraft: string, targetWords: number, expansionMode: ProseExpansionMode): string {
  const currentCharacters = narrativeCharacters(currentDraft)
  const remainingCharacters = Math.max(0, targetWords - currentCharacters)
  const minimumCharacters = Math.max(300, Math.floor(targetWords * 0.75) - currentCharacters)
  const beats = contract.beats.map((beat) => `${beat.id}｜${beat.requirement}`).join('\n')
  const forbidden = contract.forbiddenEvents.length ? contract.forbiddenEvents.map((item) => `- ${item}`).join('\n') : '- 不得提前发生章纲之外的后续关键事件'
  const foreshadowing = contract.foreshadowActions.length
    ? contract.foreshadowActions.map((item) => `${item.id}｜${foreshadowActionLabel(item.action)}｜${item.description}`).join('\n')
    : '本章无伏笔动作，不得擅自埋设、推进或回收伏笔。'
  return `请为第 ${contract.chapterPosition} 章生成候选正文。以下章节契约不可被临时要求覆盖：

【进入状态｜正文开头必须承接】
${contract.entryState}

【必须严格按顺序完成的剧情节点】
${beats}

【退出状态｜完成后立即停止】
${contract.exitState}

【允许扩写的事实范围】
${contract.allowedFacts.map((item) => `- ${item}`).join('\n')}
- “允许扩写”是事实边界的上限，不是继续发明设定的邀请。人物能力只能复述这里明确写出的最小事实；不得补充原理、硬件、速度、准确率、感知数据或由此推导出的新能力
- 解释秘密或往事时，只能使用正式上下文已确认的参与者、行为、动机与结果。一个已确认的旧事不授权补出他人帮助、包庇、授意、亲属关系、旧约细则或物证流转原因。未说明的来龙去脉可以仍待查证，不要为了让解释完整而捏造前史；人物口述也不能绕过此边界。
- 窗口流程、费用说明、制卡步骤和其他不改变后续因果的低风险生活细节可以合理展开，但不得为此增加审批角色或审查流程

【伏笔动作】
${foreshadowing}

【禁止事项】
${forbidden}
- 不得新增会改变人物状态、关系、实力、地点、资源、伏笔或后续因果的剧情事实
- 只允许在当前节点内扩写对白、动作、环境和情绪
- 写到最后一个节点的结果即停止，不得预演下一章
- 所有“禁止”“不得”和事实边界都只用于静默控制生成，正文不得逐条复述、否定式背诵或向读者解释这些规则
${currentDraft.trim() ? '- 已有正文只用于判断当前进度与承接语气；不得复述、重写或重复输出，只生成需要接续的新内容' : ''}

${narrativeConstraintGuidance}

【篇幅要求】
- 本章目标约 ${targetWords} 字；当前已有正文约 ${currentCharacters} 字
- 本次新生成正文应约 ${remainingCharacters} 字，且不得少于 ${minimumCharacters} 字
- 目标字数仅用于保证场景完整度，不设字数上限；只要没有章纲、事实、人物或连续性问题，可以自然写长
- 本次扩写方式：${expansionMode}

【作者本次补充要求】
${authorInstruction.trim() || '无'}

只输出小说正文，不要输出节点编号、分析、解释、标题或审校报告。`
}

export function applyDeterministicDraftChecks(report: AdherenceReport, content: string, targetWords: number): AdherenceReport {
  const characters = narrativeCharacters(content)
  const minimum = Math.max(300, Math.floor(targetWords * 0.75))
  const violations: string[] = []
  if (characters < minimum) violations.push(`候选正文约 ${characters} 字，低于本章目标 ${targetWords} 字的最低完整度要求 ${minimum} 字。`)
  const paragraphs = content.split(/\r?\n+/).map((item) => item.trim()).filter(Boolean)
  const oversized = paragraphs
    .map((paragraph, index) => ({ index: index + 1, characters: narrativeCharacters(paragraph) }))
    .filter((paragraph) => paragraph.characters >= 500)
  if (oversized.length) {
    violations.push(`候选正文存在 ${oversized.length} 个不少于 500 字的超长段落（第 ${oversized.slice(0, 5).map((item) => item.index).join('、')} 段），不适合手机端网文阅读，请在动作、反应或说话人变化处自然分段。`)
  }
  if (!violations.length) return report
  return {
    ...report,
    passed: false,
    summary: `${report.summary}；${violations.join('；')}`,
    violations: [...report.violations, ...violations]
  }
}

type FactClaimCandidate = { id: string; evidence: string; kind: 'capability' | 'institutional' | 'priorHistory' }

export function extractFactClaimCandidates(content: string, strictness: ReviewStrictness = 'balanced'): FactClaimCandidate[] {
  const sentences = content
    .split(/(?<=[。！？!?])|\r?\n+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 8 && item.length <= 500)
  const capability = strictness === 'strict'
    ? /扫描|预测|读取|分析|检索|计算|识别|推算|检测到|检测出|定位|追踪|处理器|传感器|光学镜头|微表情|心率|血压|人脸识别|面部识别/
    : /扫描|预测|读取.{0,12}(?:私人|身份|设备|数据)|推算|检测到|检测出|定位(?:到|人员|位置)|追踪(?:到|人员|位置)|检索(?:到|涉黑|婚育|记录|数据库|档案)|处理器|传感器|光学镜头|微表情|心率|血压|人脸识别|面部识别/
  const institutional = strictness === 'strict'
    ? /实名|托管|身份证|银行卡|户籍|账户|归属|登记/
    : /身份证|银行卡|户籍|账户.{0,24}(?:挂在|归属|归入|登记在)|(?:挂在|归属|归入|登记在).{0,24}(?:账户|李家|设备编号|家庭账户)/
  // “还没翻过 / 还是……不过” uses the adverb 还, not a past return of property.
  const priorHistory = /(?:以前|之前|上次|平时|早先|曾经|一直).{0,36}(?:借|还给|帮|帮助|答应|约好|说好|承诺|送给)|(?:借|帮|帮助|答应|约好|说好|承诺|归还|还(?=给|过|了)).{0,20}(?:过(?!来|去)|恩情|上次|以前|之前)/
  const found: FactClaimCandidate[] = []
  const seen = new Set<string>()
  for (const kind of ['capability', 'institutional', 'priorHistory'] as const) {
    const pattern = kind === 'capability' ? capability : kind === 'institutional' ? institutional : priorHistory
    for (const evidence of sentences) {
      if (!pattern.test(evidence) || seen.has(evidence)) continue
      if (kind === 'capability' && /(?:工作人员|店员|医生|护士|警察|老师).{0,30}(?:扫描枪|扫描仪|检测仪|读卡器|机器)/.test(evidence)) continue
      if (kind === 'institutional' && (/[？?]/.test(evidence) || /(?:不是|不属于|不能|不得|没有|不等于).{0,20}(?:身份证|银行卡|户籍|账户归属|设备归属)/.test(evidence))) continue
      if (kind === 'institutional' && /(?:可能|围绕|拉扯|协商|讨论|争议).{0,24}(?:账户归属)|(?:账户归属).{0,24}(?:拉扯|协商|讨论|争议)/.test(evidence)) continue
      if (kind === 'priorHistory' && (/[？?]/.test(evidence) || /(?:如果|要是|假如|以后|将来|下次).{0,30}(?:借|还|帮|答应|约好|说好|承诺)/.test(evidence))) continue
      seen.add(evidence)
      found.push({ id: `F${found.length + 1}`, evidence, kind })
      if (found.length >= 48) return found
    }
  }
  return found
}

function factBoundaryPrompt(contract: ChapterContract, candidates: FactClaimCandidate[]): string {
  return `你是独立的小说事实边界审校员，只核对下列已由程序逐字摘出的声明，不评价文风，也不得漏掉任何编号。

【本章正式剧情节点】
${contract.beats.map((beat) => `${beat.id}｜${beat.requirement}`).join('\n')}

【本章允许扩写】
${contract.allowedFacts.map((item) => `- ${item}`).join('\n')}

【本章明确禁止】
${contract.forbiddenEvents.length ? contract.forbiddenEvents.map((item) => `- ${item}`).join('\n') : '- 不得新增章纲外关键事实'}

【待核对声明】
${candidates.map((item) => `${item.id}｜${factClaimKindLabel(item.kind)}｜${item.evidence}`).join('\n')}

对每个编号必须返回一项：
- supported：正式作品上下文中存在可以逐字复制的依据；supportEvidence 必须逐字摘录，不能改写。
- subjective：候选原句本身明确写成当前视角人物的私人感知、脑补或比喻，没有转成客观能力或正式制度；supportEvidence 留空。
- proposal：候选原句明确只是角色的要求、建议、疑问或待协商方案，没有被旁白或权威角色宣布为已经成立的事实；supportEvidence 留空。
- unsupported：找不到正式逐字依据，或只是根据常识、模型知识、候选自身推断；supportEvidence 留空。

只返回一个 JSON 对象，不要 Markdown：
{"items":[{"id":"F1","status":"supported|subjective|proposal|unsupported","supportEvidence":"正式上下文逐字依据或空字符串","reason":"一句简短说明"}]}`
}

function applyFactBoundaryReview(
  report: AdherenceReport,
  content: string,
  candidates: FactClaimCandidate[],
  formalContext: string
): AdherenceReport {
  try {
    const match = content.match(/\{[\s\S]*\}/)
    if (!match) throw new Error('missing json')
    const raw = JSON.parse(match[0]) as { items?: unknown }
    if (!Array.isArray(raw.items)) throw new Error('missing items')
    const byId = new Map(raw.items
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
      .map((item) => [String(item.id || ''), item]))
    const introduced = [...report.introducedFacts]
    for (const candidate of candidates) {
      const item = byId.get(candidate.id)
      const status = String(item?.status || '')
      const supportEvidence = bounded(item?.supportEvidence, 500)
      const supported = status === 'supported' && Boolean(supportEvidence) && formalContext.includes(supportEvidence)
      const subjective = status === 'subjective' && /(?:.{1,16}(?:眼中|视界|觉得|脑补|看来)|仿佛|好像)/.test(candidate.evidence)
      const proposal = /(?:建议|提议|要求|希望|我需要|我必须|我不需要|如果|要不|怎么样|能否|可以先|是否|从.{0,16}角度)/.test(candidate.evidence)
      if (!supported && !subjective && !proposal) introduced.push(`缺少正式依据的${factClaimKindLabel(candidate.kind)}：${candidate.evidence}`)
    }
    const uniqueIntroduced = [...new Set(introduced)]
    return {
      ...report,
      passed: report.passed && uniqueIntroduced.length === 0,
      summary: uniqueIntroduced.length > report.introducedFacts.length ? `${report.summary}；事实边界审校发现未获正式依据的声明。` : report.summary,
      introducedFacts: uniqueIntroduced
    }
  } catch {
    const violation = '事实边界审校未返回完整的逐项证据报告，候选稿已阻断自动采用。'
    return { ...report, passed: false, summary: `${report.summary}；${violation}`, violations: [...report.violations, violation] }
  }
}

function factClaimKindLabel(kind: FactClaimCandidate['kind']): string {
  if (kind === 'capability') return '能力声明'
  if (kind === 'institutional') return '制度/身份声明'
  return '前情旧事声明'
}

function narrativeCharacters(value: string): number {
  return value.replace(/\s/g, '').length
}

function reviewPrompt(contract: ChapterContract, content: string): string {
  const beats = contract.beats.map((beat) => `${beat.id}｜${beat.requirement}`).join('\n')
  const foreshadowing = contract.foreshadowActions.length
    ? contract.foreshadowActions.map((item) => `${item.id}｜${foreshadowActionLabel(item.action)}｜${item.description}`).join('\n')
    : '无；若正文擅自新增伏笔，应记入 introducedFacts。'
  return `你现在是只读的章节契约审校员，不得改写正文。对候选正文逐项检查：

${narrativeConstraintGuidance}

【进入状态】
${contract.entryState}

【契约节点】
${beats}

【退出状态】
${contract.exitState}

【允许扩写的事实范围】
${contract.allowedFacts.map((item) => `- ${item}`).join('\n')}

【伏笔动作】
${foreshadowing}

【明确禁止】
${contract.forbiddenEvents.length ? contract.forbiddenEvents.map((item) => `- ${item}`).join('\n') : '- 不得提前消耗后续关键事件'}

【候选正文】
${content}

审校时把正式上下文中的人物知情范围、证据留存/消失规则、日期与持续时长、并行事件、关系推进阶段都当成硬约束。正文若让角色越权知道幕后机制、让已规定消失的旧证据重新出现、压缩或串行化已确认的时间窗口、用一次巧合直接完成确认，必须写入 violations。

先逐段完成事实核对并输出 factClaims，再检查节点、边界和文学问题，最后才决定 passed。不要先写“通过”再只寻找支持通过的材料。每条 evidence 必须是正文中连续的一小段原文，不得用省略号连接不相邻句子。即使是 supported 也需这样举证。
literaryFindings 为必填数组，无问题也返回 []，最多30项。每项格式：{"category":"${literaryFindingCategories.join('|')}","severity":"blocking|advice","candidateQuote":"候选正文中连续逐字原句","sourceQuote":"正式上下文/章契/本次人物场景要求中的逐字依据，没有则为空","reason":"问题为何成立及影响","correction":"局部修改方向，不能提供替换正文或新增设定"}。
blocking 只能是正式人物/情节约束或明确作者要求的违反，必须有 sourceQuote；明显因果缺步可以用 causal-gap、空 sourceQuote 并引用跳步前后连续语段说明缺什么。纯审美偏好、想要更多笑话/抒情和无正式依据的声音偏好用 advice，不影响 passed。没有具体证据不报确定问题，场景尚未达到后续关系不算本章错误。
只返回一个 JSON 对象，不要 Markdown 代码块：
{"factClaims":[{"claim":"人物前史、关系及因果解释，或能力、身份、关键物品来源、机构规则声明","evidence":"候选正文中的逐字证据","status":"supported|unsupported|subjective","supportEvidence":"supported 时必须是正式作品上下文中的逐字依据，否则留空"}],"summary":"一句中文结论","beats":[{"id":"B1","status":"covered|partial|missing","evidence":"正文中的简短证据"}],"boundary":{"entryRespected":true,"exitReached":true,"evidence":"开头承接与结尾停点的简短证据"},"foreshadowing":[{"id":"F1","status":"satisfied|missing|violated","evidence":"正文中的简短证据"}],"violations":["违反禁止事项或节点顺序的问题"],"introducedFacts":["不在允许扩写范围内且会影响后续的新增事实"],"characterChanges":[{"character":"人物姓名","field":"location|injury|relationship|knowledge|possession|goal|power|vitality","value":"本章结束时的新状态；vitality 只能是存活或死亡","evidence":"必须逐字摘自候选正文且包含人物姓名的短句"}],"characterConflicts":[{"character":"人物姓名","field":"identity|motivation|arc","claimedValue":"正文声称的身份、长期动机或人物弧变化","evidence":"必须逐字摘自候选正文且包含人物姓名的短句"}],"passed":true}

characterChanges 只记录正文明确写出的地点、伤势、关系、已知信息、关键物品状态、当前目标、实力/境界和生死状态，不得推测；可增加 event 表示触发变化的简短事件，供同类候选合并。possession 必须描述本章结束时仍然成立的关键物品状态：持有时写“持有：物品名”，明确交出后写“不再持有：物品名”；同一件关键物品转手时，交出者和接收者分别记录一项，并让 evidence 保留双方姓名和交接动作。goal 与 power 也必须描述本章结束状态，不要只摘录瞬间动作。vitality 只有正文明确说明人物存活或死亡时才记录，value 只能写“存活”或“死亡”，失踪、昏迷和重伤都不等于死亡。characterConflicts 只记录可能改写人物身份、长期动机或人物弧的声明，它们是待作者处理的冲突，不是自动成立的事实。两个数组的 evidence 必须是包含人物姓名、可以在候选正文中逐字找到的短句；没有可靠证据就返回空数组。

factClaims 必须逐段检查所有会影响后续连续性的人物前史、既往关系、秘密成因、关键物证来历与流转原因，以及人物能力、身份和作品内机构规则。它是完整正文的语义检查，不能只等程序匹配“曾经、帮助、借过”等关键词才查；即使所有契约节点完成，也必须单独检查这些新增事实。
- 将复合解释拆成独立声明：谁在何时做了什么、为何做、与谁有什么关系。正式依据支持其中一项，不代表其余细节也获批准。对参与者、行为、动机、结果分别比对，不得用主题相近的一句代替整项依据。
- 特别检查角色回忆、坦白和档案解读中补出的往事。比如正式依据只有某人违令救人，不等于批准了另一个人替他销毁证据；正式依据只有物品移交，不等于批准了隐藏罪证的动机。即使角色在对白中说“当年就是如此”，仍是待核对前史，不是正式来源。
- supported 的 supportEvidence 必须逐字复制正式上下文里支持该项完整声明的原文（保留标点，不要转述）；候选正文自身不算来源。只有正式依据没有而候选新编的关键前史，应标 unsupported，不因它听起来合理、补全悬念或符合时代常识而放行。
- subjective 仅适用于正文明确保持为视角人物的猜测、比喻或私人感知，且没有被旁白、证物或其他人物确认，也没有据此让关键情节落定。带引号的陈述、第一人称回忆或角色自述不因此成为 subjective。
- 普通当前动作、对白措辞和不改变事实的环境细节无需列入；正式大纲允许的当前事件可正常发生，不要把正常扩写全部当成未经批准的前史。

在上方 JSON 对象中同时加入 literaryFindings 数组。只有开头承接进入状态、全部节点按顺序 covered、伏笔动作全部 satisfied、结尾停在退出状态，且 violations、introducedFacts 都为空、literaryFindings 没有 blocking 时，passed 才能为 true。人物变化候选与人物锚点冲突本身不改变 passed。`
}

export function parseAdherenceReview(content: string, contract: ChapterContract, candidateContent = '', formalContext = '', methodContext = ''): AdherenceReport {
  try {
    const match = content.match(/\{[\s\S]*\}/)
    if (!match) throw new Error('没有 JSON')
    const raw = JSON.parse(match[0]) as Record<string, unknown>
    const rawBeats = Array.isArray(raw.beats) ? raw.beats : []
    const beats = contract.beats.map((beat) => {
      const candidate = rawBeats.find((item) => item && typeof item === 'object' && String((item as Record<string, unknown>).id) === beat.id) as Record<string, unknown> | undefined
      const status: AdherenceBeatResult['status'] = candidate?.status === 'covered' || candidate?.status === 'partial' ? candidate.status : 'missing'
      return { id: beat.id, status, evidence: String(candidate?.evidence || '').trim() }
    })
    const violations = stringArray(raw.violations)
    const introducedFacts = [
      ...stringArray(raw.introducedFacts),
      ...parseUnsupportedFactClaims(raw.factClaims, candidateContent, formalContext)
    ]
    const characterChanges = parseCharacterChanges(raw.characterChanges, candidateContent)
    const characterConflicts = parseCharacterConflicts(raw.characterConflicts, candidateContent)
    const literaryFindings = raw.literaryFindings === undefined ? undefined : parseLiteraryFindings(raw.literaryFindings, contract, candidateContent, formalContext, methodContext)
    for (const finding of literaryFindings ?? []) {
      if (finding.severity === 'blocking') violations.push(`文学检查：${finding.reason}（正文：${finding.candidateQuote}；修改方向：${finding.correction}）`)
    }
    const rawBoundary = raw.boundary && typeof raw.boundary === 'object' ? raw.boundary as Record<string, unknown> : {}
    const boundary = {
      entryRespected: rawBoundary.entryRespected === true,
      exitReached: rawBoundary.exitReached === true,
      evidence: String(rawBoundary.evidence || '').trim()
    }
    const rawForeshadowing = Array.isArray(raw.foreshadowing) ? raw.foreshadowing : []
    const foreshadowing = contract.foreshadowActions.map((action) => {
      const candidate = rawForeshadowing.find((item) => item && typeof item === 'object' && String((item as Record<string, unknown>).id) === action.id) as Record<string, unknown> | undefined
      const status: AdherenceForeshadowResult['status'] = candidate?.status === 'satisfied' || candidate?.status === 'violated' ? candidate.status : 'missing'
      return { id: action.id, status, evidence: String(candidate?.evidence || '').trim() }
    })
    const passed = raw.passed === true
      && beats.every((beat) => beat.status === 'covered')
      && foreshadowing.every((item) => item.status === 'satisfied')
      && boundary.entryRespected
      && boundary.exitReached
      && !violations.length
      && !introducedFacts.length
    const summary = raw.passed === true && introducedFacts.length
      ? '事实核对发现未获正式依据支持的声明，候选稿未通过审校。'
      : literaryFindings?.some(finding => finding.severity === 'blocking')
        ? '人物与场景检查发现需要修正的问题，候选稿未通过审校。'
      : String(raw.summary || (passed ? '章纲节点与状态边界已经全部覆盖' : '候选正文需要人工复核')).trim()
    return { reviewMode: 'full', passed, summary, beats, boundary, foreshadowing, violations, introducedFacts, characterChanges, characterConflicts,
      ...(literaryFindings === undefined ? {} : { literaryFindings }) }
  } catch {
    return {
      reviewMode: 'full',
      passed: false,
      summary: '审校模型未返回可验证的结构化报告，候选稿已阻断自动采用',
      beats: contract.beats.map((beat) => ({ id: beat.id, status: 'missing', evidence: '' })),
      boundary: { entryRespected: false, exitReached: false, evidence: '' },
      foreshadowing: contract.foreshadowActions.map((item) => ({ id: item.id, status: 'missing', evidence: '' })),
      violations: ['审校报告格式无效'],
      introducedFacts: [],
      characterChanges: [],
      characterConflicts: []
    }
  }
}

function parseLiteraryFindings(value: unknown, contract: ChapterContract, candidate: string, context: string, methodContext: string): LiteraryFinding[] {
  const findings = decodeLiteraryFindings(value)
  const sources = [context, contract.outlineSnapshot, contract.entryState, contract.exitState,
    ...contract.beats.map(beat => beat.requirement), ...contract.allowedFacts, ...contract.forbiddenEvents,
    methodContext, narrativeConstraintGuidance].join('\n')
  if (findings.some(finding => !candidate.includes(finding.candidateQuote)
    || (finding.sourceQuote && !sources.includes(finding.sourceQuote))
    || (finding.severity === 'blocking' && !finding.sourceQuote && finding.category !== 'causal-gap'))) {
    throw new Error('文学问题的逐字证据或正式依据无效')
  }
  return findings
}

function parseUnsupportedFactClaims(value: unknown, candidateContent: string, formalContext: string): string[] {
  if (!Array.isArray(value) || !candidateContent) return []
  const result: string[] = []
  const seen = new Set<string>()
  for (const raw of value.slice(0, 100)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const item = raw as Record<string, unknown>
    const claim = bounded(item.claim, 500)
    const evidence = bounded(item.evidence, 500)
    const supportEvidence = bounded(item.supportEvidence, 500)
    const status = String(item.status || '')
    if (!claim || !evidence || !candidateContent.includes(evidence)) continue
    const supported = status === 'supported' && Boolean(supportEvidence) && formalContext.includes(supportEvidence)
    if (supported || status === 'subjective') continue
    const finding = `缺少正式依据的事实声明：${claim}（正文证据：${evidence}）`
    if (!seen.has(finding)) {
      seen.add(finding)
      result.push(finding)
    }
  }
  return result
}

function foreshadowActionLabel(action: ChapterContract['foreshadowActions'][number]['action']): string {
  return ({ plant: '埋设', advance: '推进', misdirect: '误导', resolve: '回收', hold: '保持', discard: '废弃' } as const)[action]
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : []
}

function parseCharacterChanges(value: unknown, candidateContent: string): CharacterDynamicChange[] {
  const allowed = new Set<CharacterDynamicChange['field']>(['location', 'injury', 'relationship', 'knowledge', 'possession', 'goal', 'power', 'vitality'])
  return parseCharacterRecords(value, candidateContent, (item) => {
    const field = String(item.field || '') as CharacterDynamicChange['field']
    const character = bounded(item.character, 40)
    const nextValue = bounded(item.value, 500)
    const evidence = bounded(item.evidence, 500)
    if (!allowed.has(field) || character.length < 2 || !nextValue || (field === 'vitality' && nextValue !== '存活' && nextValue !== '死亡') || !validEvidence(candidateContent, character, evidence)) return undefined
    const event = bounded(item.event, 120)
    return { character, field, value: nextValue, evidence, ...(event ? { event } : {}) }
  })
}

function parseCharacterConflicts(value: unknown, candidateContent: string): CharacterStableConflict[] {
  const allowed = new Set<CharacterStableConflict['field']>(['identity', 'motivation', 'arc'])
  return parseCharacterRecords(value, candidateContent, (item) => {
    const field = String(item.field || '') as CharacterStableConflict['field']
    const character = bounded(item.character, 40)
    const claimedValue = bounded(item.claimedValue, 500)
    const evidence = bounded(item.evidence, 500)
    if (!allowed.has(field) || character.length < 2 || !claimedValue || !validEvidence(candidateContent, character, evidence)) return undefined
    return { character, field, claimedValue, evidence }
  })
}

function parseCharacterRecords<T>(value: unknown, candidateContent: string, decode: (item: Record<string, unknown>) => T | undefined): T[] {
  if (!candidateContent || !Array.isArray(value)) return []
  const result: T[] = []
  const seen = new Set<string>()
  for (const raw of value.slice(0, 100)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const item = decode(raw as Record<string, unknown>)
    if (!item) continue
    const key = JSON.stringify(item)
    if (!seen.has(key)) {
      seen.add(key)
      result.push(item)
    }
  }
  return result
}

function validEvidence(candidateContent: string, character: string, evidence: string): boolean {
  return evidence.length >= character.length && evidence.includes(character) && candidateContent.includes(evidence)
}

function bounded(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}
