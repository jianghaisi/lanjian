import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { AppError } from '../../../core/errors/app-error'
import type { LegacyWorkspacePromptProfile, LegacyWorkspaceSnapshot, LegacyWorkspaceSource } from '../../../core/ports/workspace-database'
import { projectDirectory, projectExistingPath } from '../../../platform/storage/project-path'
import { DocumentService } from '../../manuscript/application/document-service'
import { ProjectService } from './project-service'

export class CurrentProjectLegacyWorkspaceSource implements LegacyWorkspaceSource {
  constructor(
    private readonly projects: ProjectService,
    private readonly documents: DocumentService
  ) {}

  async snapshot(): Promise<LegacyWorkspaceSnapshot> {
    const rootBefore = await this.projects.currentPath()
    const migration = await this.projects.migrationPreview()
    if (migration.required) {
      const blocker = migration.issues.find((issue) => issue.severity === 'blocker')
      throw new AppError('CONFLICT', blocker
        ? `${blocker.title}：${blocker.message}`
        : '这部作品仍是旧版文件结构，请先完成现有安全升级，再建立 SQLite 影子数据。', {
        recoverable: true,
        details: { area: 'workspaceDatabase', reason: blocker?.id || 'legacy-schema' }
      })
    }
    await this.documents.validateChapterOrderLedger()
    const revisionBefore = await this.documents.manuscriptRevision()
    const outlineSnapshotBefore = await this.outlineSnapshot()
    const statePath = await projectExistingPath(rootBefore, join(rootBefore, '.webnovel', 'state.json'))
    const manifest = await readFile(statePath, 'utf8')
    const project = await this.projects.currentSummary()
    const promptProfileBefore = await this.promptProfileSnapshot(rootBefore, project.id)
    const chapters = await this.documents.chapters()
    const snapshotChapters = chapters.map((chapter) => ({
      legacyChapterId: chapter.id,
      position: chapter.position,
      title: chapter.title,
      content: chapter.content,
      contentHash: hashText(chapter.content),
      wordCount: chapter.word_count,
      mirrorRelativePath: `正文/第${chapter.id}章-${safeMirrorTitle(chapter.title)}.md`
    }))
    const chapterOrderRelativePath = '.webnovel/manuscript/chapter-order.json'
    const chapterOrderPath = await projectDirectory(rootBefore, join(rootBefore, ...chapterOrderRelativePath.split('/')))
    let chapterOrderContent = `${JSON.stringify({ version: 1, chapterIds: snapshotChapters.map((chapter) => chapter.legacyChapterId) }, null, 2)}\n`
    let chapterOrderObservedHash: string | null = null
    try {
      chapterOrderContent = await readFile(await projectExistingPath(rootBefore, chapterOrderPath), 'utf8')
      chapterOrderObservedHash = hashText(chapterOrderContent)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const revisionAfter = await this.documents.manuscriptRevision()
    const outlineSnapshotAfter = await this.outlineSnapshot()
    const promptProfileAfter = await this.promptProfileSnapshot(rootBefore, project.id)
    const rootAfter = await this.projects.currentPath()
    if (rootAfter !== rootBefore || revisionAfter !== revisionBefore || hashText(JSON.stringify(outlineSnapshotAfter)) !== hashText(JSON.stringify(outlineSnapshotBefore))
      || hashText(JSON.stringify(promptProfileAfter)) !== hashText(JSON.stringify(promptProfileBefore))) {
      throw new AppError('CONFLICT', '扫描书稿时检测到项目或正文发生变化，请重新检查；原稿没有改动。', {
        recoverable: true,
        details: { area: 'workspaceDatabase', reason: rootAfter !== rootBefore ? 'project-switched' : revisionAfter !== revisionBefore ? 'manuscript-changed' : hashText(JSON.stringify(outlineSnapshotAfter)) !== hashText(JSON.stringify(outlineSnapshotBefore)) ? 'outline-changed' : 'prompt-profile-changed' }
      })
    }
    const projectManifestHash = hashText(manifest)
    const totalWords = snapshotChapters.reduce((sum, chapter) => sum + chapter.wordCount, 0)
    const sourceFingerprint = hashText(JSON.stringify({
      projectManifestHash,
      manuscriptRevision: revisionAfter,
      chapterOrderContentHash: hashText(chapterOrderContent),
      chapters: snapshotChapters.map(({ content: _content, ...chapter }) => chapter),
      outlines: outlineSnapshotAfter.map(({ content: _content, ...outline }) => outline),
      promptProfile: promptProfileAfter.mirror ? { ...promptProfileAfter, mirror: { ...promptProfileAfter.mirror, content: undefined } } : promptProfileAfter
    }))
    return {
      workItemId: rootBefore,
      projectName: project.name,
      projectManifestHash,
      sourceFingerprint,
      chapters: snapshotChapters,
      outlines: outlineSnapshotAfter,
      totalWords,
      chapterOrderMirror: {
        relativePath: chapterOrderRelativePath,
        content: chapterOrderContent,
        contentHash: hashText(chapterOrderContent),
        observedHash: chapterOrderObservedHash
      },
      promptProfile: promptProfileAfter
    }
  }

  private async promptProfileSnapshot(root: string, workItemId: string): Promise<LegacyWorkspacePromptProfile> {
    const relativePath = '.webnovel/config/prompt-profile.json' as const
    const path = await projectDirectory(root, join(root, ...relativePath.split('/')))
    let content: string
    try { content = await readFile(await projectExistingPath(root, path), 'utf8') }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, workItemId, genreFingerprint: '', overrides: {}, updatedAt: '', mirror: null }
      throw error
    }
    let value: unknown
    try { value = JSON.parse(content) }
    catch { throw new AppError('INVALID_PROJECT_STATE', '本书提示词文件已损坏；修复前不会迁入 SQLite。', { recoverable: true }) }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError('INVALID_PROJECT_STATE', '本书提示词文件结构无效；修复前不会迁入 SQLite。', { recoverable: true })
    const record = value as Record<string, unknown>
    if (record.version !== 1 || record.workItemId !== workItemId || typeof record.genreFingerprint !== 'string'
      || !record.overrides || typeof record.overrides !== 'object' || Array.isArray(record.overrides)) {
      throw new AppError('INVALID_PROJECT_STATE', '本书提示词文件不属于当前作品或结构无效；修复前不会迁入 SQLite。', { recoverable: true })
    }
    const tasks = new Set(['outline', 'chapterOutline', 'prose', 'review'])
    const overrides: LegacyWorkspacePromptProfile['overrides'] = {}
    for (const [task, raw] of Object.entries(record.overrides as Record<string, unknown>)) {
      if (!tasks.has(task) || typeof raw !== 'string' || !raw.trim() || raw.length > 50_000) throw new AppError('INVALID_PROJECT_STATE', '本书提示词文件包含无效内容；修复前不会迁入 SQLite。', { recoverable: true })
      overrides[task as keyof LegacyWorkspacePromptProfile['overrides']] = raw.trim()
    }
    const contentHash = hashText(content)
    return {
      version: 1, workItemId, genreFingerprint: record.genreFingerprint, overrides,
      updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : '',
      mirror: { relativePath, content, contentHash, observedHash: contentHash }
    }
  }

  private async outlineSnapshot(): Promise<NonNullable<LegacyWorkspaceSnapshot['outlines']>> {
    const [outlines, chapters] = await Promise.all([this.documents.outlines(), this.documents.chapterOutlines()])
    const values: NonNullable<LegacyWorkspaceSnapshot['outlines']> = []
    if (outlines.total) values.push({
      legacyKey: 'total', nodeType: 'summary', seq: 1, title: '总纲', content: outlines.total.content,
      contentHash: hashText(outlines.total.content), mirrorRelativePath: '大纲/总纲.md'
    })
    for (const volume of outlines.volumes) values.push({
      legacyKey: `volume-${volume.volume}`, ...(outlines.total ? { parentLegacyKey: 'total' } : {}), nodeType: 'volume', seq: volume.volume,
      title: volume.title, content: volume.content, contentHash: hashText(volume.content), mirrorRelativePath: `大纲/第${volume.volume}卷-大纲.md`
    })
    for (const chapter of chapters) values.push({
      legacyKey: `chapter-${chapter.chapterId}`, nodeType: 'chapter', seq: chapter.chapterId,
      title: `第${chapter.chapterId}章章纲`, content: chapter.content, contentHash: hashText(chapter.content), mirrorRelativePath: `大纲/章纲/第${chapter.chapterId}章.md`
    })
    return values
  }
}

function safeMirrorTitle(title: string): string {
  return title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim() || '未命名'
}

function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
