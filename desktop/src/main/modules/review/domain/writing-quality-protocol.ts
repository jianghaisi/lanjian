import { createHash } from 'node:crypto'
import { AppError } from '../../../core/errors/app-error'

export const WRITING_QUALITY_PURPOSE = 'protocol-and-runner-validation-only' as const
export const CHARACTER_RULE = 'nfc-code-points-excluding-whitespace-v1' as const
export const TARGET_CHARACTERS = { minimum: 1800, maximum: 2200 } as const
export const GENRES = ['xuanhuan', 'xuanyi', 'dushi'] as const
export const ARMS = ['direct', 'outline-first', 'v3-full-flow'] as const
export const TERMINAL_STATUSES = ['succeeded', 'invalid', 'budget-rejected', 'cancelled', 'interrupted', 'failed'] as const

export type Genre = typeof GENRES[number]
export type Arm = typeof ARMS[number]
export type AttemptStatus = 'reserved' | typeof TERMINAL_STATUSES[number]

export type TokenUsage = {
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

export type QualitySlot = { storyId: string; genre: Genre; arm: Arm }

export type TrialManifestV1 = {
  version: 1
  purpose: typeof WRITING_QUALITY_PURPOSE
  runId: string
  mode: 'offline'
  seed: number
  protocolHash: string
  fixtureHash: string
  rubricHash: string
  characterRule: typeof CHARACTER_RULE
  targetCharacters: typeof TARGET_CHARACTERS
  slots: QualitySlot[]
  syntheticPriceBasis: {
    currency: 'CNY'
    inputPerMillionTokens: number
    outputPerMillionTokens: number
  }
  perStoryCeilingCny: number
  wholeRunCeilingCny: number
}

export type GenerationAttemptEventV1 = {
  version: 1
  runId: string
  eventId: string
  eventHash: string
  attemptId: string
  sequence: number
  previousEventHash: string | null
  storyId: string
  genre: Genre
  arm: Arm
  attempt: number
  status: AttemptStatus
  inputHash: string
  outputId: string | null
  outputHash: string | null
  narrativeCharacters: number | null
  usage: TokenUsage | null
  reservedCostCny: number
  actualCostCny: number | null
  startedAt: string
  finishedAt: string | null
  errorCode: string | null
  synthetic: true
}

export type BlindPacketV1 = {
  version: 1
  purpose: typeof WRITING_QUALITY_PURPOSE
  runId: string
  packetId: string
  genre: Genre
  fixture: { title: string; premise: string; constraints: string[] }
  rubricVersion: 'writing-quality-rubric-v1'
  candidates: [{ anonymousId: string; content: string }, { anonymousId: string; content: string }]
  packetHash: string
}

export type IdentityMapV1 = {
  version: 1
  runId: string
  mappings: Array<{ packetId: string; anonymousId: string; storyId: string; arm: Arm }>
  identityHash: string
}

export type JudgmentRecordV1 = {
  version: 1
  runId: string
  judgmentId: string
  packetId: string
  choice: 'left' | 'right' | 'tie' | 'abstain'
  confidence: number | null
  note: string | null
  createdAt: string
  rubricHash: string
  recordHash: string
}

export type QualityReportV1 = {
  version: 1
  purpose: typeof WRITING_QUALITY_PURPOSE
  scopeNotice: string
  runId: string
  status: 'protocol-complete' | 'incomplete'
  generatedAt: string
  slotCount: number
  successfulSlots: number
  terminalSlots: number
  packetCount: number
  judgmentCoverage: { completed: 0; required: number; ratio: 0 }
  estimatedSyntheticCostCny: number
  protocolDeviations: string[]
  packetHashes: Array<{ packetId: string; packetHash: string }>
  identityHash: string
  reportHash: string
}

export type AttemptProjection = {
  events: GenerationAttemptEventV1[]
  byAttempt: Map<string, GenerationAttemptEventV1[]>
  terminalBySlot: Map<string, GenerationAttemptEventV1>
  danglingReservations: GenerationAttemptEventV1[]
  actualCostCny: number
  lastEventHash: string | null
}

const identifierPattern = /^[a-z0-9][a-z0-9-]{0,95}$/
const hashPattern = /^[a-f0-9]{64}$/

export function narrativeCharacterCount(content: string): number {
  return Array.from(content.normalize('NFC')).filter(character => !/\s/u.test(character)).length
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value))
}

export function sha256(value: unknown): string {
  return createHash('sha256').update(typeof value === 'string' ? value : canonicalJson(value), 'utf8').digest('hex')
}

