import { createHash } from 'node:crypto'

export type ContextAuthority = 'required' | 'pinned' | 'related' | 'optional'
export type ContextTruncationPolicy = 'never' | 'compress' | 'truncate' | 'drop'

export type ContextCandidate = {
  id: string
  sourceType: string
  sourceId: string
  sourceVersion?: string
  contentHash?: string
  label: string
  content: string
  compressedContent?: string
  authority: ContextAuthority
  priority?: number
  relevanceReasons?: string[]
  chapterDistance?: number
  updatedAt?: string
  truncationPolicy?: ContextTruncationPolicy
  untrusted?: boolean
}

export type ContextTokenEstimatorMetadata = {
  id: string
  method: 'tokenizer' | 'heuristic'
  errorMargin: number | null
  description: string
}

export type ContextTokenEstimator = {
  metadata: ContextTokenEstimatorMetadata
  estimate(content: string): number
}

export type ContextCompileRequest = {
  task: string
  candidates: ContextCandidate[]
  modelContextLimit: number
  outputReserveTokens: number
  systemReserveTokens: number
  projectInputBudget?: number
  pinnedIds?: string[]
  excludedIds?: string[]
  estimator?: ContextTokenEstimator
}

export type CompiledContextItem = {
  id: string
  sourceType: string
  sourceId: string
  sourceVersion: string | null
  sourceContentHash: string
  contentHash: string
  label: string
  content: string
  authority: ContextAuthority
  priority: number
  relevanceReasons: string[]
  chapterDistance: number | null
  updatedAt: string | null
  untrusted: boolean
  mode: 'full' | 'compressed' | 'truncated'
  originalEstimatedTokens: number
  estimatedTokens: number
}

export type ContextExclusionReason = 'user_excluded' | 'budget' | 'compression_unavailable' | 'compressed_over_budget' | 'drop_policy'

export type ExcludedContextItem = {
  id: string
  sourceType: string
  sourceId: string
  label: string
  authority: ContextAuthority
  estimatedTokens: number
  reason: ContextExclusionReason
}

export type ContextTruncationReportItem = {
  id: string
  action: 'compressed' | 'truncated' | 'excluded'
  reason: ContextExclusionReason | 'compression_policy' | 'truncation_policy'
  originalEstimatedTokens: number
  keptEstimatedTokens: number
}

export type ContextCompileBudget = {
  modelContextLimit: number
  outputReserveTokens: number
  systemReserveTokens: number
  modelInputLimit: number
  projectInputBudget: number | null
  availableInputTokens: number
  usedInputTokens: number
  remainingInputTokens: number
}

export type ContextCompileBlock = {
  code: 'NO_INPUT_BUDGET' | 'REQUIRED_CONTEXT_EXCEEDS_BUDGET'
  message: string
  availableInputTokens: number
  requiredTokens: number
  candidateIds: string[]
}

export type ContextCompileResult = {
  version: 1
  task: string
  status: 'ready' | 'blocked'
  included: CompiledContextItem[]
  excluded: ExcludedContextItem[]
  budget: ContextCompileBudget
  truncation: {
    truncated: boolean
    items: ContextTruncationReportItem[]
  }
  estimator: ContextTokenEstimatorMetadata
  contentHash: string
  blocked: ContextCompileBlock | null
}

const authorityOrder: Record<ContextAuthority, number> = { required: 0, pinned: 1, related: 2, optional: 3 }
const truncationMarker = '\n[…因上下文预算截断]'

export const heuristicContextTokenEstimator: ContextTokenEstimator = {
  metadata: {
    id: 'lanjian-cjk-latin-heuristic-v1',
    method: 'heuristic',
    errorMargin: 0.25,
    description: '中文、日文和韩文按约 1.35 token/字符估算，其他字符按约 0.32 token/字符估算。'
  },
  estimate(content: string): number {
    if (!content) return 0
    let weighted = 0
    for (const character of content) weighted += /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(character) ? 1.35 : 0.32
    return Math.max(1, Math.ceil(weighted))
  }
}

