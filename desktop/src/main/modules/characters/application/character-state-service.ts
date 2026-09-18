import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { AppError } from '../../../core/errors/app-error'
import { projectDirectory } from '../../../platform/storage/project-path'
import type { Chapter, ChapterDraftProposal, CharacterDynamicChange, CharacterDynamicField, CharacterStateConflict, CharacterStateEvent, CharacterStateView, CharacterStableConflict, PlanningCharacterSeed, PlanningCharacterSeedPreview } from '../../../../contracts/index'
import { writeJson } from '../../../platform/storage/json-store'

export type CharacterEvidenceSource = {
  id: string
  names: string[]
  location: string
}

type ProjectLocator = { currentPath: () => Promise<string> }
type FormalCharacterStatePort = {
  active(workItemId: string): Promise<boolean>
  characterStateReady(workItemId: string): Promise<boolean>
  characterState(workItemId: string): Promise<{ state: CharacterStateView; contentHash: string }>
  importCharacterState(workItemId: string, state: CharacterStateView, observedMirrorHash?: string): Promise<CharacterStateView>
  replaceCharacterState(workItemId: string, expectedContentHash: string, state: CharacterStateView): Promise<CharacterStateView>
}

export class CharacterStateService {
  private mutation: Promise<void> = Promise.resolve()
  private readonly formalHashes = new WeakMap<CharacterStateView, string>()

  constructor(private readonly projects: ProjectLocator, private readonly formalStates?: FormalCharacterStatePort) {}

  async state(): Promise<CharacterStateView> {
    const root = await this.projects.currentPath()
    return this.read(root)
  }

  async validateLedger(): Promise<void> {
    const root = await this.projects.currentPath()
    await this.read(root)
  }

  async previewPlanningSeeds(proposalId: string, seeds: PlanningCharacterSeed[]): Promise<PlanningCharacterSeedPreview> {
    const root = await this.projects.currentPath()
    const current = await this.read(root)
    return planningSeedPreview(proposalId, seeds, current)
  }

  async adoptPlanningSeeds(input: {
    proposalId: string
    seeds: PlanningCharacterSeed[]
    candidateFingerprint: string
    currentFingerprint: string
  }): Promise<{ state: CharacterStateView; anchorFingerprint: string }> {
    const root = await this.projects.currentPath()
    return this.serializeMutation(async () => {
      const current = await this.read(root)
      const preview = planningSeedPreview(input.proposalId, input.seeds, current)
      if (preview.candidateFingerprint !== input.candidateFingerprint || preview.currentFingerprint !== input.currentFingerprint) {
        throw new AppError('CONFLICT', '人物种子或当前人物锚点已在预览后变化，请重新核对。', { recoverable: true })
      }
      if (preview.conflicts.length) throw new AppError('CONFLICT', preview.conflicts[0], { recoverable: true })
      const sourceRef = planningSourceRef(input.proposalId, input.candidateFingerprint)
      const anchors = current.anchors.map((anchor) => ({ ...anchor, sourceRefs: [...anchor.sourceRefs] }))
      for (const seed of normalizedPlanningSeeds(input.seeds)) {
        const existing = anchors.find((anchor) => normalizedName(anchor.name) === normalizedName(seed.name))
        if (existing) {
          existing.name = seed.name
          existing.role = seed.role
          existing.arcSeed = seed.arcSeed
          existing.sourceRefs = unique([...existing.sourceRefs, sourceRef])
        } else anchors.push({
          id: `character-${hash(normalizedName(seed.name)).slice(0, 16)}`,
          name: seed.name,
          role: seed.role,
          arcSeed: seed.arcSeed,
          sourceRefs: [sourceRef]
        })
      }
      const next = project(1, root, anchors, current.events, current.pendingConflicts)
      await this.save(root, current, next)
      return { state: structuredClone(next), anchorFingerprint: characterAnchorFingerprint(next.anchors) }
    })
  }

  async previewStableAnchor(sourceId: string, seed: PlanningCharacterSeed): Promise<PlanningCharacterSeedPreview> {
    const root = await this.projects.currentPath()
    const current = await this.read(root)
    return planningSeedPreview(sourceId, [seed], current)
  }

