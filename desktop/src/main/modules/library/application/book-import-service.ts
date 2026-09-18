import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join, parse } from 'node:path'
import { TextDecoder } from 'node:util'
import * as mammoth from 'mammoth'
import { AppError } from '../../../core/errors/app-error'
import { projectDirectory } from '../../../platform/storage/project-path'
import type {
  DocumentImportManifest,
  DocumentImportRecovery,
  DocumentImportManifestRequest,
  DocumentImportManifestResult,
  TxtCreationMethod,
  TxtImportPreview,
  TxtImportRequest,
  TxtImportResult
} from '../../../../contracts/index'
import { DocumentService } from '../../manuscript/application/document-service'
import { readJson, writeJson } from '../../../platform/storage/json-store'
import { ProjectService } from './project-service'

type ParsedChapter = {
  sourceIndex: number
  chapterNumber?: number
  title: string
  content: string
  wordCount: number
  preview: string
  status: 'ready' | 'review'
  issues: string[]
  selectedByDefault: boolean
}
type PendingImport = TxtImportPreview & { hash: string; content: string; bytesBuffer: Buffer; sourceExtension: string; parsedChapters: ParsedChapter[]; expiresAt: number }
type ImportRecord = {
  id: string
  importedAt: string
  fileName: string
  title: string
  sha256: string
  ownership: 'owned' | 'material' | 'external'
  creationMethod?: TxtCreationMethod
  chapterIds: number[]
  sourceIds?: string[]
  selectedChapterIndexes?: number[]
  storagePath: string
}
type ImportLedger = { version: 1; records: ImportRecord[] }
type ManifestJournalFile = {
  token: string
  fileName: string
  sha256: string
  stagedSource: string
  request: DocumentImportManifestRequest['files'][number]
  status: 'pending' | 'running' | 'completed' | 'skipped' | 'review'
  result?: TxtImportResult
}
type ManifestJournal = {
  version: 1
  id: string
  status: 'ready' | 'committing' | 'interrupted' | 'completed' | 'needs-review'
  createdAt: string
  updatedAt: string
  files: ManifestJournalFile[]
  lastError?: string
}

export type CompletedManifestEvidence = {
  id: string
  sourceFingerprint: string
  files: Array<{
    fileName: string
    ownership: 'owned' | 'material' | 'external'
    title: string
    content: string
  }>
}

const maxTxtBytes = 50 * 1024 * 1024
const maxDocxBytes = 20 * 1024 * 1024
const maxExtractedCharacters = 10_000_000
// One continuation queue may hold 20 files while a chooser batch is being
// previewed. Keep a small bounded headroom so appending never evicts the
// author's already-reviewed files halfway through that operation.
const maxPendingImports = 48
const maxManifestFiles = 20
const manifestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const pendingImportTtlMs = 15 * 60 * 1000
const chineseOrdinal = '[0-9〇零一二三四五六七八九十百千万两]+'
const chapterHeading = new RegExp(`^\\s*(?:第${chineseOrdinal}[章回](?:[：:、.．\\-—_ ]{0,3}.{0,80})?|第${chineseOrdinal}节(?:[：:、.．\\-—_ ]{1,3}.{0,80})?|(?:chapter|chap\\.?)\\s+\\d+(?:[：:、.．\\-—_ ]{0,3}.{0,80})?)\\s*$`, 'i')
const volumeHeading = new RegExp(`^\\s*第${chineseOrdinal}[卷部篇集](?:[：:、.．\\-—_ ]{0,3}.{0,80})?\\s*$`)

export class BookImportService {
  private readonly pending = new Map<string, PendingImport>()
  private readonly pendingManifests = new Map<string, Set<string>>()

  constructor(
    private readonly projects: ProjectService,
    private readonly documents: DocumentService,
    private readonly researchLibrary?: { importManualDocument: (title: string, content: string) => Promise<Array<{ id: string }>> },
    private readonly beforeManifestFile?: (fileName: string, index: number) => Promise<void>
  ) {}

