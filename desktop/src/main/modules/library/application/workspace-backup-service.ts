import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, mkdir, readFile, readdir, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { AppError } from '../../../core/errors/app-error'
import {
  WORKSPACE_BACKUP_MANIFEST,
  WORKSPACE_BACKUP_VERSION,
  type WorkspaceBackupFile,
  type WorkspaceBackupManifest,
  type WorkspaceBackupResult,
  type WorkspaceRestorePreview,
  type WorkspaceRestoreResult
} from '../domain/workspace-backup'
import { WORKSPACE_DATABASE_RELATIVE_PATH, WORKSPACE_DATABASE_SCHEMA_VERSION, type WorkspaceDatabaseFactory } from '../../../core/ports/workspace-database'
import { atomicWriteText } from '../../../platform/storage/atomic-file'
import { canonicalDirectory, projectDirectory, projectExistingPath, projectTargetPath } from '../../../platform/storage/project-path'
import { WorkspaceWriteCoordinator } from '../../../core/application/workspace-write-coordinator'

type PendingRestore = { workItemId: string; backupRoot: string; manifest: WorkspaceBackupManifest; fingerprint: string; expiresAtMs: number }
const restorePreviewTtlMs = 15 * 60 * 1_000
const maxManifestBytes = 20 * 1024 * 1024
const maxBackupFiles = 100_000
const maxBackupFileBytes = 10 * 1024 * 1024 * 1024
const maxBackupTotalBytes = 100 * 1024 * 1024 * 1024

export class WorkspaceBackupService {
  private readonly pendingRestores = new Map<string, PendingRestore>()
  private mutation: Promise<void> = Promise.resolve()

  constructor(
    private readonly databases: WorkspaceDatabaseFactory,
    private readonly currentWorkItem: () => Promise<string>,
    private readonly currentProjectName: () => Promise<string>,
    private readonly appVersion: () => string,
    private readonly now: () => Date = () => new Date(),
    private readonly id: () => string = () => randomUUID(),
    private readonly writes: WorkspaceWriteCoordinator = new WorkspaceWriteCoordinator()
  ) {}

  async create(targetParentPath: string): Promise<WorkspaceBackupResult> {
    return this.serialize(async () => {
      const workItemId = await this.currentWorkItem()
      return this.writes.run(workItemId, () => this.createNow(workItemId, targetParentPath, 'manual'))
    })
  }

  async createAutomatic(targetParentPath: string, retentionCount: number): Promise<WorkspaceBackupResult & { prunedCount: number }> {
    return this.serialize(async () => {
      const workItemId = await this.currentWorkItem()
      const result = await this.writes.run(workItemId, () => this.createNow(workItemId, targetParentPath, 'automatic'))
      const prunedCount = await this.pruneAutomatic(targetParentPath, result.projectName, retentionCount)
      return { ...result, prunedCount }
    })
  }

  async changeFingerprint(): Promise<string> {
    const root = await this.currentWorkItem()
    const entries: string[] = []
    await walk(root, '', async (relativePath, path) => {
      const detail = await stat(path)
      entries.push(`${relativePath}\u0000${detail.size}\u0000${detail.mtimeMs}`)
    })
    return hashText(entries.sort((left, right) => left.localeCompare(right, 'zh-CN')).join('\n'))
  }

  async validateTargetParent(targetParentPath: string): Promise<string> {
    const workItemId = await this.currentWorkItem()
    const targetParent = await canonicalDirectory(targetParentPath)
    assertNotInside(workItemId, targetParent, '备份位置不能位于当前作品内部。')
    return targetParent
  }

