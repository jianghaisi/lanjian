import { createHash } from 'node:crypto'
import { AppError } from '../../../core/errors/app-error'
import type {
  AiTask,
  BookProfile,
  ContextBudgetPreferences,
  OutlinePlanningStatus,
  PlanningChapterSkeletonEntry,
  PlanningChapterSkeletonProposal,
  PlanningPackageProposal
} from '../../../../contracts/index'
import {
  renderPlanningTotalOutline,
  renderPlanningVolumeOutline,
  renderPlanningVolumePlan,
  renderPlanningVolumeStructure
} from './planning-package-service'
import { completeStoryOutline } from './story-outline-review'
import { creativePolicyRun, type CaptureCreativePolicy } from '../../writing-plugins/domain/creative-policy'
import { policyRecords } from '@lanjian/writing-plugin-contracts'
import { completeStructured } from '../../assistant/application/structured-response-repair'

type TextGenerator = {
  captureRun?: (tasks: AiTask[]) => Promise<TextGenerator>
  complete: (instruction: string, draft?: string, systemContext?: string, task?: AiTask, signal?: AbortSignal) => Promise<{ content: string }>
}

type PlanningPackagePort = {
  get: () => Promise<PlanningPackageProposal | null>
  storeChapterSkeleton: (proposalId: string, skeleton: PlanningChapterSkeletonProposal) => Promise<PlanningPackageProposal>
}

type PlanningStatusPort = { status: () => Promise<OutlinePlanningStatus> }
type WorkspacePort = {
  bookProfile: () => Promise<BookProfile>
  effectivePrompt?: (task: AiTask) => Promise<string>
  authorPrompt?: (task: AiTask) => Promise<string>
  contextBudgetPreferences?: () => Promise<ContextBudgetPreferences>
}

export type ChapterSkeletonProgress = (completed: number, total: number, message: string) => void

export class ChapterSkeletonService {
  constructor(
    private readonly ai: TextGenerator,
    private readonly packages: PlanningPackagePort,
    private readonly planning: PlanningStatusPort,
    private readonly workspace: WorkspacePort,
    private readonly now = () => new Date(),
    private readonly capturePolicy: CaptureCreativePolicy = async () => creativePolicyRun()
  ) {}

  async generate(proposalId: string, signal?: AbortSignal, onProgress?: ChapterSkeletonProgress): Promise<PlanningPackageProposal> {
    const ai = this.ai.captureRun ? await this.ai.captureRun(['chapterOutline']) : this.ai
    const [proposal, status, profile, effectivePrompt] = await Promise.all([
      this.packages.get(), this.planning.status(), this.workspace.bookProfile(),
      this.workspace.authorPrompt?.('chapterOutline') ?? this.workspace.effectivePrompt?.('chapterOutline') ?? Promise.resolve('')
    ])
    if (!proposal || proposal.id !== proposalId) throw new AppError('NOT_FOUND', '当前作品没有可生成章节骨架的谋篇候选。', { recoverable: true })
    assertSkeletonReady(proposal, status, profile)
    const policy = await this.capturePolicy(), methods = policy.resolve('chapter-skeleton')
    const sources = [...methods, ...policy.resolve('outline-review')]

    const total = proposal.volumes.length
    const chapters: PlanningChapterSkeletonEntry[] = []
    const repairAttempts = this.workspace.contextBudgetPreferences ? (await this.workspace.contextBudgetPreferences()).structuredRepairAttempts : 1
    const systemContext = [
      ...methods.map(p => p.text),
      `本次创作策略版本：${JSON.stringify(sources.map(({ text: _text, ...source }) => source))}`,
      '本次只生成轻量章节安排，不写详细章纲或正文。',
      '每章必须服从已确认总纲和本卷卷纲，明确核心事件的结果，不得增加改变后续因果的新支线。',
      effectivePrompt.trim() ? `本书章节大纲提示词：\n${effectivePrompt.trim()}` : ''
    ].filter(Boolean).join('\n')

    for (const volume of proposal.volumes) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      onProgress?.(volume.order - 1, total, `正在编排第 ${volume.order} 卷《${volume.title}》`)
      const startChapter = chapters.length + 1
      const instruction = [
        `生成第 ${volume.order} 卷《${volume.title}》的轻量章节骨架，预计 ${profile.chaptersPerVolume} 章，按实际场景与节奏确定数量（1到500章），不要凑数；全书章序从 ${startChapter} 开始。`,
        '每项只输出标题、核心事件、参与人物、地点和事件结果。',
        '只输出一个 JSON 对象，不要输出 Markdown。字段：',
        '{"chapters":[{"volumeChapter":1,"title":"章名","coreEvent":"本章唯一核心事件","characters":["人物名"],"location":"主要地点","result":"章末已发生的结果"}]}',
        `创作蓝图：${JSON.stringify(proposal.blueprint)}`,
        `全书总纲：${JSON.stringify(proposal.totalOutline)}`,
        `本卷卷纲：${JSON.stringify(volume)}`,
        volume.order > 1 ? `上一卷卷末状态：${proposal.volumes[volume.order - 2]?.ending || ''}` : '这是第一卷，需要建立全书起点。'
      ].join('\n\n')
      chapters.push(...await completeStoryOutline({
        parent: `${JSON.stringify(proposal.totalOutline)}\n${JSON.stringify(volume)}\n${JSON.stringify(chapters.slice(-5))}`,
        ai, policy, instruction, systemContext, task: 'chapterOutline', signal, repairAttempts,
        parse: (content) => parseChapterSkeletonVolume(content, volume.order, profile.chaptersPerVolume, startChapter, true)
      }))
      onProgress?.(volume.order, total, `第 ${volume.order} 卷骨架完成`)
    }