  async previewFile(filePath: string): Promise<TxtImportPreview> {
    this.prunePending()
    const extension = extname(filePath).toLowerCase()
    if (!['.txt', '.md', '.docx'].includes(extension)) {
      invalidImport(extension === '.doc' ? '旧版 .doc 暂不能安全解析，请先在 Word 中另存为 .docx' : '请选择 TXT、Markdown 或 Word（.docx）文件')
    }
    const info = await stat(filePath).catch(() => { throw new AppError('NOT_FOUND', '所选文稿文件已不存在，请重新选择', { recoverable: true }) })
    if (!info.isFile()) invalidImport('所选路径不是文件')
    const maxBytes = extension === '.docx' ? maxDocxBytes : maxTxtBytes
    if (info.size > maxBytes) invalidImport(`文件超过 ${maxBytes / 1024 / 1024} MB，请先拆分后再导入`)

    const bytes = await readFile(filePath).catch(() => { throw new AppError('NOT_FOUND', '所选文稿文件已无法读取，请重新选择', { recoverable: true }) })
    if (bytes.length > maxBytes) invalidImport(`文件超过 ${maxBytes / 1024 / 1024} MB，请先拆分后再导入`)
    const decoded = await decodeDocument(extension, bytes)
    const content = normalizeText(decoded.content)
    if (!content.trim()) invalidImport('文件没有可导入的文字内容')
    if (content.length > maxExtractedCharacters) invalidImport('文件提取出的文字超过 1000 万字符，请先拆分后再导入')

    const parsed = splitChapters(content, parse(filePath).name)
    if (parsed.chapters.length > 5000) invalidImport('识别到的章节超过 5000 章，请检查章节标题格式或拆分文件')
    const token = randomUUID()
    const warnings: string[] = []
    if (!parsed.detectedHeadings) warnings.push('没有识别到章节标题，将整本书作为一个章节导入')
    if (decoded.encoding !== 'UTF-8' && extension !== '.docx') warnings.push(`原文件编码为 ${decoded.encoding}，导入正文会统一转换为 UTF-8`)
    warnings.push(...decoded.warnings)
    if (extension === '.docx') warnings.push('Word 页面样式不会写入正文；原始 .docx 会完整留档，只提取可编辑的段落文字')
    if (parsed.reviewRequired) warnings.push(`检测到 ${parsed.chapters.filter((item) => item.status === 'review').length} 个需要核对的标题块，已保守推荐连续可信章节`)
    warnings.push('导入只会追加选中的内容，不会覆盖当前已有章节；完整原始文件仍会留档')

    const preview: PendingImport = {
      token,
      fileName: basename(filePath),
      suggestedTitle: safeName(parse(filePath).name),
      sourceFormat: decoded.sourceFormat,
      encoding: decoded.encoding,
      bytes: info.size,
      characterCount: content.length,
      wordCount: countWords(content),
      chapterCount: parsed.chapters.length,
      detectedHeadings: parsed.detectedHeadings,
      chapters: parsed.chapters.map((chapter, index) => ({
        sourceIndex: chapter.sourceIndex,
        order: index + 1,
        ...(chapter.chapterNumber === undefined ? {} : { chapterNumber: chapter.chapterNumber }),
        title: chapter.title,
        wordCount: chapter.wordCount,
        preview: chapter.preview,
        status: chapter.status,
        issues: chapter.issues,
        selectedByDefault: chapter.selectedByDefault
      })),
      recommendedChapterCount: parsed.chapters.filter((item) => item.selectedByDefault).length,
      reviewRequired: parsed.reviewRequired,
      warnings,
      hash: createHash('sha256').update(bytes).digest('hex'),
      content,
      bytesBuffer: bytes,
      sourceExtension: extension,
      parsedChapters: parsed.chapters,
      expiresAt: Date.now() + pendingImportTtlMs
    }
    while (this.pending.size >= maxPendingImports) this.pending.delete(this.pending.keys().next().value!)
    this.pending.set(token, preview)
    return publicPreview(preview)
  }

  async previewFiles(filePaths: string[]): Promise<DocumentImportManifest> {
    this.prunePending()
    const uniquePaths = [...new Set(filePaths.map((filePath) => filePath.trim()).filter(Boolean))]
    if (!uniquePaths.length) invalidImport('请至少选择一个文稿文件')
    if (uniquePaths.length > maxManifestFiles) invalidImport(`一次最多选择 ${maxManifestFiles} 个文稿文件`)

    const previews: TxtImportPreview[] = []
    try {
      for (const filePath of uniquePaths) previews.push(await this.previewFile(filePath))
      const hashes = new Map<string, string>()
      for (const preview of previews) {
        const hash = this.pending.get(preview.token)?.hash
        if (!hash) throw new AppError('CONFLICT', '导入预览已经失效，请重新选择文稿文件', { recoverable: true })
        const duplicate = hashes.get(hash)
        if (duplicate) invalidImport(`“${preview.fileName}”与“${duplicate}”内容相同，请移除重复文件后重试`)
        hashes.set(hash, preview.fileName)
      }

      const files = previews.map((preview) => ({ ...preview, ...recommendRole(preview) }))
      const manuscriptCount = files.filter((file) => file.recommendedRole === 'manuscript').length
      const id = randomUUID()
      const manifest = {
        id,
        files,
        totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
        totalWordCount: files.reduce((sum, file) => sum + file.wordCount, 0),
        warnings: [
          '每个文件的用途都必须由作者确认；系统建议不会自动写入作品。',
          manuscriptCount
            ? `识别到 ${manuscriptCount} 个正文候选；其余文件建议先作为作品资料。`
            : '没有可靠识别出正文文件；建立作品前请把至少一个文件确认为正文。'
        ]
      }
      this.pendingManifests.set(id, new Set(files.map((file) => file.token)))
      return manifest
    } catch (error) {
      for (const preview of previews) this.pending.delete(preview.token)
      throw error
    }
  }

