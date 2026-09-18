export const MANUSCRIPT_RECOVERY_STORAGE_KEY = 'lanjian.manuscript-recovery.v1'
export const PLANNED_OUTLINE_RECOVERY_STORAGE_KEY = 'lanjian.planned-outline-recovery.v1'

export type ManuscriptRecoveryStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export type ManuscriptRecoveryDraft = Readonly<{
  version: 1
  workItemId: string
  chapterId: number
  title: string
  content: string
  baseRevision: string | null
  operationId: string
  updatedAt: string
}>

export type ManuscriptRecoveryDraftInput = {
  workItemId: string
  chapterId: number
  title: string
  content: string
  baseRevision?: string | null
  operationId?: string
}

export type ActiveManuscriptDraft = Readonly<{
  chapterId: number | null
  title: string
  content: string
}>

// The crash-safety snapshot for the text currently held by the editor is not
// an interrupted draft. It must stay persisted, but it must not open a modal
// and steal focus while the author is still typing.
export function recoveryDraftMatchesActiveEditor(
  draft: Pick<ManuscriptRecoveryDraft, 'chapterId' | 'title' | 'content'>,
  active: ActiveManuscriptDraft
): boolean {
  return active.chapterId !== null
    && draft.chapterId === active.chapterId
    && draft.title === active.title
    && draft.content === active.content
}

export type ManuscriptRecoveryStore = {
  write(input: ManuscriptRecoveryDraftInput): ManuscriptRecoveryDraft
  read(workItemId: string, chapterId: number): ManuscriptRecoveryDraft | null
  list(workItemId: string): ManuscriptRecoveryDraft[]
  discard(workItemId: string, chapterId: number): boolean
  clearIfSnapshotMatches(snapshot: ManuscriptRecoveryDraft): boolean
}

type PersistedRecoveryDrafts = {
  version: 1
  drafts: ManuscriptRecoveryDraft[]
}

type StoreOptions = {
  now?: () => Date
  operationId?: () => string
  kind?: 'manuscript' | 'planned-outline'
}

export function createManuscriptRecoveryStore(
  storage: ManuscriptRecoveryStorage,
  options: StoreOptions = {}
): ManuscriptRecoveryStore {
  const now = options.now ?? (() => new Date())
  const operationId = options.operationId ?? defaultOperationId
  const strict = options.kind === 'planned-outline'
  const storageKey = strict ? PLANNED_OUTLINE_RECOVERY_STORAGE_KEY : MANUSCRIPT_RECOVERY_STORAGE_KEY

  const readAll = (): ManuscriptRecoveryDraft[] => {
    let raw: string | null
    try { raw = storage.getItem(storageKey) } catch {
      if (strict) throw new Error('无法读取章纲恢复草稿，已停止改写恢复数据。请保留当前编辑内容后重试。')
      return []
    }
    if (raw === null || (!strict && !raw)) return []

    try {
      const value = JSON.parse(raw) as unknown
      if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.drafts)) {
        if (strict) throw new Error('invalid recovery structure')
        return []
      }
      const drafts = value.drafts.filter(isRecoveryDraft)
      if (strict && drafts.length !== value.drafts.length) throw new Error('invalid recovery entry')
      const latestByChapter = new Map<string, ManuscriptRecoveryDraft>()
      for (const draft of drafts) {
        const key = chapterKey(draft.workItemId, draft.chapterId)
        const current = latestByChapter.get(key)
        if (strict && current) throw new Error('duplicate recovery identity')
        if (!current || Date.parse(draft.updatedAt) > Date.parse(current.updatedAt)) latestByChapter.set(key, draft)
      }
      return [...latestByChapter.values()]
    } catch {
      if (strict) throw new Error('章纲恢复数据损坏，原始数据已保留，未自动覆盖。请先保留当前编辑内容。')
      return []
    }
  }

  const persist = (drafts: ManuscriptRecoveryDraft[]): void => {
    try {
      if (!drafts.length) {
        storage.removeItem(storageKey)
        return
      }
      const value: PersistedRecoveryDrafts = { version: 1, drafts }
      storage.setItem(storageKey, JSON.stringify(value))
    } catch (error) {
      if (strict) throw new Error('章纲恢复草稿未能写入或清理，可能是本地存储空间不足。请先保存正式章纲或复制当前内容。')
      throw error
    }
  }

  const read = (workItemId: string, chapterId: number): ManuscriptRecoveryDraft | null => (
    readAll().find((draft) => sameChapter(draft, workItemId, chapterId)) ?? null
  )

  return {
    write(input) {
      assertDraftInput(input)
      const draft: ManuscriptRecoveryDraft = {
        version: 1,
        workItemId: input.workItemId,
        chapterId: input.chapterId,
        title: input.title,
        content: input.content,
        baseRevision: input.baseRevision ?? null,
        operationId: input.operationId ?? operationId(),
        updatedAt: now().toISOString()
      }
      if (!isRecoveryDraft(draft)) throw new TypeError('恢复草稿快照无效')
      const remaining = readAll().filter((item) => !sameChapter(item, draft.workItemId, draft.chapterId))
      persist([...remaining, draft])
      return draft
    },
    read,
    list(workItemId) {
      if (!validIdentity(workItemId)) return []
      return readAll()
        .filter((draft) => draft.workItemId === workItemId)
        .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    },
    discard(workItemId, chapterId) {
      if (!validIdentity(workItemId) || !validChapterId(chapterId)) return false
      const drafts = readAll()
      const remaining = drafts.filter((draft) => !sameChapter(draft, workItemId, chapterId))
      if (remaining.length === drafts.length) return false
      persist(remaining)
      return true
    },
    clearIfSnapshotMatches(snapshot) {
      if (!isRecoveryDraft(snapshot)) return false
      const drafts = readAll()
      const stored = drafts.find((draft) => sameChapter(draft, snapshot.workItemId, snapshot.chapterId))
      if (!stored || !sameSnapshot(stored, snapshot)) return false
      persist(drafts.filter((draft) => !sameChapter(draft, snapshot.workItemId, snapshot.chapterId)))
      return true
    }
  }
}

