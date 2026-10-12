import { AppError, isAppError } from './app-error'

/** A retry is safe only for acquisition drift, never for a reviewed operation. */
export function workspaceSnapshotConflict(reason: 'changing' | 'recovery-required' = 'changing'): AppError {
  return new AppError('CONFLICT', reason === 'changing'
    ? '作品资料正在更新，暂时未能读完，请重新检查。'
    : '作品数据库存在尚未确认的恢复记录，请结束正在进行的操作后重新检查；原文件未改动。', {
    recoverable: true, details: { area: 'workspaceSnapshot', reason }
  })
}

export function isChangingWorkspaceSnapshot(error: unknown): boolean {
  return isAppError(error) && error.code === 'CONFLICT'
    && error.details?.area === 'workspaceSnapshot' && error.details.reason === 'changing'
}