  /** Add another chooser batch to the same author-reviewed continuation queue. */
  async appendFiles(manifestId: string, filePaths: string[]): Promise<DocumentImportManifest> {
    this.prunePending()
    if (!manifestIdPattern.test(manifestId)) invalidImport('导入清单编号格式无效')
    const existingTokens = this.pendingManifests.get(manifestId)
    if (!existingTokens?.size) throw new AppError('CONFLICT', '当前导入清单已经失效，请重新开始续接', { recoverable: true })
    const existing = [...existingTokens].map((token) => this.pending.get(token)).filter((item): item is PendingImport => Boolean(item))
    if (existing.length !== existingTokens.size) throw new AppError('CONFLICT', '已添加的文件预览已过期，请重新开始续接', { recoverable: true })
    const uniquePaths = [...new Set(filePaths.map((filePath) => filePath.trim()).filter(Boolean))]
    if (!uniquePaths.length) invalidImport('请至少选择一个文稿文件')
    if (existing.length + uniquePaths.length > maxManifestFiles) invalidImport(`一个接续工作项最多添加 ${maxManifestFiles} 个文件`)

    const additions: TxtImportPreview[] = []
    try {
      for (const filePath of uniquePaths) additions.push(await this.previewFile(filePath))
      const hashes = new Map(existing.map((file) => [file.hash, file.fileName]))
      for (const preview of additions) {
        const source = this.pending.get(preview.token)
        if (!source) throw new AppError('CONFLICT', '新文件预览已失效，请重新选择', { recoverable: true })
        const duplicate = hashes.get(source.hash)
        if (duplicate) invalidImport(`“${preview.fileName}”与“${duplicate}”内容相同，请移除重复文件后重试`)
        hashes.set(source.hash, preview.fileName)
      }
      for (const preview of additions) existingTokens.add(preview.token)
      return this.manifestFromTokens(manifestId, existingTokens)
    } catch (error) {
      for (const preview of additions) this.pending.delete(preview.token)
      throw error
    }
  }

  async commitManifest(input: DocumentImportManifestRequest): Promise<DocumentImportManifestResult> {
    this.prunePending()
    if (!input.files.length || input.files.length > maxManifestFiles) invalidImport(`导入清单必须包含 1 到 ${maxManifestFiles} 个文件`)
    const tokens = input.files.map((file) => file.token)
    if (new Set(tokens).size !== tokens.length) invalidImport('导入清单包含重复文件令牌')
    const actionable = input.files.filter((file): file is TxtImportRequest => file.ownership !== 'skip')
    if (!actionable.some((file) => file.ownership === 'owned')) invalidImport('请至少确认一个文件为正文')
    const root = await this.projects.currentPath()
    const manifestRoot = await projectDirectory(root, join(root, '.webnovel', 'imports', 'manifests', input.id))
    const journalPath = await projectDirectory(root, join(manifestRoot, 'manifest.json'))
    let journal = await readManifestJournal(journalPath)

    if (!journal) {
      const expectedTokens = this.pendingManifests.get(input.id)
      if (!expectedTokens || expectedTokens.size !== tokens.length || tokens.some((token) => !expectedTokens.has(token))) {
        throw new AppError('CONFLICT', '导入清单与当前预览不一致，请重新选择全部文件', { recoverable: true })
      }
      for (const file of input.files) {
        const source = this.pending.get(file.token)
        if (!source || source.expiresAt < Date.now()) throw new AppError('CONFLICT', `“${file.title}”的预览已经失效，请重新选择全部文件`, { recoverable: true })
      }
      await mkdir(await projectDirectory(root, join(manifestRoot, 'sources')), { recursive: true })
      const now = new Date().toISOString()
      const files: ManifestJournalFile[] = []
      for (const file of input.files) {
        const source = this.pending.get(file.token)!
        const relativeSource = `.webnovel/imports/manifests/${input.id}/sources/${source.hash}${source.sourceExtension}`
        await writeFile(await projectDirectory(root, join(root, relativeSource)), source.bytesBuffer)
        files.push({
          token: file.token,
          fileName: source.fileName,
          sha256: source.hash,
          stagedSource: relativeSource,
          request: file,
          status: file.ownership === 'skip' ? 'skipped' : 'pending'
        })
      }
      journal = { version: 1, id: input.id, status: 'ready', createdAt: now, updatedAt: now, files }
      await writeJson(journalPath, journal)
    } else {
      if (journal.version !== 1 || journal.id !== input.id) invalidImport('导入恢复日志已损坏，请保留项目并人工核对')
      const requestByToken = new Map(input.files.map((file) => [file.token, file]))
      if (journal.files.length !== input.files.length || journal.files.some((file) => JSON.stringify(file.request) !== JSON.stringify(requestByToken.get(file.token)))) {
        throw new AppError('CONFLICT', '导入已经开始，不能中途改变文件用途或章节选择', { recoverable: true })
      }
      if (journal.files.some((file) => file.status === 'running' || file.status === 'review')) {
        throw new AppError('CONFLICT', '上次导入可能在单个文件写入期间中断，已停止自动重试，请按恢复日志核对', { recoverable: true })
      }
      if (journal.status === 'completed') {
        return { id: journal.id, status: 'completed', results: journal.files.flatMap((file) => file.result ? [file.result] : []) }
      }
    }

    journal.status = 'committing'
    journal.updatedAt = new Date().toISOString()
    delete journal.lastError
    await writeJson(journalPath, journal)
    for (let index = 0; index < journal.files.length; index += 1) {
      const file = journal.files[index]
      if (file.status === 'completed' || file.status === 'skipped') continue
      try {
        await this.beforeManifestFile?.(file.fileName, index)
      } catch {
        journal.status = 'interrupted'
        journal.lastError = `在“${file.fileName}”写入前中断；已经完成的文件不会重复导入。`
        journal.updatedAt = new Date().toISOString()
        await writeJson(journalPath, journal)
        throw new AppError('CONFLICT', journal.lastError, { recoverable: true })
      }
      file.status = 'running'
      journal.updatedAt = new Date().toISOString()
      await writeJson(journalPath, journal)
      try {
        file.result = await this.commit(file.request as TxtImportRequest)
        file.status = 'completed'
        journal.updatedAt = new Date().toISOString()
        await writeJson(journalPath, journal)
      } catch (error) {
        file.status = 'review'
        journal.status = 'needs-review'
        journal.lastError = `“${file.fileName}”写入期间失败，可能存在部分落盘；已停止自动重试。`
        journal.updatedAt = new Date().toISOString()
        await writeJson(journalPath, journal)
        throw new AppError('CONFLICT', journal.lastError, { recoverable: true, cause: error })
      }
    }
    journal.status = 'completed'
    journal.updatedAt = new Date().toISOString()
    await writeJson(journalPath, journal)
    this.pendingManifests.delete(input.id)
    for (const file of input.files) if (file.ownership === 'skip') this.pending.delete(file.token)
    return { id: journal.id, status: 'completed', results: journal.files.flatMap((file) => file.result ? [file.result] : []) }
  }

