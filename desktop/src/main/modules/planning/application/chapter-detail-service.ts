import { createHash } from 'node:crypto'
import { AppError } from '../../../core/errors/app-error'
import { renderPlanningChapterDetail } from '../domain/planning-chapter-detail'
import type { AiTask, ContextBudgetPreferences, OutlinePlanningStatus, PlanningChapterDetailEntry, PlanningChapterDetailVolumeProposal, PlanningPackageProposal } from '../../../../contracts/index'
import { renderPlanningChapterSkeletonVolume, renderPlanningTotalOutline, renderPlanningVolumeOutline } from './planning-package-service'
import { completeStructured } from '../../assistant/application/structured-response-repair'

type TextGenerator = { captureRun?: (tasks: AiTask[]) => Promise<TextGenerator>; complete: (instruction: string, draft?: string, systemContext?: string, task?: AiTask, signal?: AbortSignal) => Promise<{ content: string }> }
type PackagePort = {
  get: () => Promise<PlanningPackageProposal | null>
  storeChapterDetail: (proposalId: string, detail: PlanningChapterDetailVolumeProposal) => Promise<PlanningPackageProposal>
}
type PlanningPort = { status: () => Promise<OutlinePlanningStatus> }
type WorkspacePort = { effectivePrompt?: (task: AiTask) => Promise<string>; contextBudgetPreferences?: () => Promise<ContextBudgetPreferences> }
export type ChapterDetailProgress = (completed: number, total: number, message: string) => void

const batchSize = 5

export class ChapterDetailService {
  constructor(private readonly ai: TextGenerator, private readonly packages: PackagePort, private readonly planning: PlanningPort, private readonly workspace: WorkspacePort, private readonly now = () => new Date()) {}

  async generate(proposalId: string, volumeOrder: number, signal?: AbortSignal, onProgress?: ChapterDetailProgress): Promise<PlanningPackageProposal> {
    const ai = this.ai.captureRun ? await this.ai.captureRun(['chapterOutline']) : this.ai
    const [proposal, status, effectivePrompt] = await Promise.all([this.packages.get(), this.planning.status(), this.workspace.effectivePrompt?.('chapterOutline') || Promise.resolve('')])
    if (!proposal || proposal.id !== proposalId) throw new AppError('NOT_FOUND', '当前作品没有可生成详细章纲的谋篇候选。', { recoverable: true })
    const skeleton = assertReady(proposal, status, volumeOrder)
    const volume = proposal.volumes[volumeOrder - 1]
    const batches = Math.ceil(skeleton.length / batchSize)
    const chapters: PlanningChapterDetailEntry[] = []
    const repairAttempts = this.workspace.contextBudgetPreferences ? (await this.workspace.contextBudgetPreferences()).structuredRepairAttempts : 1
    const systemContext = [
      '你是中文长篇小说的章纲编剧。把已确认的轻量骨架编译为可受约束执行的详细章纲，不写正文。',
      '严格服从总纲、卷纲与骨架，不得提前发生后续章节事件；每个节拍都必须推进本章唯一核心事件。',
      '进入状态必须承接前章结果，退出状态必须包含本章已经造成且供后章继承的变化。',
      effectivePrompt.trim() ? `本书可修改的章节大纲提示词：\n${effectivePrompt.trim()}` : ''
    ].filter(Boolean).join('\n')

    for (let offset = 0; offset < skeleton.length; offset += batchSize) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      const batch = skeleton.slice(offset, offset + batchSize)
      const number = Math.floor(offset / batchSize) + 1
      onProgress?.(number - 1, batches, `正在细化第 ${volumeOrder} 卷 · 第 ${number}/${batches} 批`)
      const instruction = [
        `细化第 ${volumeOrder} 卷《${volume.title}》的本批章节。本批章节编号：${batch.map((item) => item.chapter).join(',')}。`,
        '只输出 JSON 对象，不要 Markdown：',
        '{"chapters":[{"chapter":1,"entryState":"开章时已成立的状态","beats":["按顺序发生的剧情动作"],"exitState":"章末已经形成的状态","allowedFacts":["可在不改因果时扩写的事实"],"forbiddenEvents":["本章绝不能提前发生的后续事件"],"foreshadowActions":[{"action":"plant|advance|misdirect|resolve|hold|discard","description":"伏笔动作"}]}]}',
        `总纲：${renderPlanningTotalOutline(proposal)}`,
        `本卷卷纲：${renderPlanningVolumeOutline(volume)}`,
        `本批骨架：${JSON.stringify(batch)}`,
        chapters.length ? `上一章详细退出状态：${chapters.at(-1)?.exitState}` : `本卷起点：${volumeOrder > 1 ? proposal.volumes[volumeOrder - 2]?.ending : proposal.totalOutline.summary}`,
        skeleton[offset + batch.length] ? `下一章核心事件（只能作为边界，禁止提前发生）：${skeleton[offset + batch.length]?.coreEvent}` : `本卷终点：${volume.ending}`
      ].join('\n\n')
      chapters.push(...await completeStructured({
        ai, instruction, systemContext, task: 'chapterOutline', signal, repairAttempts,
        parse: (content) => parseChapterDetailBatch(content, batch)
      }))
      onProgress?.(number, batches, `第 ${number}/${batches} 批详细章纲完成`)
    }