  async adoptStableAnchor(input: {
    sourceId: string
    seed: PlanningCharacterSeed
    candidateFingerprint: string
    currentFingerprint: string
  }): Promise<{ state: CharacterStateView; anchorFingerprint: string }> {
    const root = await this.projects.currentPath()
    return this.serializeMutation(async () => {
      const current = await this.read(root)
      const sourceRef = stableAnchorSourceRef(input.sourceId, input.candidateFingerprint)
      const normalized = normalizedPlanningSeeds([input.seed])[0]
      const existing = current.anchors.find((anchor) => normalizedName(anchor.name) === normalizedName(normalized.name))
      const alreadyApplied = Boolean(existing?.sourceRefs.includes(sourceRef)
        && existing.name === normalized.name && existing.role === normalized.role && existing.arcSeed === normalized.arcSeed)
      if (alreadyApplied) return { state: structuredClone(current), anchorFingerprint: characterAnchorFingerprint(current.anchors) }
      const preview = planningSeedPreview(input.sourceId, [normalized], current)
      if (preview.candidateFingerprint !== input.candidateFingerprint || preview.currentFingerprint !== input.currentFingerprint) {
        throw new AppError('CONFLICT', '人物候选或当前人物锚点已在预览后变化，请重新核对。', { recoverable: true })
      }
      if (preview.conflicts.length) throw new AppError('CONFLICT', preview.conflicts[0], { recoverable: true })
      const anchors = current.anchors.map((anchor) => ({ ...anchor, sourceRefs: [...anchor.sourceRefs] }))
      const target = anchors.find((anchor) => normalizedName(anchor.name) === normalizedName(normalized.name))
      if (target) {
        target.name = normalized.name
        target.role = normalized.role
        target.arcSeed = normalized.arcSeed
        target.sourceRefs = unique([...target.sourceRefs, sourceRef])
      } else anchors.push({
        id: `character-${hash(normalizedName(normalized.name)).slice(0, 16)}`,
        name: normalized.name,
        role: normalized.role,
        arcSeed: normalized.arcSeed,
        sourceRefs: [sourceRef]
      })
      const next = project(1, root, anchors, current.events, current.pendingConflicts)
      await this.save(root, current, next)
      return { state: structuredClone(next), anchorFingerprint: characterAnchorFingerprint(next.anchors) }
    })
  }

  async snapshotsBefore(chapterPosition: number): Promise<CharacterStateView['snapshots']> {
    if (!Number.isSafeInteger(chapterPosition) || chapterPosition < 1) throw invalidState()
    const root = await this.projects.currentPath()
    const current = await this.read(root)
    return project(
      1,
      root,
      current.anchors,
      current.events.filter((event) => event.active && event.chapterPosition < chapterPosition),
      []
    ).snapshots.filter((snapshot) => Boolean(snapshot.lastEventId))
  }