  async recoverableManifests(): Promise<DocumentImportRecovery[]> {
    const root = await this.projects.currentPath()
    const manifestsRoot = await projectDirectory(root, join(root, '.webnovel', 'imports', 'manifests'))
    const entries = await readdir(manifestsRoot, { withFileTypes: true }).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    })
    const recoveries: DocumentImportRecovery[] = []
    for (const entry of entries) {
      if (!entry.isDirectory() || !manifestIdPattern.test(entry.name)) continue
      const journalPath = await projectDirectory(root, join(manifestsRoot, entry.name, 'manifest.json'))
      try {
        const journal = await readManifestJournal(journalPath)
        if (!journal || journal.status === 'completed') continue
        recoveries.push(publicRecovery(journal))
      } catch {
        recoveries.push({
          id: entry.name,
          status: 'needs-review',
          createdAt: '',
          completedCount: 0,
          totalCount: 0,
          canResume: false,
          message: '恢复日志无法读取，已停止自动处理；原文件和日志保持不变。',
          files: []
        })
      }
    }
    return recoveries.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  }

  async resumeManifest(id: string): Promise<DocumentImportManifestResult> {
    if (!manifestIdPattern.test(id)) invalidImport('导入清单编号格式无效')
    const root = await this.projects.currentPath()
    const manifestRoot = await projectDirectory(root, join(root, '.webnovel', 'imports', 'manifests', id))
    const journalPath = await projectDirectory(root, join(manifestRoot, 'manifest.json'))
    const journal = await readManifestJournal(journalPath)
    if (!journal || journal.id !== id) throw new AppError('NOT_FOUND', '没有找到这份导入恢复记录', { recoverable: true })
    if (journal.status === 'completed') {
      return { id, status: 'completed', results: journal.files.flatMap((file) => file.result ? [file.result] : []) }
    }
    if (journal.status === 'needs-review' || journal.files.some((file) => file.status === 'running' || file.status === 'review')) {
      throw new AppError('CONFLICT', '这批导入可能有单文件部分落盘，必须先人工核对，不能自动继续', { recoverable: true })
    }
    for (const file of journal.files) {
      if (file.status !== 'pending') continue
      const stagedPath = await projectDirectory(root, join(root, file.stagedSource))
      const stagedBytes = await readFile(stagedPath).catch(() => {
        throw new AppError('NOT_FOUND', `“${file.fileName}”的暂存原文件缺失，不能继续导入`, { recoverable: true })
      })
      if (createHash('sha256').update(stagedBytes).digest('hex') !== file.sha256) {
        throw new AppError('CONFLICT', `“${file.fileName}”的暂存原文件已经变化，不能继续导入`, { recoverable: true })
      }
      const preview = await this.previewFile(stagedPath)
      const restoredSource = this.pending.get(preview.token)
      if (!restoredSource) throw new AppError('INTERNAL_ERROR', '暂存文稿恢复失败，请重新打开作品后再试', { recoverable: true })
      // The staged file is hash-named. Keep the author's original filename in the
      // import ledger and provenance instead of leaking that implementation detail.
      restoredSource.fileName = file.fileName
      file.token = preview.token
      file.request = { ...file.request, token: preview.token }
    }
    journal.status = 'interrupted'
    journal.updatedAt = new Date().toISOString()
    journal.lastError = '应用重新启动后已从项目内暂存文件恢复，等待继续未完成项。'
    await writeJson(journalPath, journal)
    return this.commitManifest({ id, files: journal.files.map((file) => file.request) })
  }

  async latestCompletedManifestId(): Promise<string | undefined> {
    const root = await this.projects.currentPath()
    const manifestsRoot = await projectDirectory(root, join(root, '.webnovel', 'imports', 'manifests'))
    const entries = await readdir(manifestsRoot, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return []
      throw error
    })
    const completed: Array<{ id: string; updatedAt: string }> = []
    for (const entry of entries) {
      if (!entry.isDirectory() || !manifestIdPattern.test(entry.name)) continue
      try {
        const journal = await readManifestJournal(await projectDirectory(root, join(manifestsRoot, entry.name, 'manifest.json')))
        if (journal?.id === entry.name && journal.status === 'completed') completed.push({ id: journal.id, updatedAt: journal.updatedAt })
      } catch {
        // Damaged journals are surfaced by recoverableManifests; they must not
        // prevent an unrelated completed batch from offering analysis.
      }
    }
    return completed.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]?.id
  }

  async completedManifestEvidence(id: string): Promise<CompletedManifestEvidence> {
    if (!manifestIdPattern.test(id)) invalidImport('导入清单编号格式无效')
    const root = await this.projects.currentPath()
    const manifestRoot = await projectDirectory(root, join(root, '.webnovel', 'imports', 'manifests', id))
    const journal = await readManifestJournal(await projectDirectory(root, join(manifestRoot, 'manifest.json')))
    if (!journal || journal.id !== id) throw new AppError('NOT_FOUND', '没有找到这份导入清单', { recoverable: true })
    if (journal.status !== 'completed') throw new AppError('CONFLICT', '这批文件尚未全部安全导入，不能开始接续分析', { recoverable: true })
    const files: CompletedManifestEvidence['files'] = []
    const fingerprintParts: string[] = []
    for (const file of journal.files) {
      if (file.status === 'skipped' || file.request.ownership === 'skip') continue
      if (file.status !== 'completed') throw new AppError('CONFLICT', '导入日志与批次完成状态不一致，请先核对文件', { recoverable: true })
      const stagedPath = await projectDirectory(root, join(root, file.stagedSource))
      const bytes = await readFile(stagedPath).catch(() => { throw new AppError('NOT_FOUND', `“${file.fileName}”的暂存原文件缺失，不能分析`, { recoverable: true }) })
      const hash = createHash('sha256').update(bytes).digest('hex')
      if (hash !== file.sha256) throw new AppError('CONFLICT', `“${file.fileName}”的暂存原文件已经变化，不能分析`, { recoverable: true })
      const decoded = await decodeDocument(extname(file.fileName).toLowerCase(), bytes)
      files.push({
        fileName: file.fileName,
        ownership: file.request.ownership,
        title: file.request.title?.trim() || parse(file.fileName).name,
        content: boundedAnalysisSource(normalizeText(decoded.content))
      })
      fingerprintParts.push(`${file.sha256}:${file.request.ownership}:${file.request.title}`)
    }
    if (!files.some((file) => file.ownership === 'owned')) throw new AppError('CONFLICT', '接续分析至少需要一份已经确认的正文', { recoverable: true })
    return { id, sourceFingerprint: createHash('sha256').update(fingerprintParts.join('|')).digest('hex'), files }
  }

  async commit(input: TxtImportRequest): Promise<TxtImportResult> {
    const source = this.pending.get(input.token)
    if (!source || source.expiresAt < Date.now()) throw new AppError('CONFLICT', '导入预览已经失效，请重新选择文稿文件', { recoverable: true })
    const root = await this.projects.currentPath()
    const importsRoot = await projectDirectory(root, join(root, '.webnovel', 'imports'))
    const ledgerPath = await projectDirectory(root, join(importsRoot, 'index.json'))
    const ledger = await readJson<ImportLedger>(ledgerPath, { version: 1, records: [] })
    if (ledger.records.some((record) => record.sha256 === source.hash)) throw new AppError('CONFLICT', '这份文件已经导入过，无需重复导入', { recoverable: true })

    const title = safeName(input.title?.trim() || source.suggestedTitle)
    const id = randomUUID()
    const importedAt = new Date().toISOString()
    let result: TxtImportResult
    let record: ImportRecord

    if (input.ownership === 'owned') {
      const selectedIndexes = input.selectedChapterIndexes ?? source.parsedChapters.filter((item) => item.selectedByDefault).map((item) => item.sourceIndex)
      if (!selectedIndexes.length || new Set(selectedIndexes).size !== selectedIndexes.length) invalidImport('请至少选择一个不重复的章节')
      const selected = selectedIndexes.map((sourceIndex) => source.parsedChapters.find((item) => item.sourceIndex === sourceIndex))
      if (selected.some((item) => !item)) invalidImport('章节选择已经失效，请重新预览文稿')
      const existing = await this.documents.chapters()
      let nextId = Math.max(0, ...existing.map((chapter) => chapter.id)) + 1
      const chapterIds: number[] = []
      for (const chapter of selected as ParsedChapter[]) {
        await this.documents.updateChapter(nextId, { title: chapter.title, content: chapter.content })
        chapterIds.push(nextId)
        nextId += 1
      }
      const archiveRoot = await projectDirectory(root, join(importsRoot, 'sources'))
      await mkdir(archiveRoot, { recursive: true })
      const archivePath = await projectDirectory(root, join(archiveRoot, `${source.hash}${source.sourceExtension}`))
      await writeFile(archivePath, source.bytesBuffer)
      record = {
        id, importedAt, fileName: source.fileName, title, sha256: source.hash,
        ownership: 'owned', creationMethod: input.creationMethod ?? 'mixed', chapterIds,
        selectedChapterIndexes: selectedIndexes,
        storagePath: `.webnovel/imports/sources/${source.hash}${source.sourceExtension}`
      }
      result = { ownership: 'owned', title, importedChapterIds: chapterIds }
    } else if (input.ownership === 'material') {
      if (!this.researchLibrary) throw new AppError('INTERNAL_ERROR', '作者资料导入服务尚未就绪', { recoverable: false })
      const archiveRoot = await projectDirectory(root, join(importsRoot, 'sources'))
      await mkdir(archiveRoot, { recursive: true })
      const archivePath = await projectDirectory(root, join(archiveRoot, `${source.hash}${source.sourceExtension}`))
      const sources = await this.researchLibrary.importManualDocument(title, source.content)
      await writeFile(archivePath, source.bytesBuffer)
      const sourceIds = sources.map((item) => item.id)
      record = {
        id, importedAt, fileName: source.fileName, title, sha256: source.hash,
        ownership: 'material', chapterIds: [], sourceIds,
        storagePath: `.webnovel/imports/sources/${source.hash}${source.sourceExtension}`
      }
      result = { ownership: 'material', title, importedChapterIds: [], importedSourceIds: sourceIds }
    } else {
      const referenceRoot = await projectDirectory(root, join(root, '参考资料', '外部书籍', `${title}-${source.hash.slice(0, 8)}`))
      await mkdir(referenceRoot, { recursive: true })
      const originalPath = await projectDirectory(root, join(referenceRoot, `原始文件${source.sourceExtension}`))
      const searchablePath = await projectDirectory(root, join(referenceRoot, '可检索文本.md'))
      await writeFile(originalPath, source.bytesBuffer)
      await writeFile(searchablePath, source.content, 'utf8')
      await writeJson(await projectDirectory(root, join(referenceRoot, '来源说明.json')), {
        version: 1,
        title,
        sourceFileName: source.fileName,
        importedAt,
        ownership: 'external',
        purpose: 'reference-only',
        sha256: source.hash,
        note: '外部作品仅作为参考资料保存，默认不进入正文，也不自动加入模型上下文。'
      })
      record = {
        id, importedAt, fileName: source.fileName, title, sha256: source.hash,
        ownership: 'external', chapterIds: [], storagePath: `参考资料/外部书籍/${title}-${source.hash.slice(0, 8)}`
      }
      result = { ownership: 'external', title, importedChapterIds: [] }
    }

    ledger.records.push(record)
    await writeJson(ledgerPath, ledger)
    this.pending.delete(input.token)
    return result
  }

  private prunePending(): void {
    const now = Date.now()
    for (const [token, value] of this.pending) if (value.expiresAt < now) this.pending.delete(token)
  }

  private manifestFromTokens(id: string, tokens: Set<string>): DocumentImportManifest {
    const files = [...tokens].map((token) => this.pending.get(token)).filter((item): item is PendingImport => Boolean(item)).map((file) => ({ ...publicPreview(file), ...recommendRole(file) }))
    const manuscriptCount = files.filter((file) => file.recommendedRole === 'manuscript').length
    return {
      id,
      files,
      totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
      totalWordCount: files.reduce((sum, file) => sum + file.wordCount, 0),
      warnings: [
        '每个文件的用途都必须由作者确认；系统建议不会自动写入作品。',
        manuscriptCount ? `识别到 ${manuscriptCount} 个正文候选；其余文件建议先作为作品资料。` : '没有可靠识别出正文文件；建立作品前请把至少一个文件确认为正文。'
      ]
    }
  }
}

