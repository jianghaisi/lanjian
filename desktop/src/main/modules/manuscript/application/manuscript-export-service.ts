import { extname, isAbsolute, relative, resolve } from 'node:path'
import { AppError } from '../../../core/errors/app-error'
import { atomicWriteText } from '../../../platform/storage/atomic-file'
import type { Chapter, ManuscriptExportResult, ProjectSummary } from '../../../../contracts/index'
import type { ManuscriptExportSelection } from '../../../../contracts/manuscript/types'
import { decodeManuscriptExportArgs } from '../../../../contracts/manuscript/ipc'

export type ManuscriptExportFormat = 'txt' | 'markdown'

type ManuscriptExportSource = {
  currentPath: () => Promise<string>
  currentSummary: () => Promise<ProjectSummary>
}

type ManuscriptExportDocuments = { chapters: () => Promise<Chapter[]> }

export type PreparedManuscriptExport = {
  workItemPath: string
  workItemId: string
  title: string
  chapters: Chapter[]
}

export class ManuscriptExportService {
  constructor(
    private readonly projects: ManuscriptExportSource,
    private readonly documents: ManuscriptExportDocuments
  ) {}

  async exportSelected(targetPath?: string, selection?: ManuscriptExportSelection): Promise<ManuscriptExportResult | null> {
    return targetPath ? this.export(targetPath, selection) : null
  }

  async prepare(selection?: ManuscriptExportSelection): Promise<PreparedManuscriptExport> {
    if (selection) [selection] = decodeManuscriptExportArgs([selection])
    const workItemPath = await this.projects.currentPath()
    if (selection && resolve(selection.workItemPath) !== resolve(workItemPath)) this.changedBook()
    const [summary, chapters] = await Promise.all([this.projects.currentSummary(), this.documents.chapters()])
    if (resolve(summary.path) !== resolve(workItemPath) || (selection && selection.workItemId !== summary.id)) this.changedBook()
    const ids = selection ? new Set(selection.chapterIds) : null
    const selected = ids ? chapters.filter(chapter => ids.has(chapter.id)) : chapters
    if (!selected.length) throw new AppError('VALIDATION_ERROR', '请选择至少一个可导出的章节。', { recoverable: true })
    if (ids && selected.length !== ids.size) {
      throw new AppError('CONFLICT', '部分所选章节已不存在，请重新打开导出面板选择。', { recoverable: true })
    }
    const snapshot = { workItemPath, workItemId: summary.id, title: summary.title, chapters: selected.map(chapter => ({ ...chapter })) }
    await this.assertCurrent(snapshot)
    return snapshot
  }

  async assertCurrent(snapshot: PreparedManuscriptExport): Promise<void> {
    if (resolve(await this.projects.currentPath()) !== resolve(snapshot.workItemPath)) this.changedBook()
  }

  private changedBook(): never {
    throw new AppError('CONFLICT', '导出期间当前作品已经切换，请重新导出。', { recoverable: true })
  }

  async export(targetPath: string, selection?: ManuscriptExportSelection): Promise<ManuscriptExportResult> {
    return this.exportPrepared(await this.prepare(selection), targetPath)
  }

  async exportPrepared(snapshot: PreparedManuscriptExport, targetPath: string): Promise<ManuscriptExportResult> {
    const target = resolve(targetPath)
    if (isInside(snapshot.workItemPath, target)) {
      throw new AppError('VALIDATION_ERROR', '阅读稿不能保存到作品文件夹内部，以免和正式数据或可读镜像混淆。', { recoverable: true })
    }
    const extension = extname(target).toLocaleLowerCase('en-US')
    const format: ManuscriptExportFormat = extension === '.md' ? 'markdown' : extension === '.txt' ? 'txt' : invalidFormat()
    await this.assertCurrent(snapshot)
    const content = buildManuscriptExport(snapshot.title, snapshot.chapters, format)
    await atomicWriteText(target, content, () => this.assertCurrent(snapshot))
    return {
      format,
      filePath: target,
      chapterCount: snapshot.chapters.length,
      characterCount: Array.from(content).length
    }
  }
}

export function buildManuscriptExport(title: string, chapters: readonly Chapter[], format: ManuscriptExportFormat): string {
  const cleanTitle = singleLine(title) || '未命名作品'
  const ordered = [...chapters].sort((left, right) => left.position - right.position || left.id - right.id)
  const blocks = ordered.map((chapter) => {
    const heading = chapterHeading(chapter)
    const body = chapter.content.replace(/\r\n?/g, '\n').trimEnd()
    return format === 'markdown'
      ? `## ${heading}${body ? `\n\n${body}` : ''}`
      : `${heading}${body ? `\n\n${body}` : ''}`
  })
  const bookHeading = format === 'markdown' ? `# ${cleanTitle}` : cleanTitle
  return `${[bookHeading, ...blocks].join('\n\n')}\n`
}

export function safeExportFileName(title: string): string {
  const value = singleLine(title).replace(/[<>:"/\\|?*：？\u0000-\u001F]/g, '_').replace(/[. ]+$/g, '').slice(0, 100)
  return value || '未命名作品'
}

function chapterHeading(chapter: Chapter): string {
  const title = singleLine(chapter.title)
  return `第${chapter.position}章${title ? `　${title}` : ''}`
}

function singleLine(value: string): string {
  return value.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function isInside(root: string, candidate: string): boolean {
  const path = relative(resolve(root), candidate)
  return path === '' || (!path.startsWith('..') && !isAbsolute(path))
}

function invalidFormat(): never {
  throw new AppError('VALIDATION_ERROR', '阅读稿只支持导出为 TXT 或 Markdown。', { recoverable: true })
}
