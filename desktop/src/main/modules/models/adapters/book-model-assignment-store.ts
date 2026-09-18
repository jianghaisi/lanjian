import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { AppError } from '../../../core/errors/app-error'
import type { BookModelSnapshot } from '../domain/book-model-resolution'
import { decodeBookModelSettings, type BookModelSettings } from '../domain/book-model-settings'
import type { BookModelAssignmentCommit, BookModelAssignmentWriter, FormalBookModelAssignmentWriter } from '../domain/book-model-assignments'
import type { ModelRequestGuard } from '../domain/model-provider'
import { WORKSPACE_DATABASE_SCHEMA_VERSION } from '../../../core/ports/workspace-database'
import { WorkspaceWriteCoordinator } from '../../../core/application/workspace-write-coordinator'
import { atomicWriteText } from '../../../platform/storage/atomic-file'
import { projectTargetPath } from '../../../platform/storage/project-path'
import { modelSourceHash } from './ai-settings-read-snapshot'
import { bookModelConfigInputs } from './book-model-configs'

export class BookModelAssignmentStore implements BookModelAssignmentWriter {
  constructor(private readonly formal: FormalBookModelAssignmentWriter, private readonly writes: WorkspaceWriteCoordinator,
    private readonly publish: typeof atomicWriteText = atomicWriteText) {}

  async save(source: BookModelSnapshot, value: BookModelSettings, guard: ModelRequestGuard): Promise<BookModelAssignmentCommit> {
    const settings = decodeBookModelSettings(value)
    bookModelConfigInputs(settings)
    if (source.storage.mode === 'sqlite') {
      if (source.storage.schemaVersion !== WORKSPACE_DATABASE_SCHEMA_VERSION) throw new AppError('FEATURE_UNAVAILABLE', '请先在项目数据中核对并升级数据库，再保存模型分配；本次未执行升级。', { recoverable: true })
      return this.formal.saveBookModelAssignment(source, JSON.stringify(settings), guard)
    }
    return this.writes.run(source.bookRoot, async () => {
      await guard.recheck()
      const path = await projectTargetPath(source.bookRoot, join(source.bookRoot, '.webnovel', 'ai-settings.json'))
      await mkdir(dirname(path), { recursive: true })
      const content = JSON.stringify(settings, null, 2) + '\n'
      try { await this.publish(path, content, guard.recheck, guard.assertActive) }
      catch (error) {
        if (error instanceof AppError && ['CONFLICT', 'VALIDATION_ERROR', 'FEATURE_UNAVAILABLE', 'STORAGE_ERROR'].includes(error.code)) throw error
        throw new AppError('STORAGE_ERROR', '模型分配未能保存，请检查文件后重试；原分配已保留。', { recoverable: true })
      }
      return { content, contentHash: modelSourceHash(content), revision: null, authority: 'files', mirrorStatus: 'not-applicable' }
    })
  }
}
