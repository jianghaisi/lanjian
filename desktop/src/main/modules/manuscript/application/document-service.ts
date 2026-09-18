import { mkdir, readFile, readdir, stat, unlink } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, join, relative, resolve, sep } from 'node:path'
import type { Chapter, ChapterMirrorRecoveryPreview, ChapterMirrorRecoveryResult, ChapterOutlineDocument, ChapterRevision, ChapterRevisionReason, DeletedChapterSummary, OutlineDocument, OutlineList, OutlineUpdateResult, OutlineVolume, StageOutlineUpdateResult } from '../../../../contracts/index'
import { AppError } from '../../../core/errors/app-error'
import { parseChapterFileName } from '../domain/chapter-file'
import type {
  ManuscriptAuthority,
  ManuscriptAutosaveCheckpoint,
  ManuscriptAutosaveFinalizeResult,
  ManuscriptAutosaveStageInput,
  ManuscriptAutosaveStageResult
} from '../domain/manuscript-authority'
import { projectDirectory, projectExistingPath } from '../../../platform/storage/project-path'
import { atomicWriteText } from '../../../platform/storage/atomic-file'
import { ProjectService } from '../../library/application/project-service'
import type { PlannedChapterOutline, PlannedChapterOutlineUpdate } from '../../../../contracts/index'
import type { PlannedChapterStartInput, PlannedChapterStartResult } from '../../../../contracts/index'

const revisionPattern = /^\d{13}-[0-9a-f-]{36}$/i
const revisionLimit = 50
const autosaveRevisionWindowStartingSuggestionMs = 30_000
type StoredChapterFile = Omit<Chapter, 'position'> & { path: string }
type StoredChapter = StoredChapterFile & { position: number }
type ChapterOrderFile = { version: 1; chapterIds: number[] }
type DeletedChapterArchiveFile = {
  version: 1
  id: number
  position: number
  title: string
  content: string
  word_count: number
  deletedAt: string
}

export class DocumentService {
  private orderMutation: Promise<void> = Promise.resolve()
  private readonly chapterMutations = new Map<number, Promise<void>>()

  constructor(
    private readonly projects: ProjectService,
    private readonly trash: { trashItem: (path: string) => Promise<void> } = {
      trashItem: async () => { throw new AppError('FEATURE_UNAVAILABLE', '系统回收站服务未配置') }
    },
    private readonly manuscriptAuthority?: ManuscriptAuthority,
    private readonly autosaveMergeWindowMs: () => Promise<number> = async () => autosaveRevisionWindowStartingSuggestionMs
  ) {}

  private async formalManuscript(): Promise<{ workItemId: string; authority: ManuscriptAuthority } | null> {
    if (!this.manuscriptAuthority) return null
    const workItemId = await this.projects.currentPath()
    return await this.manuscriptAuthority.active(workItemId)
      ? { workItemId, authority: this.manuscriptAuthority }
      : null
  }

  private async formalOutline(): Promise<{ workItemId: string; authority: ManuscriptAuthority } | null> {
    if (!this.manuscriptAuthority) return null
    const workItemId = await this.projects.currentPath()
    return await this.manuscriptAuthority.outlineActive(workItemId)
      ? { workItemId, authority: this.manuscriptAuthority }
      : null
  }

  private async root(folder: '正文' | '大纲'): Promise<string> {
    const projectRoot = await this.projects.currentPath()
    return projectDirectory(projectRoot, join(projectRoot, folder))
  }

  private async existingPath(candidate: string): Promise<string> {
    return projectExistingPath(await this.projects.currentPath(), candidate)
  }

  async chapters(): Promise<Chapter[]> {
    const formal = await this.formalManuscript()
    if (formal) return formal.authority.chapters(formal.workItemId)
    return (await this.storedChapters()).map(withoutPath)
  }

  async validateChapterOrderLedger(): Promise<void> {
    const formal = await this.formalManuscript()
    if (formal) return formal.authority.validate(formal.workItemId)
    let parsed: unknown
    try { parsed = JSON.parse(await readFile(await this.chapterOrderFile(), 'utf8')) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      if (error instanceof SyntaxError) throw invalidChapterOrder('章节顺序文件损坏，未对稿件执行任何改动')
      throw error
    }
    if (!isChapterOrderFile(parsed)) throw invalidChapterOrder('章节顺序文件格式无效，未对稿件执行任何改动')
  }

  async unsequencedChapters(): Promise<Chapter[]> {
    if (await this.formalManuscript()) return []
    const root = await this.root('正文')
    let files: string[] = []
    try { files = await readdir(root) } catch { return [] }
    const chapters = await Promise.all(files.map((file) => this.chapterFromFile(root, file)))
    const physical = chapters.filter((item): item is StoredChapterFile => Boolean(item)).sort((a, b) => a.id - b.id)
    const ids = physical.map((item) => item.id)
    if (new Set(ids).size !== ids.length) {
      throw new AppError('INVALID_PROJECT_STATE', '检测到重复的章节文件编号，请先处理同编号稿件', { recoverable: true })
    }
    return physical.map((item, index) => withoutPath({ ...item, position: index + 1 }))
  }

