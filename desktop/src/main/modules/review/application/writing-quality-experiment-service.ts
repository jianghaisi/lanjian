import { AppError } from '../../../core/errors/app-error'
import { WritingQualityRunStore } from '../adapters/writing-quality-run-store'
import {
  ARMS, GENRES, TARGET_CHARACTERS, WRITING_QUALITY_PURPOSE, calculateSyntheticCost, canonicalJson, decodeManifest,
  narrativeCharacterCount, reduceAttemptEvents, roundMoney, sealAttemptEvent, sha256, slotKey, stableAnonymousId,
  type Arm, type BlindPacketV1, type GenerationAttemptEventV1, type IdentityMapV1, type QualityReportV1,
  type QualitySlot, type TrialManifestV1
} from '../domain/writing-quality-protocol'
import {
  WRITING_QUALITY_RUBRIC, fixtureForGenre, freezeSlotInput, publicFixture,
  type OfflineGenerationAdapter
} from '../domain/writing-quality-fixtures'

export type WritingQualityRunResult = {
  manifest: TrialManifestV1
  report: QualityReportV1
  events: GenerationAttemptEventV1[]
  runRoot: string
}

const RESERVED_USAGE = { inputTokens: 2000, outputTokens: 3000, totalTokens: 5000 }
const pairs: ReadonlyArray<readonly [Arm, Arm]> = [
  ['direct', 'outline-first'], ['direct', 'v3-full-flow'], ['outline-first', 'v3-full-flow']
]

export class WritingQualityExperimentService {
  constructor(
    private readonly store: WritingQualityRunStore,
    private readonly adapter: OfflineGenerationAdapter,
    private readonly clock: () => Date = () => new Date()
  ) {}

  async run(expectedManifest: TrialManifestV1, signal: AbortSignal = new AbortController().signal): Promise<WritingQualityRunResult> {
    const manifest = decodeManifest(expectedManifest)
    if (manifest.runId !== this.store.runId) throw new AppError('CONFLICT', '运行目录与 manifest 的 run-id 不一致')
    const stored = await this.store.readManifest()
    if (stored === null) await this.store.writeManifest(manifest)
    else if (canonicalJson(decodeManifest(stored)) !== canonicalJson(manifest)) throw new AppError('CONFLICT', '已有运行的 manifest 与本次参数不一致')

    let projection = reduceAttemptEvents(await this.store.readAttemptValues(), manifest)
    for (const reservation of projection.danglingReservations) {
      const interrupted = terminalFromReservation(reservation, {
        sequence: projection.events.length + 1,
        previousEventHash: projection.lastEventHash,
        status: 'interrupted', finishedAt: this.timestamp(), actualCostCny: 0, errorCode: 'INTERRUPTED_BEFORE_RESUME'
      })
      await this.store.appendAttempt(interrupted)
      projection = reduceAttemptEvents([...projection.events, interrupted], manifest)
    }

    for (const slot of manifest.slots) {
      if (projection.terminalBySlot.has(slotKey(slot))) continue
      const input = freezeSlotInput(manifest, slot)
      const attemptId = `${slot.storyId}-${slot.arm}-attempt-1`
      const startedAt = this.timestamp()
      const reservationCost = calculateSyntheticCost(RESERVED_USAGE, manifest.syntheticPriceBasis)
      if (!budgetAllows(manifest, projection.events, slot, reservationCost)) {
        const rejected = sealAttemptEvent({
          version: 1, runId: manifest.runId, eventId: `${attemptId}-budget-rejected`, attemptId,
          sequence: projection.events.length + 1, previousEventHash: projection.lastEventHash,
          storyId: slot.storyId, genre: slot.genre, arm: slot.arm, attempt: 1, status: 'budget-rejected',
          inputHash: input.inputHash, outputId: null, outputHash: null, narrativeCharacters: null, usage: null,
          reservedCostCny: 0, actualCostCny: 0, startedAt, finishedAt: startedAt,
          errorCode: 'SYNTHETIC_BUDGET_EXCEEDED', synthetic: true
        })
        await this.store.appendAttempt(rejected)
        projection = reduceAttemptEvents([...projection.events, rejected], manifest)
        continue
      }

      const reserved = sealAttemptEvent({
        version: 1, runId: manifest.runId, eventId: `${attemptId}-reserved`, attemptId,
        sequence: projection.events.length + 1, previousEventHash: projection.lastEventHash,
        storyId: slot.storyId, genre: slot.genre, arm: slot.arm, attempt: 1, status: 'reserved',
        inputHash: input.inputHash, outputId: null, outputHash: null, narrativeCharacters: null, usage: null,
        reservedCostCny: reservationCost, actualCostCny: null, startedAt, finishedAt: null, errorCode: null, synthetic: true
      })
      await this.store.appendAttempt(reserved)
      projection = reduceAttemptEvents([...projection.events, reserved], manifest)

      let terminal: GenerationAttemptEventV1
      try {
        const result = await this.adapter.generate(input, signal)
        const characters = narrativeCharacterCount(result.content)
        const actualCost = calculateSyntheticCost(result.usage, manifest.syntheticPriceBasis)
        if (actualCost > reservationCost) {
          terminal = terminalFromReservation(reserved, {
            sequence: projection.events.length + 1, previousEventHash: projection.lastEventHash, status: 'invalid',
            finishedAt: this.timestamp(), actualCostCny: actualCost, errorCode: 'USAGE_EXCEEDS_RESERVATION',
            narrativeCharacters: characters, usage: result.usage
          })
        } else if (characters < TARGET_CHARACTERS.minimum || characters > TARGET_CHARACTERS.maximum) {
          terminal = terminalFromReservation(reserved, {
            sequence: projection.events.length + 1, previousEventHash: projection.lastEventHash, status: 'invalid',
            finishedAt: this.timestamp(), actualCostCny: actualCost, errorCode: 'INVALID_NARRATIVE_LENGTH',
            narrativeCharacters: characters, usage: result.usage
          })
        } else {
          const outputId = stableAnonymousId(manifest.seed, slot.storyId, slot.arm)
          const outputHash = sha256(result.content)
          await this.store.writeOutput(outputId, result.content)
          terminal = terminalFromReservation(reserved, {
            sequence: projection.events.length + 1, previousEventHash: projection.lastEventHash, status: 'succeeded',
            finishedAt: this.timestamp(), actualCostCny: actualCost, errorCode: null,
            outputId, outputHash, narrativeCharacters: characters, usage: result.usage
          })
        }
      } catch (error) {
        terminal = terminalFromReservation(reserved, {
          sequence: projection.events.length + 1, previousEventHash: projection.lastEventHash,
          status: isAbort(error, signal) ? 'cancelled' : 'failed', finishedAt: this.timestamp(), actualCostCny: 0,
          errorCode: isAbort(error, signal) ? 'CANCELLED' : 'ADAPTER_FAILED'
        })
      }
      await this.store.appendAttempt(terminal)
      projection = reduceAttemptEvents([...projection.events, terminal], manifest)
    }

    const { packets, identity } = await this.buildBlindArtifacts(manifest, projection.terminalBySlot)
    for (const packet of packets) await writeOrVerifyPacket(this.store, packet)
    await writeOrVerifyIdentity(this.store, identity)
    const report = buildReport(manifest, projection.events, packets, identity, this.timestamp())
    await this.store.writeReport(report)
    return { manifest, report, events: projection.events, runRoot: this.store.runRoot }
  }

