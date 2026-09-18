import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { AppError } from '../../../core/errors/app-error'
import { parseChapterFileName } from '../../manuscript/domain/chapter-file'
import { canonicalDirectory, projectExistingPath } from '../../../platform/storage/project-path'
import { stableEventReadSnapshot } from '../../timeline/adapters/event-read-snapshot'
import { ManuscriptCommitJournal } from '../../manuscript/adapters/manuscript-commit-journal'
import { measureManuscript } from '../../../../contracts/manuscript/manuscript-metrics'
import { libraryOutlinePageSize, type LibraryOutlineChapter, type LibraryOutlinePreview, type LibraryOutlineRequest } from '../../../../contracts/library/library-outline-preview'

type Registry = { load(): Promise<{ recentProjects: string[] }> }
type Planning = { volumes: Array<{ id: number; title: string }>; placements: Map<number, number> }
const emptyPlanning = (): Planning => ({ volumes: [], placements: new Map() })
const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT'
const identity = (value: string) => process.platform === 'win32' ? value.toLocaleLowerCase() : value

/** Shelf-only projection. Never opens the mutating factory, switches a book, or writes mirrors. */
export class LibraryOutlinePreviewService {
  constructor(private readonly registry: Registry) {}

  async preview(input: LibraryOutlineRequest): Promise<LibraryOutlinePreview> {
    const root = await canonicalDirectory(input.path)
    const recent = (await this.registry.load()).recentProjects
    let registered = false
    for (const path of recent) {
      try { if (identity(await canonicalDirectory(path)) === identity(root)) { registered = true; break } }
      catch { /* stale registry entry does not authorize another directory */ }
    }
    if (!registered) throw new AppError('VALIDATION_ERROR', '请先将这部作品加入书架，再预览目录。')
    const databasePath = join(root, '.webnovel', 'workspace.sqlite')
    try {
      await projectExistingPath(root, databasePath)
      // SQLite may read WAL sidecars. They must remain inside this same registered book.
      for (const suffix of ['-wal', '-shm']) {
        try { await projectExistingPath(root, databasePath + suffix) } catch (error) { if (!missing(error)) throw error }
      }
    } catch (error) {
      if (missing(error)) return this.files(root, input.offset)
      throw error
    }
    let database: DatabaseSync | undefined
    const snapshot = await stableEventReadSnapshot(root)
    if (!snapshot) throw new AppError('CONFLICT', '目录预览期间数据库已变化，请重试。', { recoverable: true })
    try {
      database = new DatabaseSync(snapshot.path, { readOnly: true, enableForeignKeyConstraints: true, allowExtension: false })
      database.exec('PRAGMA query_only = ON; BEGIN;')
      const projects = database.prepare('SELECT * FROM projects LIMIT 2').all()
      if (projects.length !== 1 || !['sqlite', 'shadow'].includes(String(projects[0]?.storage_mode))) throw new Error('ambiguous storage authority')
      if (projects[0]!.storage_mode === 'shadow') { database.close(); database = undefined; return this.files(root, input.offset) }
      const project = projects[0]!
      const fileText = project.text_authority === 'files-v1'
      if (project.text_authority !== undefined && !['legacy-sqlite', 'files-v1'].includes(String(project.text_authority))) throw new Error('unknown text authority')
      let planning = emptyPlanning()
      let notice = ''
      if (project.outline_planning_state_ready === 1) {
        const row = database.prepare('SELECT substr(content_json, 1, 4000001) AS content FROM outline_planning_state_documents WHERE project_id = ?').get(String(project.id))
        planning = parsePlanning(String(row?.content ?? ''))
      } else {
        // This module can still be file-authoritative until explicitly migrated.
        planning = await this.planning(root)
      }
      const total = Number(database.prepare("SELECT count(*) AS count FROM chapters WHERE project_id = ? AND status <> 'archived'").get(String(project.id))?.count ?? 0)
      const rows = database.prepare(`SELECT c.id, c.legacy_chapter_id, c.title, c.status, c.updated_at, ${fileText ? 'b.content_hash' : 'NULL'} AS content_hash,
        CASE WHEN length(b.content) <= 100000 THEN b.content ELSE NULL END AS body
        FROM chapters c LEFT JOIN body_versions b ON b.id = c.current_body_version_id AND b.chapter_id = c.id
        WHERE c.project_id = ? AND c.status <> 'archived' ORDER BY c.seq LIMIT ? OFFSET ?`).all(String(project.id), libraryOutlinePageSize, input.offset)
      const currentFiles = new ManuscriptCommitJournal(root)
      const chapters: LibraryOutlineChapter[] = rows.map(row => {
        const head = fileText ? database!.prepare("SELECT title, relative_path FROM manuscript_file_heads WHERE document_id = ? AND kind = 'body'").get(String(row.id)) : null
        if (fileText && !head) throw new AppError('INVALID_PROJECT_STATE', '当前章稿缺少文件身份，未将它当作空稿。', { recoverable: true })
        const current = head ? currentFiles.readCurrent(String(head.relative_path)) : null
        if (head && !current) throw new AppError('NOT_FOUND', '目录中的稿件文件缺失，请打开作品核对；未从历史补写。', { recoverable: true })
        const body = current ? current.content.length <= 100_000 ? current.content : null : row.body
        return {
          id: Number(row.legacy_chapter_id), title: String(head?.title ?? row.title).slice(0, 500), volume: planning.placements.get(Number(row.legacy_chapter_id)) ?? null,
          status: row.status === 'confirmed' && (!current || current.hash === row.content_hash) ? 'confirmed' : 'draft', updatedAt: String(row.updated_at),
          wordCount: typeof body === 'string' ? measureManuscript(body).wordCount : null, canOpen: true
        }
      })
      if (chapters.some(chapter => chapter.volume === null)) notice = '未分卷章节保留在独立分组，不自动猜测归属。'
      return page('sqlite', chapters, planning, total, input.offset, notice)
    } catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError('INVALID_PROJECT_STATE', '正式目录暂时无法读取。请打开作品检查数据状态；没有改动正文，也没有改用镜像猜测目录。', { recoverable: true })
    } finally { try { database?.close() } finally { snapshot.dispose() } }
  }

  private async planning(root: string): Promise<Planning> {
    try {
      const file = await projectExistingPath(root, join(root, '.webnovel', 'planning', 'outline-state.json'))
      if ((await stat(file)).size > 4_000_000) throw new Error('large planning ledger')
      return parsePlanning(await readFile(file, 'utf8'))
    } catch (error) {
      if (missing(error)) return emptyPlanning()
      if (error instanceof AppError) throw error
      throw new AppError('INVALID_PROJECT_STATE', '篇卷目录需要核对，请打开作品处理；预览没有修改任何文件。', { recoverable: true })
    }
  }

  private async files(root: string, offset: number): Promise<LibraryOutlinePreview> {
    const planning = await this.planning(root)
    let files: string[]
    try { files = await readdir(await projectExistingPath(root, join(root, '正文'))) }
    catch (error) { if (!missing(error)) throw error; files = [] }
    if (files.length > 100_000) throw new AppError('INVALID_PROJECT_STATE', '章稿目录过大，请打开作品查看。')
    const indexed = files.map(file => ({ file, parsed: parseChapterFileName(file) })).filter(item => item.parsed)
      .sort((a, b) => a.parsed!.id - b.parsed!.id || a.file.localeCompare(b.file))
    const counts = new Map<number, number>()
    for (const item of indexed) counts.set(item.parsed!.id, (counts.get(item.parsed!.id) ?? 0) + 1)
    const unique = indexed.filter((item, index) => index === 0 || indexed[index - 1]!.parsed!.id !== item.parsed!.id)
    const chapters = await Promise.all(unique.slice(offset, offset + libraryOutlinePageSize).map(async item => {
      const metadata = await stat(await projectExistingPath(root, join(root, '正文', item.file)))
      if (!metadata.isFile()) throw new AppError('INVALID_PROJECT_STATE', '章稿路径不是普通文件，请打开作品核对。')
      return { id: item.parsed!.id, title: item.parsed!.title.slice(0, 500), volume: planning.placements.get(item.parsed!.id) ?? null,
        status: 'unknown' as const, updatedAt: metadata.mtime.toISOString(), wordCount: null, canOpen: counts.get(item.parsed!.id) === 1 }
    }))
    return page('files', chapters, planning, unique.length, offset, '文件模式仅预览目录，不读取整本正文；章节字数与确认状态进入作品后查看。重复章号须先核对。')
  }
}

