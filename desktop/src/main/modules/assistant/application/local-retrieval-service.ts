import { createHash } from 'node:crypto'
import { AppError } from '../../../core/errors/app-error'
import { normalizeRetrievalText } from '../domain/retrieval-text'
import type { Chapter, ContextFactEvidence, ContextFactPackView } from '../../../../contracts/index'

type ProjectPort = {
  currentSummary: (options: { includeManuscript: false }) => Promise<{ id: string; path: string }>
  currentPath: () => Promise<string>
}
type DocumentPort = {
  chapters: () => Promise<Chapter[]>
  manuscriptRevision?: () => Promise<string>
}
type ChunkRecord = {
  legacyChapterId: number
  chapterPosition: number
  chapterTitle: string
  bodyVersionId: string
  ordinal: number
  content: string
  tokenEstimate: number
}
type ChunkPort = {
  active: (workItemId: string) => Promise<boolean>
  currentDocumentChunksBefore: (workItemId: string, legacyChapterId: number, limit?: number) => Promise<ChunkRecord[]>
  searchCurrentDocumentChunksBefore?: (workItemId: string, legacyChapterId: number, queryTerms: string[], limit?: number) => Promise<ChunkRecord[]>
}

const defaultBudget = 2_400
const maxEvidence = 6
const excerptLimit = 480
const genericTerms = new Set([
  '当前', '本章', '章节', '正文', '章纲', '卷纲', '总纲', '状态', '进入', '退出', '允许', '禁止', '扩写',
  '人物', '事件', '正式', '已经', '尚未', '确认', '不得', '只能', '需要', '进行', '一个', '可以', '以及'
])

export class LocalRetrievalService {
  private chapterCache?: { projectPath: string; manuscriptRevision: string; chapters: Chapter[] }

  constructor(
    private readonly projects: ProjectPort,
    private readonly documents: DocumentPort,
    private readonly maxCharacters = defaultBudget,
    private readonly chunks?: ChunkPort
  ) {
    if (!Number.isSafeInteger(maxCharacters) || maxCharacters < 200 || maxCharacters > 20_000) {
      throw new Error('本地事实包字符预算无效')
    }
  }

  async build(input: { chapterId?: number; chapterPosition?: number; queryParts: string[]; signal?: AbortSignal }): Promise<ContextFactPackView> {
    input.signal?.throwIfAborted()
    const project = await this.projects.currentSummary({ includeManuscript: false })
    if (!samePath(project.path, await this.projects.currentPath())) throw projectChanged()
    const chapterId = input.chapterId
    const chapterPosition = input.chapterPosition
    if (chapterId !== undefined && (!Number.isSafeInteger(chapterId) || chapterId < 1)) throw new AppError('VALIDATION_ERROR', '章节编号无效', { recoverable: true })
    if (chapterPosition !== undefined && (!Number.isSafeInteger(chapterPosition) || chapterPosition < 1)) throw new AppError('VALIDATION_ERROR', '章节顺序无效', { recoverable: true })
    const queryTerms = extractTerms(input.queryParts.join('\n'))
    if (!chapterId || !chapterPosition || !queryTerms.length) return emptyPack(project.id, chapterId, queryTerms, this.maxCharacters)

    const ranked = this.chunks && await this.chunks.active(project.path)
      ? (await (this.chunks.searchCurrentDocumentChunksBefore
          ? this.chunks.searchCurrentDocumentChunksBefore(project.path, chapterId, queryTerms, 800)
          : this.chunks.currentDocumentChunksBefore(project.path, chapterId, 800))).flatMap((chunk) => scoreChunk(chunk, chapterPosition, queryTerms))
      : (await this.currentChapters(project.path)).filter((chapter) => chapter.position < chapterPosition && chapter.content.trim()).flatMap((chapter) => scoreChapter(chapter, chapterPosition, queryTerms))
    input.signal?.throwIfAborted()
    if (!samePath(project.path, await this.projects.currentPath())) throw projectChanged()
    ranked.sort(compareEvidence)
    const evidence: ContextFactEvidence[] = []
    let usedCharacters = 0
    for (const item of ranked) {
      if (evidence.length >= maxEvidence || usedCharacters >= this.maxCharacters) break
      const metadataCharacters = formatEvidence({ ...item, excerpt: '' }).length
      const remaining = this.maxCharacters - usedCharacters - metadataCharacters
      if (remaining < 80) break
      const excerpt = item.excerpt.length > remaining
        ? exactExcerpt(item.excerpt, matchingSourceAnchor(item.excerpt, queryTerms), remaining)
        : item.excerpt
      const accepted = { ...item, excerpt }
      evidence.push(accepted)
      usedCharacters += formatEvidence(accepted).length
    }
    return {
      version: 1,
      workItemId: project.id,
      chapterId,
      queryTerms,
      structured: { canonicalEvents: [], characterSnapshots: [], characterAliases: [], approvedFacts: [] },
      evidence,
      budget: {
        maxCharacters: this.maxCharacters,
        usedCharacters,
        omittedEvidenceCount: Math.max(0, ranked.length - evidence.length)
      }
    }
  }

