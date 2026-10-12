import assert from 'node:assert/strict'
import test from 'node:test'
import { ref } from 'vue'
import { WorkspaceRequestGuard } from '../../../src/contracts/library/workspace-request-guard.ts'
import { createWorkspaceRecoveryActions } from '../../../src/renderer/features/library/composables/create-workspace-recovery-actions.js'
import { decodeWorkspaceLoadCheckArgs } from '../../../src/contracts/library/ipc.ts'
import { unwrapValidatedIpcResponse } from '../../../src/contracts/core/ipc-response.ts'
import { compareWorkspaceMemory } from '../../../src/renderer/features/library/services/workspace-session-memory.js'

const eventIssue = { id: 'unifiedEventsUnreadable', reason: 'busy', area: 'unifiedEvents', recovery: 'manualReview', title: '资料更新中', message: '请重查' }
const modelIssue = { ...eventIssue, id: 'modelSettingsUnreadable', area: 'aiSettings' }
function fixture() {
  const project = { id: 'G:\\books\\fixture', path: 'G:\\books\\fixture' }
  let finish, calls = 0, invalidations = 0
  const ports = { current: ref(project), workspaceRequests: new WorkspaceRequestGuard(),
    workspaceBootstrapIssues: ref([eventIssue, modelIssue, { id: 'planningDraftUnreadable' }]),
    ai: ref({ shared: { model: '草稿模型' }, connections: [], modelConfigured: false, apiKeyConfigured: false }), modelSettingsDirty: ref(false),
    eventProjection: ref(null), unifiedEvents: ref([]), archivedUnifiedEvents: ref([]), unifiedEventCandidates: ref([]),
    appVersion: ref('test'), invalidateWorkspaceSnapshot: () => { invalidations++ },
    desktop: { workspace: { recheckLoadIssues: () => { calls++; return new Promise(resolve => { finish = resolve }) } } }
  }
  ports.workspaceRequests.begin(project)
  const result = { workItem: project, checkedIds: [eventIssue.id, modelIssue.id], issues: [], eventProjection: null,
    aiSettings: { connections: [], shared: { model: '已保存模型' }, modelConfigured: true, apiKeyConfigured: true } }
  return { ports, result, actions: createWorkspaceRecoveryActions(ports), finish: (value = result) => finish(value), calls: () => calls, invalidations: () => invalidations }
}

test('retry merges recovered projections, clears only checked issues and invalidates old warm snapshots', async () => {
  const f = fixture(); const original = f.ports.current.value
  const pending = f.actions.recheckWorkspaceIssues()
  assert.equal(f.actions.workspaceRecoveryBusy.value, true)
  await f.actions.recheckWorkspaceIssues(); assert.equal(f.calls(), 1)
  f.finish(); await pending
  assert.equal(f.actions.workspaceRecoveryBusy.value, false)
  assert.equal(f.ports.ai.value.modelConfigured, true)
  assert.equal(f.ports.ai.value.shared.model, '已保存模型')
  assert.deepEqual(f.ports.workspaceBootstrapIssues.value, [{ id: 'planningDraftUnreadable' }])
  assert.equal(f.ports.current.value, original)
  assert.equal(f.invalidations(), 2)
  assert.match(f.actions.workspaceRecoveryFeedback.value, /已恢复 2 项/)
})

test('typing during retry or a pre-existing settings draft preserves input while availability recovers', async () => {
  for (const dirty of [true, false]) {
    const f = fixture(); f.ports.modelSettingsDirty.value = dirty
    const pending = f.actions.recheckWorkspaceIssues()
    if (!dirty) f.ports.ai.value.shared.model = '刚输入的模型'
    const draft = f.ports.ai.value.shared.model
    f.finish(); await pending
    assert.equal(f.ports.ai.value.shared.model, draft)
    assert.equal(f.ports.ai.value.modelConfigured, true)
    assert.match(f.actions.workspaceRecoveryFeedback.value, /未保存的模型设置已保留/)
  }
})

test('failure retains fields and an A to B to A result cannot clear current issues', async () => {
  const f = fixture(), before = JSON.stringify(f.ports.ai.value)
  const pending = f.actions.recheckWorkspaceIssues()
  f.ports.workspaceRequests.invalidate()
  f.ports.current.value = { id: 'B', path: 'B' }
  f.ports.workspaceRequests.begin(f.result.workItem)
  f.ports.current.value = f.result.workItem
  f.finish(); await pending
  assert.equal(JSON.stringify(f.ports.ai.value), before)
  assert.equal(f.ports.workspaceBootstrapIssues.value.length, 3)
  assert.equal(f.actions.workspaceRecoveryFeedback.value, '')
})