function page(source: LibraryOutlinePreview['source'], chapters: LibraryOutlineChapter[], planning: Planning, totalChapters: number, offset: number, notice: string): LibraryOutlinePreview {
  const ids = new Set(chapters.map(chapter => chapter.volume))
  return { source, chapters, volumes: planning.volumes.length <= libraryOutlinePageSize ? planning.volumes : planning.volumes.filter(volume => ids.has(volume.id)), totalChapters, offset,
    nextOffset: offset + chapters.length < totalChapters ? offset + chapters.length : null, notice }
}

function parsePlanning(content: string): Planning {
  if (content.length > 4_000_000) throw new Error('large planning ledger')
  const value: unknown = JSON.parse(content)
  if (!value || typeof value !== 'object') throw new Error('invalid planning ledger')
  const record = value as { volumes?: unknown; chapterPlacements?: unknown }
  if (!Array.isArray(record.volumes) || !Array.isArray(record.chapterPlacements) || record.volumes.length > 10_000 || record.chapterPlacements.length > 100_000) throw new Error('invalid planning lists')
  const result = emptyPlanning()
  const seen = new Set<number>()
  for (const row of record.volumes) {
    if (!row || !Number.isSafeInteger(row.volume) || row.volume < 1 || typeof row.title !== 'string' || !row.title.trim() || seen.has(row.volume)) throw new Error('invalid volume')
    seen.add(row.volume); result.volumes.push({ id: row.volume, title: row.title.slice(0, 500) })
  }
  for (const row of record.chapterPlacements) {
    if (!row || !Number.isSafeInteger(row.chapterId) || row.chapterId < 1 || !seen.has(row.volume) || result.placements.has(row.chapterId)) throw new Error('invalid placement')
    result.placements.set(row.chapterId, row.volume)
  }
  return result
}
