import { randomUUID, createHash } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { AppError } from '../../../core/errors/app-error'
import type { WorkspaceDatabasePort } from '../../../core/ports/workspace-database'
import { ManuscriptTextObjects } from './manuscript-text-objects'
import { projectExistingPathSync, projectTargetPathSync } from '../../../platform/storage/project-path'

const commandNames = ['writeFormalChapter', 'writeFormalOutline', 'appendFormalOutlineChildren', 'applyWritingAgentArtifact',
  'createFormalChapter', 'startChapterFromOutline', 'stageAutosaveCheckpoint', 'finalizeAutosaveCheckpoint',
  'updateChapterPlanning', 'archiveFormalChapter', 'restoreArchivedFormalChapter', 'promoteIdeaToSummary'] as const
type CommandName = typeof commandNames[number]
export type ManuscriptCommand = { [K in CommandName]: { name: K; args: Parameters<WorkspaceDatabasePort[K]> } }[CommandName]
export type ManuscriptFileIntent = { relativePath: string; previousHash: string | null; hash: string | null }
type PackedValue = null | boolean | number | string | PackedValue[] | { [key: string]: PackedValue }
export type ManuscriptCommitReceipt = {
  version: 1; operationId: string; projectId: string; command: PackedValue; files: ManuscriptFileIntent[]
}
const journalDirectory = '.webnovel/recovery/manuscript-commits'
const digest = /^[a-f0-9]{64}$/
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i

/** Bounded file-first commit journal for the existing synchronous SQLite adapter.
 * It records a named domain operation, not arbitrary SQL. Text values are immutable
 * file references. Replay reruns the same domain guards; it cannot invent an AI approval. */
export class ManuscriptCommitJournal {
  readonly objects: ManuscriptTextObjects
  constructor(private readonly root: string) { this.objects = new ManuscriptTextObjects(root) }

  readCurrent(relativePath: string): { content: string; hash: string } | null {
    manuscriptPath(relativePath)
    try {
      const target = projectExistingPathSync(this.root, join(this.root, relativePath))
      if (!statSync(target).isFile() || statSync(target).size > 16 * 1024 * 1024) throw invalid('稿件文件大小或类型无效。')
      const bytes = readFileSync(target)
      if (bytes.length > 16 * 1024 * 1024) throw invalid('稿件文件超过读取上限。')
      const content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
      if (content.includes('\0')) throw invalid('稿件包含无效字符。')
      return { content, hash: hashBytes(bytes) }
    } catch (error) {
      if (code(error) === 'ENOENT') return null
      if (error instanceof AppError) throw error
      throw new AppError('STORAGE_ERROR', '稿件文件读取失败，未返回空稿。', { recoverable: true, cause: error })
    }
  }

  pending(): ManuscriptCommitReceipt[] {
    const path = projectTargetPathSync(this.root, join(this.root, journalDirectory))
    if (!existsSync(path)) return []
    projectExistingPathSync(this.root, path)
    const names = readdirSync(path).filter(name => name.endsWith('.json'))
    if (names.length > 32) throw invalid('待完成稿件操作过多，已停止自动处理。')
    return names.map(name => {
      if (!uuid.test(name.slice(0, -5))) throw invalid('稿件操作记录名称无效。')
      const target = projectExistingPathSync(this.root, join(path, name))
      if (statSync(target).size > 2 * 1024 * 1024) throw invalid('稿件操作记录过大。')
      let value: unknown
      try { value = JSON.parse(readFileSync(target, 'utf8')) } catch { throw invalid('稿件操作记录损坏。') }
      return this.validate(value, name.slice(0, -5))
    })
  }

  prepare(projectId: string, command: ManuscriptCommand, files: ManuscriptFileIntent[]): ManuscriptCommitReceipt {
    if (this.pending().length) throw conflict('前一份稿件的索引尚待恢复，未覆盖文件。')
    if (!files.length || files.length > 32 || new Set(files.map(file => file.relativePath.toLowerCase())).size !== files.length) {
      throw invalid('稿件提交文件清单无效。')
    }
    // Capture and retain the exact previous file too, including external line endings.
    for (const file of files) {
      this.validateIntent(file)
      const current = this.readCurrent(file.relativePath)
      if ((current?.hash ?? null) !== file.previousHash) throw conflict('稿件在保存前已被修改，未覆盖外部内容。')
      if (current) this.objects.write(current.content)
      if (file.hash) this.snapshot(file.hash)
    }
    const receipt: ManuscriptCommitReceipt = { version: 1, operationId: randomUUID(), projectId,
      command: this.pack(command), files }
    const text = JSON.stringify(receipt)
    if (Buffer.byteLength(text) > 2 * 1024 * 1024) throw invalid('稿件提交记录超过安全上限。')
    const path = this.target(`${journalDirectory}/${receipt.operationId}.json`)
    this.writeDurable(path, text)
    return receipt
  }

  apply(receipt: ManuscriptCommitReceipt): void {
    // Preflight ALL targets before any replace. Every replace rechecks again.
    for (const file of receipt.files) this.assertExpected(file)
    for (const file of receipt.files) {
      const current = this.readCurrent(file.relativePath)
      if ((current?.hash ?? null) === file.hash) continue
      this.assertExpected(file)
      if (file.hash === null) {
        unlinkSync(projectExistingPathSync(this.root, join(this.root, file.relativePath)))
        continue
      }
      const content = this.snapshot(file.hash)
      const path = this.target(file.relativePath)
      const temporary = `${path}.${randomUUID()}.tmp`
      try {
        this.writeDurable(temporary, content)
        projectTargetPathSync(this.root, path)
        this.assertExpected(file)
        renameSync(temporary, path)
      } finally { if (existsSync(temporary)) unlinkSync(projectExistingPathSync(this.root, temporary)) }
      if (this.readCurrent(file.relativePath)?.hash !== file.hash) throw conflict('稿件替换后发生变化，恢复记录已保留。')
    }
  }

