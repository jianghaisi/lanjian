import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { ProjectSummary } from '../../../../contracts/index'
import { parseChapterFileName } from '../../manuscript/domain/chapter-file'
import { projectExistingPath } from '../../../platform/storage/project-path'
import { stableEventReadSnapshot } from '../../timeline/adapters/event-read-snapshot'

type LastEditedChapter = ProjectSummary['manuscript']['lastEditedChapter']
const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT'

/** Shelf metadata never activates a workspace or creates/migrates a database. */
export async function readLibraryLastEditedChapter(root: string): Promise<LastEditedChapter> {
  const databasePath = join(root, '.webnovel', 'workspace.sqlite')
  let hasDatabase = false
  try {
    await projectExistingPath(root, databasePath)
    for (const suffix of ['-wal', '-shm']) {
      try { await projectExistingPath(root, databasePath + suffix) } catch (error) { if (!missing(error)) throw error }
    }
    hasDatabase = true
  } catch (error) { if (!missing(error)) throw error }
  if (hasDatabase) {
    const snapshot = await stableEventReadSnapshot(root)
    if (!snapshot) throw new Error('Shelf database changed while reading')
    let database: DatabaseSync | undefined
    try {
      database = new DatabaseSync(snapshot.path, { readOnly: true, allowExtension: false })
      const projects = database.prepare('SELECT * FROM projects LIMIT 2').all()
      if (projects.length !== 1) throw new Error('Ambiguous shelf authority')
      if (projects[0]!.storage_mode === 'sqlite') {
        const row = database.prepare(`SELECT c.legacy_chapter_id, c.title, c.updated_at,
          (SELECT count(*) FROM chapters before WHERE before.project_id = c.project_id AND before.status <> 'archived' AND before.seq <= c.seq) AS position
          FROM chapters c WHERE c.project_id = ? AND c.status <> 'archived'
          ORDER BY c.updated_at DESC, c.seq DESC LIMIT 1`).get(String(projects[0]!.id))
        const head = row && projects[0]!.text_authority === 'files-v1'
          ? database.prepare("SELECT h.title FROM manuscript_file_heads h JOIN chapters c ON c.id = h.document_id WHERE c.project_id = ? AND c.legacy_chapter_id = ? AND h.kind = 'body'").get(String(projects[0]!.id), Number(row.legacy_chapter_id)) : null
        return row ? { id: Number(row.legacy_chapter_id), position: Number(row.position), title: String(head?.title ?? row.title).slice(0, 500), updatedAt: String(row.updated_at) } : null
      }
      if (projects[0]!.storage_mode !== 'shadow') throw new Error('Unknown shelf authority')
    } finally { try { database?.close() } finally { snapshot.dispose() } }
  }
  let files: string[]
  try { files = await readdir(await projectExistingPath(root, join(root, '正文'))) }
  catch (error) { if (!missing(error)) throw error; return null }
  const indexed = files.map(file => ({ file, chapter: parseChapterFileName(file) })).filter(item => item.chapter)
  const ids = [...new Set(indexed.map(item => item.chapter!.id))].sort((a, b) => a - b)
  let latest: LastEditedChapter = null
  for (let offset = 0; offset < indexed.length; offset += 24) {
    const batch = await Promise.all(indexed.slice(offset, offset + 24).map(async item => {
      const metadata = await stat(await projectExistingPath(root, join(root, '正文', item.file)))
      return metadata.isFile() ? { id: item.chapter!.id, position: ids.indexOf(item.chapter!.id) + 1, title: item.chapter!.title.slice(0, 500), updatedAt: metadata.mtime.toISOString() } : null
    }))
    for (const chapter of batch) if (chapter && (!latest || chapter.updatedAt > latest.updatedAt)) latest = chapter
  }
  return latest
}