  async settleAcceptedProposal(input: {
    workItemId: string
    chapter: Chapter
    proposal: ChapterDraftProposal
    sources: CharacterEvidenceSource[]
  }): Promise<CharacterStateView> {
    const root = await this.projects.currentPath()
    if (root !== input.workItemId) throw new AppError('CONFLICT', '人物状态结算不属于当前书稿。', { recoverable: true })
    if (!input.proposal.report.passed || input.proposal.chapterId !== input.chapter.id) {
      throw new AppError('CONFLICT', '只有通过章契审校并由作者采用的本章候选才能结算人物状态。', { recoverable: true })
    }
    const candidate = input.proposal.content.trim()
    if (!candidate || !input.chapter.content.includes(candidate)) {
      throw new AppError('CONFLICT', '已保存正文与候选稿不一致，人物状态没有自动结算。', { recoverable: true })
    }

    return this.serializeMutation(async () => {
      const current = await this.read(root)
      const manuscriptRevision = manuscriptHash(input.chapter.content)
      const acceptedAt = new Date().toISOString()
      const relevant = uniqueSources(input.sources).filter((source) => source.names.some((name) => input.chapter.content.includes(name)))
      if (!relevant.length) return structuredClone(current)
      const anchors = [...current.anchors]
      const events = [...current.events]
      const pendingConflicts = [...current.pendingConflicts]

      const appearances = new Map<string, CharacterEvidenceSource[]>()
      for (const source of relevant) for (const name of source.names) {
        if (input.chapter.content.includes(name)) appearances.set(name, [...(appearances.get(name) || []), source])
      }
      for (const [name, characterSources] of appearances) {
        const sourceRefs = [...new Set(characterSources.map((source) => source.id))]
        const generatedId = `character-${hash(normalizedName(name)).slice(0, 16)}`
        const existingAnchor = anchors.find((item) => item.id === generatedId || normalizedName(item.name) === normalizedName(name))
        const characterId = existingAnchor?.id || generatedId
        if (existingAnchor) existingAnchor.sourceRefs = [...new Set([...existingAnchor.sourceRefs, ...sourceRefs])]
        else anchors.push({ id: characterId, name, sourceRefs })

        const dynamicChanges = evidenceBackedChanges(input.proposal.report.characterChanges, name, input.chapter.content)
        const id = `state-${hash(`${characterId}:${input.chapter.id}:${manuscriptRevision}`).slice(0, 24)}`
        const existingEvent = events.find((item) => item.id === id)
        if (existingEvent) {
          existingEvent.active = true
          existingEvent.chapterPosition = input.chapter.position
        } else {
          const reportedLocation = uniqueChangeValue(dynamicChanges, 'location')
          const location = reportedLocation || uniqueExplicitLocation(characterSources, input.chapter.content, input.proposal.contract.outlineSnapshot)
          const injury = uniqueChangeValue(dynamicChanges, 'injury')
          const relationships = changeValues(dynamicChanges, 'relationship')
          const knowledge = changeValues(dynamicChanges, 'knowledge')
          const possession = uniqueChangeValue(dynamicChanges, 'possession')
          const goal = uniqueChangeValue(dynamicChanges, 'goal')
          const power = uniqueChangeValue(dynamicChanges, 'power')
          const vitalityValue = uniqueChangeValue(dynamicChanges, 'vitality')
          const vitality = vitalityValue === '存活' ? 'alive' as const : vitalityValue === '死亡' ? 'dead' as const : undefined
          const changeEvidence = evidenceByField(dynamicChanges)
          events.push({
            id,
            characterId,
            chapterId: input.chapter.id,
            chapterPosition: input.chapter.position,
            manuscriptRevision,
            proposalId: input.proposal.id,
            acceptedAt,
            evidence: dynamicChanges[0]?.evidence || excerptAround(input.chapter.content, name),
            active: true,
            changes: {
              present: true,
              ...(location ? { location } : {}),
              ...(injury ? { injury } : {}),
              ...(relationships.length ? { relationships } : {}),
              ...(knowledge.length ? { knowledge } : {}),
              ...(possession ? { possession } : {}),
              ...(goal ? { goal } : {}),
              ...(power ? { power } : {}),
              ...(vitality ? { vitality } : {})
            },
            ...(Object.keys(changeEvidence).length ? { changeEvidence } : {})
          })
        }

        for (const conflict of evidenceBackedConflicts(input.proposal.report.characterConflicts, name, input.chapter.content)) {
          const conflictId = `conflict-${hash(`${characterId}:${input.chapter.id}:${manuscriptRevision}:${conflict.field}:${conflict.claimedValue}:${conflict.evidence}`).slice(0, 24)}`
          const anchor = anchors.find((item) => item.id === characterId)
          const anchorValue = conflict.field === 'identity' ? anchor?.role : conflict.field === 'arc' ? anchor?.arcSeed : undefined
          const existingConflict = pendingConflicts.find((item) => item.id === conflictId)
          if (existingConflict) {
            if (existingConflict.status === 'superseded') existingConflict.status = 'pending'
            existingConflict.chapterPosition = input.chapter.position
            if (anchorValue) existingConflict.anchorValue = anchorValue
          } else pendingConflicts.push({
            id: conflictId,
            characterId,
            name,
            field: conflict.field,
            claimedValue: conflict.claimedValue,
            ...(anchorValue ? { anchorValue } : {}),
            chapterId: input.chapter.id,
            chapterPosition: input.chapter.position,
            manuscriptRevision,
            proposalId: input.proposal.id,
            evidence: conflict.evidence,
            status: 'pending'
          })
        }
      }

      const next = project(1, root, anchors, events, pendingConflicts)
      await this.save(root, current, next)
      return structuredClone(next)
    })
  }