    const latestProposal = await this.packages.get()
    const latestStatus = await this.planning.status()
    const latestProfile = await this.workspace.bookProfile()
    if (!latestProposal || latestProposal.id !== proposalId) throw stale()
    assertSkeletonReady(latestProposal, latestStatus, latestProfile)
    if (latestProfile.plannedVolumes !== profile.plannedVolumes
      || latestProfile.chaptersPerVolume !== profile.chaptersPerVolume
      || latestProfile.targetWordsPerChapter !== profile.targetWordsPerChapter) throw stale()

    await policy.assertAuthorized?.()
    return this.packages.storeChapterSkeleton(proposalId, {
      creativePolicy: policyRecords(sources),
      generatedAt: this.now().toISOString(),
      basedOn: {
        totalOutlineFingerprint: fingerprint(renderPlanningTotalOutline(proposal)),
        volumePlanFingerprint: fingerprint(renderPlanningVolumePlan(proposal))
      },
      targetWordsPerChapter: profile.targetWordsPerChapter,
      chapters
    })
  }
}

export function parseChapterSkeletonVolume(content: string, volume: number, expectedCount: number, startChapter: number, flexible = false): PlanningChapterSkeletonEntry[] {
  const value = jsonRecord(content)
  if (!Array.isArray(value.chapters)) throw invalid('章节骨架缺少 chapters 数组，请重试。')
  if (value.chapters.length < 1 || value.chapters.length > 500 || (!flexible && value.chapters.length !== expectedCount)) throw invalid(`第 ${volume} 卷应有 ${expectedCount} 章，模型实际返回 ${value.chapters.length} 章，请重试。`)
  return value.chapters.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw invalid(`第 ${volume} 卷第 ${index + 1} 章结构无效。`)
    const entry = item as Record<string, unknown>
    const volumeChapter = Number(entry.volumeChapter)
    const rawCharacters = Array.isArray(entry.characters) ? entry.characters : []
    const characters = rawCharacters.map((name) => clean(name, 120)).filter(Boolean)
    const result = {
      chapter: startChapter + index,
      volume,
      volumeChapter,
      title: clean(entry.title, 200),
      coreEvent: clean(entry.coreEvent, 5_000),
      characters: [...new Set(characters)],
      location: clean(entry.location, 500),
      result: clean(entry.result, 5_000)
    }
    if (volumeChapter !== index + 1 || !result.title || !result.coreEvent || !result.characters.length || !result.location || !result.result) {
      throw invalid(`第 ${volume} 卷第 ${index + 1} 章缺少连续卷内章序、标题、事件、人物、地点或结果。`)
    }
    return result
  })
}

function assertSkeletonReady(proposal: PlanningPackageProposal, status: OutlinePlanningStatus, profile: BookProfile): void {
  if (profile.plannedVolumes !== proposal.volumes.length) {
    throw new AppError('CONFLICT', '作品预计卷数已经变化，请先重新生成或调整谋篇候选。', { recoverable: true })
  }
  const adoption = proposal.adoption
  if (!adoption?.totalOutline || !adoption.volumeStructure
    || adoption.volumeStructure.fingerprint !== fingerprint(renderPlanningVolumeStructure(proposal))) {
    throw new AppError('CONFLICT', '请先采用总纲并建立当前篇卷目录。', { recoverable: true })
  }
  if (status.totalApproval.status !== 'confirmed') {
    throw new AppError('CONFLICT', '请先正式确认当前总纲。', { recoverable: true })
  }
  const missing = proposal.volumes.filter((volume) => {
    const adopted = adoption.volumeOutlines?.find((item) => item.order === volume.order)
    const formal = status.volumes.find((item) => item.volume === volume.order)
    return !adopted || adopted.fingerprint !== fingerprint(renderPlanningVolumeOutline(volume))
      || formal?.title !== volume.title.trim() || formal.approval.status !== 'confirmed'
  })
  if (missing.length) {
    throw new AppError('CONFLICT', `请先逐卷采用并正式确认：${missing.map((item) => `第 ${item.order} 卷`).join('、')}。`, { recoverable: true })
  }
}

function jsonRecord(content: string): Record<string, unknown> {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  try {
    const value = JSON.parse(start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object')
    return value as Record<string, unknown>
  } catch {
    throw invalid('模型返回的章节骨架不是有效 JSON，请重试。')
  }
}

function clean(value: unknown, limit: number): string { return typeof value === 'string' ? value.trim().slice(0, limit) : '' }
function fingerprint(content: string): string { return createHash('sha256').update(content).digest('hex') }
function invalid(message: string): AppError { return new AppError('AI_RESPONSE_INVALID', message, { recoverable: true }) }
function stale(): AppError { return new AppError('CONFLICT', '谋篇或作品篇幅在生成期间发生变化，本次章节骨架没有保存。', { recoverable: true }) }