function recommendRole(preview: TxtImportPreview): Pick<import('../../../../contracts/index').DocumentImportManifestFile, 'recommendedRole' | 'recommendationReason'> {
  const materialName = /(?:作品相关|资料|设定|人物|角色|世界观|大纲|卷纲|章纲|时间线|境界|力量|金手指|系统)/
  if (materialName.test(preview.fileName)) {
    return { recommendedRole: 'material', recommendationReason: '文件名更像大纲、设定或作品资料' }
  }
  if (preview.detectedHeadings && preview.chapterCount > 1) {
    return { recommendedRole: 'manuscript', recommendationReason: `识别到 ${preview.chapterCount} 个章节标题` }
  }
  return { recommendedRole: 'material', recommendationReason: '未识别到连续章节，建议先作为可审阅资料' }
}

async function readManifestJournal(path: string): Promise<ManifestJournal | null> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new AppError('CONFLICT', '导入恢复日志已损坏，已停止写入以保护现有作品', { recoverable: true })
  }
  if (!value || typeof value !== 'object' || (value as ManifestJournal).version !== 1 || !Array.isArray((value as ManifestJournal).files)) {
    throw new AppError('CONFLICT', '导入恢复日志格式无法识别，已停止写入以保护现有作品', { recoverable: true })
  }
  return value as ManifestJournal
}