  async reconcileManuscript(chapters: Chapter[], scopedChapterIds?: number[]): Promise<CharacterStateView> {
    const root = await this.projects.currentPath()
    return this.serializeMutation(async () => {
      const current = await this.read(root)
      const revisions = new Map(chapters.map((chapter) => [chapter.id, {
        position: chapter.position,
        revision: manuscriptHash(chapter.content)
      }]))
      if (revisions.size !== chapters.length) throw invalidState()
      const scope = scopedChapterIds ? new Set(scopedChapterIds) : undefined
      if (scope && (scope.size !== (scopedChapterIds?.length || 0) || [...scope].some((id) => !Number.isSafeInteger(id) || id < 1))) throw invalidState()

      let changed = false
      const events = current.events.map((event) => {
        if (scope && !scope.has(event.chapterId)) return event
        const chapter = revisions.get(event.chapterId)
        const active = Boolean(chapter && chapter.revision === event.manuscriptRevision)
        const chapterPosition = chapter?.position ?? event.chapterPosition
        if (active !== event.active || chapterPosition !== event.chapterPosition) changed = true
        return { ...event, active, chapterPosition }
      })
      const pendingConflicts = current.pendingConflicts.map((conflict) => {
        if (scope && !scope.has(conflict.chapterId)) return conflict
        const chapter = revisions.get(conflict.chapterId)
        const status: CharacterStateConflict['status'] = conflict.status === 'dismissed'
          ? 'dismissed'
          : chapter && chapter.revision === conflict.manuscriptRevision ? 'pending' : 'superseded'
        const chapterPosition = chapter?.position ?? conflict.chapterPosition
        if (status !== conflict.status || chapterPosition !== conflict.chapterPosition) changed = true
        return { ...conflict, status, chapterPosition }
      })
      if (!changed) return structuredClone(current)
      const next = project(1, root, current.anchors, events, pendingConflicts)
      await this.save(root, current, next)
      return structuredClone(next)
    })
  }

  async dismissConflict(conflictId: string): Promise<CharacterStateView> {
    const root = await this.projects.currentPath()
    return this.serializeMutation(async () => {
      const current = await this.read(root)
      const conflict = current.pendingConflicts.find((item) => item.id === conflictId)
      if (!conflict) throw new AppError('NOT_FOUND', '这条人物冲突记录不存在。', { recoverable: true })
      if (conflict.status === 'superseded') {
        throw new AppError('CONFLICT', '对应正文已经变化，请先查看当前版本的人物冲突。', { recoverable: true })
      }
      if (conflict.status === 'dismissed') return structuredClone(current)

      const pendingConflicts = current.pendingConflicts.map((item) => item.id === conflictId
        ? { ...item, status: 'dismissed' as const }
        : item)
      const next = project(1, root, current.anchors, current.events, pendingConflicts)
      await this.save(root, current, next)
      return structuredClone(next)
    })
  }

  private async file(root: string): Promise<string> {
    return projectDirectory(root, join(root, '.webnovel', 'story-state', 'characters.json'))
  }

  private async read(root: string): Promise<CharacterStateView> {
    if (this.formalStates && await this.formalStates.active(root)) {
      if (!await this.formalStates.characterStateReady(root)) {
        const legacy = await this.readLegacy(root)
        const imported = await this.formalStates.importCharacterState(root, legacy.state, legacy.observedHash)
        if (!validStore(imported, root)) throw invalidState()
      }
      const formal = await this.formalStates.characterState(root)
      if (!validStore(formal.state, root)) throw invalidState()
      const view = project(1, root, formal.state.anchors, formal.state.events, formal.state.pendingConflicts || [])
      this.formalHashes.set(view, formal.contentHash)
      return view
    }
    return (await this.readLegacy(root)).state
  }

