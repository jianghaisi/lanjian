import { AppError } from '../../../core/errors/app-error'
import { inspectEventMigrationSources, type EventMigrationReviewPage, type EventReviewOccurrenceRef } from './event-migration-review'
import { EVENT_SNAPSHOT_MAX_ROWS, EVENT_SOURCE_KINDS, type EventSourceKind, type EventSourceSnapshot } from './event-source-snapshot'

export type EventMigrationDecision = {
  rowIndex: number
  disposition: 'retain-source' | 'keep-separate' | 'link-existing'
  targetRowIndex?: number
}
export type EventMigrationDecisionsInput = {
  fingerprint: string
  rows: EventMigrationDecision[]
  acknowledgedGroups: number[]
  acknowledgedPlanningFindings: number[]
  acknowledgedMirrors: EventSourceKind[]
}
export type EventMigrationDecisionPlan = {
  version: 1
  sourceFingerprint: string
  rows: ReadonlyArray<Readonly<{ rowIndex: number; ref: Readonly<EventReviewOccurrenceRef>;
    disposition: EventMigrationDecision['disposition']; targetRowIndex: number | null }>>
  acknowledgedGroups: readonly number[]
  acknowledgedPlanningFindings: readonly number[]
  acknowledgedMirrors: readonly EventSourceKind[]
}
export type EventMigrationInspection = ReturnType<typeof inspectEventMigrationSources>

/** Reviewed source order; a linked identity occupies its first occurrence's slot.
 * Row indices refer to the retained target, including links to a later row. */
export function eventMigrationDisplayOrder(plan: EventMigrationDecisionPlan): readonly number[] {
  const targets = new Set<number>()
  for (const row of plan.rows) {
    if (row.ref.source === 'events' || row.ref.source === 'timeline') targets.add(row.targetRowIndex ?? row.rowIndex)
  }
  return Object.freeze([...targets])
}

/** The same exact decisions are revalidated before conversion and receipt recovery. */
export function eventMigrationDecisionsInput(plan: EventMigrationDecisionPlan): EventMigrationDecisionsInput {
  return { fingerprint: plan.sourceFingerprint,
    rows: plan.rows.map(row => ({ rowIndex: row.rowIndex, disposition: row.disposition,
      ...(row.targetRowIndex === null ? {} : { targetRowIndex: row.targetRowIndex }) })),
    acknowledgedGroups: [...plan.acknowledgedGroups], acknowledgedPlanningFindings: [...plan.acknowledgedPlanningFindings],
    acknowledgedMirrors: [...plan.acknowledgedMirrors] }
}

/** Presence is deliberately stricter than a completed module pointer: never replay partial evidence. */
export function assertEventMigrationReviewable(snapshot: EventSourceSnapshot): void {
  if (!snapshot.database || snapshot.database.storageMode !== 'sqlite' || !snapshot.database.projectId) {
    throw new AppError('FEATURE_UNAVAILABLE', '请先完成作品数据库切换，再核对旧事件迁移；本次未建立数据库。', { recoverable: true })
  }
  if (snapshot.database.hasMigrationEvidence !== false) {
    throw new AppError('FEATURE_UNAVAILABLE', '作品已有迁移证据或其状态无法确认；请先核对原回执，不可重新迁移。', { recoverable: true })
  }
}

export function eventMigrationMirrorAcknowledgements(snapshot: EventSourceSnapshot): readonly EventSourceKind[] {
  return Object.freeze(EVENT_SOURCE_KINDS.filter(kind => {
    const mirror = snapshot.mirrors[kind]
    return mirror && (mirror.status !== 'synced' || snapshot.files[kind].hash !== mirror.contentHash)
  }))
}

/** Pure all-row decisions, not a token or a write plan. Canonical IDs cannot be merged away.
 * The trusted snapshot/inspection come from one private acquisition, never from IPC.
 */