  async manuscriptRevision(): Promise<string> {
    const formal = await this.formalManuscript()
    if (formal) return formal.authority.manuscriptRevision(formal.workItemId)
    const root = await this.root('正文')
    let files: string[] = []
    try { files = await readdir(root) } catch { return createHash('sha256').update('empty-manuscript').digest('hex') }
    const chapterFiles = files.filter((file) => Boolean(parseChapterFileName(file))).sort((a, b) => a.localeCompare(b, 'zh-CN'))
    const identities = chapterFiles.map((file) => parseChapterFileName(file)!)
    if (new Set(identities.map((item) => item.id)).size !== identities.length) {
      throw new AppError('INVALID_PROJECT_STATE', '检测到重复的章节文件编号，请先处理同编号稿件', { recoverable: true })
    }
    const records: string[] = []
    for (const file of chapterFiles) {
      const path = await this.existingPath(contained(root, join(root, file)))
      const metadata = await stat(path, { bigint: true })
      if (metadata.isFile()) records.push(`${file}\u0000${metadata.size}\u0000${metadata.mtimeNs}`)
    }
    let order = ''
    try { order = await readFile(await this.chapterOrderFile(), 'utf8') }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    return createHash('sha256').update(records.join('\n')).update('\u0000order\u0000').update(order).digest('hex')
  }

  private async storedChapters(): Promise<StoredChapter[]> {
    const root = await this.root('正文')
    let files: string[] = []
    try { files = await readdir(root) } catch { return [] }
    const chapters = await Promise.all(files.map((file) => this.chapterFromFile(root, file)))
    const physical = chapters.filter((item): item is StoredChapterFile => Boolean(item)).sort((a, b) => a.id - b.id)
    const ids = physical.map((item) => item.id)
    if (new Set(ids).size !== ids.length) {
      throw new AppError('INVALID_PROJECT_STATE', '检测到重复的章节文件编号，请先处理同编号稿件', { recoverable: true })
    }
    const orderedIds = await this.chapterOrder(ids)
    const byId = new Map(physical.map((item) => [item.id, item]))
    return orderedIds.map((id, index) => ({ ...byId.get(id)!, position: index + 1 }))
  }

  async reorderChapter(id: number, position: number): Promise<Chapter[]> {
    if (!Number.isSafeInteger(id) || id < 1) throw new Error('章节编号无效')
    if (!Number.isSafeInteger(position) || position < 1) throw new Error('章节顺序无效')
    return this.serializeOrderMutation(async () => {
      const formal = await this.formalManuscript()
      if (formal) return formal.authority.reorderChapter(formal.workItemId, id, position)
      const chapters = await this.storedChapters()
      const currentIndex = chapters.findIndex((item) => item.id === id)
      if (currentIndex < 0) throw new AppError('NOT_FOUND', `第 ${id} 章不存在`, { recoverable: true, details: { chapterId: id } })
      if (position > chapters.length) {
        throw new AppError('VALIDATION_ERROR', `章序必须在 1 到 ${chapters.length} 之间`, { recoverable: true, details: { field: 'position' } })
      }
      if (currentIndex !== position - 1) {
        const ids = chapters.map((item) => item.id)
        ids.splice(currentIndex, 1)
        ids.splice(position - 1, 0, id)
        await this.persistChapterOrder(ids)
      }
      return this.chapters()
    })
  }

  async chapter(id: number): Promise<Chapter> {
    const formal = await this.formalManuscript()
    if (formal) {
      const match = (await formal.authority.chapters(formal.workItemId)).find((item) => item.id === id)
      if (!match) throw new AppError('NOT_FOUND', `第 ${id} 章不存在`, { recoverable: true, details: { chapterId: id } })
      return match
    }
    const match = (await this.storedChapters()).find((item) => item.id === id)
    if (!match) throw new AppError('NOT_FOUND', `第 ${id} 章不存在`, { recoverable: true, details: { chapterId: id } })
    return withoutPath(match)
  }

