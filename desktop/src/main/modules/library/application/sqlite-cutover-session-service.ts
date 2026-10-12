import { randomUUID } from 'node:crypto'
import { AppError } from '../../../core/errors/app-error'
import type { LegacyWorkspaceSource, ShadowImportPreview, WorkspaceDatabaseFactory } from '../../../core/ports/workspace-database'
import type { SqliteStorageActivationPreview, SqliteStorageStatus } from '../../../../contracts/index'
import type { ShadowImportService } from './shadow-import-service'
import type { SqliteManuscriptService } from '../../manuscript/application/sqlite-manuscript-service'

type PendingActivation = { workItemId: string; preview: ShadowImportPreview; expiresAtMs: number }
const previewTtlMs = 15 * 60 * 1_000

export class SqliteCutoverSessionService {
  private readonly pending = new Map<string, PendingActivation>()

  constructor(
    private readonly source: LegacyWorkspaceSource,
    private readonly importer: Pick<ShadowImportService, 'preview' | 'import'>,
    private readonly databases: WorkspaceDatabaseFactory,
    private readonly manuscripts: SqliteManuscriptService,
    private readonly currentWorkItem: () => Promise<string>,
    private readonly now: () => number = () => Date.now(),
    private readonly id: () => string = () => randomUUID()
  ) {}

  async status(): Promise<SqliteStorageStatus> {
    const workItemId = await this.currentWorkItem()
    const database = await this.databases.openExisting(workItemId)
    if (!database) return { storageMode: 'files', databaseExists: false, chapterCount: 0, outlineCount: 0, outlineStorageMode: 'files', promptStorageMode: 'files', promptMirrorStatus: null, outlinePendingMirrors: 0, outlineConflictMirrors: 0, outlineFailedMirrors: 0, pendingMirrors: 0, conflictMirrors: 0, failedMirrors: 0 }
    try {
      const mode = database.storageMode()
      if (mode === 'sqlite') {
        const chapters = await (database.formalChaptersAsync?.() ?? database.formalChapters())
        const outlines = database.formalOutlineReady() ? await (database.formalOutlinesAsync?.() ?? database.formalOutlines()) : []
        const fileText = database.textAuthority() === 'files-v1'
        const pending = database.pendingMirrorPlans(fileText ? { excludeSourceTypes: ['chapter_markdown', 'outline_markdown'] } : undefined)
        const promptMirror = database.formalPromptReady() ? database.formalPromptMirror() : null
        const conflicts = [...chapters, ...outlines].filter((item) => item.mirrorStatus === 'conflict').length + (promptMirror?.status === 'conflict' ? 1 : 0)
        const failed = [...chapters, ...outlines].filter((item) => item.mirrorStatus === 'failed').length + (promptMirror?.status === 'failed' ? 1 : 0)
        const outlinePending = outlines.filter((outline) => outline.mirrorStatus === 'pending').length
        const outlineConflicts = outlines.filter((outline) => outline.mirrorStatus === 'conflict').length
        const outlineFailed = outlines.filter((outline) => outline.mirrorStatus === 'failed').length
        return {
          storageMode: 'sqlite', textAuthority: database.textAuthority(), databaseExists: true, chapterCount: chapters.length,
          outlineCount: outlines.length, outlineStorageMode: database.formalOutlineReady() ? 'sqlite' : 'files',
          promptStorageMode: database.formalPromptReady() ? 'sqlite' : 'files', promptMirrorStatus: promptMirror?.status ?? null,
          outlinePendingMirrors: outlinePending, outlineConflictMirrors: outlineConflicts, outlineFailedMirrors: outlineFailed,
          pendingMirrors: Math.max(0, pending.length - conflicts - failed),
          conflictMirrors: conflicts,
          failedMirrors: failed
        }
      }
      const inspection = database.inspect()
      return { storageMode: 'shadow', databaseExists: true, chapterCount: inspection.chapters.filter((chapter) => chapter.status !== 'archived').length, outlineCount: 0, outlineStorageMode: 'files', promptStorageMode: 'files', promptMirrorStatus: null, outlinePendingMirrors: 0, outlineConflictMirrors: 0, outlineFailedMirrors: 0, pendingMirrors: 0, conflictMirrors: 0, failedMirrors: 0 }
    } finally {
      database.close()
    }
  }

  async preview(): Promise<SqliteStorageActivationPreview> {
    this.removeExpired()
    const workItemId = await this.currentWorkItem()
    const status = await this.status()
    if (status.storageMode === 'sqlite') return { token: null, canActivate: false, chapterCount: status.chapterCount, totalWords: 0, expiresAt: null, blockers: [{ code: 'ALREADY_ACTIVE', message: '当前作品已经由 SQLite 正式保存。' }] }
    if (!status.databaseExists) return { token: null, canActivate: false, chapterCount: 0, totalWords: 0, expiresAt: null, blockers: [{ code: 'SHADOW_REQUIRED', message: '请先建立并校验 SQLite 影子副本。' }] }
    const preview = await this.importer.preview()
    if (await this.currentWorkItem() !== workItemId) throw this.conflict('核对期间作品已经切换，请重新检查。')
    if (preview.blockers.length) return { token: null, canActivate: false, chapterCount: preview.chapterCount, totalWords: preview.totalWords, expiresAt: null, blockers: preview.blockers }
    const token = this.id()
    const expiresAtMs = this.now() + previewTtlMs
    this.pending.clear()
    this.pending.set(token, { workItemId, preview, expiresAtMs })
    return { token, canActivate: true, chapterCount: preview.chapterCount, totalWords: preview.totalWords, expiresAt: new Date(expiresAtMs).toISOString(), blockers: [] }
  }

  async commit(token: string) {
    const pending = this.pending.get(token)
    this.pending.delete(token)
    if (!pending || pending.expiresAtMs <= this.now()) throw this.conflict('这次正式切换核对已经失效，请重新核对。')
    if (await this.currentWorkItem() !== pending.workItemId) throw this.conflict('当前作品已经切换，已拒绝使用上一部作品的核对凭证。')
    await this.importer.import(pending.preview)
    const snapshot = await this.source.snapshot()
    if (snapshot.sourceFingerprint !== pending.preview.sourceFingerprint) throw this.conflict('核对后书稿发生了变化，请重新检查；正式数据源没有切换。')
    return this.manuscripts.activate(pending.workItemId, snapshot)
  }

  clear(): void { this.pending.clear() }

  private removeExpired(): void {
    const now = this.now()
    for (const [token, item] of this.pending) if (item.expiresAtMs <= now) this.pending.delete(token)
  }

  private conflict(message: string): AppError {
    return new AppError('CONFLICT', message, { recoverable: true, details: { area: 'workspaceDatabase' } })
  }
}