function publicRecovery(journal: ManifestJournal): DocumentImportRecovery {
  const files = journal.files.map((file) => ({
    fileName: file.fileName,
    ownership: file.request.ownership,
    status: file.status
  }))
  const completedCount = files.filter((file) => file.status === 'completed' || file.status === 'skipped').length
  const unsafe = files.some((file) => file.status === 'running' || file.status === 'review') || journal.status === 'needs-review'
  const visibleStatus = journal.status === 'completed' ? 'ready' : journal.status
  return {
    id: journal.id,
    status: unsafe ? 'needs-review' : visibleStatus,
    createdAt: journal.createdAt,
    completedCount,
    totalCount: files.length,
    canResume: !unsafe,
    message: unsafe
      ? '有文件可能在写入中中断，请先核对正文、资料与恢复日志。'
      : `已完成 ${completedCount}/${files.length} 份，可从项目内暂存原文件继续。`,
    files
  }
}

function publicPreview(source: PendingImport): TxtImportPreview {
  const { hash: _hash, content: _content, bytesBuffer: _bytes, sourceExtension: _extension, parsedChapters: _parsed, expiresAt: _expires, ...preview } = source
  return preview
}

function boundedAnalysisSource(content: string): string {
  const limit = 40_000
  if (content.length <= limit) return content
  const headings = content.split('\n').filter((line) => chapterHeading.test(line) || volumeHeading.test(line)).slice(0, 500).join('\n')
  const edge = Math.max(8_000, Math.floor((limit - headings.length - 80) / 2))
  return `${content.slice(0, edge)}\n\n【中段省略；保留目录线索】\n${headings.slice(0, 8_000)}\n\n【末段】\n${content.slice(-edge)}`.slice(0, limit)
}

