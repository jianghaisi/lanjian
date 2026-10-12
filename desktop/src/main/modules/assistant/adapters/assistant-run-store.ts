import { createHash } from 'node:crypto'
import { readFile, stat, opendir } from 'node:fs/promises'
import { join } from 'node:path'
import { AppError } from '../../../core/errors/app-error'
import { projectDirectory } from '../../../platform/storage/project-path'
import { writeJson } from '../../../platform/storage/json-store'
import { decodeRunRecord, runLimits, runTerminal, type AssistantRunRecord, type AssistantRunStorePort } from '../application/runs/state'

/** Main-owned interaction history. No path from a plugin or renderer is used here. */
export class AssistantRunStore implements AssistantRunStorePort {
  private writes: Promise<void> = Promise.resolve()
  constructor(private readonly root: string) {}
  private file(book: string) { return projectDirectory(this.root, join(this.root, 'assistant-runs', createHash('sha256').update(book).digest('hex'), 'runs.json')) }
  async read(book: string): Promise<AssistantRunRecord[]> { await this.writes; return this.readNow(book) }
  async *all(): AsyncIterable<AssistantRunRecord> {
    await this.writes
    const root = await projectDirectory(this.root, join(this.root, 'assistant-runs'))
    let directory
    try { directory = await opendir(root) } catch (cause) { if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return; throw cause }
    for await (const entry of directory) {
      if (!entry.isDirectory() || !/^[a-f0-9]{64}$/.test(entry.name)) continue
      const file = await projectDirectory(this.root, join(root, entry.name, 'runs.json'))
      const records = await this.readFile(file)
      if (records.some(r => createHash('sha256').update(r.view.workItemId).digest('hex') !== entry.name)) throw new AppError('STORAGE_ERROR', '创作任务记录所属作品不匹配，原文件已保留。', { recoverable: true })
      for (const record of records) yield record
    }
  }
  private async readFile(file: string): Promise<AssistantRunRecord[]> {
    if ((await stat(file)).size > runLimits.storeBytes) throw new Error('History limit')
    const value: unknown = JSON.parse(await readFile(file, 'utf8'))
    if (!Array.isArray(value) || value.length > 100) throw new Error('History format')
    return value.map(decodeRunRecord)
  }
  private async readNow(book: string): Promise<AssistantRunRecord[]> {
    try {
      const file = await this.file(book)
      const records = await this.readFile(file)
      if (records.some(record => record.view.workItemId !== book) || new Set(records.map(r => r.view.id)).size !== records.length) throw new Error('History identity')
      return records
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw new AppError('STORAGE_ERROR', '创作任务记录无法读取，原文件已保留，请检查存储后重试。', { recoverable: true, cause })
    }
  }
  write(record: AssistantRunRecord, beforeCommit?: () => Promise<void>): Promise<void> {
    const saved = decodeRunRecord(record)
    const operation = this.writes.then(async () => {
      const previous = await this.readNow(saved.view.workItemId)
      const ordered = [saved, ...previous.filter(r => r.view.id !== saved.view.id)].sort((a, b) => b.view.updatedAt.localeCompare(a.view.updatedAt))
      let finished = 0
      const next = ordered.filter(r => !runTerminal(r.view.status) || ++finished <= runLimits.historyCount)
      if (next.length > 100 || Buffer.byteLength(JSON.stringify(next, null, 2)) > runLimits.storeBytes) throw new AppError('STORAGE_ERROR', '创作任务历史已达到容量上限，请先处理待办任务。当前记录已保留。', { recoverable: true })
      const path = await this.file(saved.view.workItemId)
      await writeJson(path, next, async () => { await this.file(saved.view.workItemId); await beforeCommit?.() })
    })
    this.writes = operation.catch(() => {})
    return operation
  }
}