  private async readLegacy(root: string): Promise<{ state: CharacterStateView; observedHash?: string }> {
    let raw: string
    try { raw = await readFile(await this.file(root), 'utf8') }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { state: project(1, root, [], [], []) }
      throw error
    }
    let value: unknown
    try { value = JSON.parse(raw) }
    catch { throw invalidState() }
    if (!validStore(value, root)) throw invalidState()
    return {
      state: project(1, root, value.anchors, value.events, value.pendingConflicts || []),
      observedHash: hash(raw)
    }
  }

  private async save(root: string, current: CharacterStateView, next: CharacterStateView): Promise<void> {
    if (this.formalStates && await this.formalStates.active(root)) {
      const expectedContentHash = this.formalHashes.get(current) || hash(JSON.stringify(current))
      await this.formalStates.replaceCharacterState(root, expectedContentHash, next)
      return
    }
    await writeJson(await this.file(root), next)
  }

  private async serializeMutation<T>(mutation: () => Promise<T>): Promise<T> {
    const previous = this.mutation
    let release!: () => void
    this.mutation = new Promise<void>((resolve) => { release = resolve })
    await previous
    try { return await mutation() } finally { release() }
  }
}

function project(version: 1, workItemId: string, anchors: CharacterStateView['anchors'], events: CharacterStateEvent[], pendingConflicts: CharacterStateConflict[]): CharacterStateView {
  const normalizedEvents = events.map((event) => ({ ...event, active: event.active !== false }))
  const snapshots = anchors.map((anchor) => {
    const history = normalizedEvents.filter((event) => event.active && event.characterId === anchor.id).sort((a, b) => a.chapterPosition - b.chapterPosition || a.acceptedAt.localeCompare(b.acceptedAt))
    const latestLocation = [...history].reverse().find((event) => event.changes.location)?.changes.location
    const latestInjury = [...history].reverse().find((event) => event.changes.injury)?.changes.injury
    const relationships = unique(history.flatMap((event) => event.changes.relationships || []))
    const knowledge = unique(history.flatMap((event) => event.changes.knowledge || []))
    const latestPossession = [...history].reverse().find((event) => event.changes.possession)?.changes.possession
    const latestGoal = [...history].reverse().find((event) => event.changes.goal)?.changes.goal
    const latestPower = [...history].reverse().find((event) => event.changes.power)?.changes.power
    const latestVitality = [...history].reverse().find((event) => event.changes.vitality)?.changes.vitality
    return {
      characterId: anchor.id,
      name: anchor.name,
      throughChapter: history.at(-1)?.chapterPosition || 0,
      present: history.at(-1)?.changes.present ?? false,
      ...(latestLocation ? { location: latestLocation } : {}),
      ...(latestInjury ? { injury: latestInjury } : {}),
      ...(relationships.length ? { relationships } : {}),
      ...(knowledge.length ? { knowledge } : {}),
      ...(latestPossession ? { possession: latestPossession } : {}),
      ...(latestGoal ? { goal: latestGoal } : {}),
      ...(latestPower ? { power: latestPower } : {}),
      ...(latestVitality ? { vitality: latestVitality } : {}),
      lastEventId: history.at(-1)?.id || ''
    }
  })
  return { version, workItemId, anchors, events: normalizedEvents, snapshots, pendingConflicts }
}