  private async buildBlindArtifacts(manifest: TrialManifestV1, terminals: Map<string, GenerationAttemptEventV1>): Promise<{ packets: BlindPacketV1[]; identity: IdentityMapV1 }> {
    const packets: BlindPacketV1[] = []
    const mappings: IdentityMapV1['mappings'] = []
    for (const genre of GENRES) {
      const fixture = fixtureForGenre(genre)
      for (const [pairIndex, [firstArm, secondArm]] of pairs.entries()) {
        const first = successfulTerminal(terminals, fixture.storyId, genre, firstArm)
        const second = successfulTerminal(terminals, fixture.storyId, genre, secondArm)
        if (!first || !second) continue
        const packetId = `${genre}-pair-${pairIndex + 1}`
        const firstCandidate = { anonymousId: first.outputId!, content: await verifiedOutput(this.store, first) }
        const secondCandidate = { anonymousId: second.outputId!, content: await verifiedOutput(this.store, second) }
        const shouldSwap = sha256(`${manifest.seed}:${packetId}:order`).charCodeAt(0) % 2 === 1
        const candidates = (shouldSwap ? [secondCandidate, firstCandidate] : [firstCandidate, secondCandidate]) as BlindPacketV1['candidates']
        const unsigned = {
          version: 1 as const, purpose: WRITING_QUALITY_PURPOSE, runId: manifest.runId, packetId, genre,
          fixture: publicFixture(fixture), rubricVersion: WRITING_QUALITY_RUBRIC.version, candidates
        }
        const packet: BlindPacketV1 = { ...unsigned, packetHash: sha256(unsigned) }
        packets.push(packet)
        mappings.push(...candidates.map(candidate => ({
          packetId, anonymousId: candidate.anonymousId, storyId: fixture.storyId,
          arm: candidate.anonymousId === first.outputId ? firstArm : secondArm
        })))
      }
    }
    const unsignedIdentity = { version: 1 as const, runId: manifest.runId, mappings }
    return { packets, identity: { ...unsignedIdentity, identityHash: sha256(unsignedIdentity) } }
  }

  private timestamp(): string { return this.clock().toISOString() }
}