  async createChapter(): Promise<Chapter> {
    const workItemId = await this.projects.currentPath()
    return this.serializeOrderMutation(async () => {
      const formal = await this.formalManuscript()
      if (await this.projects.currentPath() !== workItemId) throw new AppError('CONFLICT', '作品已切换，请重新新建章节。', { recoverable: true })
      if (formal && await formal.authority.outlineActive(formal.workItemId)) return formal.authority.createChapter(formal.workItemId)
      let largest = 0
      const sources = [
        ...(!formal ? [{ directory: '正文', pattern: /^第(\d+)章.*\.md$/ }] : []),
        { directory: '大纲/章纲', pattern: /^第(\d+)章\.md$/ },
        { directory: '.webnovel/history/chapters', pattern: /^(\d+)$/ },
        { directory: '.webnovel/trash/chapters', pattern: /^(\d+)\.json$/ }
      ]
      for (const source of sources) {
        const directory = await projectDirectory(workItemId, join(workItemId, source.directory))
        let names: string[]
        try { names = await readdir(directory) }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error }
        for (const name of names) {
          const match = source.pattern.exec(name)
          if (match) largest = Math.max(largest, Number(match[1]))
        }
      }
      if (!Number.isSafeInteger(largest) || largest >= 1_000_000) throw new AppError('CONFLICT', '章节编号已达到支持范围，未创建正文。', { recoverable: true })
      if (await this.projects.currentPath() !== workItemId) throw new AppError('CONFLICT', '作品已切换，请重新新建章节。', { recoverable: true })
      if (formal) return formal.authority.createChapter(formal.workItemId, largest + 1)
      return this.updateChapter(largest + 1, { title: '未命名', content: '' })
    })
  }

  async updateChapter(id: number, data: { title?: string; content?: string; reason?: ChapterRevisionReason; expectedRevision?: string; sourceTaskRunId?: string; generationArtifactId?: string; workItemId?: string; workItemPath?: string }): Promise<Chapter> {
    if (!Number.isInteger(id) || id < 1) throw new Error('章节编号无效')
    return this.serializeChapterMutation(id, async () => {
      const formal = await this.formalManuscript()
      if (formal) return formal.authority.updateChapter(formal.workItemId, id, data)
      const root = await this.root('正文')
      await mkdir(root, { recursive: true })
      const existing = (await this.storedChapters()).find((item) => item.id === id)
      this.assertExpectedRevision(id, data.expectedRevision, existing)
      const title = safeTitle(data.title ?? existing?.title ?? `第${id}章`)
      const target = contained(root, join(root, `第${id}章-${title}.md`))
      const content = data.content ?? existing?.content ?? ''
      if (existing && (existing.title !== title || existing.content !== content)) {
        const reason = data.reason ?? 'manual'
        if (reason !== 'autosave' || await this.shouldCaptureAutosave(id)) await this.captureRevision(existing, reason)
      }
      await atomicWriteText(target, content)
      if (existing && resolve(existing.path) !== resolve(target)) await unlink(existing.path)
      return this.chapter(id)
    })
  }

  async stageAutosave(id: number, input: ManuscriptAutosaveStageInput): Promise<ManuscriptAutosaveStageResult> {
    if (!Number.isInteger(id) || id < 1) throw new Error('章节编号无效')
    const formal = await this.formalManuscript()
    if (formal) return this.serializeChapterMutation(id, () => formal.authority.stageAutosave(formal.workItemId, id, input))
    const chapter = await this.updateChapter(id, {
      title: input.title,
      content: input.content,
      reason: 'autosave',
      expectedRevision: input.expectedRevision
    })
    return { storageMode: 'files', checkpoint: null, chapter, merged: false, idempotent: false }
  }

  async finalizeAutosave(checkpointId: string): Promise<ManuscriptAutosaveFinalizeResult> {
    const formal = await this.formalManuscript()
    if (!formal) throw new AppError('NOT_FOUND', '文件存储模式没有待提升的自动保存检查点', { recoverable: true })
    return formal.authority.finalizeAutosave(formal.workItemId, checkpointId)
  }

  async autosaveRecoveries(id?: number): Promise<ManuscriptAutosaveCheckpoint[]> {
    const formal = await this.formalManuscript()
    return formal ? formal.authority.autosaveRecoveries(formal.workItemId, id) : []
  }

  async discardAutosaveRecovery(checkpointId: string): Promise<ManuscriptAutosaveCheckpoint> {
    const formal = await this.formalManuscript()
    if (!formal) throw new AppError('NOT_FOUND', '文件存储模式没有自动保存检查点', { recoverable: true })
    return formal.authority.discardAutosaveRecovery(formal.workItemId, checkpointId)
  }

  async preserveDraft(id: number, data: { title: string; content: string; baseRevision?: string; workItemId?: string; workItemPath?: string }): Promise<{ success: true; recoveryRelativePath: string }> {
    if (!Number.isInteger(id) || id < 1) throw new Error('章节编号无效')
    const projectRoot = await this.projects.currentPath()
    const recoveryRoot = await projectDirectory(projectRoot, join(projectRoot, '.webnovel', 'recovery', 'manuscript'))
    await mkdir(recoveryRoot, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const path = contained(recoveryRoot, join(recoveryRoot, `${stamp}-第${id}章-${safeTitle(data.title)}-${randomUUID()}.md`))
    const header = `<!-- 岚笺冲突恢复副本；原章节：第${id}章；共同基线：${data.baseRevision ?? '未知'} -->\n\n`
    await atomicWriteText(path, `${header}${data.content}`)
    return { success: true, recoveryRelativePath: relative(projectRoot, path).replace(/\\/g, '/') }
  }

  async revisions(id: number): Promise<ChapterRevision[]> {
    if (!Number.isInteger(id) || id < 1) throw new Error('章节编号无效')
    const formal = await this.formalManuscript()
    if (formal) return formal.authority.revisions(formal.workItemId, id)
    const root = await this.revisionRoot(id)
    let files: string[] = []
    try { files = (await readdir(root)).filter((file) => file.endsWith('.json')) } catch { return [] }
    const values = await Promise.all(files.map(async (file) => {
      try {
        return validateRevision(JSON.parse(await readFile(await this.existingPath(contained(root, join(root, file))), 'utf8')), id)
      } catch { return null }
    }))
    return values.filter((item): item is ChapterRevision => Boolean(item)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  async nameCurrentRevision(id: number, labelValue: string): Promise<ChapterRevision> {
    if (!Number.isInteger(id) || id < 1) throw new Error('章节编号无效')
    const label = labelValue.trim()
    if (!label || label.length > 80) throw new AppError('VALIDATION_ERROR', '版本名称应为 1 到 80 个字符。', { recoverable: true })
    return this.serializeChapterMutation(id, async () => {
      const formal = await this.formalManuscript()
      if (formal) return formal.authority.nameCurrentRevision(formal.workItemId, id, label)
      const current = (await this.storedChapters()).find((item) => item.id === id)
      if (!current) throw new AppError('NOT_FOUND', `第 ${id} 章不存在`, { recoverable: true, details: { chapterId: id } })
      return this.captureRevision(current, 'manual', label)
    })
  }

  async restoreRevision(id: number, revisionId: string): Promise<Chapter> {
    if (!revisionPattern.test(revisionId)) throw new Error('历史版本编号无效')
    const formal = await this.formalManuscript()
    if (formal) return this.serializeChapterMutation(id, () => formal.authority.restoreRevision(formal.workItemId, id, revisionId))
    const current = (await this.storedChapters()).find((item) => item.id === id)
    if (!current) throw new AppError('NOT_FOUND', `第 ${id} 章不存在`, { recoverable: true, details: { chapterId: id } })
    const revision = (await this.revisions(id)).find((item) => item.id === revisionId)
    if (!revision) throw new Error('历史版本不存在或已经清理')
    await this.captureRevision(current, 'restore')
    return this.updateChapterWithoutRevision(id, revision.title, revision.content, current)
  }

  async previewExternalMirror(id: number): Promise<ChapterMirrorRecoveryPreview> {
    if (!this.manuscriptAuthority) throw new AppError('FEATURE_UNAVAILABLE', '当前作品不支持镜像恢复。', { recoverable: true })
    return this.manuscriptAuthority.previewExternalMirror(await this.projects.currentPath(), id)
  }

  async adoptExternalMirror(token: string): Promise<ChapterMirrorRecoveryResult> {
    const formal = await this.formalManuscript()
    if (!formal) throw new AppError('FEATURE_UNAVAILABLE', '当前作品仍由 Markdown 正式保存，不需要执行镜像恢复。', { recoverable: true })
    return formal.authority.adoptExternalMirror(formal.workItemId, token, () => this.assertRecoveryWorkItem(formal.workItemId))
  }

  async previewExternalOutlineMirror(id: number) {
    if (!this.manuscriptAuthority) throw new AppError('FEATURE_UNAVAILABLE', '当前作品不支持章纲镜像恢复。', { recoverable: true })
    return this.manuscriptAuthority.previewExternalOutlineMirror(await this.projects.currentPath(), id)
  }

  async adoptExternalOutlineMirror(token: string) {
    if (!this.manuscriptAuthority) throw new AppError('FEATURE_UNAVAILABLE', '当前作品不支持章纲镜像恢复。', { recoverable: true })
    const root = await this.projects.currentPath()
    return this.manuscriptAuthority.adoptExternalOutlineMirror(root, token, () => this.assertRecoveryWorkItem(root))
  }

  private async assertRecoveryWorkItem(root: string): Promise<void> {
    if (await this.projects.currentPath() !== root) throw new AppError('CONFLICT', '当前作品已切换，未采用上一部作品的外部稿。', { recoverable: true })
  }

  async deleteChapter(id: number): Promise<{ success: boolean; recovery: 'chapter-trash' }> {
    if (!Number.isSafeInteger(id) || id < 1) throw new AppError('VALIDATION_ERROR', '章节编号无效。', { recoverable: true })
    return this.serializeOrderMutation(async () => {
      const formal = await this.formalManuscript()
      if (formal) return this.serializeChapterMutation(id, () => formal.authority.deleteChapter(formal.workItemId, id))
      const chapters = await this.storedChapters()
      const chapter = chapters.find((item) => item.id === id)
      if (!chapter) throw new AppError('NOT_FOUND', `第 ${id} 章不存在`, { recoverable: true, details: { chapterId: id } })
      const trashRoot = await this.chapterTrashRoot()
      await mkdir(trashRoot, { recursive: true })
      const archivePath = contained(trashRoot, join(trashRoot, `${id}.json`))
      const archive: DeletedChapterArchiveFile = {
        version: 1,
        id: chapter.id,
        position: chapter.position,
        title: chapter.title,
        content: chapter.content,
        word_count: chapter.word_count,
        deletedAt: new Date().toISOString()
      }
      await atomicWriteText(archivePath, `${JSON.stringify(archive, null, 2)}\n`)
      const manuscriptRoot = await this.root('正文')
      try {
        await this.trash.trashItem(resolve(contained(manuscriptRoot, chapter.path)))
      } catch (error) {
        await unlink(archivePath).catch(() => undefined)
        throw error
      }
      await this.persistChapterOrder(chapters.filter((item) => item.id !== id).map((item) => item.id))
      return { success: true, recovery: 'chapter-trash' as const }
    })
  }

  async trashedChapters(): Promise<DeletedChapterSummary[]> {
    const formal = await this.formalManuscript()
    if (formal) return formal.authority.trashedChapters(formal.workItemId)
    const root = await this.chapterTrashRoot()
    let files: string[] = []
    try { files = (await readdir(root)).filter((file) => /^\d+\.json$/.test(file)) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
    const archives = await Promise.all(files.map((file) => this.readDeletedChapterArchive(contained(root, join(root, file)))))
    return archives
      .sort((left, right) => right.deletedAt.localeCompare(left.deletedAt))
      .map(({ content: _content, version: _version, ...summary }) => summary)
  }

  async restoreChapter(id: number): Promise<Chapter> {
    if (!Number.isSafeInteger(id) || id < 1) throw new AppError('VALIDATION_ERROR', '章节编号无效。', { recoverable: true })
    return this.serializeOrderMutation(async () => {
      const formal = await this.formalManuscript()
      if (formal) return this.serializeChapterMutation(id, () => formal.authority.restoreChapter(formal.workItemId, id))
      const chapters = await this.storedChapters()
      if (chapters.some((chapter) => chapter.id === id)) {
        throw new AppError('CONFLICT', '正文目录中已经存在同一章节，未覆盖现有内容。', { recoverable: true, details: { chapterId: id } })
      }
      const trashRoot = await this.chapterTrashRoot()
      const archivePath = contained(trashRoot, join(trashRoot, `${id}.json`))
      const archive = await this.readDeletedChapterArchive(archivePath)
      const preferredPosition = Math.max(1, Math.min(archive.position, chapters.length + 1))
      const order = chapters.map((chapter) => chapter.id)
      order.splice(preferredPosition - 1, 0, id)
      await this.persistChapterOrder(order)
      const manuscriptRoot = await this.root('正文')
      await mkdir(manuscriptRoot, { recursive: true })
      const target = contained(manuscriptRoot, join(manuscriptRoot, `第${id}章-${safeTitle(archive.title)}.md`))
      await atomicWriteText(target, archive.content)
      await unlink(archivePath)
      return this.chapter(id)
    })
  }

  async chapterStats(): Promise<Record<string, number>> {
    const chapters = await this.chapters()
    return { total_chapters: chapters.length, total_words: chapters.reduce((sum, item) => sum + item.word_count, 0) }
  }

  async outlines(): Promise<OutlineList> {
    const formal = await this.formalOutline()
    if (formal) return formal.authority.outlines(formal.workItemId)
    const root = await this.root('大纲')
    let files: string[] = []
    try { files = (await readdir(root)).filter((file) => file.endsWith('.md')) } catch { return { total: null, volumes: [] } }
    const volumes = await Promise.all(files.filter((file) => /\d+/.test(file)).map(async (file) => ({
      volume: Number(file.match(/\d+/)?.[0]),
      title: file.replace(/\.md$/, ''),
      content: await readFile(await this.existingPath(contained(root, join(root, file))), 'utf8')
    })))
    const totalFile = files.find((file) => /总纲/.test(file))
    return { total: totalFile ? { content: await readFile(await this.existingPath(contained(root, join(root, totalFile))), 'utf8') } : null, volumes: volumes.sort((a, b) => a.volume - b.volume) }
  }

  async outline(volume: OutlineVolume): Promise<OutlineDocument> {
    const all = await this.outlines()
    if (volume === 'total') return all.total ?? { content: '' }
    return all.volumes.find((item) => item.volume === volume) ?? { volume, content: '' }
  }

  async updateOutline(volume: OutlineVolume, content: string): Promise<OutlineUpdateResult> {
    const formal = await this.formalOutline()
    if (formal) return formal.authority.updateOutline(formal.workItemId, volume, content)
    const root = await this.root('大纲')
    const filename = volume === 'total' ? '总纲.md' : `第${volume}卷-大纲.md`
    const path = contained(root, join(root, filename))
    await atomicWriteText(path, content)
    return { success: true, volume, content, storageMode: 'files', mirrorStatus: 'synced' }
  }

  async createStage(volume: number, title: string): Promise<StageOutlineUpdateResult> {
    const formal = await this.formalOutline()
    if (!formal) throw new AppError('FEATURE_UNAVAILABLE', '阶段纲将在作品切换为 SQLite 正式数据后启用。', { recoverable: true })
    return formal.authority.createStage(formal.workItemId, volume, title)
  }

  async getPlannedChapter(chapterId: number): Promise<PlannedChapterOutline> {
    const formal = await this.formalOutline()
    if (!formal) throw new AppError('FEATURE_UNAVAILABLE', '独立章纲需要本书启用 SQLite 正式大纲。', { recoverable: true })
    return formal.authority.getPlannedChapter(formal.workItemId, chapterId)
  }

  async updatePlannedChapter(input: PlannedChapterOutlineUpdate): Promise<PlannedChapterOutline> {
    const formal = await this.formalOutline()
    if (!formal) throw new AppError('FEATURE_UNAVAILABLE', '独立章纲需要本书启用 SQLite 正式大纲。', { recoverable: true })
    return formal.authority.updatePlannedChapter(formal.workItemId, input)
  }

  async startPlannedChapter(input: PlannedChapterStartInput, expectedWorkItemId?: string): Promise<PlannedChapterStartResult> {
    const formal = await this.formalOutline()
    if (!formal) throw new AppError('FEATURE_UNAVAILABLE', '请先启用 SQLite 正式大纲。', { recoverable: true })
    if (expectedWorkItemId !== undefined && formal.workItemId !== expectedWorkItemId) throw new AppError('CONFLICT', '作品已切换，未在新作品中创建正文。', { recoverable: true })
    return formal.authority.startPlannedChapter(formal.workItemId, input)
  }

  async updateStage(stage: number, title: string, content: string): Promise<StageOutlineUpdateResult> {
    const formal = await this.formalOutline()
    if (!formal) throw new AppError('FEATURE_UNAVAILABLE', '阶段纲将在作品切换为 SQLite 正式数据后启用。', { recoverable: true })
    return formal.authority.updateStage(formal.workItemId, stage, title, content)
  }

  async placeChapterInStage(chapterId: number, stage: number | null, volume: number | null): Promise<StageOutlineUpdateResult | { success: true; stage: null; storageMode: 'sqlite' }> {
    const formal = await this.formalOutline()
    if (!formal) throw new AppError('FEATURE_UNAVAILABLE', '章节阶段归属将在作品切换为 SQLite 正式数据后启用。', { recoverable: true })
    return formal.authority.placeChapterInStage(formal.workItemId, chapterId, stage, volume)
  }

  async outlineTree(): Promise<{ volumes: OutlineList['volumes'] }> {
    const all = await this.outlines()
    return { volumes: all.volumes }
  }

  async chapterOutlines(): Promise<ChapterOutlineDocument[]> {
    const formal = await this.formalOutline()
    if (formal) return formal.authority.chapterOutlines(formal.workItemId)
    const root = await this.chapterOutlineRoot()
    let files: string[] = []
    try { files = (await readdir(root)).filter((file) => /^第\d+章\.md$/.test(file)) } catch { return [] }
    const values = await Promise.all(files.map(async (file) => {
      const path = await this.existingPath(contained(root, join(root, file)))
      return { chapterId: Number(file.match(/\d+/)?.[0]), content: await readFile(path, 'utf8') }
    }))
    return values.sort((a, b) => a.chapterId - b.chapterId)
  }

  async chapterOutline(chapterId: number): Promise<ChapterOutlineDocument> {
    const existing = (await this.chapterOutlines()).find((item) => item.chapterId === chapterId)
    return existing ?? { chapterId, content: '' }
  }

  async updateChapterOutline(chapterId: number, content: string, plannedVolume?: number): Promise<ChapterOutlineDocument> {
    if (!Number.isInteger(chapterId) || chapterId < 1) throw new Error('章节编号无效')
    const formal = await this.formalOutline()
    if (formal) return formal.authority.updateChapterOutline(formal.workItemId, chapterId, content, plannedVolume)
    const root = await this.chapterOutlineRoot()
    await mkdir(root, { recursive: true })
    const path = contained(root, join(root, `第${chapterId}章.md`))
    await atomicWriteText(path, content)
    return { chapterId, content, storageMode: 'files', mirrorStatus: 'synced' }
  }

  private async chapterFromFile(root: string, file: string): Promise<StoredChapterFile | null> {
    const identity = parseChapterFileName(file)
    if (!identity) return null
    const path = await this.existingPath(contained(root, join(root, file)))
    if (!(await stat(path)).isFile()) return null
    const content = await readFile(path, 'utf8')
    return { ...identity, content, word_count: countWords(content), summary: '', revision: chapterRevision(identity.id, identity.title, content), path }
  }

  private async revisionRoot(id: number): Promise<string> {
    const projectRoot = await this.projects.currentPath()
    return projectDirectory(projectRoot, join(projectRoot, '.webnovel', 'history', 'chapters', String(id)))
  }

  private async chapterOutlineRoot(): Promise<string> {
    const projectRoot = await this.projects.currentPath()
    return projectDirectory(projectRoot, join(projectRoot, '大纲', '章纲'))
  }

  private async chapterTrashRoot(): Promise<string> {
    const projectRoot = await this.projects.currentPath()
    return projectDirectory(projectRoot, join(projectRoot, '.webnovel', 'trash', 'chapters'))
  }

  private async readDeletedChapterArchive(path: string): Promise<DeletedChapterArchiveFile> {
    let value: unknown
    try { value = JSON.parse(await readFile(await this.existingPath(path), 'utf8')) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new AppError('NOT_FOUND', '回收站中没有这个章节。', { recoverable: true })
      if (error instanceof SyntaxError) throw new AppError('INVALID_PROJECT_STATE', '章节回收记录损坏，未执行恢复。', { recoverable: true })
      throw error
    }
    return validateDeletedChapterArchive(value)
  }

  private async chapterOrderFile(): Promise<string> {
    const projectRoot = await this.projects.currentPath()
    return projectDirectory(projectRoot, join(projectRoot, '.webnovel', 'manuscript', 'chapter-order.json'))
  }

  private async chapterOrder(physicalIds: number[]): Promise<number[]> {
    let parsed: unknown
    try {
      parsed = JSON.parse(await readFile(await this.chapterOrderFile(), 'utf8'))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return physicalIds
      if (error instanceof SyntaxError) {
        throw invalidChapterOrder('章节顺序文件损坏，未对稿件执行任何改动')
      }
      throw error
    }
    if (!isChapterOrderFile(parsed)) {
      throw invalidChapterOrder('章节顺序文件格式无效，未对稿件执行任何改动')
    }
    const physical = new Set(physicalIds)
    const ordered = parsed.chapterIds.filter((id) => physical.has(id))
    const recorded = new Set(ordered)
    return [...ordered, ...physicalIds.filter((id) => !recorded.has(id))]
  }

  private async persistChapterOrder(chapterIds: number[]): Promise<void> {
    const path = await this.chapterOrderFile()
    await mkdir(dirname(path), { recursive: true })
    await atomicWriteText(path, `${JSON.stringify({ version: 1, chapterIds } satisfies ChapterOrderFile, null, 2)}\n`)
  }

  private async serializeOrderMutation<T>(mutation: () => Promise<T>): Promise<T> {
    const previous = this.orderMutation
    let release!: () => void
    this.orderMutation = new Promise<void>((resolve) => { release = resolve })
    await previous
    try { return await mutation() } finally { release() }
  }

  private async serializeChapterMutation<T>(id: number, mutation: () => Promise<T>): Promise<T> {
    const previous = this.chapterMutations.get(id) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((resolve) => { release = resolve })
    this.chapterMutations.set(id, current)
    await previous
    try { return await mutation() } finally {
      release()
      if (this.chapterMutations.get(id) === current) this.chapterMutations.delete(id)
    }
  }

  private assertExpectedRevision(id: number, expectedRevision: string | undefined, existing: StoredChapter | undefined): void {
    if (!expectedRevision) return
    if (existing?.revision === expectedRevision) return
    throw new AppError('CONFLICT', existing
      ? '磁盘上的正文已被其他程序修改，岚笺没有覆盖它。当前草稿仍保留在编辑器中。'
      : '磁盘上的正文已被移动或删除，岚笺没有重新建立或覆盖文件。当前草稿仍保留在编辑器中。', {
      recoverable: true,
      details: {
        area: 'manuscript',
        reason: existing ? 'external-change' : 'missing',
        chapterId: id,
        expectedRevision,
        externalChapter: existing ? withoutPath(existing) : null
      }
    })
  }

  private async captureRevision(chapter: Chapter, reason: ChapterRevisionReason, label?: string): Promise<ChapterRevision> {
    const root = await this.revisionRoot(chapter.id)
    await mkdir(root, { recursive: true })
    const now = Date.now()
    const revision: ChapterRevision = {
      id: `${now}-${randomUUID()}`,
      chapterId: chapter.id,
      title: chapter.title,
      content: chapter.content,
      word_count: chapter.word_count,
      createdAt: new Date(now).toISOString(),
      reason,
      ...(label ? { label } : {})
    }
    await atomicWriteText(contained(root, join(root, `${revision.id}.json`)), `${JSON.stringify(revision, null, 2)}\n`)
    const files = (await readdir(root)).filter((file) => file.endsWith('.json')).sort()
    await Promise.all(files.slice(0, Math.max(0, files.length - revisionLimit)).map((file) => unlink(contained(root, join(root, file)))))
    return revision
  }

  private async shouldCaptureAutosave(id: number): Promise<boolean> {
    const latest = (await this.revisions(id))[0]
    let configuredWindow = autosaveRevisionWindowStartingSuggestionMs
    try {
      const value = Number(await this.autosaveMergeWindowMs())
      if (Number.isSafeInteger(value) && value >= 1_000 && value <= 600_000) configuredWindow = value
    } catch {
      // A settings read must never prevent a local manuscript save.
    }
    return !latest || latest.reason !== 'autosave' || Date.now() - Date.parse(latest.createdAt) >= configuredWindow
  }

  private async updateChapterWithoutRevision(id: number, titleValue: string, content: string, existing: StoredChapter): Promise<Chapter> {
    const root = await this.root('正文')
    const title = safeTitle(titleValue)
    const target = contained(root, join(root, `第${id}章-${title}.md`))
    await atomicWriteText(target, content)
    if (resolve(existing.path) !== resolve(target)) await unlink(existing.path)
    return this.chapter(id)
  }
}

function validateRevision(value: unknown, chapterId: number): ChapterRevision | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Partial<ChapterRevision>
  if (!item.id || !revisionPattern.test(item.id) || item.chapterId !== chapterId) return null
  if (typeof item.title !== 'string' || typeof item.content !== 'string' || typeof item.createdAt !== 'string') return null
  if (!['manual', 'autosave', 'ai', 'restore'].includes(item.reason ?? '')) return null
  if (item.label != null && (typeof item.label !== 'string' || !item.label.trim() || item.label.length > 80)) return null
  return { ...item, label: item.label?.trim() || null, isCurrent: false, word_count: countWords(item.content) } as ChapterRevision
}

function contained(root: string, candidate: string): string {
  const base = `${resolve(root)}${sep}`
  const value = resolve(candidate)
  if (!value.startsWith(base)) throw new AppError('PATH_ESCAPE', '文件路径超出了项目目录')
  return value
}

function safeTitle(title: string): string {
  return title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim() || '未命名'
}

function countWords(content: string): number {
  const chinese = content.match(/[\u3400-\u9fff]/g)?.length ?? 0
  const latin = content.match(/[A-Za-z0-9]+/g)?.length ?? 0
  return chinese + latin
}

function chapterRevision(id: number, title: string, content: string): string {
  return createHash('sha256').update(`${id}\u0000${title}\u0000${content}`).digest('hex')
}

function withoutPath(chapter: StoredChapter): Chapter {
  const { path: _path, ...value } = chapter
  return value
}

function isChapterOrderFile(value: unknown): value is ChapterOrderFile {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  if (record.version !== 1 || !Array.isArray(record.chapterIds)) return false
  const ids = record.chapterIds
  return ids.every((id) => Number.isSafeInteger(id) && Number(id) >= 1 && Number(id) <= 1_000_000)
    && new Set(ids).size === ids.length
}

function validateDeletedChapterArchive(value: unknown): DeletedChapterArchiveFile {
  if (!value || typeof value !== 'object') throw invalidChapterTrash()
  const item = value as Partial<DeletedChapterArchiveFile>
  if (item.version !== 1
    || !Number.isSafeInteger(item.id) || Number(item.id) < 1 || Number(item.id) > 1_000_000
    || !Number.isSafeInteger(item.position) || Number(item.position) < 1 || Number(item.position) > 1_000_000
    || typeof item.title !== 'string' || !item.title.trim() || item.title.length > 200
    || typeof item.content !== 'string' || item.content.length > 2_000_000
    || !Number.isSafeInteger(item.word_count) || Number(item.word_count) < 0
    || typeof item.deletedAt !== 'string' || !Number.isFinite(Date.parse(item.deletedAt))) throw invalidChapterTrash()
  return item as DeletedChapterArchiveFile
}

function invalidChapterTrash(): AppError {
  return new AppError('INVALID_PROJECT_STATE', '章节回收记录格式无效，未执行恢复。', { recoverable: true, details: { area: 'chapterTrash' } })
}

function invalidChapterOrder(message: string): AppError {
  return new AppError('INVALID_PROJECT_STATE', message, { recoverable: true, details: { area: 'chapterOrder' } })
}
