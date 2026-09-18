import type { WorkspaceDatabaseFactory, WorkspaceTaskRunRecord } from '../../../core/ports/workspace-database'
import type { TaskCenterItem } from '../../../../contracts/index'
import { isLegacyTaskContract } from '../domain/task-template-contract'
import { taskRunHasLegacyPause } from '../domain/task-run-lifecycle'

type CurrentProject = { currentPath(): Promise<string> }

export class TaskCenterService {
  constructor(private readonly projects: CurrentProject, private readonly databases: WorkspaceDatabaseFactory) {}

  async list(): Promise<TaskCenterItem[]> {
    const root = await this.projects.currentPath()
    const database = await this.databases.openExisting(root)
    if (!database) return []
    try {
      const records = database.taskCenterTaskRuns(100)
        .filter((record) => !safeObject(record.checkpointJson).dismissedAt)
      return records.map((record) => projectTaskCenterItem(record, record.hasContinuation, root))
    }
    finally { database.close() }
  }
}

export function projectTaskCenterItem(task: WorkspaceTaskRunRecord, hasContinuation = false, workItemId = task.projectId): TaskCenterItem {
  const checkpoint = safeObject(task.checkpointJson)
  const semanticPaused = taskRunHasLegacyPause(task, workItemId)
  const status: TaskCenterItem['status'] = semanticPaused ? 'paused' : task.status
  const taskType = knownTaskType(task.taskType)
  // A continuation is its own live run; its paused parent stays in history.
  const active = ['queued', 'preparing', 'running', 'streaming'].includes(status)
    || (status === 'resuming' && taskType === 'writing_agent')
  const legacy = isLegacyTaskContract(task.taskContract)
  const continuedPause = status === 'paused' && hasContinuation
  const actions: TaskCenterItem['actions'] = ['view']
  if (active && taskType !== 'other') {
    if (taskType === 'writing_agent' && !legacy) actions.unshift('pause')
    actions.push('cancel')
  } else if (status === 'paused' && !continuedPause && taskType === 'writing_agent') {
    if (!legacy) actions.unshift('resume')
    actions.push('cancel')
  } else if (!legacy && ['failed', 'interrupted', 'cancelled'].includes(status) && taskType !== 'other'
    && !(taskType === 'writing_agent' && status === 'interrupted' && hasContinuation)) {
    actions.unshift('retry')
  }
  return {
    id: task.id,
    workItemId: task.projectId,
    taskType,
    status,
    label: taskLabel(taskType),
    detail: legacy && !continuedPause && taskType !== 'other' && ['paused', 'failed', 'interrupted', 'cancelled'].includes(status)
      ? legacyRecoveryDetail(taskType)
      : taskDetail(taskType, checkpoint, task.legacyChapterId).slice(0, 240),
    hasContinuation,
    ...(task.legacyChapterId ? { chapterId: task.legacyChapterId } : {}),
    attempt: task.attempt,
    ...(task.parentTaskRunId ? { parentTaskRunId: task.parentTaskRunId } : {}),
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    ...(task.errorMessage ? { errorMessage: task.errorMessage.slice(0, 500) } : {}),
    actions
  }
}

function legacyRecoveryDetail(type: Exclude<TaskCenterItem['taskType'], 'other'>): string {
  const source = { writing_agent: '当前正文', idea_generation: '当前灵感', outline_expansion: '当前父级大纲', fact_extraction: '当前已确认正文' }[type]
  return `旧版任务缺少可验证的原始任务记录，无法继续或重试。历史结果仍可查看；请从${source}重新发起。`
}

function safeObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch { return {} }
}

function knownTaskType(value: string): TaskCenterItem['taskType'] {
  return ['writing_agent', 'idea_generation', 'outline_expansion', 'fact_extraction'].includes(value)
    ? value as TaskCenterItem['taskType'] : 'other'
}

function taskLabel(type: TaskCenterItem['taskType']): string {
  return ({ writing_agent: '智能助笔', idea_generation: '灵感生成', outline_expansion: '逐层谋篇', fact_extraction: '重要变化提炼', other: '后台任务' })[type]
}

function taskDetail(type: TaskCenterItem['taskType'], checkpoint: Record<string, unknown>, chapterId: number | null): string {
  const request = checkpoint.request && typeof checkpoint.request === 'object' && !Array.isArray(checkpoint.request)
    ? checkpoint.request as Record<string, unknown> : {}
  if (type === 'writing_agent') return boundedText(request.message, chapterId ? `第 ${chapterId} 章写作任务` : '写作任务')
  if (type === 'idea_generation') {
    const source = checkpoint.source && typeof checkpoint.source === 'object' && !Array.isArray(checkpoint.source) ? checkpoint.source as Record<string, unknown> : {}
    return boundedText(source.title, request.mode === 'synopsis' ? '整理梗概候选' : '发散灵感候选')
  }
  if (type === 'outline_expansion') return `从 ${boundedText(request.parentKey, '上一级大纲')} 拆解 ${Number(request.count) || 1} 项候选`
  if (type === 'fact_extraction') return chapterId ? `提炼第 ${chapterId} 章确认正文中的重要变化` : '提炼确认正文中的重要变化'
  return '保留的项目任务记录'
}

function boundedText(value: unknown, fallback: string): string {
  const text = typeof value === 'string' ? value.trim() : ''
  return (text || fallback).slice(0, 240)
}