async function decodeDocument(extension: string, bytes: Buffer): Promise<{ content: string; encoding: string; sourceFormat: TxtImportPreview['sourceFormat']; warnings: string[] }> {
  if (extension === '.docx') {
    try {
      const result = await mammoth.extractRawText({ buffer: bytes })
      return {
        content: result.value,
        encoding: 'Word 文档',
        sourceFormat: 'Word',
        warnings: result.messages.map((message) => `Word 解析提示：${message.message}`)
      }
    } catch {
      throw new AppError('VALIDATION_ERROR', 'Word 文件无法解析，可能已损坏、加密或不是有效的 .docx', { recoverable: true })
    }
  }
  const decoded = decodeText(bytes)
  return { ...decoded, sourceFormat: extension === '.md' ? 'Markdown' : 'TXT', warnings: [] }
}

function decodeText(bytes: Buffer): { content: string; encoding: string } {
  if (bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) {
    return { content: bytes.subarray(3).toString('utf8'), encoding: 'UTF-8' }
  }
  if (bytes.subarray(0, 2).equals(Buffer.from([0xff, 0xfe]))) {
    return { content: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'UTF-16LE' }
  }
  if (bytes.subarray(0, 2).equals(Buffer.from([0xfe, 0xff]))) {
    return { content: new TextDecoder('utf-16be').decode(bytes.subarray(2)), encoding: 'UTF-16BE' }
  }
  try {
    return { content: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'UTF-8' }
  } catch {
    return { content: new TextDecoder('gb18030').decode(bytes), encoding: 'GB18030' }
  }
}

function normalizeText(content: string): string {
  return content.replace(/^\uFEFF/, '').replace(/\u0000/g, '').replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').trim()
}

