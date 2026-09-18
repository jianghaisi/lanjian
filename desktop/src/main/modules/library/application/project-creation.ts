import { randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { AppError, isAppError } from '../../../core/errors/app-error'
import { decodeBookModelSettings, type ReferencedBookModelSettings } from '../../models/domain/book-model-settings'
import type { ModelRequestGuard } from '../../models/domain/model-provider'
import { canonicalDirectory, projectTargetPath } from '../../../platform/storage/project-path'
import { fileErrorCode, sameModelFileIdentity, type ModelFileIdentity } from '../../models/adapters/model-connection-file'
import type { ProjectCreateInput } from '../../../../contracts/index'
import type { PartialProjectCreation } from '../../../../contracts/models/model-connections-contracts'
export type { PartialProjectCreation } from '../../../../contracts/models/model-connections-contracts'

export type ProjectModelInitialization = {
  copy(): Promise<ReferencedBookModelSettings | null>
  guard: ModelRequestGuard
}
type Receipt = {
  id: string; root: string; identity: ModelFileIdentity; title: string
  files: Map<string, string>; written: Set<string>; busy: boolean; registered: boolean; storageInitialized: boolean
}
const AI_FILE = '.webnovel/ai-settings.json'

/** Explicit creation only. Pending authorization is process-private, never inferred from a folder marker. */
export class ProjectCreation {
  private readonly receipts = new Map<string, Receipt>()
  constructor(private readonly register: (root: string) => Promise<void>, private readonly schemaVersion: number,
    private readonly initializeStorage?: (root: string) => Promise<void>) {}

  async create(input: ProjectCreateInput, initialization?: ProjectModelInitialization) {
    input = { ...input }
    const title = (input.title || input.name || '').trim()
    const requested = input.path?.trim(), parent = input.parentPath?.trim()
    if (!title) throw new AppError('VALIDATION_ERROR', '请填写小说名', { recoverable: true })
    if (!requested && !parent) throw new AppError('VALIDATION_ERROR', '请选择项目保存位置', { recoverable: true })
    if (this.receipts.size >= 20) throw new AppError('CONFLICT', '待处理的建书操作过多，请先处理创建结果。', { recoverable: true })
    const canonicalParent = await canonicalDirectory(requested ? dirname(resolve(requested)) : parent!)
    const name = requested ? basename(resolve(requested)) : safeName(title)
    const root = join(canonicalParent, name)
    if (dirname(root) !== canonicalParent || root === canonicalParent) throw creationConflict()
    // Capture/validate before allocating anything; corruption is not an empty default.
    const models = await modelContent(initialization)
    initialization?.guard.assertActive()
    try { await mkdir(root) } catch (error) {
      if (fileErrorCode(error) === 'EEXIST') throw new AppError('CONFLICT', '已经存在同名文件夹；请更换书名，或使用“打开本地项目”。', { recoverable: true })
      throw new AppError('STORAGE_ERROR', '无法创建作品文件夹，请检查保存位置。', { recoverable: true })
    }
    const identity = await lstat(root, { bigint: true })
    const now = new Date().toISOString()
    const receipt: Receipt = { id: randomUUID(), root, identity, title, written: new Set(), busy: false, registered: false, storageInitialized: false,
      files: new Map([
        ['.webnovel/state.json', json({ version: this.schemaVersion, schemaVersion: this.schemaVersion,
          project_info: { title, genre: input.genre ?? '', mode: input.mode ?? '' }, created_at: now, updated_at: now })],
        ['.webnovel/config/book-profile.json', json({ genre: input.genre?.trim() || '未分类', subgenre: input.subgenre?.trim() || '',
          coreIdea: input.coreIdea?.trim() || `围绕《${title}》展开的故事`, plannedVolumes: input.plannedVolumes ?? 1,
          chaptersPerVolume: input.chaptersPerVolume ?? 30, targetWordsPerChapter: input.targetWordsPerChapter ?? 3000 })]
      ]) }
    if (models !== null) receipt.files.set(AI_FILE, models)
    this.receipts.set(receipt.id, receipt)
    return this.finish(receipt, initialization)
  }

  async retry(operationId: string, initialization?: ProjectModelInitialization) {
    const receipt = this.receipts.get(operationId)
    if (!receipt) throw new AppError('CONFLICT', '建书重试已失效；原目录已保留，请检查后通过“打开本地项目”进入，不会自动继承默认分配。', { recoverable: true })
    if (receipt.busy) throw creationConflict()
    receipt.busy = true
    try {
    // A completed publication cannot be relabelled as another default or as unconfigured.
    const content = await modelContent(initialization)
    if (receipt.written.has(AI_FILE) && content !== receipt.files.get(AI_FILE)) {
      throw new AppError('CONFLICT', '该目录已经写入先前确认的模型分配；请打开后核对，不能在建书重试中替换。', { recoverable: true })
    }
    if (content === null) receipt.files.delete(AI_FILE)
    else receipt.files.set(AI_FILE, content)
    } finally { receipt.busy = false }
    return this.finish(receipt, initialization)
  }

  private async finish(receipt: Receipt, initialization?: ProjectModelInitialization): Promise<{ status: 'created'; path: string } | PartialProjectCreation> {
    if (receipt.busy) throw creationConflict()
    receipt.busy = true
    try {
      await this.check(receipt)
      initialization?.guard.assertActive()
      for (const folder of ['正文', '大纲', '设定集', '.webnovel', '.webnovel/config']) {
        const target = await projectTargetPath(receipt.root, join(receipt.root, folder))
        try { await mkdir(target) } catch (error) { if (fileErrorCode(error) !== 'EEXIST') throw error }
        const stat = await lstat(target)
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw creationConflict()
      }
      for (const [relative, content] of receipt.files) {
        await this.check(receipt)
        if (relative === AI_FILE && initialization) await initialization.guard.recheck()
        initialization?.guard.assertActive()
        const target = await projectTargetPath(receipt.root, join(receipt.root, relative))
        if (receipt.written.has(relative)) continue
        // Exclusive creation: even an exact-looking pre-existing file is not ours.
        const handle = await open(target, 'wx')
        try { await handle.writeFile(content, 'utf8'); await handle.sync(); receipt.written.add(relative) }
        finally { await handle.close() }
      }
      await this.check(receipt)
      if (initialization) { await initialization.guard.recheck(); initialization.guard.assertActive() }
      if (!receipt.storageInitialized && this.initializeStorage) {
        await this.initializeStorage(receipt.root)
        receipt.storageInitialized = true
        await this.check(receipt)
        if (initialization) { await initialization.guard.recheck(); initialization.guard.assertActive() }
      }
      if (!receipt.registered) { await this.register(receipt.root); receipt.registered = true }
      this.receipts.delete(receipt.id)
      return { status: 'created', path: receipt.root }
    } catch (error) {
      return { status: 'partial', operationId: receipt.id, title: receipt.title,
        code: isAppError(error) ? error.code : 'STORAGE_ERROR',
        message: '建书尚未完成，已创建的文件原样保留。请核对后重试；不要重新创建或覆盖这个目录。',
        modelsWritten: receipt.written.has(AI_FILE) }
    } finally { receipt.busy = false }
  }

  private async check(receipt: Receipt): Promise<void> {
    const stat = await lstat(receipt.root, { bigint: true })
    if (!stat.isDirectory() || stat.isSymbolicLink() || !sameModelFileIdentity(receipt.identity, stat)
      || await canonicalDirectory(receipt.root) !== receipt.root) throw creationConflict()
    for (const relative of receipt.written) {
      const target = await projectTargetPath(receipt.root, join(receipt.root, relative))
      let ancestor = dirname(target)
      while (ancestor !== receipt.root) {
        const parent = await lstat(ancestor)
        if (!parent.isDirectory() || parent.isSymbolicLink()) throw creationConflict()
        ancestor = dirname(ancestor)
      }
      const info = await lstat(target)
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 4 * 1024 * 1024
        || await readFile(target, 'utf8') !== receipt.files.get(relative)) throw creationConflict()
    }
  }
}

async function modelContent(initialization?: ProjectModelInitialization): Promise<string | null> {
  if (!initialization) return null
  const copied = await initialization.copy()
  if (copied === null) return null
  const value = decodeBookModelSettings(copied)
  if (value.version !== 4 || value.references.some(r => r.kind !== 'global')) throw creationConflict()
  return json(value)
}
function json(value: unknown): string { return `${JSON.stringify(value, null, 2)}\n` }
function safeName(name: string): string {
  const value = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '').trim()
  if (!value || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)) throw new AppError('VALIDATION_ERROR', '项目名称无效', { recoverable: true })
  return value
}
function creationConflict(): AppError { return new AppError('CONFLICT', '建书目标或操作状态已变化，已保留原文件，请重新核对。', { recoverable: true }) }
