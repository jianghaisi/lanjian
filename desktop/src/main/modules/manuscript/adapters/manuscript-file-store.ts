import { createHash } from 'node:crypto'
import { mkdir, open, readFile, readdir, stat, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { AppError } from '../../../core/errors/app-error'
import { WorkspaceWriteCoordinator } from '../../../core/application/workspace-write-coordinator'
import { atomicWriteText } from '../../../platform/storage/atomic-file'
import { canonicalDirectory, projectExistingPath, projectTargetPath } from '../../../platform/storage/project-path'
import { ManuscriptTextObjects } from './manuscript-text-objects'

const writes = new WorkspaceWriteCoordinator()
const recoveryDirectory = '.webnovel/recovery/text-writes'
const maxTextBytes = 16 * 1024 * 1024
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const digest = /^[0-9a-f]{64}$/

export type ManuscriptFile = { content: string; hash: string }
export type TextWriteReceipt = {
  version: 1
  operationId: string
  documentId: string
  kind: 'body' | 'outline'
  relativePath: string
  title: string
  previousHash: string | null
  contentHash: string
}
export type TextFileSaveInput = Omit<TextWriteReceipt, 'version' | 'previousHash' | 'contentHash'> & {
  expectedHash: string | null
  content: string
}
export type TextFileSaveResult = { fileSaved: true; metadataSaved: boolean; changed: boolean; hash: string }
/** Must be idempotent by operationId. Text never enters the durable JSON receipt. */
export type CommitTextMetadata = (receipt: Readonly<TextWriteReceipt>, file: Readonly<ManuscriptFile>) => Promise<void>

/** Current Markdown is authoritative. Recovery and snapshots are separate files.
 * Construction/read never creates files or repairs a missing manuscript. */
export class ManuscriptFileStore {
  private constructor(private readonly root: string) {}

  static async open(root: string): Promise<ManuscriptFileStore> {
    return new ManuscriptFileStore(await canonicalDirectory(root))
  }

  async read(relativePath: string): Promise<ManuscriptFile> {
    assertManuscriptPath(relativePath)
    return this.readText(relativePath)
  }

  async save(input: TextFileSaveInput, commitMetadata: CommitTextMetadata, assertCurrent?: () => Promise<void>): Promise<TextFileSaveResult> {
    validateInput(input)
    return writes.run(this.root, async () => {
      await assertCurrent?.()
      const receipt: TextWriteReceipt = { version: 1, operationId: input.operationId, documentId: input.documentId,
        kind: input.kind, relativePath: input.relativePath, title: input.title,
        previousHash: input.expectedHash, contentHash: textHash(input.content) }
      const pending = await this.pending()
      const previous = pending.find(item => item.operationId === input.operationId)
      if (previous) {
        if (JSON.stringify(previous) !== JSON.stringify(receipt)) throw conflict('保存操作的内容已经变化，请使用新的操作标识。')
        return this.resume(previous, commitMetadata, assertCurrent)
      }
      if (pending.some(item => item.documentId === input.documentId || item.relativePath === input.relativePath)) {
        throw conflict('这份稿件仍有待完成的索引更新，请先重试恢复；草稿没有被覆盖。')
      }
      const before = await this.optionalText(input.relativePath)
      if ((before?.hash ?? null) !== input.expectedHash) throw conflict('稿件已被其他操作修改，请先核对；没有覆盖文件。')
      // A no-op still commits metadata (a title/order change can have identical bytes).
      if (before?.hash === receipt.contentHash) {
        await assertCurrent?.()
        await commitMetadata(receipt, before)
        return { fileSaved: true, metadataSaved: true, changed: false, hash: before.hash }
      }

      // Keep a bounded durable recovery draft until BOTH file and metadata succeed.
      // It is removed after acknowledgement, not retained as an extra current copy.
      const draft = await this.target(`${recoveryDirectory}/${input.operationId}.md`)
      await writeExclusive(draft, input.content)
      const receiptPath = await this.target(`${recoveryDirectory}/${input.operationId}.json`)
      await writeExclusive(receiptPath, JSON.stringify(receipt))
      return this.resume(receipt, commitMetadata, assertCurrent)
    })
  }

  /** Explicit recovery only; do not call as a side effect of an ordinary read. */
  async recover(commitMetadata: CommitTextMetadata, assertCurrent?: () => Promise<void>): Promise<TextFileSaveResult[]> {
    return writes.run(this.root, async () => {
      const results: TextFileSaveResult[] = []
      for (const receipt of await this.pending()) results.push(await this.resume(receipt, commitMetadata, assertCurrent))
      return results
    })
  }

  async pending(): Promise<TextWriteReceipt[]> {
    let directory: string
    try { directory = await projectExistingPath(this.root, join(this.root, recoveryDirectory)) }
    catch (error) { if (missing(error)) return []; throw safeStorage(error) }
    const names = await readdir(directory)
    if (names.length > 20_000) throw invalid('待恢复稿件数量异常，已停止自动处理。')
    const receipts: TextWriteReceipt[] = []
    for (const name of names.sort()) {
      if (!name.endsWith('.json')) continue
      const operationId = name.slice(0, -5)
      if (!uuid.test(operationId)) throw invalid('稿件恢复记录名称无效，原文件已保留。')
      const file = await this.readText(`${recoveryDirectory}/${name}`, 4096)
      let value: unknown
      try { value = JSON.parse(file.content) } catch { throw invalid('稿件恢复记录损坏，原文件已保留。') }
      const receipt = decodeReceipt(value)
      if (receipt.operationId !== operationId) throw invalid('稿件恢复记录身份不一致。')
      receipts.push(receipt)
    }
    return receipts
  }

  async snapshot(content: string): Promise<{ relativePath: string; hash: string }> {
    const { relativePath, hash } = new ManuscriptTextObjects(this.root).write(content)
    return { relativePath, hash }
  }

  async readSnapshot(hash: string): Promise<ManuscriptFile> {
    if (!digest.test(hash)) throw invalid('历史稿件引用无效。')
    const file = await this.readText(`.webnovel/history/text/${hash}.md`)
    if (file.hash !== hash) throw invalid('历史稿件校验失败。')
    return file
  }

  private async resume(receipt: TextWriteReceipt, commitMetadata: CommitTextMetadata, assertCurrent?: () => Promise<void>): Promise<TextFileSaveResult> {
    await assertCurrent?.()
    const draftRelative = `${recoveryDirectory}/${receipt.operationId}.md`
    const current = await this.optionalText(receipt.relativePath)
    let saved = current
    if (current?.hash !== receipt.contentHash) {
      if ((current?.hash ?? null) !== receipt.previousHash) throw conflict('稿件在恢复期间被修改；当前文件与恢复稿均已保留，请核对。')
      const draft = await this.readText(draftRelative)
      if (draft.hash !== receipt.contentHash) throw invalid('恢复草稿校验失败，未覆盖正文。')
      const target = await this.target(receipt.relativePath)
      await atomicWriteText(target, draft.content, async () => {
        await assertCurrent?.()
        await projectTargetPath(this.root, target)
        const latest = await this.optionalText(receipt.relativePath)
        if ((latest?.hash ?? null) !== receipt.previousHash) throw conflict('稿件在保存期间被修改；没有覆盖外部内容。')
      })
      saved = await this.readText(receipt.relativePath)
      if (saved.hash !== receipt.contentHash) throw conflict('稿件落盘后发生变化，索引尚未确认；恢复稿已保留。')
    }
    if (!saved || saved.hash !== receipt.contentHash) throw invalid('稿件保存状态无法确认。')
    try {
      await assertCurrent?.()
      await commitMetadata(receipt, saved)
    } catch {
      // File is the authority; NEVER roll it back from stale SQLite on index failure.
      return { fileSaved: true, metadataSaved: false, changed: true, hash: saved.hash }
    }
    // Recheck before deleting recovery evidence; metadata callbacks can take time.
    if ((await this.readText(receipt.relativePath)).hash !== receipt.contentHash) {
      throw conflict('索引提交期间稿件又有变化，恢复稿保留待核对。')
    }
    await this.removeOwned(`${recoveryDirectory}/${receipt.operationId}.json`, textHash(JSON.stringify(receipt)))
    await this.removeOwned(draftRelative, receipt.contentHash)
    return { fileSaved: true, metadataSaved: true, changed: true, hash: saved.hash }
  }

  private async target(relativePath: string): Promise<string> {
    const path = await projectTargetPath(this.root, join(this.root, relativePath))
    await mkdir(dirname(path), { recursive: true })
    await projectTargetPath(this.root, path)
    return path
  }

  private async readText(relativePath: string, limit = maxTextBytes): Promise<ManuscriptFile> {
    try {
      const path = await projectExistingPath(this.root, join(this.root, relativePath))
      const metadata = await stat(path)
      if (!metadata.isFile() || metadata.size > limit) throw invalid('稿件不是普通文件或超过安全读取上限。')
      const bytes = await readFile(path)
      if (bytes.byteLength > limit) throw invalid('稿件超过安全读取上限。')
      let content: string
      try { content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) }
      catch { throw invalid('稿件不是有效 UTF-8 文本，原文件已保留。') }
      if (content.includes('\0')) throw invalid('稿件包含无效字符，原文件已保留。')
      return { content, hash: textHash(content) }
    } catch (error) { throw safeStorage(error) }
  }

  private async optionalText(relativePath: string): Promise<ManuscriptFile | null> {
    try { return await this.readText(relativePath) }
    catch (error) { if (error instanceof AppError && error.code === 'NOT_FOUND') return null; throw error }
  }

  private async removeOwned(relativePath: string, expectedHash: string): Promise<void> {
    const current = await this.optionalText(relativePath)
    if (!current) return
    if (current.hash !== expectedHash) throw conflict('恢复文件已变化，未执行清理。')
    await unlink(await projectExistingPath(this.root, join(this.root, relativePath)))
  }
}