function splitChapters(content: string, fallbackTitle: string): { chapters: ParsedChapter[]; detectedHeadings: boolean; reviewRequired: boolean } {
  const lines = content.split('\n')
  const headings = lines.reduce<number[]>((values, line, index) => {
    if (line.length <= 100 && chapterHeading.test(line)) values.push(index)
    return values
  }, [])
  if (!headings.length) return { chapters: [chapter(0, fallbackTitle, content, undefined)], detectedHeadings: false, reviewRequired: false }

  const chapters: ParsedChapter[] = []
  for (let index = 0; index < headings.length; index += 1) {
    const headingIndex = headings[index]
    const nextHeading = headings[index + 1] ?? lines.length
    const prefix = index === 0 ? lines.slice(0, headingIndex).filter((line) => !volumeHeading.test(line)).join('\n').trim() : ''
    const body = lines.slice(headingIndex + 1, nextHeading).join('\n').trim()
    const combined = [prefix, body].filter(Boolean).join('\n\n')
    chapters.push(chapter(index, titleFromHeading(lines[headingIndex], index + 1), combined, chapterNumber(lines[headingIndex])))
  }
  diagnoseChapters(chapters)
  return { chapters, detectedHeadings: true, reviewRequired: chapters.some((item) => item.status === 'review') }
}

function chapter(sourceIndex: number, title: string, content: string, number?: number): ParsedChapter {
  const clean = content.trim()
  return {
    sourceIndex,
    ...(number === undefined ? {} : { chapterNumber: number }),
    title: safeName(title),
    content: clean,
    wordCount: countWords(clean),
    preview: clean.replace(/\s+/g, ' ').slice(0, 88),
    status: 'ready',
    issues: [],
    selectedByDefault: true
  }
}

function diagnoseChapters(chapters: ParsedChapter[]): void {
  const firstByNumber = new Map<number, number>()
  let firstAmbiguous = -1
  for (let index = 0; index < chapters.length; index += 1) {
    const current = chapters[index]
    const previous = chapters[index - 1]
    if (current.chapterNumber !== undefined) {
      const first = firstByNumber.get(current.chapterNumber)
      if (first !== undefined) {
        current.issues.push(`章号 ${current.chapterNumber} 重复出现`)
        if (firstAmbiguous < 0) chapters[first].issues.push(`章号 ${current.chapterNumber} 重复出现`)
      } else firstByNumber.set(current.chapterNumber, index)
    }
    if (!current.title || /^未命名\s+\d+$/.test(current.title)) current.issues.push('章节标题为空')
    if (!current.content.trim()) current.issues.push('章节没有正文')
    if (previous?.chapterNumber !== undefined && current.chapterNumber !== undefined) {
      if (current.chapterNumber < previous.chapterNumber) current.issues.push(`章号从 ${previous.chapterNumber} 倒回 ${current.chapterNumber}`)
      else if (current.chapterNumber > previous.chapterNumber + 1) current.issues.push(`章号从 ${previous.chapterNumber} 跳到 ${current.chapterNumber}`)
    }
    if (firstAmbiguous < 0) {
      const earlierReview = chapters.findIndex((item, itemIndex) => itemIndex <= index && item.issues.length > 0)
      if (earlierReview >= 0) firstAmbiguous = earlierReview
    }
  }
  const firstReview = firstAmbiguous >= 0 ? firstAmbiguous : chapters.findIndex((item) => item.issues.length > 0)
  for (const item of chapters) {
    item.status = item.issues.length ? 'review' : 'ready'
    item.selectedByDefault = firstReview < 0 || item.sourceIndex < firstReview
  }
}

function chapterNumber(heading: string): number | undefined {
  const arabic = heading.trim().match(/^第(\d+)[章回节]/)
  if (arabic) return Number(arabic[1])
  const chinese = heading.trim().match(/^第([〇零一二三四五六七八九十百千万两]+)[章回节]/)
  if (chinese) return chineseInteger(chinese[1])
  const english = heading.trim().match(/^(?:chapter|chap\.?)\s+(\d+)/i)
  return english ? Number(english[1]) : undefined
}

function chineseInteger(value: string): number | undefined {
  const digits: Record<string, number> = { 〇: 0, 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
  const units: Record<string, number> = { 十: 10, 百: 100, 千: 1_000, 万: 10_000 }
  if ([...value].every((item) => item in digits)) return Number([...value].map((item) => digits[item]).join(''))
  let total = 0
  let section = 0
  let number = 0
  for (const item of value) {
    if (item in digits) { number = digits[item]; continue }
    const unit = units[item]
    if (!unit) return undefined
    if (unit === 10_000) { section = (section + number) * unit; total += section; section = 0; number = 0 }
    else { section += (number || 1) * unit; number = 0 }
  }
  return total + section + number
}

function titleFromHeading(heading: string, order: number): string {
  const title = heading.trim()
    .replace(/^第[0-9〇零一二三四五六七八九十百千万两]+[章回节]/, '')
    .replace(/^(?:chapter|chap\.?)\s+\d+/i, '')
    .replace(/^[：:、.．\-—_ ]+/, '')
    .trim()
  return title || `未命名 ${order}`
}

function safeName(value: string): string {
  return (value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '').trim() || '未命名书稿').slice(0, 80)
}

function countWords(content: string): number {
  const chinese = content.match(/[\u3400-\u9fff]/g)?.length ?? 0
  const latin = content.match(/[A-Za-z0-9]+/g)?.length ?? 0
  return chinese + latin
}

function invalidImport(message: string): never {
  throw new AppError('VALIDATION_ERROR', message, { recoverable: true })
}