export function compileContext(request: ContextCompileRequest): ContextCompileResult {
  validateRequest(request)
  const estimator = request.estimator ?? heuristicContextTokenEstimator
  validateEstimator(estimator)
  const pinnedIds = new Set(request.pinnedIds ?? [])
  const excludedIds = new Set(request.excludedIds ?? [])
  const candidates = request.candidates.map((candidate) => normalizeCandidate(candidate, pinnedIds)).sort(compareCandidates)
  assertUniqueIds(candidates)

  const modelInputLimit = request.modelContextLimit - request.outputReserveTokens - request.systemReserveTokens
  const availableInputTokens = Math.max(0, Math.min(modelInputLimit, request.projectInputBudget ?? modelInputLimit))
  const emptyBudget = budget(request, modelInputLimit, availableInputTokens, 0)
  if (availableInputTokens <= 0) {
    const required = candidates.filter((candidate) => candidate.authority === 'required')
    return blockedResult(request.task, estimator, emptyBudget, {
      code: 'NO_INPUT_BUDGET',
      message: '模型上下文已被输出与系统预留占满，没有可用于作品上下文的 token。',
      availableInputTokens,
      requiredTokens: estimateCandidates(required, estimator),
      candidateIds: required.map((candidate) => candidate.id)
    })
  }

  const required = candidates.filter((candidate) => candidate.authority === 'required')
  const requiredTokens = estimateCandidates(required, estimator)
  if (requiredTokens > availableInputTokens) {
    return blockedResult(request.task, estimator, emptyBudget, {
      code: 'REQUIRED_CONTEXT_EXCEEDS_BUDGET',
      message: `不可截断的必选上下文约 ${requiredTokens} tokens，超过可用的 ${availableInputTokens} tokens。`,
      availableInputTokens,
      requiredTokens,
      candidateIds: required.map((candidate) => candidate.id)
    })
  }

  const included: CompiledContextItem[] = []
  const excluded: ExcludedContextItem[] = []
  const reports: ContextTruncationReportItem[] = []
  let usedInputTokens = 0

  for (const candidate of candidates) {
    const originalEstimatedTokens = estimator.estimate(candidate.content)
    if (excludedIds.has(candidate.id) && candidate.authority !== 'required') {
      exclude(candidate, originalEstimatedTokens, 'user_excluded', excluded, reports)
      continue
    }
    if (candidate.authority === 'required') {
      included.push(compiledItem(candidate, candidate.content, 'full', originalEstimatedTokens, originalEstimatedTokens))
      usedInputTokens += originalEstimatedTokens
      continue
    }

    const remaining = availableInputTokens - usedInputTokens
    if (originalEstimatedTokens <= remaining) {
      included.push(compiledItem(candidate, candidate.content, 'full', originalEstimatedTokens, originalEstimatedTokens))
      usedInputTokens += originalEstimatedTokens
      continue
    }

    const policy = candidate.truncationPolicy
    if (policy === 'compress') {
      if (!candidate.compressedContent?.trim()) {
        exclude(candidate, originalEstimatedTokens, 'compression_unavailable', excluded, reports)
        continue
      }
      const compressedTokens = estimator.estimate(candidate.compressedContent)
      if (compressedTokens > remaining) {
        exclude(candidate, originalEstimatedTokens, 'compressed_over_budget', excluded, reports)
        continue
      }
      included.push(compiledItem(candidate, candidate.compressedContent, 'compressed', originalEstimatedTokens, compressedTokens))
      reports.push({ id: candidate.id, action: 'compressed', reason: 'compression_policy', originalEstimatedTokens, keptEstimatedTokens: compressedTokens })
      usedInputTokens += compressedTokens
      continue
    }
    if (policy === 'truncate') {
      const content = truncateToBudget(candidate.content, remaining, estimator)
      if (!content) {
        exclude(candidate, originalEstimatedTokens, 'budget', excluded, reports)
        continue
      }
      const keptTokens = estimator.estimate(content)
      included.push(compiledItem(candidate, content, 'truncated', originalEstimatedTokens, keptTokens))
      reports.push({ id: candidate.id, action: 'truncated', reason: 'truncation_policy', originalEstimatedTokens, keptEstimatedTokens: keptTokens })
      usedInputTokens += keptTokens
      continue
    }
    exclude(candidate, originalEstimatedTokens, policy === 'drop' ? 'drop_policy' : 'budget', excluded, reports)
  }

  const finalBudget = budget(request, modelInputLimit, availableInputTokens, usedInputTokens)
  const contentHash = compiledContentHash(request.task, included)
  return {
    version: 1,
    task: request.task,
    status: 'ready',
    included,
    excluded,
    budget: finalBudget,
    truncation: { truncated: reports.length > 0, items: reports },
    estimator: { ...estimator.metadata },
    contentHash,
    blocked: null
  }
}

type NormalizedCandidate = Omit<ContextCandidate, 'priority' | 'relevanceReasons' | 'chapterDistance' | 'updatedAt' | 'truncationPolicy'> & {
  priority: number
  relevanceReasons: string[]
  chapterDistance: number | null
  updatedAt: string | null
  truncationPolicy: ContextTruncationPolicy
}