export function calculateSyntheticCost(usage: TokenUsage, price: TrialManifestV1['syntheticPriceBasis']): number {
  assertUsage(usage)
  return roundMoney((usage.inputTokens * price.inputPerMillionTokens + usage.outputTokens * price.outputPerMillionTokens) / 1_000_000)
}

export function eventHash(event: Omit<GenerationAttemptEventV1, 'eventHash'>): string {
  return sha256(event)
}

export function sealAttemptEvent(event: Omit<GenerationAttemptEventV1, 'eventHash'>): GenerationAttemptEventV1 {
  return { ...event, eventHash: eventHash(event) }
}

export function decodeManifest(value: unknown): TrialManifestV1 {
  const object = exactObject(value, [
    'version', 'purpose', 'runId', 'mode', 'seed', 'protocolHash', 'fixtureHash', 'rubricHash', 'characterRule',
    'targetCharacters', 'slots', 'syntheticPriceBasis', 'perStoryCeilingCny', 'wholeRunCeilingCny'
  ], 'manifest')
  if (object.version !== 1 || object.purpose !== WRITING_QUALITY_PURPOSE || object.mode !== 'offline' || object.characterRule !== CHARACTER_RULE) invalid('manifest constants')
  assertIdentifier(object.runId, 'runId')
  assertSafeInteger(object.seed, 'seed')
  assertHash(object.protocolHash, 'protocolHash'); assertHash(object.fixtureHash, 'fixtureHash'); assertHash(object.rubricHash, 'rubricHash')
  const target = exactObject(object.targetCharacters, ['minimum', 'maximum'], 'targetCharacters')
  if (target.minimum !== TARGET_CHARACTERS.minimum || target.maximum !== TARGET_CHARACTERS.maximum) invalid('targetCharacters')
  if (!Array.isArray(object.slots) || object.slots.length !== 9) invalid('slots')
  const slots = object.slots.map((slot, index) => decodeSlot(slot, `slots[${index}]`))
  if (new Set(slots.map(slotKey)).size !== slots.length) invalid('duplicate slot')
  const price = exactObject(object.syntheticPriceBasis, ['currency', 'inputPerMillionTokens', 'outputPerMillionTokens'], 'syntheticPriceBasis')
  if (price.currency !== 'CNY') invalid('currency')
  assertNonNegativeFinite(price.inputPerMillionTokens, 'input price'); assertNonNegativeFinite(price.outputPerMillionTokens, 'output price')
  assertPositiveFinite(object.perStoryCeilingCny, 'per story ceiling'); assertPositiveFinite(object.wholeRunCeilingCny, 'whole run ceiling')
  return value as TrialManifestV1
}

export function decodeAttemptEvent(value: unknown): GenerationAttemptEventV1 {
  const keys = [
    'version', 'runId', 'eventId', 'eventHash', 'attemptId', 'sequence', 'previousEventHash', 'storyId', 'genre', 'arm',
    'attempt', 'status', 'inputHash', 'outputId', 'outputHash', 'narrativeCharacters', 'usage', 'reservedCostCny',
    'actualCostCny', 'startedAt', 'finishedAt', 'errorCode', 'synthetic'
  ]
  const object = exactObject(value, keys, 'attempt event')
  if (object.version !== 1 || object.synthetic !== true) invalid('attempt constants')
  for (const [name, field] of [['runId', object.runId], ['eventId', object.eventId], ['attemptId', object.attemptId], ['storyId', object.storyId]] as const) assertIdentifier(field, name)
  assertSafeInteger(object.sequence, 'sequence', 1); assertSafeInteger(object.attempt, 'attempt', 1)
  if (!GENRES.includes(object.genre as Genre) || !ARMS.includes(object.arm as Arm)) invalid('genre or arm')
  if (object.status !== 'reserved' && !TERMINAL_STATUSES.includes(object.status as typeof TERMINAL_STATUSES[number])) invalid('status')
  assertHash(object.inputHash, 'inputHash'); assertHash(object.eventHash, 'eventHash')
  nullableHash(object.previousEventHash, 'previousEventHash'); nullableHash(object.outputHash, 'outputHash')
  nullableIdentifier(object.outputId, 'outputId')
  nullableSafeInteger(object.narrativeCharacters, 'narrativeCharacters', 0)
  if (object.usage !== null) assertUsage(object.usage)
  assertNonNegativeFinite(object.reservedCostCny, 'reservedCostCny'); nullableNonNegativeFinite(object.actualCostCny, 'actualCostCny')
  assertTimestamp(object.startedAt, 'startedAt'); if (object.finishedAt !== null) assertTimestamp(object.finishedAt, 'finishedAt')
  if (object.errorCode !== null && (typeof object.errorCode !== 'string' || !/^[A-Z][A-Z0-9_]{0,63}$/.test(object.errorCode))) invalid('errorCode')
  const { eventHash: claimedHash, ...unsealed } = value as GenerationAttemptEventV1
  if (eventHash(unsealed) !== claimedHash) invalid('event hash')
  validateEventShape(value as GenerationAttemptEventV1)
  return value as GenerationAttemptEventV1
}

