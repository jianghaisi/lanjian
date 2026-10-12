import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import type { ProjectCreateInput, ProjectMigrationPreview, ProjectMigrationResult, ProjectSummary } from '../../../../contracts/index'
import { AppError } from '../../../core/errors/app-error'
import { parseChapterFileName, summarizeChapterFiles } from '../../manuscript/domain/chapter-file'
import { measureManuscript } from '../../../../contracts/manuscript/manuscript-metrics'
import { canonicalDirectory, projectDirectory, projectExistingPath, projectTargetPath } from '../../../platform/storage/project-path'
import { readJson, writeJson } from '../../../platform/storage/json-store'
import { SettingsStore } from '../../../platform/settings/settings-store'
import { readLibraryLastEditedChapter } from './library-last-edited-chapter'
import { ProjectCreation, type ProjectModelInitialization } from './project-creation'
import { BookExecutionContext } from './book-execution-context'
import { BookTaskRegistry } from './book-task-registry'

type ProjectState = {
  version?: number
  schemaVersion?: number
  project_info?: Record<string, unknown>
  genre?: string
  substyle?: string
  inspiration?: string
  target_words?: number
  target_chapters?: number
  chapter_word_count?: number
  created_at?: string
  updated_at?: string
  migrationHistory?: Array<{ from: number; to: number; at: string; backupRelativePath?: string }>
}

type TrashAdapter = { trashItem: (path: string) => Promise<void> }
export type ProjectMetadata = Omit<ProjectSummary, 'manuscript'>
export type ProjectIdentityAuthority = (path: string) => Promise<{ title: string; genre?: string } | null>

export const CURRENT_PROJECT_SCHEMA_VERSION = 2
const PROJECT_READ_RETRY_DELAYS_MS = [25, 75, 150] as const

export class ProjectService {
  private readonly execution = new BookExecutionContext()
  readonly backgroundTasks = new BookTaskRegistry()
  get executionIdentity() { return this.execution.current() }

  /** Captures generation or read-only export snapshots; editor/adoption writes stay UI-scoped. */
  async runInCurrentBook<T>(operation: () => T | Promise<T>): Promise<T> {
    if (this.executionIdentity) return operation()
    const root = await this.currentPath()
    return this.execution.run(root, operation)
  }

  /** Main-only creation receipt lookup; this path never comes from renderer binding input. */
  async captureCreatedBook(root: string) {
    return this.execution.run(root, async () => {
      const summary = await this.currentSummary()
      return { summary, identity: this.executionIdentity! }
    })
  }

  /** Main-only captured group binding; never accepts an IPC-supplied root. */
  async runInCapturedBook<T>(identity: { root: string; physicalIdentity: string }, operation: () => T | Promise<T>): Promise<T> {
    return this.execution.run(identity.root, async () => {
      if (this.executionIdentity?.physicalIdentity !== identity.physicalIdentity) throw new AppError('CONFLICT', '群聊关联作品身份已变化。', { recoverable: true })
      await this.currentPath()
      return operation()
    })
  }

  async runBookTask<T extends { id: string; status: string; chapterId?: number }>(kind: string, start: () => T | Promise<T>, status: (id: string) => T | Promise<T>): Promise<T> {
    return this.runInCurrentBook(async () => {
      const book = await this.currentSummary()
      const task = await start()
      this.backgroundTasks.track(task, book, kind, async () => { await this.currentPath(); return status(task.id) })
      return task
    })
  }

  private readonly creation: ProjectCreation
  constructor(
    private readonly settings: SettingsStore,
    private readonly trash: TrashAdapter = {
      trashItem: async () => { throw new AppError('FEATURE_UNAVAILABLE', '系统回收站服务未配置') }
    },
    private readonly identityAuthority?: ProjectIdentityAuthority,
    initializeStorage?: (root: string) => Promise<void>
  ) { this.creation = new ProjectCreation(root => this.settings.setCurrentProject(root), CURRENT_PROJECT_SCHEMA_VERSION, initializeStorage) }

