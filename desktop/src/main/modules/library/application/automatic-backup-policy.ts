export type AutomaticBackupCheckInput = {
  checkedAt: Date
  lastCheckedAt?: string
  lastSuccessAt?: string
  intervalMinutes: number
  backupOnFirstOpen: boolean
  force?: boolean
}

export type AutomaticBackupCheckDecision = {
  shouldCheck: boolean
  dailySnapshotDue: boolean
}

export function automaticBackupCheckDecision(input: AutomaticBackupCheckInput): AutomaticBackupCheckDecision {
  const lastSuccess = input.lastSuccessAt ? new Date(input.lastSuccessAt) : null
  const lastSuccessValid = Boolean(lastSuccess && Number.isFinite(lastSuccess.getTime()))
  const dailySnapshotDue = input.backupOnFirstOpen && (!lastSuccessValid || lastSuccess!.toDateString() !== input.checkedAt.toDateString())
  const lastCheckedMs = Date.parse(input.lastCheckedAt || input.lastSuccessAt || '')
  const intervalDue = !Number.isFinite(lastCheckedMs)
    || input.checkedAt.getTime() - lastCheckedMs >= input.intervalMinutes * 60_000
  return { shouldCheck: Boolean(input.force || dailySnapshotDue || intervalDue), dailySnapshotDue }
}