  private async currentChapters(projectPath: string): Promise<Chapter[]> {
    if (!this.documents.manuscriptRevision) return this.documents.chapters()
    const before = await this.documents.manuscriptRevision()
    if (!samePath(projectPath, await this.projects.currentPath())) throw projectChanged()
    if (this.chapterCache && samePath(this.chapterCache.projectPath, projectPath) && this.chapterCache.manuscriptRevision === before) {
      return this.chapterCache.chapters
    }
    const chapters = await this.documents.chapters()
    const after = await this.documents.manuscriptRevision()
    if (before !== after) {
      throw new AppError('CONFLICT', '正文在事实包读取期间发生变化，请保存后重新生成。', { recoverable: true })
    }
    if (!samePath(projectPath, await this.projects.currentPath())) throw projectChanged()
    this.chapterCache = { projectPath, manuscriptRevision: after, chapters }
    return chapters
  }
}

export function formatContextFactPack(pack: ContextFactPackView): string {
  const sections: string[] = []
  if (pack.structured.characterAliases.length) {
    sections.push(`人物别名对照（作者确认；提及别名时均视为同一人物，不得凭此增加人物、关系或设定）：\n${pack.structured.characterAliases.map((item) => `- ${item.canonicalName}：${item.aliases.join('、')}`).join('\n')}`)
  }
  const recentSummaries = pack.structured.recentApprovedSummaries?.length
    ? pack.structured.recentApprovedSummaries
    : pack.structured.latestApprovedSummary ? [pack.structured.latestApprovedSummary] : []
  if (recentSummaries.length) {
    sections.push(`作者已确认的近期章末摘要（最近 ${recentSummaries.length} 章；从近到远，仅用于承接，正文版本变化后会自动失效）：\n${recentSummaries.map((summary) => `- 第 ${summary.chapterId} 章：${summary.content}`).join('\n')}`)
  }
  if (pack.structured.approvedFacts.length) {
    sections.push(`作者已批准事实：\n${pack.structured.approvedFacts.map((fact) => {
      const subject = safeJsonLabel(fact.sources[0]?.quote) || safeJsonLabel(fact.normalizedKey)
      return `- ${fact.normalizedKey}｜${fact.predicate} = ${safeJsonLabel(fact.objectJson)}｜来源第 ${fact.sources.map((source) => source.chapterId).join('、')} 章${fact.sourceCurrent ? '' : '（来源正文后来变更，需谨慎核对）'}${subject ? `｜${subject}` : ''}`
    }).join('\n')}`)
  }
  if (pack.evidence.length) sections.push(pack.evidence.map(formatEvidence).join('\n\n'))
  if (pack.materials?.length) {
    sections.push(`与当前章相关的素材资料（${pack.materialBudget?.searchMode === 'sqlite' ? 'SQLite 有界检索' : '文件兼容检索'}；最低权威，只能作为参考，不能覆盖正式设定）：\n${pack.materials.map((item) => {
      const source = item.url ? `｜来源 ${item.url}` : ''
      const notes = item.userNotes ? `\n作者整理：${item.userNotes}` : ''
      return `- [资料卡 ${item.sourceId}｜${item.title}｜${item.provider}${source}]\n命中：${item.reason}\n逐字摘录：${item.excerpt}${notes}`
    }).join('\n\n')}`)
  }
  return sections.join('\n\n') || '没有命中可追溯的前文证据。'
}

