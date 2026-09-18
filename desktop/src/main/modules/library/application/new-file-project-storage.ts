import { lstat, open, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { AppError } from '../../../core/errors/app-error'
import type { LegacyWorkspaceSnapshot, WorkspaceDatabaseFactory } from '../../../core/ports/workspace-database'
import { canonicalDirectory, projectExistingPath, projectTargetPath } from '../../../platform/storage/project-path'
import { sameModelFileIdentity, type ModelFileIdentity } from '../../models/adapters/model-connection-file'
import { textHash } from '../../manuscript/adapters/manuscript-file-store'

/** Only ProjectCreation's private newly-allocated-directory receipt calls this.
 * Import/open never uses it. Partial retry requires the exact DB inode we created. */
export class NewFileProjectStorage {
  private readonly owned = new Map<string, ModelFileIdentity>()
  constructor(private readonly databases: WorkspaceDatabaseFactory) {}

  async initialize(rootValue: string): Promise<void> {
    const root = await canonicalDirectory(rootValue)
    for (const name of ['正文', '大纲']) if ((await readdir(await projectExistingPath(root, join(root, name)))).length) {
      throw new AppError('CONFLICT', '新作品目录已出现稿件，未以空白作品覆盖它。', { recoverable: true })
    }
    const manifest = await readFile(await projectExistingPath(root, join(root, '.webnovel/state.json')), 'utf8')
    const state = JSON.parse(manifest) as { project_info?: { title?: string } }
    const title = state.project_info?.title
    if (typeof title !== 'string' || !title.trim()) throw new AppError('INVALID_PROJECT_STATE', '新作品清单缺少书名。', { recoverable: true })
    const profile = JSON.parse(await readFile(await projectExistingPath(root, join(root, '.webnovel/config/book-profile.json')), 'utf8')) as { genre?: string; targetWordsPerChapter?: number }
    const path = await projectTargetPath(root, join(root, '.webnovel/workspace.sqlite'))
    if (!this.owned.has(root)) {
      const handle = await open(path, 'wx')
      try { this.owned.set(root, await handle.stat({ bigint: true })) } finally { await handle.close() }
    }
    const identity = await lstat(await projectExistingPath(root, path), { bigint: true })
    if (!identity.isFile() || identity.isSymbolicLink() || !sameModelFileIdentity(identity, this.owned.get(root)!)) {
      throw new AppError('CONFLICT', '新作品数据库已被替换，未继续初始化。', { recoverable: true })
    }
    const order = JSON.stringify({ version: 1, chapterIds: [] }) + '\n'
    const snapshot: LegacyWorkspaceSnapshot = { workItemId: root, projectName: title,
      projectManifestHash: textHash(manifest), sourceFingerprint: textHash(manifest + '\0' + root),
      chapters: [], outlines: [], totalWords: 0,
      chapterOrderMirror: { relativePath: '.webnovel/manuscript/chapter-order.json', content: order, contentHash: textHash(order), observedHash: null },
      promptProfile: { version: 1, workItemId: root, genreFingerprint: '', overrides: {}, updatedAt: '', mirror: null } }
    const db = await this.databases.openExisting(root)
    if (!db) throw new AppError('STORAGE_ERROR', '新作品数据库尚未建立。', { recoverable: true })
    try {
      if (!db.storageMode()) db.importSnapshot(snapshot)
      if (db.storageMode() === 'shadow') db.activateSqlite(snapshot)
      if (db.textAuthority() !== 'files-v1') {
        db.updateProjectWritingConfig({ genreText: profile.genre ?? '', chapterTargetWords: profile.targetWordsPerChapter ?? null })
        db.activateEmptyFileTextAuthority()
      }
    } finally { db.close() }
    this.owned.delete(root)
  }
}
