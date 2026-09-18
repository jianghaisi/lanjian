import { randomUUID } from 'node:crypto'
import { AppError } from '../../../core/errors/app-error'
import type { ShadowImportPreview } from '../../../core/ports/workspace-database'
import type { SqliteShadowMigrationPreview, SqliteShadowMigrationResult } from '../../../../contracts/index'
import type { ShadowImportService } from './shadow-import-service'

type ShadowImporter = Pick<ShadowImportService, 'preview' | 'import'>
type PendingPreview = {
  workItemId: string
  preview: ShadowImportPreview
  expiresAtMs: number
}

const previewTtlMs = 15 * 60 * 1_000
const maxPendingPreviews = 3

export class ShadowMigrationSessionService {
  private readonly pending = new Map<string, PendingPreview>()

  constructor(
    private readonly importer: ShadowImporter,
    private readonly currentWorkItem: () => Promise<string>,
    private readonly now: () => number = () => Date.now(),
    private readonly id: () => string = () => randomUUID()
  ) {}

  async preview(): Promise<SqliteShadowMigrationPreview> {
    this.removeExpired()
    const workItemId = await this.currentWorkItem()
    const preview = await this.importer.preview()
    if (await this.currentWorkItem() !== workItemId) {
      throw this.conflict('核对期间作品已经切换，请重新打开项目数据页。')
    }
    if (preview.blockers.length) return this.publicPreview(preview, null, null)

    while (this.pending.size >= maxPendingPreviews) {
      const oldest = this.pending.keys().next().value
      if (typeof oldest !== 'string') break
      this.pending.delete(oldest)
    }
    const token = this.id()
    const expiresAtMs = this.now() + previewTtlMs
    this.pending.set(token, { workItemId, preview, expiresAtMs })
    return this.publicPreview(preview, token, expiresAtMs)
  }

  async commit(token: string): Promise<SqliteShadowMigrationResult> {
    const pending = this.pending.get(token)
    this.pending.delete(token)
    if (!pending) throw this.conflict('这次迁移核对已经失效，请重新核对后再建立数据库。')
    if (pending.expiresAtMs <= this.now()) throw this.conflict('这次迁移核对已经过期，请重新核对后再建立数据库。')
    if (await this.currentWorkItem() !== pending.workItemId) {
      throw this.conflict('当前作品已经切换，已拒绝使用上一部作品的迁移核对。')
    }
    const result = await this.importer.import(pending.preview)
    return {
      targetRelativePath: pending.preview.targetRelativePath,
      storageMode: 'shadow',
      sourceFilesChanged: false,
      chapterCount: result.chapterCount,
      insertedVersions: result.insertedVersions,
      unchangedVersions: result.unchangedVersions,
      verified: result.verified
    }
  }

  clear(): void {
    this.pending.clear()
  }

  private publicPreview(preview: ShadowImportPreview, token: string | null, expiresAtMs: number | null): SqliteShadowMigrationPreview {
    return {
      token,
      targetRelativePath: preview.targetRelativePath,
      canImport: Boolean(token) && preview.blockers.length === 0,
      chapterCount: preview.chapterCount,
      totalWords: preview.totalWords,
      expiresAt: expiresAtMs === null ? null : new Date(expiresAtMs).toISOString(),
      blockers: preview.blockers
    }
  }

  private removeExpired(): void {
    const now = this.now()
    for (const [token, preview] of this.pending) {
      if (preview.expiresAtMs <= now) this.pending.delete(token)
    }
  }

  private conflict(message: string): AppError {
    return new AppError('CONFLICT', message, { recoverable: true, details: { area: 'workspaceDatabase' } })
  }
}