function terminalFromReservation(
  reservation: GenerationAttemptEventV1,
  values: {
    sequence: number; previousEventHash: string | null; status: Exclude<GenerationAttemptEventV1['status'], 'reserved' | 'budget-rejected'>;
    finishedAt: string; actualCostCny: number; errorCode: string | null; outputId?: string; outputHash?: string;
    narrativeCharacters?: number; usage?: GenerationAttemptEventV1['usage']
  }
): GenerationAttemptEventV1 {
  return sealAttemptEvent({
    version: 1, runId: reservation.runId, eventId: `${reservation.attemptId}-${values.status}`, attemptId: reservation.attemptId,
    sequence: values.sequence, previousEventHash: values.previousEventHash, storyId: reservation.storyId, genre: reservation.genre,
    arm: reservation.arm, attempt: reservation.attempt, status: values.status, inputHash: reservation.inputHash,
    outputId: values.outputId ?? null, outputHash: values.outputHash ?? null,
    narrativeCharacters: values.narrativeCharacters ?? null, usage: values.usage ?? null,
    reservedCostCny: reservation.reservedCostCny, actualCostCny: values.actualCostCny,
    startedAt: reservation.startedAt, finishedAt: values.finishedAt, errorCode: values.errorCode, synthetic: true
  })
}

function budgetAllows(manifest: TrialManifestV1, events: GenerationAttemptEventV1[], slot: QualitySlot, reserve: number): boolean {
  const terminals = events.filter(event => event.status !== 'reserved')
  const runCost = terminals.reduce((sum, event) => sum + (event.actualCostCny ?? 0), 0)
  const storyCost = terminals.filter(event => event.storyId === slot.storyId).reduce((sum, event) => sum + (event.actualCostCny ?? 0), 0)
  return roundMoney(runCost + reserve) <= manifest.wholeRunCeilingCny && roundMoney(storyCost + reserve) <= manifest.perStoryCeilingCny
}

function successfulTerminal(terminals: Map<string, GenerationAttemptEventV1>, storyId: string, genre: typeof GENRES[number], arm: Arm): GenerationAttemptEventV1 | null {
  const event = terminals.get(slotKey({ storyId, genre, arm }))
  return event?.status === 'succeeded' ? event : null
}

async function verifiedOutput(store: WritingQualityRunStore, event: GenerationAttemptEventV1): Promise<string> {
  if (!event.outputId || !event.outputHash) throw new AppError('VALIDATION_ERROR', '成功事件缺少输出引用')
  const content = await store.readOutput(event.outputId)
  if (sha256(content) !== event.outputHash || narrativeCharacterCount(content) !== event.narrativeCharacters) {
    throw new AppError('CONFLICT', '实验输出与事件账本不一致')
  }
  return content
}

async function writeOrVerifyPacket(store: WritingQualityRunStore, packet: BlindPacketV1): Promise<void> {
  try { await store.writePacket(packet) }
  catch (error) {
    if (!(error instanceof AppError) || error.code !== 'CONFLICT') throw error
    if (canonicalJson(await store.readPacket(packet.packetId)) !== canonicalJson(packet)) throw new AppError('CONFLICT', '已有盲评包与重放结果不一致')
  }
}

async function writeOrVerifyIdentity(store: WritingQualityRunStore, identity: IdentityMapV1): Promise<void> {
  try { await store.writeIdentityMap(identity) }
  catch (error) {
    if (!(error instanceof AppError) || error.code !== 'CONFLICT') throw error
    if (canonicalJson(await store.readIdentityMap()) !== canonicalJson(identity)) throw new AppError('CONFLICT', '已有身份映射与重放结果不一致')
  }
}

function buildReport(manifest: TrialManifestV1, events: GenerationAttemptEventV1[], packets: BlindPacketV1[], identity: IdentityMapV1, generatedAt: string): QualityReportV1 {
  const terminals = events.filter(event => event.status !== 'reserved')
  const successes = terminals.filter(event => event.status === 'succeeded')
  const deviations = terminals.filter(event => event.status !== 'succeeded').map(event => `${slotKey(event)}:${event.status}:${event.errorCode}`)
  const unsigned: Omit<QualityReportV1, 'reportHash'> = {
    version: 1, purpose: WRITING_QUALITY_PURPOSE,
    scopeNotice: '本报告只证明离线实验协议、预算、恢复、盲评和产物链路可以运行；合成文本不证明小说质量，也不代表任何真实模型表现。',
    runId: manifest.runId,
    status: successes.length === manifest.slots.length && packets.length === 9 ? 'protocol-complete' : 'incomplete',
    generatedAt, slotCount: manifest.slots.length, successfulSlots: successes.length, terminalSlots: terminals.length,
    packetCount: packets.length, judgmentCoverage: { completed: 0, required: packets.length, ratio: 0 },
    estimatedSyntheticCostCny: roundMoney(terminals.reduce((sum, event) => sum + (event.actualCostCny ?? 0), 0)),
    protocolDeviations: deviations, packetHashes: packets.map(packet => ({ packetId: packet.packetId, packetHash: packet.packetHash })),
    identityHash: identity.identityHash
  }
  return { ...unsigned, reportHash: sha256(unsigned) }
}

function isAbort(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || Boolean(error && typeof error === 'object' && 'name' in error && error.name === 'AbortError')
}
