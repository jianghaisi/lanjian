import type { AssistantRunView } from '../../../../contracts/assistant/assistant-run-contracts'
import type { FieldTask, FieldCandidate } from '../../../../contracts/assistant/field-assistant-contracts'

export type AssistantHistoryFilter = 'all' | 'pending' | 'ended'
export type AssistantHistoryState = { label: string; pending: boolean; tone: 'quiet' | 'active' | 'attention' | 'error' }

/** Copy the actual stored text, not the rendered/clamped directory summary. */
export function assistantHistoryText(goal: string, message: string, candidate?: Pick<FieldCandidate, 'before' | 'after'>): string {
  return `原要求或修改目标\n${goal}\n\n${message}` + (candidate ? `\n\n修改前\n${String(candidate.before)}\n\n建议修改为\n${String(candidate.after)}` : '')
}

export function assistantRunHistoryState(run: AssistantRunView): AssistantHistoryState {
  const ended = ['completed', 'failed', 'cancelled'].includes(run.status)
  if (run.needsResume && !ended) return { label: '待恢复', pending: true, tone: 'attention' }
  const states: Record<AssistantRunView['status'], AssistantHistoryState> = {
    running: { label: '进行中', pending: true, tone: 'active' },
    'waiting-input': { label: '待回答', pending: true, tone: 'attention' },
    'waiting-adoption': { label: '待处理', pending: true, tone: 'attention' },
    'paused-limit': { label: '已暂停', pending: true, tone: 'attention' },
    interrupted: { label: '待恢复', pending: true, tone: 'attention' },
    completed: { label: '已完成', pending: false, tone: 'quiet' },
    failed: { label: '未完成', pending: false, tone: 'error' },
    cancelled: { label: '已停止', pending: false, tone: 'quiet' }
  }
  return states[run.status]
}

export function assistantFieldHistoryState(task: FieldTask): AssistantHistoryState {
  if (task.status === 'running') return { label: '生成中', pending: true, tone: 'active' }
  if (task.status === 'failed') return { label: '生成失败', pending: false, tone: 'error' }
  if (task.status === 'cancelled') return { label: '已停止', pending: false, tone: 'quiet' }
  switch (task.candidate?.status) {
    case 'candidate': return { label: '待采用', pending: true, tone: 'attention' }
    case 'applied': return { label: '已回填', pending: false, tone: 'quiet' }
    case 'undone': return { label: '已撤销', pending: false, tone: 'quiet' }
    case 'rejected': return { label: '未采用', pending: false, tone: 'quiet' }
    default: return { label: '已完成', pending: false, tone: 'quiet' }
  }
}

export function matchesAssistantHistoryState(state: AssistantHistoryState, filter: AssistantHistoryFilter): boolean {
  return filter === 'all' || (filter === 'pending' ? state.pending : !state.pending)
}

const shortDate = new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
export function assistantHistoryDate(value: string): { short: string; full: string; dateTime?: string } {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return { short: '时间未记录', full: '时间未记录' }
  return { short: shortDate.format(date), full: date.toLocaleString('zh-CN', { hour12: false }), dateTime: date.toISOString() }
}
