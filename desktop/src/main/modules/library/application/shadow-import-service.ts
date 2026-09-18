import { AppError } from '../../../core/errors/app-error'
import {
  WORKSPACE_DATABASE_RELATIVE_PATH,
  type LegacyWorkspaceSource,
  type ShadowImportPreview,
  type ShadowImportResult,
  type WorkspaceDatabaseFactory
} from '../../../core/ports/workspace-database'
import { WorkspaceWriteCoordinator } from '../../../core/application/workspace-write-coordinator'

export class ShadowImportService {
  private mutation: Promise<void> = Promise.resolve()

  constructor(
    private readonly source: LegacyWorkspaceSource,
    private readonly databases: WorkspaceDatabaseFactory,
    private readonly writes: WorkspaceWriteCoordinator = new WorkspaceWriteCoordinator()
  ) {}

  async preview(): Promise<ShadowImportPreview> {
    try {
      const snapshot = await this.source.snapshot()
      return {
        targetRelativePath: WORKSPACE_DATABASE_RELATIVE_PATH,
        sourceFingerprint: snapshot.sourceFingerprint,
        chapterCount: snapshot.chapters.length,
        totalWords: snapshot.totalWords,
        blockers: []
      }
    } catch (error) {
      if (!(error instanceof AppError) || !['CONFLICT', 'INVALID_PROJECT_STATE', 'PATH_ESCAPE', 'UNSUPPORTED_PROJECT_VERSION'].includes(error.code)) throw error
      return {
        targetRelativePath: WORKSPACE_DATABASE_RELATIVE_PATH,
        sourceFingerprint: '',
        chapterCount: 0,
        totalWords: 0,
        blockers: [{ code: error.code, message: error.message }]
      }
    }
  }

  async import(preview: ShadowImportPreview): Promise<ShadowImportResult> {
    if (preview.targetRelativePath !== WORKSPACE_DATABASE_RELATIVE_PATH || preview.blockers.length || !/^[0-9a-f]{64}$/.test(preview.sourceFingerprint)) {
      throw new AppError('CONFLICT', '影子导入预检没有通过，未创建数据库。', { recoverable: true })
    }
    return this.serialize(async () => {
      const snapshot = await this.source.snapshot()
      if (snapshot.sourceFingerprint !== preview.sourceFingerprint
        || snapshot.chapters.length !== preview.chapterCount
        || snapshot.totalWords !== preview.totalWords) {
        throw new AppError('CONFLICT', '预检后书稿发生了变化，请重新检查后再导入；原稿没有改动。', { recoverable: true })
      }
      return this.writes.run(snapshot.workItemId, async () => {
        const database = await this.databases.open(snapshot.workItemId)
        try {
          const result = database.importSnapshot(snapshot)
          database.verifySnapshot(snapshot)
          return result
        } finally {
          database.close()
        }
      })
    })
  }

  private async serialize<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.mutation
    let release!: () => void
    this.mutation = new Promise<void>((resolve) => { release = resolve })
    await previous
    try {
      return await operation()
    } finally {
      release()
    }
  }
}