  private summary(path: string): Promise<ProjectSummary>
  private summary(path: string, includeManuscript: boolean): Promise<ProjectMetadata>
  private async summary(path: string, includeManuscript = true): Promise<ProjectSummary | ProjectMetadata> {
    const statePath = join(path, '.webnovel', 'state.json')
    let guardedStatePath = statePath
    try { guardedStatePath = await projectExistingPath(path, statePath) }
    catch (error) {
      if (!isMissing(error)) throw error
      guardedStatePath = await projectTargetPath(path, statePath)
    }
    const state = await readJson<ProjectState>(guardedStatePath, {})
    const info = state.project_info ?? {}
    const profile = await readJson<{ genre?: string }>(join(path, '.webnovel', 'config', 'book-profile.json'), {})
    // state.json and book-profile.json remain bootstrap/compatibility files. Once
    // formal SQLite storage is active, external edits to those readable files
    // must not be able to present a different project identity in the shelf.
    const formalIdentity = await this.identityAuthority?.(path)
    const folderTitle = basename(path)
    const manifestTitle = String(info.title || '').trim()
    const title = formalIdentity?.title.trim() || manifestTitle || folderTitle
    const metadata: ProjectMetadata = {
      id: path, name: title, title,
      genre: formalIdentity?.genre?.trim() || String(profile.genre || info.genre || ''),
      path, updated_at: String(state.updated_at || state.created_at || '')
    }
    // Identity/default readers do not need another full manuscript word count.
    // Omit statistics entirely; this is not a claim that manuscript files are valid.
    if (!includeManuscript) return metadata
    const identityConflict = !formalIdentity && projectVersion(state) < CURRENT_PROJECT_SCHEMA_VERSION && Boolean(manifestTitle) && manifestTitle !== folderTitle
    const manuscriptFiles = await readdir(join(path, '正文')).catch(() => [])
    const manuscriptFilesSummary = summarizeChapterFiles(manuscriptFiles)
    const wordCount = await countManuscriptWords(path, manuscriptFiles)
    // Broken optional metadata must not hide an otherwise accessible book.
    // Never guess from mirrors when a formal database cannot be read.
    const lastEditedChapter = identityConflict || manuscriptFilesSummary.duplicateIds.length
      ? undefined
      : await readLibraryLastEditedChapter(path).catch(() => undefined)
    const duplicateLabel = manuscriptFilesSummary.duplicateIds.slice(0, 3).map((id) => `第 ${id} 章`).join('、')
    const manuscript = identityConflict
      ? {
          chapterCount: manuscriptFilesSummary.chapterCount,
          fileCount: manuscriptFilesSummary.fileCount,
          wordCount,
          status: 'identity-review' as const,
          message: `项目清单是《${manifestTitle}》，文件夹名却是《${folderTitle}》${manuscriptFilesSummary.duplicateIds.length ? `；${duplicateLabel}${manuscriptFilesSummary.duplicateIds.length > 3 ? '等' : ''}还存在同编号稿件` : ''}。书名与正文归属需要核对，原稿没有改动。`
        }
      : manuscriptFilesSummary.duplicateIds.length
      ? {
          chapterCount: manuscriptFilesSummary.chapterCount,
          fileCount: manuscriptFilesSummary.fileCount,
          wordCount,
          status: 'chapter-review' as const,
          message: `${duplicateLabel}${manuscriptFilesSummary.duplicateIds.length > 3 ? '等' : ''}存在同编号稿件，正文未丢失，请先核对。`
        }
      : { chapterCount: manuscriptFilesSummary.chapterCount, fileCount: manuscriptFilesSummary.fileCount, wordCount, status: 'ready' as const }
    return {
      ...metadata,
      updated_at: lastEditedChapter?.updatedAt && lastEditedChapter.updatedAt > String(state.updated_at || state.created_at || '') ? lastEditedChapter.updatedAt : String(state.updated_at || state.created_at || ''),
      manuscript: { ...manuscript, ...(lastEditedChapter === undefined ? {} : { lastEditedChapter }) }
    }
  }

  async list(): Promise<{ projects: ProjectSummary[]; continueProjectId: string | null }> {
    const value = await this.settings.load()
    const projects: ProjectSummary[] = []
    const seen = new Set<string>()
    const excluded = new Set(value.excludedProjects.map(item => pathIdentity(resolve(item))))
    const libraryRoot = value.libraryRoot ?? await this.inferRegisteredLibraryRoot(value.recentProjects, excluded)
    const discovered = libraryRoot ? await this.libraryProjectPaths(libraryRoot) : []
    for (const path of [...value.recentProjects, ...discovered]) {
      const candidateIdentity = pathIdentity(resolve(path))
      if (excluded.has(candidateIdentity) || seen.has(candidateIdentity)) continue
      const project = await this.registeredProjectSummary(path)
      if (!project) continue
      const identity = pathIdentity(project.path)
      if (seen.has(identity)) continue
      seen.add(identity)
      projects.push(project)
    }
    // Opening a registered work intentionally does not reorder the shelf. Resolve
    // the continuation target from the existing confirmed-switch preference.
    let currentIdentity: string | undefined
    if (value.currentProject) {
      try { currentIdentity = pathIdentity(await canonicalDirectory(value.currentProject)) } catch { /* unavailable target: use the visible shelf only */ }
    }
    const continuation = projects.find(project => pathIdentity(project.path) === currentIdentity) ?? projects[0]
    return { projects, continueProjectId: continuation?.id ?? null }
  }