export function reviewEventMigrationDecisions(snapshot: EventSourceSnapshot, input: unknown,
  retainedInspection?: EventMigrationInspection): EventMigrationDecisionPlan {
  assertEventMigrationReviewable(snapshot)
  const inspection = retainedInspection ?? inspectEventMigrationSources(snapshot)
  const request = object(input)
  exactKeys(request, ['fingerprint', 'rows', 'acknowledgedGroups', 'acknowledgedPlanningFindings', 'acknowledgedMirrors'])
  if (request.fingerprint !== snapshot.fingerprint || inspection.fingerprint !== snapshot.fingerprint) conflict('核对来源已变化，请重新预览。')
  const { summary } = inspection
  if (summary.blockedRowCount || summary.blockingGroupCount || summary.blockedReferenceCount || summary.planningBlockingCount) {
    conflict('仍有无效记录、来源或章节关联，不能确认迁移；请处理后重新核对。')
  }
  const rows = collect(inspection.rowsPage)
  const decisions = array(request.rows)
  if (decisions.length !== rows.length) invalid('每项来源都必须有且只有一个决策，不能只确认当前页。')
  const byIndex = new Map<number, EventMigrationDecision>()
  for (const item of decisions) {
    const value = object(item)
    if (value.disposition === 'link-existing') exactKeys(value, ['rowIndex', 'disposition', 'targetRowIndex'])
    else exactKeys(value, ['rowIndex', 'disposition'])
    const index = integer(value.rowIndex)
    if (index >= rows.length || byIndex.has(index)) invalid('来源决策重复或越界。')
    const source = rows[index]!.ref.source
    if (typeof value.disposition !== 'string' || (source === 'sources' ? value.disposition !== 'retain-source'
      : source === 'events' ? value.disposition !== 'keep-separate'
        : !['keep-separate', 'link-existing'].includes(value.disposition))) invalid('该来源的处理方式无效；既有正式事件身份必须保留。')
    byIndex.set(index, { rowIndex: index, disposition: value.disposition as EventMigrationDecision['disposition'],
      ...(value.disposition === 'link-existing' ? { targetRowIndex: integer(value.targetRowIndex) } : {}) })
  }
  const groups = collect(inspection.groupsPage).filter(group => group.severity === 'review').map(group => group.id)
  const findings = collect(inspection.planningFindingsPage).flatMap((finding, index) => finding.severity === 'review' ? [index] : [])
  acknowledgements(request.acknowledgedGroups, groups)
  acknowledgements(request.acknowledgedPlanningFindings, findings)
  const mirrorKinds = eventMigrationMirrorAcknowledgements(snapshot)
  const mirrors = array(request.acknowledgedMirrors)
  if (mirrors.length !== mirrorKinds.length || new Set(mirrors).size !== mirrors.length || mirrors.some(kind => !mirrorKinds.includes(kind as EventSourceKind))) {
    invalid('请逐项确认镜像缺失、待同步或外部改动提示；确认不会覆盖原文件。')
  }

  const exactDocuments = new Map<EventSourceKind, boolean>()
  const rowValue = (index: number) => {
    const ref = rows[index]!.ref
    const occurrence = snapshot.documents[ref.source].occurrences[ref.ordinal]!
    const value = object(occurrence.value)
    if (value.id !== ref.originalId || occurrence.originalId !== ref.originalId) conflict('来源身份与原始记录不一致。')
    return value
  }
  const result = rows.map(row => {
    const decision = byIndex.get(row.index)!
    rowValue(row.index)
    if (decision.disposition === 'link-existing') {
      const target = decision.targetRowIndex!
      // A direct occurrence may explicitly link to one retained direct occurrence.
      // Canonical provenance/evidence differs; no proof is inferred from four-field similarity.
      if (target === row.index || target >= rows.length || rows[target]!.ref.source !== 'timeline'
        || byIndex.get(target)?.disposition !== 'keep-separate') conflict('关联目标必须是本次核对中单独保留的旧纪事；不得跨书、循环关联或改变既有事件身份。')
      const kind = row.ref.source
      if (!exactDocuments.has(kind)) exactDocuments.set(kind, eventSourceJsonIsLossless(snapshot.documents[kind].content, snapshot.documents[kind].value))
      if (!exactDocuments.get(kind)) conflict('原始 JSON 含无法可靠比较的表示；请分别保留，不能据此合并。')
      if (!equalExceptIdentity(rowValue(row.index), rowValue(target))) conflict('关联记录的完整内容、状态、证据或扩展字段不同，请分别保留。')
    }
    return Object.freeze({ rowIndex: row.index, ref: Object.freeze({ ...row.ref }), disposition: decision.disposition,
      targetRowIndex: decision.targetRowIndex ?? null })
  })
  return Object.freeze({ version: 1, sourceFingerprint: snapshot.fingerprint, rows: Object.freeze(result),
    acknowledgedGroups: Object.freeze(groups), acknowledgedPlanningFindings: Object.freeze(findings), acknowledgedMirrors: mirrorKinds })
}

/** Private pages have already been bounded by the inspection owner. */
function collect<T>(read: (offset: number) => EventMigrationReviewPage<T>): T[] {
  const result: T[] = []
  let offset: number | null = 0
  while (offset !== null) { const page = read(offset); result.push(...page.items); offset = page.nextOffset }
  return result
}
function acknowledgements(value: unknown, expected: readonly number[]): void {
  const actual = array(value).map(integer), allowed = new Set(expected)
  if (actual.length !== expected.length || new Set(actual).size !== actual.length || actual.some(id => !allowed.has(id))) {
    invalid('重复、冲突和过期提示尚未逐项确认，或确认项已变化。')
  }
}
function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value >= EVENT_SNAPSHOT_MAX_ROWS) invalid('核对项编号无效。')
  return value
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > EVENT_SNAPSHOT_MAX_ROWS) invalid('核对决策列表无效或超限。')
  return value
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('核对决策必须是对象。')
  return value as Record<string, unknown>
}
function exactKeys(value: Record<string, unknown>, keys: string[]): void {
  if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) invalid('核对决策含缺失或未支持字段。')
}
function invalid(message: string): never { throw new AppError('VALIDATION_ERROR', message, { recoverable: true }) }
function conflict(message: string): never { throw new AppError('CONFLICT', message, { recoverable: true }) }

// Reject lossy JSON numbers, duplicate keys and unprovable encodings for linking.
// Whitespace OUTSIDE strings is immaterial. Exact raw bytes still stay in the snapshot.
// Pure decisions may still retain separate occurrences; confirmation additionally
// requires this proof for every document before preparing canonical payloads.
export function eventSourceJsonIsLossless(content: string | null, value: unknown): boolean {
  if (content === null) return false
  let compact = '', quoted = false, escaped = false
  for (const char of content) {
    if (!quoted && /[\t\r\n ]/.test(char)) continue
    compact += char
    if (escaped) escaped = false
    else if (quoted && char === '\\') escaped = true
    else if (char === '"') quoted = !quoted
  }
  try { return JSON.stringify(value) === compact } catch { return false }
}
function equalExceptIdentity(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  const pending: Array<[unknown, unknown, boolean]> = [[left, right, true]]
  while (pending.length) {
    const [a, b, root] = pending.pop()!
    if (Object.is(a, b)) continue
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false
    const keys = Object.keys(a).filter(key => !root || key !== 'id')
    if (keys.length !== Object.keys(b).filter(key => !root || key !== 'id').length) return false
    for (const key of keys) {
      if (!Object.hasOwn(b, key)) return false
      pending.push([(a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], false])
    }
  }
  return true
}