export function decodeBlindPacket(value: unknown): BlindPacketV1 {
  const object = exactObject(value, ['version', 'purpose', 'runId', 'packetId', 'genre', 'fixture', 'rubricVersion', 'candidates', 'packetHash'], 'blind packet')
  if (object.version !== 1 || object.purpose !== WRITING_QUALITY_PURPOSE || object.rubricVersion !== 'writing-quality-rubric-v1') invalid('blind packet constants')
  assertIdentifier(object.runId, 'runId'); assertIdentifier(object.packetId, 'packetId')
  if (!GENRES.includes(object.genre as Genre)) invalid('packet genre')
  const fixture = exactObject(object.fixture, ['title', 'premise', 'constraints'], 'packet fixture')
  assertNonEmptyString(fixture.title, 'fixture title'); assertNonEmptyString(fixture.premise, 'fixture premise')
  if (!Array.isArray(fixture.constraints) || fixture.constraints.length === 0 || fixture.constraints.some(item => typeof item !== 'string' || item.length === 0)) invalid('fixture constraints')
  if (!Array.isArray(object.candidates) || object.candidates.length !== 2) invalid('packet candidates')
  const candidates = object.candidates.map((candidate, index) => {
    const item = exactObject(candidate, ['anonymousId', 'content'], `candidate ${index}`)
    assertIdentifier(item.anonymousId, 'anonymousId'); assertNonEmptyString(item.content, 'candidate content')
    return item as { anonymousId: string; content: string }
  })
  if (candidates[0]!.anonymousId === candidates[1]!.anonymousId) invalid('duplicate anonymous candidate')
  assertHash(object.packetHash, 'packetHash')
  const { packetHash, ...unsigned } = value as BlindPacketV1
  if (sha256(unsigned) !== packetHash) invalid('packet hash')
  return value as BlindPacketV1
}

export function decodeIdentityMap(value: unknown): IdentityMapV1 {
  const object = exactObject(value, ['version', 'runId', 'mappings', 'identityHash'], 'identity map')
  if (object.version !== 1) invalid('identity version')
  assertIdentifier(object.runId, 'runId'); assertHash(object.identityHash, 'identityHash')
  if (!Array.isArray(object.mappings)) invalid('identity mappings')
  const identities = new Set<string>()
  for (const [index, mapping] of object.mappings.entries()) {
    const item = exactObject(mapping, ['packetId', 'anonymousId', 'storyId', 'arm'], `identity mapping ${index}`)
    assertIdentifier(item.packetId, 'packetId'); assertIdentifier(item.anonymousId, 'anonymousId'); assertIdentifier(item.storyId, 'storyId')
    if (!ARMS.includes(item.arm as Arm)) invalid('identity arm')
    const key = `${item.packetId}:${item.anonymousId}`
    if (identities.has(key)) invalid('duplicate identity mapping')
    identities.add(key)
  }
  const { identityHash, ...unsigned } = value as IdentityMapV1
  if (sha256(unsigned) !== identityHash) invalid('identity hash')
  return value as IdentityMapV1
}

export function decodeJudgmentRecord(value: unknown): JudgmentRecordV1 {
  const object = exactObject(value, ['version', 'runId', 'judgmentId', 'packetId', 'choice', 'confidence', 'note', 'createdAt', 'rubricHash', 'recordHash'], 'judgment')
  if (object.version !== 1) invalid('judgment version')
  assertIdentifier(object.runId, 'runId'); assertIdentifier(object.judgmentId, 'judgmentId'); assertIdentifier(object.packetId, 'packetId')
  if (!['left', 'right', 'tie', 'abstain'].includes(object.choice as string)) invalid('judgment choice')
  if (object.confidence !== null) assertSafeInteger(object.confidence, 'confidence', 1)
  if (typeof object.confidence === 'number' && object.confidence > 5) invalid('confidence')
  if (object.note !== null && typeof object.note !== 'string') invalid('judgment note')
  assertTimestamp(object.createdAt, 'createdAt'); assertHash(object.rubricHash, 'rubricHash'); assertHash(object.recordHash, 'recordHash')
  const { recordHash, ...unsigned } = value as JudgmentRecordV1
  if (sha256(unsigned) !== recordHash) invalid('judgment hash')
  return value as JudgmentRecordV1
}