  private async inferRegisteredLibraryRoot(recentProjects: string[], excluded: Set<string>): Promise<string | null> {
    let sharedParent: string | null = null
    for (const path of recentProjects) {
      if (excluded.has(pathIdentity(resolve(path)))) continue
      let canonical: string
      try { canonical = await canonicalDirectory(path) }
      catch (error) {
        if (isMissing(error)) continue
        throw error
      }
      const parent = dirname(canonical)
      if (dirname(parent) === parent) return null
      if (sharedParent && pathIdentity(sharedParent) !== pathIdentity(parent)) return null
      sharedParent = parent
    }
    return sharedParent
  }

  private async libraryProjectPaths(configuredRoot: string): Promise<string[]> {
    let root: string
    try { root = await canonicalDirectory(configuredRoot) }
    catch (error) {
      throw new AppError('STORAGE_ERROR', '作品库目录暂时不可用，请检查磁盘后重试。原作品文件没有改动。', { recoverable: true, cause: error })
    }
    let entries: Dirent[]
    try { entries = await readdir(root, { withFileTypes: true }) }
    catch (error) {
      throw new AppError('STORAGE_ERROR', '作品库目录暂时无法读取，请重试。原作品文件没有改动。', { recoverable: true, cause: error })
    }
    const projects: string[] = []
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))) {
      if (!entry.isDirectory()) continue
      const candidate = join(root, entry.name)
      let children: string[]
      try {
        const guarded = await projectExistingPath(root, candidate)
        children = await readdir(guarded)
        if (!children.includes('.webnovel') && !children.includes('正文') && !children.includes('大纲')) continue
        projects.push(await canonicalDirectory(guarded))
      } catch (error) {
        if (isMissing(error)) continue
        throw new AppError('STORAGE_ERROR', '作品库中有目录暂时无法读取，请重试。原作品文件没有改动。', { recoverable: true, cause: error })
      }
    }
    return projects
  }

  private async registeredProjectSummary(path: string): Promise<ProjectSummary | null> {
    let failure: unknown
    for (let attempt = 0; attempt <= PROJECT_READ_RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        return await this.summary(await canonicalDirectory(path))
      } catch (error) {
        failure = error
        if (attempt >= PROJECT_READ_RETRY_DELAYS_MS.length || !isRetryableProjectRead(error)) break
        await new Promise((resolve) => setTimeout(resolve, PROJECT_READ_RETRY_DELAYS_MS[attempt]))
      }
    }

    // A missing registered root is a retained recovery clue and stays off the
    // visible shelf. Any other failure must not masquerade as a complete list:
    // the boot screen can retry, while the original work remains untouched.
    try { await canonicalDirectory(path) }
    catch (error) {
      if (isMissing(error)) return null
      failure = error
    }
    throw new AppError('STORAGE_ERROR', '作品库读取未完成，请重试。原作品文件没有改动。', { recoverable: true, cause: failure })
  }

  async create(input: ProjectCreateInput): Promise<{ project: ProjectSummary }> {
    const result = await this.createWithModels(input)
    if (result.status === 'partial') throw new AppError(result.code, result.message, { recoverable: true, details: { operationId: result.operationId } })
    return { project: result.project }
  }

  async createWithModels(input: ProjectCreateInput, initialization?: ProjectModelInitialization) {
    const result = await this.creation.create(input, initialization)
    return result.status === 'created' ? { status: 'created' as const, project: await this.summary(result.path) } : result
  }

  async retryCreation(operationId: string, initialization?: ProjectModelInitialization) {
    const result = await this.creation.retry(operationId, initialization)
    return result.status === 'created' ? { status: 'created' as const, project: await this.summary(result.path) } : result
  }

  async importProject(path: string): Promise<{ project: ProjectSummary }> {
    const canonical = await this.recognizedProject(path)
    await this.settings.setCurrentProject(canonical)
    return { project: await this.summary(canonical) }
  }

  async switch(path: string): Promise<{ success: boolean; path: string }> {
    const canonical = await this.recognizedProject(path)
    await this.settings.setCurrentProject(canonical)
    return { success: true, path: canonical }
  }

  async trashProject(path: string): Promise<{ success: true; recovery: 'system-trash'; title: string }> {
    const canonical = await this.recognizedProject(path)
    const tasks = await this.backgroundTasks.list()
    if (tasks.some(task => pathIdentity(resolve(task.bookPath)) === pathIdentity(canonical) && ['queued', 'resuming', 'preparing', 'running', 'streaming'].includes(task.status))) {
      throw new AppError('CONFLICT', '这部作品仍有任务运行。请先在所属作品停止任务，或等待完成后再移入回收站。', { recoverable: true })
    }
    if (dirname(canonical) === canonical) {
      throw new AppError('VALIDATION_ERROR', '不能把磁盘根目录作为作品删除。', { recoverable: false })
    }
    const visible = await this.list()
    if (!visible.projects.some((item) => pathIdentity(resolve(item.path)) === pathIdentity(canonical))) {
      throw new AppError('NOT_FOUND', '这部作品已不在当前书架中，请刷新后重试。', { recoverable: true })
    }
    const project = await this.summary(canonical)
    await this.trash.trashItem(canonical)
    await this.settings.removeProjectData(canonical)
    return { success: true, recovery: 'system-trash', title: project.title }
  }

  async currentPath(): Promise<string> {
    const captured = await this.execution.path()
    if (captured) return captured
    const path = (await this.settings.load()).currentProject
    if (!path) throw new AppError('PROJECT_NOT_OPEN', '请先选择一个本地项目', { recoverable: true })
    try { return await canonicalDirectory(path) }
    catch (error) {
      if (isMissing(error)) throw new AppError('NOT_FOUND', '当前书稿文件夹已经移动或不存在，请重新打开。', { recoverable: true })
      throw error
    }
  }

  async status(): Promise<Record<string, unknown>> {
    const path = await this.currentPath()
    return { initialized: true, project_root: path, project: await this.summary(path) }
  }

  currentSummary(options?: { includeManuscript?: true }): Promise<ProjectSummary>
  currentSummary(options: { includeManuscript: false }): Promise<ProjectMetadata>
  async currentSummary(options: { includeManuscript?: boolean } = {}): Promise<ProjectSummary | ProjectMetadata> {
    return this.summary(await this.currentPath(), options.includeManuscript !== false)
  }

  async migrationPreview(): Promise<ProjectMigrationPreview> {
    const root = await this.currentPath()
    const { state, exists } = await this.readProjectState(root)
    const currentVersion = projectVersion(state)
    if (currentVersion > CURRENT_PROJECT_SCHEMA_VERSION) {
      throw new AppError('UNSUPPORTED_PROJECT_VERSION', `这部书稿使用更新的数据版本 ${currentVersion}，当前应用只能读取到版本 ${CURRENT_PROJECT_SCHEMA_VERSION}。`, { recoverable: false })
    }
    const issues = await this.inspectLegacyProject(root, state, currentVersion)
    const required = currentVersion < CURRENT_PROJECT_SCHEMA_VERSION
    const canMigrate = required && !issues.some((issue) => issue.severity === 'blocker')
    return {
      currentVersion,
      targetVersion: CURRENT_PROJECT_SCHEMA_VERSION,
      required,
      format: required ? 'lanjian-legacy' : 'lanjian-current',
      canMigrate,
      reviewRequired: issues.length > 0,
      operations: required && canMigrate ? [
        '原样备份当前项目清单',
        '从旧清单建立新版作品定义',
        '把可识别的旧境界配置复制到新版配置区',
        '补齐明确的 schemaVersion',
        '记录可追溯的迁移历史'
      ] : [],
      warnings: [
        ...(exists ? [] : ['没有找到项目清单；升级时将根据现有文件夹建立清单，不会改写正文。']),
        ...(required && !canMigrate ? ['发现需要作者判断的冲突，已停止自动升级；任何正文、大纲和旧配置都没有改写。'] : [])
      ],
      issues
    }
  }

  async migrate(): Promise<ProjectMigrationResult> {
    const preview = await this.migrationPreview()
    if (!preview.required) return { ...preview, migrated: false }
    if (!preview.canMigrate) {
      throw new AppError('CONFLICT', '旧作品存在书名或章节结构冲突，已停止自动升级；请先查看诊断并选择要保留的内容。', { recoverable: true })
    }

    const root = await this.currentPath()
    const { state, exists, path } = await this.readProjectState(root)
    const timestamp = new Date().toISOString()
    const backupRelativePath = `.webnovel/backups/migrations/${timestamp.replace(/[:.]/g, '-')}/state.json`
    const backupPath = await projectTargetPath(root, join(root, ...backupRelativePath.split('/')))
    await mkdir(dirname(backupPath), { recursive: true })
    if (exists) await writeFile(backupPath, await readFile(path))
    else await writeFile(backupPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')

    const next: ProjectState = {
      ...state,
      version: CURRENT_PROJECT_SCHEMA_VERSION,
      schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
      project_info: state.project_info ?? { title: basename(root), genre: '', mode: 'imported-legacy' },
      updated_at: timestamp,
      migrationHistory: [
        ...(Array.isArray(state.migrationHistory) ? state.migrationHistory : []),
        { from: preview.currentVersion, to: CURRENT_PROJECT_SCHEMA_VERSION, at: timestamp, backupRelativePath }
      ]
    }
    await writeJson(await projectTargetPath(root, join(root, '.webnovel', 'state.json')), next)
    await this.migrateLegacyConfiguration(root, state)
    return { ...(await this.migrationPreview()), migrated: true, backupRelativePath, currentVersion: CURRENT_PROJECT_SCHEMA_VERSION, required: false }
  }

  private async inspectLegacyProject(root: string, state: ProjectState, currentVersion: number): Promise<ProjectMigrationPreview['issues']> {
    if (currentVersion >= CURRENT_PROJECT_SCHEMA_VERSION) return []
    const issues: ProjectMigrationPreview['issues'] = []
    const folderTitle = basename(root)
    const manifestTitle = String(state.project_info?.title || '').trim()
    if (manifestTitle && manifestTitle !== folderTitle) {
      issues.push({
        id: 'manifest-title-mismatch', severity: 'blocker', title: '作品身份冲突',
        message: `文件夹名是《${folderTitle}》，旧项目清单却写着《${manifestTitle}》。不能自动判断哪一套大纲和设定属于本书。`,
        evidence: [`文件夹：${folderTitle}`, `旧清单：${manifestTitle}`]
      })
    }

    const manuscriptRoot = join(root, '正文')
    const chapterNames = await readdir(manuscriptRoot).catch(() => [])
    const chapterNumbers = new Map<number, string[]>()
    for (const name of chapterNames) {
      const match = /^第(\d+)章(?:-|\.|\s|$)/.exec(name)
      if (!match || !name.toLocaleLowerCase().endsWith('.md')) continue
      const number = Number(match[1])
      chapterNumbers.set(number, [...(chapterNumbers.get(number) || []), name])
    }
    const duplicates = [...chapterNumbers.entries()].filter(([, names]) => names.length > 1)
    if (duplicates.length) {
      issues.push({
        id: 'duplicate-chapter-number', severity: 'blocker', title: '正文章号重复',
        message: '同一章号对应多个正文文件；自动升级无法安全决定正文顺序和正式版本。',
        evidence: duplicates.slice(0, 20).flatMap(([number, names]) => names.map((name) => `第 ${number} 章：${name}`))
      })
    }

    const legacyLevels = join(root, 'config', 'levels.json')
    const modernProfile = join(root, '.webnovel', 'config', 'book-profile.json')
    if (await existsPath(legacyLevels)) {
      issues.push({
        id: 'legacy-config-layout', severity: 'attention', title: '发现旧版设定目录',
        message: '旧境界配置仍在 config 目录；安全升级会复制并转换到新版配置区，旧文件原样保留。',
        evidence: ['config/levels.json']
      })
    }
    if (!(await existsPath(modernProfile))) {
      issues.push({
        id: 'missing-book-profile', severity: 'attention', title: '缺少新版作品定义',
        message: '将根据无冲突的旧清单建立待检查作品定义；不会自动确认世界观、大纲或人物事实。',
        evidence: ['.webnovel/config/book-profile.json 不存在']
      })
    }
    const extraFiles = chapterNames.filter((name) => !name.toLocaleLowerCase().endsWith('.md'))
    if (extraFiles.length) {
      issues.push({
        id: 'non-manuscript-files', severity: 'info', title: '正文目录含辅助文件',
        message: '辅助文件不会被当作章节，也不会在升级时删除。',
        evidence: extraFiles.slice(0, 20)
      })
    }
    return issues
  }

  private async migrateLegacyConfiguration(root: string, state: ProjectState): Promise<void> {
    const profilePath = await projectTargetPath(root, join(root, '.webnovel', 'config', 'book-profile.json'))
    if (!(await existsPath(profilePath))) {
      const info = state.project_info || {}
      const targetWordsPerChapter = positiveInteger(info.chapter_word_count) || positiveInteger(state.chapter_word_count) || 3000
      const totalTargetWords = positiveInteger(info.target_words) || positiveInteger(state.target_words)
      const targetChapters = positiveInteger(info.target_chapters)
        || positiveInteger(state.target_chapters)
        || (totalTargetWords ? Math.ceil(totalTargetWords / targetWordsPerChapter) : 30)
      await writeJson(profilePath, {
        genre: String(info.genre || state.genre || '未分类'),
        subgenre: String(info.substyle || state.substyle || ''),
        coreIdea: String(state.inspiration || info.description || `围绕《${basename(root)}》展开的故事`),
        plannedVolumes: Math.max(1, Math.min(100, Math.ceil(targetChapters / 50))),
        chaptersPerVolume: Math.max(1, Math.min(500, Math.ceil(targetChapters / Math.max(1, Math.ceil(targetChapters / 50))))),
        targetWordsPerChapter: Math.max(300, Math.min(50_000, targetWordsPerChapter))
      })
    }

    const legacyLevelsPath = join(root, 'config', 'levels.json')
    const modernLevelsPath = await projectTargetPath(root, join(root, '.webnovel', 'config', 'levels.json'))
    if ((await existsPath(legacyLevelsPath)) && !(await existsPath(modernLevelsPath))) {
      const legacy = await readJson<{ levels?: Array<{ id?: string; name?: string; description?: string; features?: string }> }>(legacyLevelsPath, { levels: [] })
      await writeJson(modernLevelsPath, {
        levels: (legacy.levels || []).map((level) => ({
          id: String(level.id || crypto.randomUUID()),
          name: String(level.name || '').trim(),
          description: String(level.description || level.features || '').trim()
        })).filter((level) => level.name && level.description)
      })
    }
  }

  private async readProjectState(root: string): Promise<{ state: ProjectState; exists: boolean; path: string }> {
    const statePath = join(root, '.webnovel', 'state.json')
    try {
      const guarded = await projectExistingPath(root, statePath)
      const raw = await readFile(guarded, 'utf8')
      try { return { state: JSON.parse(raw) as ProjectState, exists: true, path: guarded } }
      catch { throw new AppError('INVALID_PROJECT_STATE', '项目清单格式损坏；为保护书稿，已停止迁移。', { recoverable: false }) }
    } catch (error) {
      if (!isMissing(error)) throw error
      return { state: {}, exists: false, path: await projectTargetPath(root, statePath) }
    }
  }

  private async recognizedProject(path: string): Promise<string> {
    let canonical: string
    try { canonical = await canonicalDirectory(path) }
    catch (error) {
      if (isMissing(error)) throw new AppError('NOT_FOUND', '所选项目文件夹不存在或已经移动', { recoverable: true })
      throw error
    }
    const entries = await readdir(canonical)
    if (!entries.includes('.webnovel') && !entries.includes('正文') && !entries.includes('大纲')) {
      throw new AppError('VALIDATION_ERROR', '所选文件夹不是可识别的小说项目', { recoverable: true })
    }
    return canonical
  }
}

function projectVersion(state: ProjectState): number {
  const value = state.schemaVersion ?? state.version ?? 0
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0
}

function isMissing(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}

function isRetryableProjectRead(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) return false
  return ['ENOENT', 'EACCES', 'EBUSY', 'EPERM', 'EMFILE', 'ENFILE'].includes(String(error.code))
}

function pathIdentity(path: string): string {
  return process.platform === 'win32' ? path.toLocaleLowerCase() : path
}

async function existsPath(path: string): Promise<boolean> {
  try { await access(path); return true } catch { return false }
}

function positiveInteger(value: unknown): number | undefined {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : undefined
}

async function countManuscriptWords(root: string, files: string[]): Promise<number> {
  const chapters = files.filter((file) => Boolean(parseChapterFileName(file)))
  let total = 0
  for (let start = 0; start < chapters.length; start += 24) {
    const counts = await Promise.all(chapters.slice(start, start + 24).map(async (file) => {
      const chapterPath = await projectExistingPath(root, join(root, '正文', file))
      return measureManuscript(await readFile(chapterPath, 'utf8')).wordCount
    }))
    total += counts.reduce((sum, count) => sum + count, 0)
  }
  return total
}
