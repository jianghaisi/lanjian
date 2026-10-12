import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { AppError } from '../../../core/errors/app-error'
import type { AiTask } from '../../../../contracts/index'
import type { DirectCompletionOperation } from '../../../../contracts/models/ai-api'
import type { CreativeSlot } from '@lanjian/writing-plugin-contracts'
import type { AiClient } from '../../models/application/ai-client'
import type { ProjectService } from '../../library/application/project-service'
import type { WorkspaceService } from '../../library/application/workspace-service'
import { creativePolicyRun, type CaptureCreativePolicy, type CreativePolicyRun } from '../../writing-plugins/domain/creative-policy'
import { creativePolicyContext } from '../../writing-plugins/domain/creative-policy-context'
import { timelineCandidateInstruction } from '../../timeline/domain/timeline-candidate-instruction'

const slots: Record<AiTask, CreativeSlot> = { outline: 'total-outline', chapterOutline: 'chapter-outline', prose: 'prose', review: 'review' }
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
type Workspace = Pick<WorkspaceService, 'foundationStatus' | 'chapterContractVersion' | 'bookProfile' | 'promptContext'>

/** Direct candidates retain the same author/fact authority as domain writing. */
export class DirectCompletionService {
  constructor(
    private readonly projects: Pick<ProjectService, 'currentPath' | 'executionIdentity'>,
    private readonly workspace: Workspace,
    private readonly ai: AiClient,
    private readonly capturePolicy: CaptureCreativePolicy = async () => creativePolicyRun()
  ) {}

  async complete(instruction: string, draft = '', task: AiTask = 'prose', chapterId?: number, operation?: DirectCompletionOperation) {
    await this.assertReady(task, chapterId)
    const root = await this.projects.currentPath(), physicalIdentity = this.projects.executionIdentity?.physicalIdentity
    const policy = await this.capturePolicy(), ai = this.ai.captureRun ? await this.ai.captureRun([task]) : this.ai
    const model = await ai.modelFor(task), modelIdentity = await ai.completionIdentity(task, model)
    const contract = task === 'prose' ? (await this.workspace.chapterContractVersion(chapterId!)).fingerprint : undefined
    const profile = await this.workspace.bookProfile()
    const profileHash = hash(JSON.stringify(profile))
    const methods = creativePolicyContext([...policy.resolve(operation === 'timeline' ? 'timeline-events' : slots[task]),
      ...policy.resolve('genre-guidance', { genre: profile.genre || '', subgenre: profile.subgenre || '' })])
    const context = await this.withPolicy(policy, () => this.workspace.promptContext(chapterId, task, { policyManaged: true }))
    if (context.length > 200_000) throw conflict('本次正式材料超过直接创作预算，请缩小范围后重新发起。')
    const contextHash = hash(context)
    const guard = async () => {
      if (resolve(root) !== resolve(await this.projects.currentPath()) || physicalIdentity !== this.projects.executionIdentity?.physicalIdentity) throw conflict('作品身份已经变化，请重新发起。')
      await policy.assertAuthorized?.()
      const current = await this.withPolicy(policy, () => this.workspace.promptContext(chapterId, task, { policyManaged: true, readOnly: true }))
      if (hash(current) !== contextHash || hash(JSON.stringify(await this.workspace.bookProfile())) !== profileHash) throw conflict('正式依据或作者要求已经变化，请重新发起。')
      // These reads await source work; validate model and confirmed contract after it.
      if (await this.ai.completionIdentity(task, model) !== modelIdentity || await ai.completionIdentity(task, model) !== modelIdentity) throw conflict('原模型配置已经变化，请重新发起。')
      await this.assertReady(task, chapterId)
      if (contract && (await this.workspace.chapterContractVersion(chapterId!)).fingerprint !== contract) throw conflict('原已确认章纲版本已经变化，请重新确认后发起。')
      await policy.assertAuthorized?.()
      if (resolve(root) !== resolve(await this.projects.currentPath()) || physicalIdentity !== this.projects.executionIdentity?.physicalIdentity) throw conflict('作品身份已经变化，请重新发起。')
    }
    await guard()
    const hostInstruction = operation === 'timeline' ? timelineCandidateInstruction(instruction) : instruction
    const result = await this.withPolicy(policy, () => ai.complete(hostInstruction, draft,
      `本次操作只返回候选。作者要求、正式依据、动态境界与固定系统模板优先，创作方法不得制造正式事实或作者确认。\n${methods}\n正式上下文：\n${context}`, task, undefined, model))
    await guard()
    return result
  }

  private async assertReady(task: AiTask, chapterId?: number): Promise<void> {
    if (task !== 'prose' && task !== 'chapterOutline') return
    if (task === 'prose' && chapterId === undefined) throw conflict('正文创作必须明确对应章节，并由作者确认当前总纲、卷纲和章纲。')
    const status = await this.workspace.foundationStatus(chapterId)
    if (!(task === 'prose' ? status.readyForProse : status.readyForChapterOutline)) throw conflict(`请先完善或由作者确认：${status.missing.join('、')}`)
  }
  private withPolicy<T>(policy: CreativePolicyRun, operation: () => Promise<T>): Promise<T> { return policy.withContext ? policy.withContext(operation) : operation() }
}

function conflict(message: string) { return new AppError('CONFLICT', message, { recoverable: true }) }