export function textHash(content: string): string { return createHash('sha256').update(content, 'utf8').digest('hex') }

function assertManuscriptPath(path: string): void {
  if (typeof path !== 'string' || path.length > 1024 || !/^(正文|大纲)\/.+\.md$/.test(path)
    || path.includes('\\') || path.includes(':') || path.includes('\0')
    || path.split('/').some(part => !part || part === '.' || part === '..' || /[ .]$/.test(part))) {
    throw new AppError('PATH_ESCAPE', '稿件文件引用无效。', { recoverable: true })
  }
}
function validateText(content: string): void {
  if (typeof content !== 'string' || content.includes('\0') || Buffer.byteLength(content, 'utf8') > maxTextBytes
    || Buffer.from(content, 'utf8').toString('utf8') !== content) throw invalid('稿件内容无效或超过安全写入上限。')
}
function validateInput(input: TextFileSaveInput): void {
  if (!uuid.test(input.operationId) || typeof input.documentId !== 'string' || !input.documentId || input.documentId.length > 200
    || !['body', 'outline'].includes(input.kind) || typeof input.title !== 'string' || input.title.length > 500
    || (input.expectedHash !== null && !digest.test(input.expectedHash))) throw invalid('稿件保存请求无效。')
  assertManuscriptPath(input.relativePath)
  if (!input.relativePath.startsWith(input.kind === 'body' ? '正文/' : '大纲/')) throw invalid('稿件类型与位置不一致。')
  validateText(input.content)
}
function decodeReceipt(value: unknown): TextWriteReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid('稿件恢复记录无效。')
  const record = value as Record<string, unknown>
  if (record.version !== 1 || typeof record.contentHash !== 'string' || !digest.test(record.contentHash)
    || Object.keys(record).sort().join(',') !== 'contentHash,documentId,kind,operationId,previousHash,relativePath,title,version') {
    throw invalid('稿件恢复记录格式不支持。')
  }
  validateInput({ ...record, expectedHash: record.previousHash, content: '' } as TextFileSaveInput)
  return { version: 1, operationId: String(record.operationId), documentId: String(record.documentId),
    kind: record.kind as TextWriteReceipt['kind'], relativePath: String(record.relativePath), title: String(record.title),
    previousHash: record.previousHash as string | null, contentHash: record.contentHash }
}
async function writeExclusive(path: string, content: string): Promise<void> {
  const handle = await open(path, 'wx')
  try { await handle.writeFile(content, 'utf8'); await handle.sync() } finally { await handle.close() }
}
function missing(error: unknown): boolean { return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') }
function conflict(message: string): AppError { return new AppError('CONFLICT', message, { recoverable: true }) }
function invalid(message: string): AppError { return new AppError('DATABASE_INTEGRITY_FAILED', message, { recoverable: true }) }
function safeStorage(error: unknown): AppError {
  if (error instanceof AppError) return error
  return new AppError(missing(error) ? 'NOT_FOUND' : 'STORAGE_ERROR', missing(error) ? '稿件文件不存在，未创建空稿或覆盖原文件。' : '稿件文件暂时无法读取，请保留原文件并重试。', { recoverable: true, cause: error })
}