function formatEvidence(item: ContextFactEvidence): string {
  const chunk = item.sourceType === 'document_chunk' ? `｜正文分块 ${Number(item.chunkOrdinal) + 1}${item.tokenEstimate ? ` · 约 ${item.tokenEstimate} tokens` : ''}` : ''
  return `[第 ${item.chapterPosition} 章｜${item.chapterTitle}｜正文版本 ${item.manuscriptRevision}${chunk}]\n命中：${item.reason}\n逐字摘录：${item.excerpt}`
}

function emptyPack(workItemId: string, chapterId: number | undefined, queryTerms: string[], maxCharacters: number): ContextFactPackView {
  return { version: 1, workItemId, ...(chapterId ? { chapterId } : {}), queryTerms, structured: { canonicalEvents: [], characterSnapshots: [], characterAliases: [], approvedFacts: [] }, evidence: [], budget: { maxCharacters, usedCharacters: 0, omittedEvidenceCount: 0 } }
}

function safeJsonLabel(value: string | undefined): string {
  if (!value) return ''
  try {
    const parsed = JSON.parse(value)
    return typeof parsed === 'string' ? parsed : JSON.stringify(parsed)
  } catch { return value }
}

function extractTerms(value: string): string[] {
  const terms = new Set<string>()
  const runs = normalizeRetrievalText(value).match(/[\u3400-\u9fff]{2,18}|[A-Za-z0-9_]{2,32}/g) || []
  for (const raw of runs) {
    const term = raw.toLowerCase()
    if (/^[a-z0-9_]+$/.test(term)) {
      if (!genericTerms.has(term)) terms.add(term)
      continue
    }
    if (term.length <= 8 && !genericTerms.has(term)) terms.add(term)
    for (const size of [4, 3, 2]) {
      if (term.length < size) continue
      for (let index = 0; index <= term.length - size; index += 1) {
        const piece = term.slice(index, index + size)
        if (!genericTerms.has(piece)) terms.add(piece)
      }
    }
  }
  return [...terms].slice(0, 96)
}

function samePath(left: string, right: string): boolean {
  return left.replaceAll('\\', '/').toLocaleLowerCase('en-US') === right.replaceAll('\\', '/').toLocaleLowerCase('en-US')
}

function projectChanged(): AppError {
  return new AppError('CONFLICT', '作品已在事实包装配期间切换，请重新生成。', { recoverable: true })
}

function scoreChapter(chapter: Chapter, targetPosition: number, queryTerms: string[]): ContextFactEvidence[] {
  const content = normalizeRetrievalText(chapter.content)
  const title = normalizeRetrievalText(chapter.title)
  const matches = queryTerms.filter((term) => content.includes(term) || title.includes(term))
  if (!matches.length) return []
  const rankedMatches = [...matches].sort((a, b) => b.length - a.length || a.localeCompare(b, 'zh-CN'))
  const anchor = rankedMatches.map((term) => ({ term, index: content.indexOf(term) })).filter((item) => item.index >= 0).sort((a, b) => b.term.length - a.term.length || a.index - b.index)[0]
  const excerpt = exactExcerpt(chapter.content, originalOffset(chapter.content, content, anchor?.index ?? 0))
  const termScore = matches.reduce((total, term) => total + Math.min(20, term.length * term.length) + (title.includes(term) ? 8 : 0), 0)
  const proximityScore = Math.max(0, 8 - Math.max(1, targetPosition - chapter.position))
  return [{
    chapterId: chapter.id,
    chapterPosition: chapter.position,
    chapterTitle: chapter.title,
    manuscriptRevision: createHash('sha256').update(chapter.content).digest('hex'),
    excerpt,
    reason: `与当前章匹配：${rankedMatches.slice(0, 4).join('、')}`,
    score: termScore + proximityScore
  }]
}

