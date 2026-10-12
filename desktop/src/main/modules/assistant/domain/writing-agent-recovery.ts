import { assertJson } from '@lanjian/writing-plugin-contracts'
import type { AiTask, WritingAgentSkillId } from '../../../../contracts/index'
import { AppError } from '../../../core/errors/app-error'
import { decodeCreativePolicySnapshot, type CreativePolicySnapshot } from '../../writing-plugins/domain/creative-policy-snapshot'

/** Main-private evidence. Every capability must be reacquired, never decoded here. */
export type WritingAgentRecovery = {
  format: 1
  workItemId: string
  chapterId: number
  skill: WritingAgentSkillId
  requestHash: string
  contextHash: string
  sourceHash: string
  chapterCardFingerprint: string
  modelIdentities: Array<{ task: AiTask; identity: string }>
  contractFingerprint: string | null
  creativePolicy: CreativePolicySnapshot
}
export function missingWritingAgentRecovery(): never {
  throw new AppError('CONFLICT', '这条任务没有可验证的原创作快照，请核对当前资料后重新发起；原记录仍保留。', { recoverable: true })
}
export function decodeWritingAgentRecovery(value: unknown): WritingAgentRecovery {
  try {
    assertJson(value, 384 * 1024)
    const fields = ['format', 'workItemId', 'chapterId', 'skill', 'requestHash', 'contextHash', 'sourceHash', 'chapterCardFingerprint', 'modelIdentities', 'contractFingerprint', 'creativePolicy']
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== fields.length || Object.keys(value).some(key => !fields.includes(key))) return missingWritingAgentRecovery()
    const raw = value as WritingAgentRecovery
    if (raw.format !== 1 || typeof raw.workItemId !== 'string' || !raw.workItemId.trim() || raw.workItemId.length > 256
      || !Number.isSafeInteger(raw.chapterId) || raw.chapterId < 1
      || !['continue', 'rewrite', 'expand', 'compress', 'custom', 'polish', 'review', 'query', 'plan'].includes(raw.skill)
      || [raw.requestHash, raw.contextHash, raw.sourceHash].some(hash => typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash))
      || typeof raw.chapterCardFingerprint !== 'string' || !raw.chapterCardFingerprint || raw.chapterCardFingerprint.length > 256
      || (raw.contractFingerprint !== null && (typeof raw.contractFingerprint !== 'string' || !raw.contractFingerprint || raw.contractFingerprint.length > 256))
      || !Array.isArray(raw.modelIdentities) || raw.modelIdentities.length < 1 || raw.modelIdentities.length > 2) return missingWritingAgentRecovery()
    for (const route of raw.modelIdentities) {
      if (!route || typeof route !== 'object' || Object.keys(route).length !== 2 || Object.keys(route).some(key => key !== 'task' && key !== 'identity')
        || !['prose', 'review', 'chapterOutline'].includes(route.task) || typeof route.identity !== 'string' || !/^[a-f0-9]{64}$/.test(route.identity)) return missingWritingAgentRecovery()
    }
    if (new Set(raw.modelIdentities.map(route => route.task)).size !== raw.modelIdentities.length) return missingWritingAgentRecovery()
    return { ...structuredClone(raw), creativePolicy: decodeCreativePolicySnapshot(raw.creativePolicy) }
  } catch (cause) {
    throw new AppError('CONFLICT', '原创作恢复快照已失效，请重新核对资料后发起任务。', { recoverable: true, cause })
  }
}