  private async createNow(workItemId: string, targetParentPath: string, trigger: 'manual' | 'automatic'): Promise<WorkspaceBackupResult> {
    const projectName = await this.currentProjectName()
    const targetParent = await canonicalDirectory(targetParentPath)
    assertNotInside(workItemId, targetParent, '备份位置不能位于当前作品内部。')
    const createdAt = this.now().toISOString()
    const stamp = createdAt.replace(/[:.]/g, '-').replace('T', '-').replace('Z', '')
    const backupName = `${safeSegment(projectName)}-岚笺${trigger === 'automatic' ? '自动' : ''}备份-${stamp}`
    const finalRoot = await projectTargetPath(targetParent, join(targetParent, backupName))
    const stagingRoot = await projectTargetPath(targetParent, join(targetParent, `.lanjian-backup-staging-${this.id()}`))
    await assertMissing(finalRoot, '同名备份已经存在，请稍后重试。')
    await assertMissing(stagingRoot, '备份暂存目录冲突，请稍后重试。')
    assertSeparateTrees(workItemId, finalRoot, '备份目录不能与当前作品重叠。')
    const database = await this.databases.openExisting(workItemId)
    if (!database) throw new AppError('NOT_FOUND', '当前作品还没有可备份的 SQLite 数据库。请先建立影子副本。', { recoverable: true })

    try {
      const sourceFilesBefore = await scanProjectFiles(workItemId)
      await mkdir(stagingRoot, { recursive: false })
      await copySnapshot(workItemId, stagingRoot, sourceFilesBefore)
      const inspection = database.inspect()
      const storageMode = database.storageMode()
      if (!storageMode) throw new AppError('DATABASE_INTEGRITY_FAILED', '作品数据库缺少存储模式。', { recoverable: false })
      const databaseTarget = await projectTargetPath(stagingRoot, join(stagingRoot, ...WORKSPACE_DATABASE_RELATIVE_PATH.split('/')))
      await mkdir(dirname(databaseTarget), { recursive: true })
      database.backupTo(databaseTarget)
      database.close()

      const sourceFilesAfter = await scanProjectFiles(workItemId)
      assertSameSnapshot(sourceFilesBefore, sourceFilesAfter, '备份期间作品文件发生变化，已取消本次备份。')
      const databaseFile: WorkspaceBackupFile = {
        relativePath: WORKSPACE_DATABASE_RELATIVE_PATH,
        size: (await stat(databaseTarget)).size,
        sha256: await fileHash(databaseTarget),
        kind: 'sqlite'
      }
      const databaseCheck = inspectBackupDatabase(databaseTarget)
      const activeChapterCount = inspection.chapters.filter((chapter) => chapter.status !== 'archived').length
      if (databaseCheck.schemaVersion !== inspection.schemaVersion || databaseCheck.chapterCount !== activeChapterCount) {
        throw new AppError('DATABASE_INTEGRITY_FAILED', '备份数据库与当前作品核对不一致。', { recoverable: false })
      }
      const files = [...sourceFilesBefore, databaseFile].sort((left, right) => left.relativePath.localeCompare(right.relativePath, 'zh-CN'))
      const manifest: WorkspaceBackupManifest = {
        version: WORKSPACE_BACKUP_VERSION,
        createdAt,
        appVersion: this.appVersion(),
        projectName,
        storageMode,
        databaseSchemaVersion: inspection.schemaVersion,
        chapterCount: activeChapterCount,
        bodyVersionCount: inspection.chapters.reduce((sum, chapter) => sum + chapter.versionCount, 0),
        trigger,
        files
      }
      await atomicWriteText(join(stagingRoot, WORKSPACE_BACKUP_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`)
      await verifyBackupDirectory(stagingRoot, manifest)
      const sourceFilesFinal = await scanProjectFiles(workItemId)
      assertSameSnapshot(sourceFilesBefore, sourceFilesFinal, '备份完成核对前作品文件再次发生变化，已取消本次备份。')
      await rename(stagingRoot, finalRoot)
      return {
        backupPath: finalRoot, backupName, createdAt, projectName, storageMode,
        chapterCount: manifest.chapterCount, fileCount: files.length, verified: true
      }
    } catch (error) {
      try { database.close() } catch { /* already closed or failed */ }
      await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined)
      throw error
    }
  }

  async previewRestore(backupPath: string): Promise<WorkspaceRestorePreview> {
    this.removeExpired()
    const workItemId = await this.currentWorkItem()
    try {
      const backupRoot = await canonicalDirectory(backupPath)
      assertSeparateTrees(workItemId, backupRoot, '不能把当前作品文件夹当作备份恢复。')
      const manifest = await readManifest(backupRoot)
      await verifyBackupDirectory(backupRoot, manifest)
      const token = this.id()
      const expiresAtMs = this.now().getTime() + restorePreviewTtlMs
      this.pendingRestores.clear()
      this.pendingRestores.set(token, { workItemId, backupRoot, manifest, fingerprint: manifestFingerprint(manifest), expiresAtMs })
      return publicRestorePreview(manifest, token, expiresAtMs)
    } catch (error) {
      const blocker = error instanceof AppError ? error : invalidBackup('无法读取或校验这个备份；备份内容没有改动。')
      return {
        token: null, canRestore: false, projectName: '', createdAt: null, appVersion: '', storageMode: null,
        chapterCount: 0, fileCount: 0, expiresAt: null, blockers: [{ code: blocker.code, message: blocker.message }]
      }
    }
  }

  async restore(token: string, targetParentPath: string): Promise<WorkspaceRestoreResult> {
    return this.serialize(() => this.restoreNow(token, targetParentPath))
  }

  private async restoreNow(token: string, targetParentPath: string): Promise<WorkspaceRestoreResult> {
    const pending = this.pendingRestores.get(token)
    this.pendingRestores.delete(token)
    if (!pending || pending.expiresAtMs <= this.now().getTime()) throw conflict('这次恢复核对已经失效，请重新选择备份。')
    if (await this.currentWorkItem() !== pending.workItemId) throw conflict('当前作品已经切换，已拒绝使用上一部作品的恢复凭证。')
    const targetParent = await canonicalDirectory(targetParentPath)
    assertNotInside(pending.backupRoot, targetParent, '恢复位置不能位于备份文件夹内部。')
    assertNotInside(pending.workItemId, targetParent, '恢复位置不能位于当前作品内部。')
    const manifest = await readManifest(pending.backupRoot)
    await verifyBackupDirectory(pending.backupRoot, manifest)
    if (manifestFingerprint(manifest) !== pending.fingerprint) throw conflict('核对后备份内容发生了变化，请重新选择。')

    const restoredAt = this.now().toISOString()
    const suffix = restoredAt.slice(0, 19).replace(/[T:]/g, '-')
    const projectName = `${manifest.projectName}（恢复副本 ${suffix}）`
    const folderName = safeSegment(projectName)
    const finalRoot = await projectTargetPath(targetParent, join(targetParent, folderName))
    const stagingRoot = await projectTargetPath(targetParent, join(targetParent, `.lanjian-restore-staging-${this.id()}`))
    await assertMissing(finalRoot, '同名恢复副本已经存在，请更换位置或稍后重试。')
    await assertMissing(stagingRoot, '恢复暂存目录冲突，请稍后重试。')
    assertSeparateTrees(pending.backupRoot, finalRoot, '恢复副本不能与备份文件夹重叠。')
    assertSeparateTrees(pending.workItemId, finalRoot, '恢复副本不能与当前作品重叠。')
    try {
      await mkdir(stagingRoot, { recursive: false })
      await copySnapshot(pending.backupRoot, stagingRoot, manifest.files)
      const statePath = await projectExistingPath(stagingRoot, join(stagingRoot, '.webnovel', 'state.json'))
      const state = JSON.parse(await readFile(statePath, 'utf8')) as Record<string, unknown>
      if (!state || typeof state !== 'object' || Array.isArray(state)) throw invalidBackup('备份中的项目清单格式无效。')
      const projectInfo = state.project_info && typeof state.project_info === 'object' && !Array.isArray(state.project_info)
        ? state.project_info as Record<string, unknown>
        : {}
      const nextState = { ...state, project_info: { ...projectInfo, title: projectName }, updated_at: restoredAt }
      const stateContent = `${JSON.stringify(nextState, null, 2)}\n`
      await atomicWriteText(statePath, stateContent)
      const inspection = await this.writes.run(stagingRoot, async () => {
        const restoredDatabase = await this.databases.openExisting(stagingRoot)
        if (!restoredDatabase) throw invalidBackup('备份中缺少作品数据库。')
        try {
          restoredDatabase.reidentifyRestoredProject(projectName, hashText(stateContent), finalRoot)
          return restoredDatabase.inspect()
        } finally {
          restoredDatabase.close()
        }
      })
      if (inspection.schemaVersion !== WORKSPACE_DATABASE_SCHEMA_VERSION || inspection.project.name !== projectName) {
        throw new AppError('DATABASE_INTEGRITY_FAILED', '恢复副本数据库核对失败。', { recoverable: false })
      }
      await rename(stagingRoot, finalRoot)
      return {
        projectPath: finalRoot, projectName, restoredFrom: basename(pending.backupRoot),
        storageMode: manifest.storageMode, chapterCount: manifest.chapterCount, verified: true
      }
    } catch (error) {
      await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined)
      throw error
    }
  }

  clear(): void { this.pendingRestores.clear() }

  private async pruneAutomatic(targetParentPath: string, projectName: string, retentionCount: number): Promise<number> {
    const targetParent = await canonicalDirectory(targetParentPath)
    const workItemId = await this.currentWorkItem()
    const candidates: Array<{ path: string; createdAt: string }> = []
    for (const entry of await readdir(targetParent, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue
      try {
        const path = await projectExistingPath(targetParent, join(targetParent, entry.name))
        const manifest = await readManifest(path)
        if (manifest.trigger === 'automatic' && manifest.projectName === projectName) candidates.push({ path, createdAt: manifest.createdAt })
      } catch { /* unrelated folders and damaged backups are never pruned automatically */ }
    }
    const stale = candidates.sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(Math.max(1, retentionCount))
    for (const item of stale) {
      assertNotInside(workItemId, item.path, '自动备份清理不能触及当前作品。')
      if (!inside(targetParent, item.path) || resolve(item.path) === resolve(targetParent)) throw new AppError('PATH_ESCAPE', '自动备份清理范围无效。', { recoverable: false })
      await rm(item.path, { recursive: true, force: false })
    }
    return stale.length
  }

  private removeExpired(): void {
    const now = this.now().getTime()
    for (const [token, pending] of this.pendingRestores) if (pending.expiresAtMs <= now) this.pendingRestores.delete(token)
  }

  private async serialize<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.mutation
    let release: () => void = () => undefined
    this.mutation = new Promise<void>((resolve) => { release = resolve })
    await previous
    try { return await operation() } finally { release() }
  }
}

async function scanProjectFiles(root: string): Promise<WorkspaceBackupFile[]> {
  const files: WorkspaceBackupFile[] = []
  await walk(root, '', async (relativePath, path) => {
    if (isDatabaseSidecar(relativePath)) return
    files.push({ relativePath, size: (await stat(path)).size, sha256: await fileHash(path), kind: 'project-file' })
  })
  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath, 'zh-CN'))
}

async function walk(root: string, relativeRoot: string, visit: (relativePath: string, path: string) => Promise<void>): Promise<void> {
  const directory = relativeRoot ? await projectExistingPath(root, join(root, ...relativeRoot.split('/'))) : root
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relativePath = relativeRoot ? `${relativeRoot}/${entry.name}` : entry.name
    const path = join(directory, entry.name)
    if (entry.isSymbolicLink()) throw new AppError('PATH_ESCAPE', `备份范围包含链接：${relativePath}`, { recoverable: true })
    if (entry.isDirectory()) await walk(root, relativePath, visit)
    else if (entry.isFile()) await visit(relativePath, await projectExistingPath(root, path))
    else throw new AppError('VALIDATION_ERROR', `备份范围包含不支持的文件类型：${relativePath}`, { recoverable: true })
  }
}

async function copySnapshot(sourceRoot: string, targetRoot: string, files: WorkspaceBackupFile[]): Promise<void> {
  for (const file of files) {
    validateRelativePath(file.relativePath)
    const source = await projectExistingPath(sourceRoot, join(sourceRoot, ...file.relativePath.split('/')))
    const target = await projectTargetPath(targetRoot, join(targetRoot, ...file.relativePath.split('/')))
    await mkdir(dirname(target), { recursive: true })
    await copyFile(source, target)
    if (await fileHash(target) !== file.sha256) throw new AppError('STORAGE_ERROR', `复制 ${file.relativePath} 时校验失败。`, { recoverable: true })
  }
}

async function readManifest(root: string): Promise<WorkspaceBackupManifest> {
  let value: unknown
  try {
    const path = await projectExistingPath(root, join(root, WORKSPACE_BACKUP_MANIFEST))
    if ((await stat(path)).size > maxManifestBytes) throw invalidBackup('备份清单过大，已拒绝读取。')
    value = JSON.parse(await readFile(path, 'utf8'))
  }
  catch (error) {
    if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === 'ENOENT') throw invalidBackup('所选文件夹不是可识别的岚笺备份。')
    throw error
  }
  if (!isManifest(value)) throw invalidBackup('备份清单格式无效或版本不受支持。')
  return value
}

async function verifyBackupDirectory(root: string, manifest: WorkspaceBackupManifest): Promise<void> {
  const actual = await scanBackupFiles(root)
  assertSameSnapshot(manifest.files, actual, '备份文件清单或校验值不一致。')
  const database = manifest.files.find((file) => file.kind === 'sqlite')
  if (!database) throw invalidBackup('备份清单缺少 SQLite 数据库。')
  const check = inspectBackupDatabase(await projectExistingPath(root, join(root, ...database.relativePath.split('/'))))
  if (check.schemaVersion !== manifest.databaseSchemaVersion || check.chapterCount !== manifest.chapterCount) {
    throw invalidBackup('备份数据库结构或章节统计不一致。')
  }
}

async function scanBackupFiles(root: string): Promise<WorkspaceBackupFile[]> {
  const files: WorkspaceBackupFile[] = []
  await walk(root, '', async (relativePath, path) => {
    if (relativePath === WORKSPACE_BACKUP_MANIFEST) return
    files.push({ relativePath, size: (await stat(path)).size, sha256: await fileHash(path), kind: relativePath === WORKSPACE_DATABASE_RELATIVE_PATH ? 'sqlite' : 'project-file' })
  })
  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath, 'zh-CN'))
}

function inspectBackupDatabase(path: string): { schemaVersion: number; chapterCount: number } {
  let database: DatabaseSync | undefined
  try {
    database = new DatabaseSync(path, { readOnly: true, allowExtension: false })
    const quick = String((database.prepare('PRAGMA quick_check').get() as Record<string, unknown> | undefined)?.quick_check || '')
    if (quick.toLocaleLowerCase() !== 'ok' || database.prepare('PRAGMA foreign_key_check').all().length) throw invalidBackup('备份数据库完整性检查未通过。')
    const schemaVersion = Number((database.prepare('PRAGMA user_version').get() as Record<string, unknown> | undefined)?.user_version)
    const chapterCount = Number((database.prepare("SELECT COUNT(*) AS value FROM chapters WHERE status <> 'archived'").get() as Record<string, unknown> | undefined)?.value)
    return { schemaVersion, chapterCount }
  } catch (error) {
    if (error instanceof AppError) throw error
    throw invalidBackup('备份中的 SQLite 数据库无法读取或结构无效。')
  } finally { database?.close() }
}

function isManifest(value: unknown): value is WorkspaceBackupManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  if (item.version !== WORKSPACE_BACKUP_VERSION || typeof item.createdAt !== 'string' || Number.isNaN(Date.parse(item.createdAt))
    || typeof item.appVersion !== 'string' || typeof item.projectName !== 'string' || !item.projectName.trim()
    || !['shadow', 'sqlite'].includes(String(item.storageMode)) || !Number.isSafeInteger(item.databaseSchemaVersion)
    || Number(item.databaseSchemaVersion) < 1 || Number(item.databaseSchemaVersion) > WORKSPACE_DATABASE_SCHEMA_VERSION
    || (item.trigger !== undefined && !['manual', 'automatic'].includes(String(item.trigger)))
    || !Number.isSafeInteger(item.chapterCount) || Number(item.chapterCount) < 0
    || !Number.isSafeInteger(item.bodyVersionCount) || Number(item.bodyVersionCount) < 0
    || !Array.isArray(item.files) || item.files.length > maxBackupFiles) return false
  const paths = new Set<string>()
  let totalBytes = 0
  for (const file of item.files) {
    if (!file || typeof file !== 'object' || Array.isArray(file)) return false
    const record = file as Record<string, unknown>
    if (typeof record.relativePath !== 'string' || typeof record.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(record.sha256)
      || !Number.isSafeInteger(record.size) || Number(record.size) < 0 || Number(record.size) > maxBackupFileBytes
      || !['project-file', 'sqlite'].includes(String(record.kind))) return false
    totalBytes += Number(record.size)
    if (totalBytes > maxBackupTotalBytes) return false
    try { validateRelativePath(record.relativePath) } catch { return false }
    if (paths.has(record.relativePath)) return false
    paths.add(record.relativePath)
  }
  return paths.has(WORKSPACE_DATABASE_RELATIVE_PATH) && paths.has('.webnovel/state.json')
}

function publicRestorePreview(manifest: WorkspaceBackupManifest, token: string, expiresAtMs: number): WorkspaceRestorePreview {
  return {
    token, canRestore: true, projectName: manifest.projectName, createdAt: manifest.createdAt,
    appVersion: manifest.appVersion, storageMode: manifest.storageMode, chapterCount: manifest.chapterCount,
    fileCount: manifest.files.length, expiresAt: new Date(expiresAtMs).toISOString(), blockers: []
  }
}

function validateRelativePath(value: string): void {
  if (!value || value.includes('\\') || isAbsolute(value) || value.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
    throw invalidBackup('备份清单包含无效相对路径。')
  }
}

function assertSameSnapshot(expected: WorkspaceBackupFile[], actual: WorkspaceBackupFile[], message: string): void {
  if (expected.length !== actual.length || expected.some((file, index) => {
    const other = actual[index]
    return !other || file.relativePath !== other.relativePath || file.size !== other.size || file.sha256 !== other.sha256 || file.kind !== other.kind
  })) throw conflict(message)
}

function assertSeparateTrees(left: string, right: string, message: string): void {
  const a = resolve(left)
  const b = resolve(right)
  if (inside(a, b) || inside(b, a)) throw new AppError('VALIDATION_ERROR', message, { recoverable: true })
}

function assertNotInside(root: string, candidate: string, message: string): void {
  if (inside(resolve(root), resolve(candidate))) throw new AppError('VALIDATION_ERROR', message, { recoverable: true })
}

function inside(root: string, candidate: string): boolean {
  const value = relative(root, candidate)
  return value === '' || (!isAbsolute(value) && value !== '..' && !value.startsWith(`..${sep}`))
}

async function assertMissing(path: string, message: string): Promise<void> {
  try {
    await projectExistingPath(dirname(path), path)
    throw new AppError('CONFLICT', message, { recoverable: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
}

async function fileHash(path: string): Promise<string> {
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(path)) digest.update(chunk as Buffer)
  return digest.digest('hex')
}

function manifestFingerprint(manifest: WorkspaceBackupManifest): string { return hashText(JSON.stringify(manifest)) }
function hashText(value: string): string { return createHash('sha256').update(value).digest('hex') }
function safeSegment(value: string): string { return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim().slice(0, 120) || '未命名作品' }
function isDatabaseSidecar(relativePath: string): boolean { return relativePath === WORKSPACE_DATABASE_RELATIVE_PATH || relativePath === `${WORKSPACE_DATABASE_RELATIVE_PATH}-wal` || relativePath === `${WORKSPACE_DATABASE_RELATIVE_PATH}-shm` }
function conflict(message: string): AppError { return new AppError('CONFLICT', message, { recoverable: true, details: { area: 'workspaceBackup' } }) }
function invalidBackup(message: string): AppError { return new AppError('INVALID_PROJECT_STATE', message, { recoverable: true, details: { area: 'workspaceBackup' } }) }
