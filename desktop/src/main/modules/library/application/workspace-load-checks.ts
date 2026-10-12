import { setTimeout } from 'node:timers/promises'
import { isAppError } from '../../../core/errors/app-error'
import { isChangingWorkspaceSnapshot } from '../../../core/errors/workspace-snapshot-error'
import type { WorkspaceBootstrapIssue, WorkspaceLoadCheckId } from '../../../../contracts/library/types'

export type LoadCheck<T> = { value: T | null; issues: WorkspaceBootstrapIssue[] }

export async function readLoadCheck<T>(id: WorkspaceLoadCheckId, read: () => Promise<T>): Promise<LoadCheck<T>> {
  try { return { value: await read(), issues: [] } }
  catch (error) { return { value: null, issues: [loadIssue(id, error)] } }
}

/** Called after sibling opening providers settle; never retries those providers or a write. */
export async function settleLoadCheck<T>(initial: LoadCheck<T>, read: () => Promise<LoadCheck<T>>, assertCurrent: () => Promise<void>): Promise<LoadCheck<T>> {
  let result = initial
  for (const delay of [0, 50, 150]) {
    if (result.issues[0]?.reason !== 'busy') break
    if (delay) await setTimeout(delay)
    await assertCurrent()
    result = await read()
  }
  return result
}

function loadIssue(id: WorkspaceLoadCheckId, error: unknown): WorkspaceBootstrapIssue {
  const model = id === 'modelSettingsUnreadable'
  const area = model ? 'aiSettings' : 'unifiedEvents'
  const subject = model ? '模型分配' : '事件资料'
  const reason = isChangingWorkspaceSnapshot(error) ? 'busy'
    : isAppError(error) && error.details?.area === 'workspaceSnapshot' && error.details.reason === 'recovery-required' ? 'recovery-required'
    : isAppError(error) && ['VALIDATION_ERROR', 'DATABASE_INTEGRITY_FAILED', 'INVALID_PROJECT_STATE', 'UNSUPPORTED_PROJECT_VERSION'].includes(error.code) ? 'invalid-data' : 'unavailable'
  const message = reason === 'busy'
    ? '作品资料正在更新，本次未能读完。请在当前操作结束后点击“重新检查”，无需修改正文或重新填写接口。'
    : reason === 'recovery-required'
      ? '数据库存在尚未确认的恢复记录。请结束正在进行的保存后重新检查；若仍失败，请保留原文件，在“设置 → 数据与备份 → 项目数据”中恢复到新副本，或复制诊断信息反馈。请勿手动删除数据库日志。'
      : model
        ? '暂时无法读取本书模型分配或共享接口配置。请先重新检查；若仍失败，可核对模型设置或复制诊断信息反馈。原配置保留，未自动更换接口。'
        : '暂时无法安全读取事件资料。请先重新检查；若仍失败，请保留原件，使用“设置 → 数据与备份 → 项目数据”恢复到新副本，或复制诊断信息反馈。未用旧事件替代正式数据。'
  return { id, area, title: reason === 'busy' ? `${subject}尚未加载完成` : `${subject}暂时无法读取`, message, recovery: 'manualReview', reason } as WorkspaceBootstrapIssue
}