export function decodeQualityReport(value: unknown): QualityReportV1 {
  const object = exactObject(value, [
    'version', 'purpose', 'scopeNotice', 'runId', 'status', 'generatedAt', 'slotCount', 'successfulSlots', 'terminalSlots',
    'packetCount', 'judgmentCoverage', 'estimatedSyntheticCostCny', 'protocolDeviations', 'packetHashes', 'identityHash', 'reportHash'
  ], 'quality report')
  if (object.version !== 1 || object.purpose !== WRITING_QUALITY_PURPOSE || !['protocol-complete', 'incomplete'].includes(object.status as string)) invalid('report constants')
  assertNonEmptyString(object.scopeNotice, 'scopeNotice'); assertIdentifier(object.runId, 'runId'); assertTimestamp(object.generatedAt, 'generatedAt')
  for (const field of ['slotCount', 'successfulSlots', 'terminalSlots', 'packetCount'] as const) assertSafeInteger(object[field], field, 0)
  const coverage = exactObject(object.judgmentCoverage, ['completed', 'required', 'ratio'], 'judgment coverage')
  if (coverage.completed !== 0 || coverage.ratio !== 0) invalid('offline judgment coverage')
  assertSafeInteger(coverage.required, 'required judgments', 0)
  assertNonNegativeFinite(object.estimatedSyntheticCostCny, 'estimatedSyntheticCostCny')
  if (!Array.isArray(object.protocolDeviations) || object.protocolDeviations.some(item => typeof item !== 'string')) invalid('protocol deviations')
  if (!Array.isArray(object.packetHashes)) invalid('packet hashes')
  for (const item of object.packetHashes) {
    const entry = exactObject(item, ['packetId', 'packetHash'], 'packet hash entry')
    assertIdentifier(entry.packetId, 'packetId'); assertHash(entry.packetHash, 'packetHash')
  }
  assertHash(object.identityHash, 'identityHash'); assertHash(object.reportHash, 'reportHash')
  const { reportHash, ...unsigned } = value as QualityReportV1
  if (sha256(unsigned) !== reportHash) invalid('report hash')
  return value as QualityReportV1
}

export function reduceAttemptEvents(values: unknown[], manifest: TrialManifestV1): AttemptProjection {
  const events = values.map(decodeAttemptEvent)
  const byAttempt = new Map<string, GenerationAttemptEventV1[]>()
  const terminalBySlot = new Map<string, GenerationAttemptEventV1>()
  const eventIds = new Set<string>()
  const manifestSlots = new Map(manifest.slots.map(slot => [slotKey(slot), slot]))
  let previous: string | null = null
  let cost = 0
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]!
    if (event.runId !== manifest.runId || event.sequence !== index + 1 || event.previousEventHash !== previous) invalid('event chain')
    if (eventIds.has(event.eventId)) invalid('duplicate event id')
    eventIds.add(event.eventId); previous = event.eventHash
    const slot = manifestSlots.get(slotKey(event))
    if (!slot) invalid('event slot')
    const attemptEvents = byAttempt.get(event.attemptId) ?? []
    if (attemptEvents.length === 0) {
      if (event.status !== 'reserved' && event.status !== 'budget-rejected') invalid('attempt must start reserved or budget-rejected')
    } else {
      const first = attemptEvents[0]!
      if (attemptEvents.length !== 1 || first.status !== 'reserved' || event.status === 'reserved' || event.status === 'budget-rejected') invalid('attempt transition')
      for (const field of ['runId', 'attemptId', 'storyId', 'genre', 'arm', 'attempt', 'inputHash', 'startedAt', 'reservedCostCny'] as const) {
        if (event[field] !== first[field]) invalid(`attempt changed ${field}`)
      }
    }
    attemptEvents.push(event); byAttempt.set(event.attemptId, attemptEvents)
    if (event.status !== 'reserved') {
      const key = slotKey(event)
      if (terminalBySlot.has(key)) invalid('multiple terminal attempts for slot')
      terminalBySlot.set(key, event)
      cost = roundMoney(cost + (event.actualCostCny ?? 0))
    }
  }
  return {
    events, byAttempt, terminalBySlot,
    danglingReservations: [...byAttempt.values()].filter(items => items.length === 1 && items[0]!.status === 'reserved').map(items => items[0]!),
    actualCostCny: cost, lastEventHash: previous
  }
}