    const [latest, latestStatus] = await Promise.all([this.packages.get(), this.planning.status()])
    if (!latest || latest.id !== proposalId) throw stale()
    assertReady(latest, latestStatus, volumeOrder)
    if (fingerprint(renderPlanningChapterSkeletonVolume(latest, volumeOrder)) !== fingerprint(renderPlanningChapterSkeletonVolume(proposal, volumeOrder))) throw stale()
    return this.packages.storeChapterDetail(proposalId, {
      volume: volumeOrder,
      generatedAt: this.now().toISOString(),
      basedOn: {
        totalOutlineFingerprint: fingerprint(renderPlanningTotalOutline(proposal)),
        volumeOutlineFingerprint: fingerprint(renderPlanningVolumeOutline(volume)),
        skeletonFingerprint: fingerprint(renderPlanningChapterSkeletonVolume(proposal, volumeOrder))
      },
      chapters
    })
  }
}

export function parseChapterDetailBatch(content: string, expected: NonNullable<PlanningPackageProposal['chapterSkeleton']>['chapters']): PlanningChapterDetailEntry[] {
  const value = jsonRecord(content)
  if (!Array.isArray(value.chapters) || value.chapters.length !== expected.length) throw invalid(`本批应返回 ${expected.length} 章详细章纲。`)
  return value.chapters.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw invalid('详细章纲项目结构无效。')
    const input = raw as Record<string, unknown>
    const skeleton = expected[index]
    const list = (value: unknown, min: number, max: number, name: string) => {
      if (!Array.isArray(value) || value.length < min || value.length > max) throw invalid(`${name} 必须包含 ${min} 到 ${max} 项。`)
      const result = value.map((item) => clean(item, 5_000)).filter(Boolean)
      if (result.length !== value.length) throw invalid(`${name} 不能包含空项。`)
      return result
    }
    if (Number(input.chapter) !== skeleton.chapter) throw invalid(`模型改变了第 ${skeleton.chapter} 章的章序。`)
    if (!Array.isArray(input.foreshadowActions) || input.foreshadowActions.length > 8) throw invalid('伏笔动作最多 8 项。')
    const foreshadowActions = input.foreshadowActions.map((rawAction) => {
      if (!rawAction || typeof rawAction !== 'object' || Array.isArray(rawAction)) throw invalid('伏笔动作结构无效。')
      const action = rawAction as Record<string, unknown>
      if (!['plant', 'advance', 'misdirect', 'resolve', 'hold', 'discard'].includes(String(action.action))) throw invalid('伏笔动作类型无效。')
      const description = clean(action.description, 2_000)
      if (!description) throw invalid('伏笔动作描述不能为空。')
      return { action: action.action as 'plant' | 'advance' | 'misdirect' | 'resolve' | 'hold' | 'discard', description }
    })
    const entryState = clean(input.entryState, 5_000)
    const exitState = clean(input.exitState, 5_000)
    if (!entryState || !exitState) throw invalid('进入状态和退出状态不能为空。')
    return { chapter: skeleton.chapter, volume: skeleton.volume, volumeChapter: skeleton.volumeChapter, title: skeleton.title, entryState, beats: list(input.beats, 2, 8, '剧情节拍'), exitState, allowedFacts: list(input.allowedFacts, 1, 12, '允许事实'), forbiddenEvents: list(input.forbiddenEvents, 1, 12, '禁止事件'), foreshadowActions }
  })
}

export { renderPlanningChapterDetail }

function assertReady(proposal: PlanningPackageProposal, status: OutlinePlanningStatus, volume: number) {
  const skeleton = proposal.chapterSkeleton?.chapters.filter((item) => item.volume === volume) || []
  const formal = status.volumes.find((item) => item.volume === volume)
  const adopted = proposal.adoption?.volumeOutlines?.find((item) => item.order === volume)
  const candidate = proposal.volumes[volume - 1]
  if (!candidate) throw new AppError('NOT_FOUND', '候选中没有这一卷。', { recoverable: true })
  if (!skeleton.length || !proposal.chapterSkeleton || proposal.chapterSkeleton.basedOn.totalOutlineFingerprint !== fingerprint(renderPlanningTotalOutline(proposal))) throw new AppError('CONFLICT', '请先生成当前有效的全书章节骨架。', { recoverable: true })
  if (!adopted || adopted.fingerprint !== fingerprint(renderPlanningVolumeOutline(candidate)) || formal?.approval.status !== 'confirmed') throw new AppError('CONFLICT', '目标卷纲必须已采用并正式确认。', { recoverable: true })
  return skeleton
}

function jsonRecord(content: string): Record<string, unknown> {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try { const value = JSON.parse(trimmed.slice(trimmed.indexOf('{'), trimmed.lastIndexOf('}') + 1)); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value }
  catch { throw invalid('模型返回的详细章纲不是有效 JSON，请重试。') }
}
function clean(value: unknown, limit: number) { return typeof value === 'string' ? value.trim().slice(0, limit) : '' }
function fingerprint(content: string) { return createHash('sha256').update(content).digest('hex') }
function invalid(message: string) { return new AppError('AI_RESPONSE_INVALID', message, { recoverable: true }) }
function stale() { return new AppError('CONFLICT', '上游内容在生成期间发生变化，本卷详细章纲没有保存。', { recoverable: true }) }