function assertDraftInput(input: ManuscriptRecoveryDraftInput): void {
  if (!validIdentity(input.workItemId)) throw new TypeError('作品身份无效')
  if (!validChapterId(input.chapterId)) throw new TypeError('章节身份无效')
  if (typeof input.title !== 'string') throw new TypeError('章节标题无效')
  if (typeof input.content !== 'string') throw new TypeError('章节正文无效')
  if (input.baseRevision !== undefined && input.baseRevision !== null && !validRevision(input.baseRevision)) {
    throw new TypeError('正文基线无效')
  }
  if (input.operationId !== undefined && !validOperationId(input.operationId)) throw new TypeError('草稿操作编号无效')
}

function isRecoveryDraft(value: unknown): value is ManuscriptRecoveryDraft {
  return isRecord(value)
    && value.version === 1
    && validIdentity(value.workItemId)
    && validChapterId(value.chapterId)
    && typeof value.title === 'string'
    && typeof value.content === 'string'
    && (value.baseRevision === null || validRevision(value.baseRevision))
    && validOperationId(value.operationId)
    && typeof value.updatedAt === 'string'
    && Number.isFinite(Date.parse(value.updatedAt))
}

function sameChapter(draft: ManuscriptRecoveryDraft, workItemId: string, chapterId: number): boolean {
  return draft.workItemId === workItemId && draft.chapterId === chapterId
}

function sameSnapshot(left: ManuscriptRecoveryDraft, right: ManuscriptRecoveryDraft): boolean {
  return left.version === right.version
    && left.workItemId === right.workItemId
    && left.chapterId === right.chapterId
    && left.title === right.title
    && left.content === right.content
    && left.baseRevision === right.baseRevision
    && left.operationId === right.operationId
    && left.updatedAt === right.updatedAt
}

function chapterKey(workItemId: string, chapterId: number): string {
  return JSON.stringify([workItemId, chapterId])
}

function validIdentity(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 8_192
}

function validChapterId(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0
}

function validRevision(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value)
}

function validOperationId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 256
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function defaultOperationId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}
