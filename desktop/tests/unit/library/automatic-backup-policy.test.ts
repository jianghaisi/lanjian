import assert from 'node:assert/strict'
import test from 'node:test'
import { automaticBackupCheckDecision } from '../../../src/main/modules/library/application/automatic-backup-policy'

test('lets the author disable the daily first-open snapshot without disabling periodic checks', () => {
  const common = {
    checkedAt: new Date('2026-09-06T08:10:00.000Z'),
    lastCheckedAt: '2026-09-06T08:00:00.000Z',
    lastSuccessAt: '2026-09-05T08:00:00.000Z',
    intervalMinutes: 30
  }
  assert.deepEqual(automaticBackupCheckDecision({ ...common, backupOnFirstOpen: true }), {
    shouldCheck: true, dailySnapshotDue: true
  })
  assert.deepEqual(automaticBackupCheckDecision({ ...common, backupOnFirstOpen: false }), {
    shouldCheck: false, dailySnapshotDue: false
  })
  assert.deepEqual(automaticBackupCheckDecision({
    ...common, backupOnFirstOpen: false, checkedAt: new Date('2026-09-06T08:31:00.000Z')
  }), { shouldCheck: true, dailySnapshotDue: false })
})

test('manual checking remains available independently of both automatic schedules', () => {
  assert.deepEqual(automaticBackupCheckDecision({
    checkedAt: new Date('2026-09-06T08:10:00.000Z'),
    lastCheckedAt: '2026-09-06T08:00:00.000Z',
    lastSuccessAt: '2026-09-06T08:00:00.000Z',
    intervalMinutes: 30,
    backupOnFirstOpen: false,
    force: true
  }), { shouldCheck: true, dailySnapshotDue: false })
})