function validStore(value: unknown, root: string): value is Pick<CharacterStateView, 'anchors' | 'events'> & Partial<Pick<CharacterStateView, 'pendingConflicts'>> & { version: 1; workItemId: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Partial<CharacterStateView>
  if (item.version !== 1 || item.workItemId !== root || !Array.isArray(item.anchors) || !Array.isArray(item.events)) return false
  if (item.anchors.length > 10_000 || item.events.length > 200_000 || (item.pendingConflicts?.length || 0) > 50_000) return false
  return item.anchors.every((anchor) => Boolean(anchor && typeof anchor.id === 'string' && anchor.id.length <= 200
      && typeof anchor.name === 'string' && anchor.name.length >= 1 && anchor.name.length <= 120
      && (anchor.role === undefined || (typeof anchor.role === 'string' && anchor.role.length <= 1_000))
      && (anchor.arcSeed === undefined || (typeof anchor.arcSeed === 'string' && anchor.arcSeed.length <= 5_000))
      && Array.isArray(anchor.sourceRefs) && anchor.sourceRefs.length <= 1_000
      && anchor.sourceRefs.every((ref) => typeof ref === 'string' && ref.length <= 500)))
    && item.events.every((event) => Boolean(event && typeof event.id === 'string' && typeof event.characterId === 'string'
      && Number.isInteger(event.chapterId) && Number.isInteger(event.chapterPosition) && typeof event.manuscriptRevision === 'string'
      && typeof event.proposalId === 'string' && typeof event.acceptedAt === 'string' && typeof event.evidence === 'string'
      && (event.active === undefined || typeof event.active === 'boolean')
      && event.changes && event.changes.present === true
      && (event.changes.location === undefined || typeof event.changes.location === 'string')
      && (event.changes.injury === undefined || typeof event.changes.injury === 'string')
      && (event.changes.possession === undefined || typeof event.changes.possession === 'string')
      && (event.changes.goal === undefined || typeof event.changes.goal === 'string')
      && (event.changes.power === undefined || typeof event.changes.power === 'string')
      && (event.changes.vitality === undefined || event.changes.vitality === 'alive' || event.changes.vitality === 'dead')
      && validChangeEvidence(event.changeEvidence)
      && stringList(event.changes.relationships)
      && stringList(event.changes.knowledge)))
    && (item.pendingConflicts === undefined || (Array.isArray(item.pendingConflicts) && item.pendingConflicts.every(validConflict)))
}

function validConflict(conflict: CharacterStateConflict): boolean {
  return Boolean(conflict && typeof conflict.id === 'string' && typeof conflict.characterId === 'string' && typeof conflict.name === 'string'
    && (conflict.field === 'identity' || conflict.field === 'motivation' || conflict.field === 'arc')
    && typeof conflict.claimedValue === 'string' && (conflict.anchorValue === undefined || (typeof conflict.anchorValue === 'string' && conflict.anchorValue.length <= 5_000))
    && Number.isInteger(conflict.chapterId) && Number.isInteger(conflict.chapterPosition)
    && typeof conflict.manuscriptRevision === 'string' && typeof conflict.proposalId === 'string'
    && typeof conflict.evidence === 'string' && (conflict.status === 'pending' || conflict.status === 'superseded' || conflict.status === 'dismissed'))
}

function stringList(value: unknown): boolean {
  return value === undefined || (Array.isArray(value) && value.every((item) => typeof item === 'string'))
}

function validChangeEvidence(value: unknown): boolean {
  if (value === undefined) return true
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const allowed = new Set<CharacterDynamicField>(['location', 'injury', 'relationship', 'knowledge', 'possession', 'goal', 'power', 'vitality'])
  return Object.entries(value).every(([field, evidence]) => allowed.has(field as CharacterDynamicField) && typeof evidence === 'string')
}

function uniqueSources(sources: CharacterEvidenceSource[]): CharacterEvidenceSource[] {
  const seen = new Set<string>()
  return sources.map((source) => ({
    id: source.id.trim(),
    names: [...new Set(source.names.map((name) => name.trim()).filter((name) => name.length >= 2 && name.length <= 40))],
    location: source.location.trim()
  })).filter((source) => source.id && source.names.length && !seen.has(source.id) && seen.add(source.id))
}

function excerptAround(content: string, name: string): string {
  const index = content.indexOf(name)
  const start = Math.max(0, index - 45)
  const end = Math.min(content.length, index + name.length + 75)
  return content.slice(start, end).replace(/\s+/g, ' ').trim()
}

function uniqueExplicitLocation(sources: CharacterEvidenceSource[], content: string, outline: string): string | undefined {
  const inContent = [...new Set(sources.map((source) => source.location).filter((location) => location && content.includes(location)))]
  if (inContent.length === 1) return inContent[0]
  if (inContent.length > 1) return undefined
  const inOutline = [...new Set(sources.map((source) => source.location).filter((location) => location && outline.includes(location)))]
  return inOutline.length === 1 ? inOutline[0] : undefined
}

function evidenceBackedChanges(changes: CharacterDynamicChange[] | undefined, name: string, content: string): CharacterDynamicChange[] {
  return (changes || []).filter((change) => change.character === name && change.evidence.includes(name) && content.includes(change.evidence))
}