test('partial recovery retains event failure and diagnostic never copies arbitrary error text', async () => {
  const f = fixture(), pending = f.actions.recheckWorkspaceIssues()
  f.finish({ ...f.result, issues: [eventIssue] }); await pending
  assert.equal(f.ports.workspaceBootstrapIssues.value.length, 2)
  assert.equal(f.ports.ai.value.modelConfigured, true)
  assert.match(f.actions.workspaceRecoveryFeedback.value, /仍有项目/)
  assert.doesNotMatch(f.actions.workspaceIssueDiagnostic({ ...eventIssue, message: 'private-key-sentinel', reason: 'private-key-sentinel' }), /private-key-sentinel/)
})

test('transport failure preserves warnings and all author drafts, then allows a new retry', async () => {
  const f = fixture()
  f.ports.chapterContent = ref('尚未保存的正文')
  f.ports.totalOutline = ref('尚未保存的总纲')
  f.ports.volumeOutline = ref('尚未保存的卷纲')
  f.ports.chapterOutline = ref('尚未保存的章纲')
  f.ports.loadWorkspace = () => assert.fail('recovery must not reload the workspace')
  const before = JSON.stringify([f.ports.workspaceBootstrapIssues.value, f.ports.ai.value])
  f.ports.desktop.workspace.recheckLoadIssues = async () => { throw Error('private transport details') }
  await f.actions.recheckWorkspaceIssues()
  assert.equal(f.actions.workspaceRecoveryBusy.value, false)
  assert.equal(JSON.stringify([f.ports.workspaceBootstrapIssues.value, f.ports.ai.value]), before)
  assert.doesNotMatch(f.actions.workspaceRecoveryFeedback.value, /private/)
  f.ports.desktop.workspace.recheckLoadIssues = async () => f.result
  await f.actions.recheckWorkspaceIssues()
  assert.equal(f.ports.workspaceBootstrapIssues.value.length, 1)
  for (const key of ['chapterContent', 'totalOutline', 'volumeOutline', 'chapterOutline']) assert.match(f.ports[key].value, /^尚未保存/)
})

test('resolved opening errors do not mark a warm book externally changed; real event drift still does', () => {
  const workItem = { id: 'A', path: '/A' }
  const snapshot = { ...workItem, fields: { chapters: [], eventProjection: null, workspaceBootstrapIssues: [eventIssue, modelIssue] }, formBaselines: {} }
  const bootstrap = { workItem, chapters: [], eventProjection: null, issues: [], outlines: { volumes: [] },
    sources: { sources: [] }, events: { events: [] }, realms: { levels: [] }, systemTemplate: { template: '' } }
  assert.equal(compareWorkspaceMemory(snapshot, bootstrap).changed, false)
  assert.equal(compareWorkspaceMemory(snapshot, { ...bootstrap, eventProjection: { revision: 'new' } }).changed, true)
  assert.equal(compareWorkspaceMemory(snapshot, { ...bootstrap, issues: [{ id: 'chapterOrderUnreadable' }] }).changed, true)
})

test('input boundary rejects unknown areas, duplicate ids and mismatched identity', () => {
  const input = { workItem: { id: 'G:\\books\\fixture', path: 'G:\\books\\fixture' }, issueIds: [modelIssue.id] }
  assert.deepEqual(decodeWorkspaceLoadCheckArgs([input]), [input])
  for (const wrong of [[], ['unknown'], [modelIssue.id, modelIssue.id]]) assert.throws(() => decodeWorkspaceLoadCheckArgs([{ ...input, issueIds: wrong }]))
  assert.throws(() => decodeWorkspaceLoadCheckArgs([{ ...input, workItem: { ...input.workItem, id: 'B' } }]))
  assert.throws(() => decodeWorkspaceLoadCheckArgs([{ ...input, rawError: 'secret' }]))
})

test('response boundary distinguishes unmigrated events from failures and rejects unsafe details', () => {
  const value = { workItem: { id: 'G:\\books\\fixture', path: 'G:\\books\\fixture' }, checkedIds: [eventIssue.id], eventProjection: null, issues: [] }
  const decode = v => unwrapValidatedIpcResponse('workspace:recheck-load-issues', { ok: true, value: v })
  assert.deepEqual(decode(value), value)
  assert.deepEqual(decode({ ...value, issues: [eventIssue] }), { ...value, issues: [eventIssue] })
  for (const issue of [{ ...eventIssue, reason: 'raw-error' }, { ...eventIssue, stack: 'secret' }, modelIssue]) assert.throws(() => decode({ ...value, issues: [issue] }))
  assert.throws(() => decode({ ...value, aiSettings: null }))
  assert.throws(() => decode({ ...value, checkedIds: [modelIssue.id], aiSettings: null }))
})