function normalizeCandidate(candidate: ContextCandidate, pinnedIds: Set<string>): NormalizedCandidate {
  validateCandidate(candidate)
  const authority = candidate.authority === 'required' ? 'required' : pinnedIds.has(candidate.id) ? 'pinned' : candidate.authority
  return {
    ...candidate,
    authority,
    priority: candidate.priority ?? 0,
    relevanceReasons: [...(candidate.relevanceReasons ?? [])],
    chapterDistance: candidate.chapterDistance ?? null,
    updatedAt: candidate.updatedAt ?? null,
    truncationPolicy: candidate.truncationPolicy ?? (authority === 'required' || authority === 'pinned' ? 'never' : 'drop'),
    untrusted: candidate.untrusted ?? false
  }
}

function compareCandidates(left: NormalizedCandidate, right: NormalizedCandidate): number {
  return authorityOrder[left.authority] - authorityOrder[right.authority]
    || right.priority - left.priority
    || nullableAscending(left.chapterDistance, right.chapterDistance)
    || nullableDateDescending(left.updatedAt, right.updatedAt)
    || left.id.localeCompare(right.id, 'en-US')
}

function compiledItem(candidate: NormalizedCandidate, content: string, mode: CompiledContextItem['mode'], originalEstimatedTokens: number, estimatedTokens: number): CompiledContextItem {
  return {
    id: candidate.id,
    sourceType: candidate.sourceType,
    sourceId: candidate.sourceId,
    sourceVersion: candidate.sourceVersion ?? null,
    sourceContentHash: validHash(candidate.contentHash) ? candidate.contentHash!.toLowerCase() : hashText(candidate.content),
    contentHash: hashText(content),
    label: candidate.label,
    content,
    authority: candidate.authority,
    priority: candidate.priority,
    relevanceReasons: [...candidate.relevanceReasons],
    chapterDistance: candidate.chapterDistance,
    updatedAt: candidate.updatedAt,
    untrusted: Boolean(candidate.untrusted),
    mode,
    originalEstimatedTokens,
    estimatedTokens
  }
}

function exclude(candidate: NormalizedCandidate, estimatedTokens: number, reason: ContextExclusionReason, excluded: ExcludedContextItem[], reports: ContextTruncationReportItem[]): void {
  excluded.push({ id: candidate.id, sourceType: candidate.sourceType, sourceId: candidate.sourceId, label: candidate.label, authority: candidate.authority, estimatedTokens, reason })
  reports.push({ id: candidate.id, action: 'excluded', reason, originalEstimatedTokens: estimatedTokens, keptEstimatedTokens: 0 })
}