  finish(receipt: ManuscriptCommitReceipt): void {
    for (const file of receipt.files) {
      if ((this.readCurrent(file.relativePath)?.hash ?? null) !== file.hash) throw conflict('稿件提交后又被修改，恢复记录已保留。')
    }
    const path = projectExistingPathSync(this.root, join(this.root, journalDirectory, `${receipt.operationId}.json`))
    if (readFileSync(path, 'utf8') !== JSON.stringify(receipt)) throw conflict('稿件恢复记录已变化，未执行清理。')
    unlinkSync(path)
  }

  command(receipt: ManuscriptCommitReceipt): ManuscriptCommand {
    const decoded = this.unpack(receipt.command) as { name?: unknown; args?: unknown }
    if (!decoded || typeof decoded.name !== 'string' || !commandNames.includes(decoded.name as CommandName)
      || !Array.isArray(decoded.args) || decoded.args.length > 2) throw invalid('稿件恢复操作不受支持。')
    return decoded as ManuscriptCommand
  }

  private snapshot(hash: string): string {
    return this.objects.read({ hash, relativePath: `.webnovel/history/text/${hash}.md`, rangeStart: null, rangeEnd: null })
  }
  private assertExpected(file: ManuscriptFileIntent): void {
    const hash = this.readCurrent(file.relativePath)?.hash ?? null
    if (hash !== file.previousHash && hash !== file.hash) throw conflict('稿件出现不同于保存前后的外部内容，当前稿和恢复稿均已保留。')
  }
  private target(relativePath: string): string {
    const path = projectTargetPathSync(this.root, join(this.root, relativePath))
    mkdirSync(dirname(path), { recursive: true })
    return projectTargetPathSync(this.root, path)
  }
  private writeDurable(path: string, text: string): void {
    const descriptor = openSync(path, 'wx')
    try { writeFileSync(descriptor, text, 'utf8'); fsyncSync(descriptor) } finally { closeSync(descriptor) }
  }
  private pack(value: unknown, key = '', depth = 0): PackedValue {
    if (depth > 20) throw invalid('稿件操作嵌套过深。')
    if (key === 'content' && typeof value === 'string') return { $manuscriptText: this.objects.write(value).hash }
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (Array.isArray(value)) return value.map(item => this.pack(item, '', depth + 1))
    if (typeof value === 'object' && value) return Object.fromEntries(Object.entries(value)
      .filter(([, item]) => item !== undefined).map(([name, item]) => [name, this.pack(item, name, depth + 1)]))
    throw invalid('稿件操作参数无效。')
  }
  private unpack(value: PackedValue, depth = 0): unknown {
    if (depth > 20) throw invalid('稿件恢复参数嵌套过深。')
    if (Array.isArray(value)) return value.map(item => this.unpack(item, depth + 1))
    if (value && typeof value === 'object') {
      if ('$manuscriptText' in value) {
        if (Object.keys(value).length !== 1 || typeof value.$manuscriptText !== 'string' || !digest.test(value.$manuscriptText)) throw invalid('恢复稿件文件引用无效。')
        return this.snapshot(value.$manuscriptText)
      }
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, this.unpack(item, depth + 1)]))
    }
    return value
  }
  private validateIntent(value: ManuscriptFileIntent): void {
    if (!value || Object.keys(value).sort().join(',') !== 'hash,previousHash,relativePath') throw invalid('稿件提交文件字段无效。')
    manuscriptPath(value.relativePath)
    if ((value.hash !== null && !digest.test(value.hash)) || (value.previousHash !== null && !digest.test(value.previousHash))) throw invalid('稿件提交指纹无效。')
  }
  private validate(value: unknown, operationId: string): ManuscriptCommitReceipt {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid('稿件提交记录无效。')
    const record = value as ManuscriptCommitReceipt
    if (Object.keys(record).sort().join(',') !== 'command,files,operationId,projectId,version' || record.version !== 1
      || record.operationId !== operationId || typeof record.projectId !== 'string' || !record.projectId || record.projectId.length > 200
      || !Array.isArray(record.files) || !record.files.length || record.files.length > 32) throw invalid('稿件提交记录身份无效。')
    for (const file of record.files) this.validateIntent(file)
    if (new Set(record.files.map(file => file.relativePath.toLowerCase())).size !== record.files.length) throw invalid('稿件提交路径重复。')
    this.command(record)
    return record
  }
}

function manuscriptPath(path: string): void {
  if (typeof path !== 'string' || path.length > 1024 || !/^(正文|大纲)\/.+\.md$/.test(path) || /[\\:\0]/.test(path)
    || path.split('/').some(part => !part || part === '.' || part === '..' || /[ .]$/.test(part))) throw new AppError('PATH_ESCAPE', '稿件路径无效。', { recoverable: true })
}
function hashBytes(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex') }
function code(error: unknown): unknown { return error && typeof error === 'object' && 'code' in error ? error.code : undefined }
function invalid(message: string): AppError { return new AppError('DATABASE_INTEGRITY_FAILED', message, { recoverable: true }) }
function conflict(message: string): AppError { return new AppError('CONFLICT', message, { recoverable: true }) }