function evidenceBackedConflicts(conflicts: CharacterStableConflict[] | undefined, name: string, content: string): CharacterStableConflict[] {
  return (conflicts || []).filter((conflict) => conflict.character === name && conflict.evidence.includes(name) && content.includes(conflict.evidence))
}

function uniqueChangeValue(changes: CharacterDynamicChange[], field: CharacterDynamicChange['field']): string | undefined {
  const values = changeValues(changes, field)
  return values.length === 1 ? values[0] : undefined
}

function changeValues(changes: CharacterDynamicChange[], field: CharacterDynamicChange['field']): string[] {
  return unique(changes.filter((change) => change.field === field).map((change) => change.value))
}

function evidenceByField(changes: CharacterDynamicChange[]): Partial<Record<CharacterDynamicField, string>> {
  const evidence: Partial<Record<CharacterDynamicField, string>> = {}
  for (const change of changes) if (!(change.field in evidence)) evidence[change.field] = change.evidence
  return evidence
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function planningSeedPreview(proposalId: string, seeds: PlanningCharacterSeed[], current: CharacterStateView): PlanningCharacterSeedPreview {
  const normalized = normalizedPlanningSeeds(seeds)
  const names = normalized.map((seed) => normalizedName(seed.name))
  const conflicts = new Set(names).size === names.length ? [] : ['人物种子中存在重名，请先修改后再建立人物锚点。']
  const actions = normalized.map((seed) => {
    const existing = current.anchors.find((anchor) => normalizedName(anchor.name) === normalizedName(seed.name))
    const action = !existing ? 'create' as const
      : existing.role === seed.role && existing.arcSeed === seed.arcSeed ? 'keep' as const
        : !existing.role && !existing.arcSeed ? 'enrich' as const : 'update' as const
    return {
      name: seed.name,
      action,
      candidate: { role: seed.role, arcSeed: seed.arcSeed },
      ...(existing ? { current: { ...(existing.role ? { role: existing.role } : {}), ...(existing.arcSeed ? { arcSeed: existing.arcSeed } : {}) } } : {})
    }
  })
  return {
    proposalId,
    candidateFingerprint: planningSeedFingerprint(normalized),
    currentFingerprint: characterAnchorFingerprint(current.anchors),
    changes: actions.some((item) => item.action !== 'keep'),
    conflicts,
    actions,
    affected: {
      existingAnchors: current.anchors.length,
      dynamicSnapshots: current.snapshots.filter((snapshot) => Boolean(snapshot.lastEventId)).length,
      pendingConflicts: current.pendingConflicts.filter((conflict) => conflict.status === 'pending').length
    }
  }
}

function normalizedPlanningSeeds(seeds: PlanningCharacterSeed[]): PlanningCharacterSeed[] {
  return seeds.map((seed) => ({ name: seed.name.trim(), role: seed.role.trim(), arcSeed: seed.arcSeed.trim() }))
}

function normalizedName(name: string): string {
  return name.trim().normalize('NFKC').toLocaleLowerCase('zh-CN')
}

function planningSeedFingerprint(seeds: PlanningCharacterSeed[]): string {
  return hash(JSON.stringify(normalizedPlanningSeeds(seeds)))
}

function characterAnchorFingerprint(anchors: CharacterStateView['anchors']): string {
  return hash(JSON.stringify([...anchors].map((anchor) => ({
    id: anchor.id,
    name: anchor.name,
    role: anchor.role || '',
    arcSeed: anchor.arcSeed || '',
    sourceRefs: [...anchor.sourceRefs].sort()
  })).sort((left, right) => left.id.localeCompare(right.id))))
}

function planningSourceRef(proposalId: string, candidateFingerprint: string): string {
  return `planning:${proposalId}:${candidateFingerprint}`
}

function stableAnchorSourceRef(sourceId: string, candidateFingerprint: string): string {
  return `continuation:${sourceId}:${candidateFingerprint}`
}

function manuscriptHash(content: string): string {
  return hash(content)
}

function invalidState(): AppError {
  return new AppError('INVALID_PROJECT_STATE', '人物状态文件已损坏；为保护作品，应用不会覆盖它。', { recoverable: false })
}