function truncateToBudget(content: string, tokenBudget: number, estimator: ContextTokenEstimator): string {
  if (tokenBudget <= 0 || !content) return ''
  if (estimator.estimate(content) <= tokenBudget) return content
  const markerTokens = estimator.estimate(truncationMarker)
  if (markerTokens >= tokenBudget) return ''
  const characters = [...content]
  let low = 1
  let high = characters.length
  let best = ''
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const candidate = `${characters.slice(0, middle).join('').trimEnd()}${truncationMarker}`
    if (estimator.estimate(candidate) <= tokenBudget) {
      best = candidate
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  return best
}

function estimateCandidates(candidates: NormalizedCandidate[], estimator: ContextTokenEstimator): number {
  return candidates.reduce((total, candidate) => total + estimator.estimate(candidate.content), 0)
}

function budget(request: ContextCompileRequest, modelInputLimit: number, availableInputTokens: number, usedInputTokens: number): ContextCompileBudget {
  return {
    modelContextLimit: request.modelContextLimit,
    outputReserveTokens: request.outputReserveTokens,
    systemReserveTokens: request.systemReserveTokens,
    modelInputLimit: Math.max(0, modelInputLimit),
    projectInputBudget: request.projectInputBudget ?? null,
    availableInputTokens,
    usedInputTokens,
    remainingInputTokens: Math.max(0, availableInputTokens - usedInputTokens)
  }
}

function blockedResult(task: string, estimator: ContextTokenEstimator, value: ContextCompileBudget, blocked: ContextCompileBlock): ContextCompileResult {
  return {
    version: 1,
    task,
    status: 'blocked',
    included: [],
    excluded: [],
    budget: value,
    truncation: { truncated: false, items: [] },
    estimator: { ...estimator.metadata },
    contentHash: compiledContentHash(task, []),
    blocked
  }
}

function compiledContentHash(task: string, included: CompiledContextItem[]): string {
  return hashText(JSON.stringify({
    version: 1,
    task,
    included: included.map((item) => ({
      id: item.id,
      sourceType: item.sourceType,
      sourceId: item.sourceId,
      sourceVersion: item.sourceVersion,
      sourceContentHash: item.sourceContentHash,
      contentHash: item.contentHash,
      authority: item.authority,
      mode: item.mode,
      content: item.content
    }))
  }))
}

function validateRequest(request: ContextCompileRequest): void {
  if (!request || typeof request !== 'object') throw new TypeError('上下文编译请求无效')
  if (!boundedIdentity(request.task, 100)) throw new TypeError('上下文任务无效')
  if (!Array.isArray(request.candidates)) throw new TypeError('上下文候选无效')
  for (const [label, value, minimum] of [
    ['模型上下文上限', request.modelContextLimit, 1],
    ['输出预留', request.outputReserveTokens, 0],
    ['系统预留', request.systemReserveTokens, 0]
  ] as const) {
    if (!Number.isSafeInteger(value) || value < minimum) throw new TypeError(`${label}无效`)
  }
  if (request.projectInputBudget !== undefined && (!Number.isSafeInteger(request.projectInputBudget) || request.projectInputBudget < 1)) {
    throw new TypeError('项目上下文预算无效')
  }
  for (const ids of [request.pinnedIds, request.excludedIds]) {
    if (ids !== undefined && (!Array.isArray(ids) || ids.some((id) => !boundedIdentity(id, 256)))) throw new TypeError('上下文候选选择无效')
  }
}

function validateCandidate(candidate: ContextCandidate): void {
  if (!candidate || typeof candidate !== 'object') throw new TypeError('上下文候选无效')
  for (const [label, value, limit] of [
    ['候选编号', candidate.id, 256],
    ['来源类型', candidate.sourceType, 100],
    ['来源编号', candidate.sourceId, 512],
    ['候选标题', candidate.label, 500]
  ] as const) if (!boundedIdentity(value, limit)) throw new TypeError(`${label}无效`)
  if (typeof candidate.content !== 'string') throw new TypeError('候选内容无效')
  if (candidate.compressedContent !== undefined && typeof candidate.compressedContent !== 'string') throw new TypeError('候选压缩内容无效')
  if (!Object.hasOwn(authorityOrder, candidate.authority)) throw new TypeError('候选权威级别无效')
  if (candidate.priority !== undefined && !Number.isFinite(candidate.priority)) throw new TypeError('候选优先级无效')
  if (candidate.chapterDistance !== undefined && (!Number.isSafeInteger(candidate.chapterDistance) || candidate.chapterDistance < 0)) throw new TypeError('候选章节距离无效')
  if (candidate.updatedAt !== undefined && !Number.isFinite(Date.parse(candidate.updatedAt))) throw new TypeError('候选更新时间无效')
  if (candidate.relevanceReasons !== undefined && (!Array.isArray(candidate.relevanceReasons) || candidate.relevanceReasons.some((reason) => typeof reason !== 'string'))) throw new TypeError('候选相关原因无效')
  if (candidate.truncationPolicy !== undefined && !['never', 'compress', 'truncate', 'drop'].includes(candidate.truncationPolicy)) throw new TypeError('候选截断策略无效')
}

function validateEstimator(estimator: ContextTokenEstimator): void {
  if (!estimator || typeof estimator.estimate !== 'function' || !estimator.metadata || !boundedIdentity(estimator.metadata.id, 200)) throw new TypeError('token 估算器无效')
  if (!['tokenizer', 'heuristic'].includes(estimator.metadata.method) || typeof estimator.metadata.description !== 'string') throw new TypeError('token 估算器元数据无效')
  if (estimator.metadata.errorMargin !== null && (!Number.isFinite(estimator.metadata.errorMargin) || estimator.metadata.errorMargin < 0)) throw new TypeError('token 估算误差无效')
  const probe = estimator.estimate('测试 token')
  if (!Number.isSafeInteger(probe) || probe < 0) throw new TypeError('token 估算结果无效')
}

function assertUniqueIds(candidates: NormalizedCandidate[]): void {
  const ids = new Set<string>()
  for (const candidate of candidates) {
    if (ids.has(candidate.id)) throw new TypeError(`上下文候选编号重复：${candidate.id}`)
    ids.add(candidate.id)
  }
}

function nullableAscending(left: number | null, right: number | null): number {
  if (left === null && right === null) return 0
  if (left === null) return 1
  if (right === null) return -1
  return left - right
}

function nullableDateDescending(left: string | null, right: string | null): number {
  if (left === null && right === null) return 0
  if (left === null) return 1
  if (right === null) return -1
  return Date.parse(right) - Date.parse(left)
}

function boundedIdentity(value: unknown, limit: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= limit
}

function validHash(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value)
}

function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
