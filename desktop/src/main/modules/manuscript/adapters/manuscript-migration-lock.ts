import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { AppError } from '../../../core/errors/app-error'
import { projectExistingPathSync, projectTargetPathSync } from '../../../platform/storage/project-path'

export const manuscriptMigrationMarker = '.webnovel/recovery/text-authority-migration.json'

/** A mode switch is explicit and resumable, never repaired by an ordinary open. */
export function assertNoManuscriptMigration(root: string): void {
  const path = projectTargetPathSync(root, join(root, manuscriptMigrationMarker))
  if (!existsSync(path)) return
  projectExistingPathSync(root, path)
  throw new AppError('CONFLICT', '这部作品的正文迁移尚未完成，请继续原迁移。原稿与迁移备份均保留，不要重复导入。', { recoverable: true })
}