export function slotKey(slot: Pick<QualitySlot, 'storyId' | 'genre' | 'arm'>): string {
  return `${slot.storyId}:${slot.genre}:${slot.arm}`
}

export function stableAnonymousId(seed: number, storyId: string, arm: Arm): string {
  return `candidate-${sha256(`${seed}:${storyId}:${arm}`).slice(0, 12)}`
}

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000
}

function validateEventShape(event: GenerationAttemptEventV1): void {
  if (event.status === 'reserved') {
    if (event.finishedAt !== null || event.actualCostCny !== null || event.outputId !== null || event.outputHash !== null || event.narrativeCharacters !== null || event.usage !== null || event.errorCode !== null) invalid('reserved shape')
    return
  }
  if (event.finishedAt === null || event.actualCostCny === null) invalid('terminal shape')
  if (event.status === 'succeeded') {
    if (event.outputId === null || event.outputHash === null || event.narrativeCharacters === null || event.usage === null || event.errorCode !== null) invalid('success shape')
    if (event.narrativeCharacters < TARGET_CHARACTERS.minimum || event.narrativeCharacters > TARGET_CHARACTERS.maximum) invalid('success length')
  } else if (event.outputId !== null || event.outputHash !== null) invalid('failed output reference')
  if (event.status === 'budget-rejected' && (event.reservedCostCny !== 0 || event.usage !== null || event.actualCostCny !== 0)) invalid('budget rejection shape')
  if (event.status !== 'succeeded' && event.errorCode === null) invalid('terminal error code')
}

function canonicalValue(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) invalid('canonical number')
    return Object.is(value, -0) ? 0 : value
  }
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (!isPlainObject(value)) invalid('canonical value')
  const result: Record<string, unknown> = {}
  for (const key of Object.keys(value).sort()) {
    if (value[key] === undefined) invalid('canonical undefined')
    result[key] = canonicalValue(value[key])
  }
  return result
}

function decodeSlot(value: unknown, label: string): QualitySlot {
  const object = exactObject(value, ['storyId', 'genre', 'arm'], label)
  assertIdentifier(object.storyId, `${label}.storyId`)
  if (!GENRES.includes(object.genre as Genre) || !ARMS.includes(object.arm as Arm)) invalid(label)
  return value as QualitySlot
}

function exactObject(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!isPlainObject(value)) invalid(label)
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) invalid(`${label} keys`)
  return value
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function assertUsage(value: unknown): asserts value is TokenUsage {
  const object = exactObject(value, ['inputTokens', 'outputTokens', 'totalTokens'], 'usage')
  assertSafeInteger(object.inputTokens, 'inputTokens', 0); assertSafeInteger(object.outputTokens, 'outputTokens', 0); assertSafeInteger(object.totalTokens, 'totalTokens', 0)
  if (object.totalTokens !== (object.inputTokens as number) + (object.outputTokens as number)) invalid('usage total')
}

function assertIdentifier(value: unknown, label: string): asserts value is string { if (typeof value !== 'string' || !identifierPattern.test(value)) invalid(label) }
function nullableIdentifier(value: unknown, label: string): void { if (value !== null) assertIdentifier(value, label) }
function assertHash(value: unknown, label: string): asserts value is string { if (typeof value !== 'string' || !hashPattern.test(value)) invalid(label) }
function nullableHash(value: unknown, label: string): void { if (value !== null) assertHash(value, label) }
function assertSafeInteger(value: unknown, label: string, minimum = Number.MIN_SAFE_INTEGER): asserts value is number { if (!Number.isSafeInteger(value) || (value as number) < minimum) invalid(label) }
function nullableSafeInteger(value: unknown, label: string, minimum: number): void { if (value !== null) assertSafeInteger(value, label, minimum) }
function assertNonNegativeFinite(value: unknown, label: string): asserts value is number { if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) invalid(label) }
function nullableNonNegativeFinite(value: unknown, label: string): void { if (value !== null) assertNonNegativeFinite(value, label) }
function assertPositiveFinite(value: unknown, label: string): asserts value is number { if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) invalid(label) }
function assertTimestamp(value: unknown, label: string): asserts value is string { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value))) invalid(label) }
function assertNonEmptyString(value: unknown, label: string): asserts value is string { if (typeof value !== 'string' || value.length === 0) invalid(label) }

function invalid(field: string): never {
  throw new AppError('VALIDATION_ERROR', `离线质量实验数据无效：${field}`, { recoverable: false })
}
