import { AppError } from '../core/app-error'
import type { WritingAgentArtifactApplicationInput, WritingAgentCandidate, WritingAgentInsertionAnchor, WritingAgentTask } from '../index'
import { mergeWritingAgentDiff } from './writing-diff'
import { formatManuscriptParagraphs } from '../../renderer/features/manuscript/services/manuscript-formatting'

export function buildWritingAgentApplication(task: WritingAgentTask, input: WritingAgentArtifactApplicationInput): {
  artifactId: string
  artifactType: 'writing_agent_turn' | 'writing_agent_stream'
  mode: WritingAgentCandidate['mode']
  content: string
} {
  const accepted = new Set(input.acceptedChangeIds ?? [])
  let content: string
  let mode: WritingAgentCandidate['mode']
  let artifactId: string
  let artifactType: 'writing_agent_turn' | 'writing_agent_stream'
  if (task.status === 'succeeded' && task.turn?.candidate && task.artifact?.status === 'complete') {
    const candidate = task.turn.candidate
    if (task.turn.proposal && !task.turn.proposal.report.passed && input.allowFailedReview !== true) {
      throw new AppError('VALIDATION_ERROR', '这份候选没有通过全部章纲检查，请明确确认后再采用。', { recoverable: true })
    }
    content = applyCandidate(task.baseDraft, candidate, accepted)
    mode = candidate.mode
    artifactId = task.artifact.id
    artifactType = 'writing_agent_turn'
  } else if (['paused', 'cancelled', 'failed', 'interrupted'].includes(task.status) && task.partial?.status === 'partial') {
    if (!['continue', 'rewrite', 'expand', 'compress', 'custom', 'polish'].includes(task.skill || '')) {
      throw new AppError('CONFLICT', '只读回答的未完成内容不能放入正文。', { recoverable: true })
    }
    if (accepted.size) throw new AppError('VALIDATION_ERROR', '未完成草稿不支持逐块采用。', { recoverable: true })
    const replacement = task.partial.content.trim()
    if (!replacement) throw new AppError('CONFLICT', '未完成草稿没有可采用的内容。', { recoverable: true })
    if (task.selection) {
      assertSelection(task.baseDraft, task.selection)
      content = `${task.baseDraft.slice(0, task.selection.start)}${replacement}${task.baseDraft.slice(task.selection.end)}`
      mode = 'replaceSelection'
    } else if (task.skill === 'continue') {
      content = task.insertionAnchor
        ? insertAtAnchor(task.baseDraft, task.insertionAnchor, replacement)
        : appendCandidate(task.baseDraft, replacement)
      mode = task.insertionAnchor ? 'insertAtAnchor' : 'append'
    } else {
      throw new AppError('CONFLICT', '只读回答的未完成内容不能放入正文。', { recoverable: true })
    }
    artifactId = task.partial.id
    artifactType = 'writing_agent_stream'
  } else {
    throw new AppError('CONFLICT', '只有未采用的已完成候选或可恢复片段可以结算。', { recoverable: true })
  }
  const formatted = formatManuscriptParagraphs(content, input.formatting)
  if (formatted === task.baseDraft) throw new AppError('CONFLICT', '本次决定没有产生正文变化，请选择保留原文。', { recoverable: true })
  return { artifactId, artifactType, mode, content: formatted }
}

/** Inline review retains whitespace. Formatting remains an explicit editor command. */
export function buildWritingAgentReviewCandidate(task: WritingAgentTask, allowFailedReview = false): string {
  if (task.status !== 'succeeded' || task.artifact?.status !== 'complete' || !task.turn?.candidate) throw damagedCandidate()
  if (task.turn.proposal && !task.turn.proposal.report.passed && !allowFailedReview) {
    throw new AppError('VALIDATION_ERROR', '这份候选尚未通过全部章纲检查，请先核对检查结果。', { recoverable: true })
  }
  const candidate = task.turn.candidate
  return applyCandidate(task.baseDraft, candidate, new Set(candidate.diff?.filter(block => block.kind === 'change').map(block => block.id) ?? []))
}

function applyCandidate(baseDraft: string, candidate: WritingAgentCandidate, accepted: ReadonlySet<string>): string {
  if (candidate.mode === 'replaceSelection') {
    if (!candidate.selection || !candidate.diff) throw damagedCandidate()
    assertSelection(baseDraft, candidate.selection)
    const replacement = checkedDiff(candidate, candidate.selection.text, accepted)
    return `${baseDraft.slice(0, candidate.selection.start)}${replacement}${baseDraft.slice(candidate.selection.end)}`
  }
  if (candidate.mode === 'insertAtAnchor') {
    if (!candidate.insertionAnchor || !candidate.diff) throw damagedCandidate()
    const insertion = checkedDiff(candidate, '', accepted)
    if (!insertion.trim()) throw new AppError('CONFLICT', '本次决定没有插入正文，请选择保留原文。', { recoverable: true })
    return insertAtAnchor(baseDraft, candidate.insertionAnchor, insertion)
  }
  if (accepted.size) throw damagedCandidate()
  return appendCandidate(baseDraft, candidate.content)
}

function checkedDiff(candidate: WritingAgentCandidate, original: string, accepted: ReadonlySet<string>): string {
  const blocks = candidate.diff!
  const allowed = new Set(blocks.filter((block) => block.kind === 'change').map((block) => block.id))
  if ([...accepted].some((id) => !allowed.has(id))) throw damagedCandidate()
  try {
    if (mergeWritingAgentDiff(blocks, new Set()) !== original || mergeWritingAgentDiff(blocks, allowed) !== candidate.content) throw damagedCandidate()
    return mergeWritingAgentDiff(blocks, accepted)
  } catch (error) {
    if (error instanceof AppError) throw error
    throw damagedCandidate()
  }
}

function assertSelection(baseDraft: string, selection: { start: number; end: number; text: string }): void {
  if (!Number.isSafeInteger(selection.start) || !Number.isSafeInteger(selection.end) || selection.start < 0 || selection.end <= selection.start
    || baseDraft.slice(selection.start, selection.end) !== selection.text) throw damagedCandidate()
}

function insertAtAnchor(baseDraft: string, anchor: WritingAgentInsertionAnchor, addition: string): string {
  if (!Number.isSafeInteger(anchor.offset) || anchor.offset < 0 || anchor.offset > baseDraft.length
    || baseDraft.slice(Math.max(0, anchor.offset - anchor.before.length), anchor.offset) !== anchor.before
    || baseDraft.slice(anchor.offset, anchor.offset + anchor.after.length) !== anchor.after) throw damagedCandidate()
  const before = baseDraft.slice(0, anchor.offset)
  const after = baseDraft.slice(anchor.offset)
  const text = addition.trim()
  const leftGap = !before || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n'
  const rightGap = !after || after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n'
  return `${before}${leftGap}${text}${rightGap}${after}`
}

function appendCandidate(baseDraft: string, addition: string): string {
  const text = addition.trim()
  return baseDraft.trim() ? `${baseDraft.trim()}\n\n${text}` : text
}

function damagedCandidate(): AppError {
  return new AppError('CONFLICT', '这份写作候选已经损坏或与发起时草稿不一致，请重新生成。', { recoverable: true })
}
