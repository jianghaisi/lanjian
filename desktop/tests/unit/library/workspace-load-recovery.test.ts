import assert from 'node:assert/strict'
import test from 'node:test'
import { AppError } from '../../../src/main/core/errors/app-error'
import { WorkspaceBootstrapService, type WorkspaceBootstrapDependencies } from '../../../src/main/modules/library/application/workspace-bootstrap-service'

function fixture() {
  let root = 'G:\\books\\fixture'
  const deps = {
    projects: { currentPath: async () => root, currentSummary: async () => ({ id: root, path: root }), migrationPreview: async () => ({}) },
    documents: { chapters: async () => [{ content: '作者正文' }], outlines: async () => ({ total: null, volumes: [] }) },
    workspace: { timeline: async () => ({ events: [] }), realms: async () => ({ levels: [] }), powerSystem: async () => ({}), cheatSystem: async () => ({}), systemTemplate: async () => ({ template: '' }), foundation: async () => ({}), bookProfile: async () => ({}), promptProfile: async () => ({}) },
    aiSettings: async () => ({ connections: [], modelConfigured: true }), eventProjection: { read: async () => null },
    researchSettings: async () => ({}), researchLibrary: { listSources: async () => ({ sources: [] }), listEvents: async () => ({ events: [] }) },
    planningDraft: async () => null, importRecoveries: async () => [], continuation: async () => ({ candidate: null })
  } as unknown as WorkspaceBootstrapDependencies
  return { deps, service: new WorkspaceBootstrapService(deps), switchRoot: (value: string) => { root = value } }
}
const busy = () => new AppError('CONFLICT', 'private fixture details', { details: { area: 'workspaceSnapshot', reason: 'changing' } })

test('rechecks snapshot conflicts after the other opening providers settle, without reloading author text', async () => {
  const f = fixture()
  let settle!: () => void
  const opening = new Promise<void>(resolve => { settle = resolve })
  let ready = false, chapters = 0, models = 0, events = 0
  f.deps.documents.chapters = async () => { chapters++; await opening; ready = true; return [] }
  f.deps.aiSettings = async () => { models++; if (!ready) { settle(); throw busy() } return { modelConfigured: true } as never }
  f.deps.eventProjection!.read = async () => { events++; if (!ready) throw busy(); return null }
  const result = await f.service.load()
  assert.deepEqual(result.issues, [])
  assert.equal(result.aiSettings?.modelConfigured, true)
  assert.equal(chapters, 1)
  assert.equal(models, 2)
  assert.equal(events, 2)
})

test('a persistent conflict is bounded and classified without exposing internal diagnostics', async () => {
  const f = fixture(); let attempts = 0
  f.deps.aiSettings = async () => { attempts++; throw busy() }
  const result = await f.service.load()
  assert.equal(result.issues[0].reason, 'busy')
  assert.ok(attempts > 1 && attempts <= 4)
  assert.equal(result.aiSettings, null)
  assert.doesNotMatch(JSON.stringify(result), /private fixture/)
})

test('unmarked identity conflict and damaged storage are not retried or treated as empty success', async () => {
  for (const error of [new AppError('CONFLICT', 'private book changed'), new AppError('DATABASE_INTEGRITY_FAILED', 'private damaged database')]) {
    const f = fixture(); let reads = 0
    f.deps.aiSettings = async () => { reads++; throw error }
    const result = await f.service.load()
    assert.equal(reads, 1)
    assert.equal(result.aiSettings, null)
    assert.equal(result.issues.length, 1)
    assert.doesNotMatch(JSON.stringify(result), /private/)
  }
})

test('targeted recheck never loads manuscripts, summaries, settings writers or the other area', async () => {
  const f = fixture()
  const forbidden = async () => assert.fail('recheck must only read the requested projection')
  f.deps.documents.chapters = forbidden
  f.deps.projects.currentSummary = forbidden
  f.deps.eventProjection!.read = forbidden
  const result = await f.service.recheck({ workItem: { id: 'G:\\books\\fixture', path: 'G:\\books\\fixture' }, issueIds: ['modelSettingsUnreadable'] })
  assert.deepEqual(result.issues, [])
  assert.equal(result.aiSettings?.modelConfigured, true)
  assert.equal(Object.hasOwn(result, 'eventProjection'), false)
})

test('a recheck can recover models while preserving a failed event inspection', async () => {
  const f = fixture()
  f.deps.eventProjection!.read = async () => { throw new AppError('CONFLICT', 'private recovery', { details: { area: 'workspaceSnapshot', reason: 'recovery-required' } }) }
  const result = await f.service.recheck({ workItem: { id: 'G:\\books\\fixture', path: 'G:\\books\\fixture' }, issueIds: ['unifiedEventsUnreadable', 'modelSettingsUnreadable'] })
  assert.equal(result.aiSettings?.modelConfigured, true)
  assert.equal(result.issues[0].reason, 'recovery-required')
  assert.equal(result.eventProjection, null)
  assert.doesNotMatch(JSON.stringify(result), /private recovery/)
})

test('switching A to B to A rejects an old recheck and an old initial load', async () => {
  for (const kind of ['load', 'recheck']) {
    const f = fixture()
    f.deps.aiSettings = async () => { f.service.invalidate(); f.switchRoot('B'); f.service.invalidate(); f.switchRoot('G:\\books\\fixture'); return {} as never }
    const result = kind === 'load' ? f.service.load() : f.service.recheck({ workItem: { id: 'G:\\books\\fixture', path: 'G:\\books\\fixture' }, issueIds: ['modelSettingsUnreadable'] })
    await assert.rejects(result, (e: unknown) => e instanceof AppError && e.code === 'CONFLICT')
  }
})

test('a renderer supplied different book is rejected before accessing any data', async () => {
  const f = fixture(); f.deps.aiSettings = async () => assert.fail('wrong book read')
  await assert.rejects(f.service.recheck({ workItem: { id: 'B', path: 'B' }, issueIds: ['modelSettingsUnreadable'] }), { code: 'CONFLICT' })
})