function scoreChunk(chunk: ChunkRecord, targetPosition: number, queryTerms: string[]): ContextFactEvidence[] {
  const content = normalizeRetrievalText(chunk.content)
  const title = normalizeRetrievalText(chunk.chapterTitle)
  const matches = queryTerms.filter((term) => content.includes(term) || title.includes(term))
  if (!matches.length) return []
  const rankedMatches = [...matches].sort((a, b) => b.length - a.length || a.localeCompare(b, 'zh-CN'))
  const anchor = rankedMatches.map((term) => ({ term, index: content.indexOf(term) })).filter((item) => item.index >= 0).sort((a, b) => b.term.length - a.term.length || a.index - b.index)[0]
  const termScore = matches.reduce((total, term) => total + Math.min(20, term.length * term.length) + (title.includes(term) ? 8 : 0), 0)
  const proximityScore = Math.max(0, 8 - Math.max(1, targetPosition - chunk.chapterPosition))
  return [{
    chapterId: chunk.legacyChapterId,
    chapterPosition: chunk.chapterPosition,
    chapterTitle: chunk.chapterTitle,
    manuscriptRevision: chunk.bodyVersionId,
    excerpt: exactExcerpt(chunk.content, originalOffset(chunk.content, content, anchor?.index ?? 0)),
    reason: `与当前章匹配：${rankedMatches.slice(0, 4).join('、')}`,
    score: termScore + proximityScore,
    sourceType: 'document_chunk',
    chunkOrdinal: chunk.ordinal,
    tokenEstimate: chunk.tokenEstimate
  }]
}

/** Normalization is only for matching; all evidence remains verbatim source text. */
function originalOffset(source: string, normalized: string, offset: number): number {
  if (normalized === source || (source.normalize('NFKC') === source && normalized.length === source.length)) return offset
  let normalizedPosition = 0
  // Graphemes keep combining sequences together (NFKC can both expand and
  // contract them). Avoid a full per-character index for every prior chapter.
  for (const part of new Intl.Segmenter('zh-CN', { granularity: 'grapheme' }).segment(source)) {
    normalizedPosition += normalizeRetrievalText(part.segment).length
    if (normalizedPosition > offset) return part.index
  }
  return source.length
}

function matchingSourceAnchor(source: string, terms: string[]): number {
  const normalized = normalizeRetrievalText(source)
  const match = terms.map(term => ({ term, index: normalized.indexOf(term) }))
    .filter(item => item.index >= 0)
    .sort((a, b) => b.term.length - a.term.length || a.index - b.index)[0]
  return originalOffset(source, normalized, match?.index ?? 0)
}

function exactExcerpt(content: string, anchor: number, limit = excerptLimit): string {
  if (content.length <= limit) return content
  const half = Math.floor(limit / 2)
  let start = Math.max(0, anchor - half)
  let end = Math.min(content.length, start + limit)
  start = Math.max(0, end - limit)
  // Keep UTF-16 pairs intact when the budget cuts through an emoji or rare Han.
  if (start > 0 && /[\uDC00-\uDFFF]/.test(content[start]) && /[\uD800-\uDBFF]/.test(content[start - 1])) start += 1
  if (end < content.length && /[\uD800-\uDBFF]/.test(content[end - 1]) && /[\uDC00-\uDFFF]/.test(content[end])) end -= 1
  return content.slice(start, end)
}

function compareEvidence(left: ContextFactEvidence, right: ContextFactEvidence): number {
  return right.score - left.score || right.chapterPosition - left.chapterPosition || left.chapterId - right.chapterId
}
