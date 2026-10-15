import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { ref } from 'vue'
import { WorkspaceRequestGuard } from '../../../src/contracts/library/workspace-request-guard'

const { createPlanningGenerationActions } = await import(new URL('../../../src/renderer/features/planning/composables/create-generation-actions.js', import.meta.url).href)
function fixture(t: TestContext) {
  let poll: (() => Promise<void>) | undefined
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    setTimeout(callback: () => Promise<void>) { poll = callback; return 1 }, clearTimeout() { poll = undefined }
  } })
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'window', previous); else Reflect.deleteProperty(globalThis, 'window') })
  const calls: string[] = [], notices: string[] = []
  const hooks = { navigate: async () => {}, readDraft: async () => ({ id: 'candidate' }) }
  const ports = {
    current: ref({ id: 'a', path: 'book-a' }), workspaceRefreshGeneration: 1, workspaceRequests: new WorkspaceRequestGuard(),
    active: ref('outline'), preparationMode: ref('automatic'), planningRunning: ref(false),
    planningDraft: ref<{ id: string } | null>(null), planningDraftSaveState: ref('saved'),
    planningMaterialsReady: ref(true), ai: ref({ modelConfigured: true }), bookProfile: ref({}),
    planningJob: ref<{ id: string; status: string } | null>(null), planningPollTimer: null,
    notice: (message: string) => notices.push(message), plainDto: (value: unknown) => value,
    guard: (operation: () => Promise<unknown>) => operation(),
    async selectWorkspaceLeaf(leaf: string) { assert.equal(leaf, 'preparation'); calls.push('navigation'); await hooks.navigate() },
    desktop: {
      workspace: { async saveBookProfile() { calls.push('profile') } },
      planning: {
        async start() { calls.push('start'); return { id: 'job', status: 'running' } },
        async job() { return { id: 'job', status: 'completed' } },
        async draft() { return hooks.readDraft() }
      }
    }
  }
  hooks.navigate = async () => { ports.active.value = 'preparation' }
  return { ports, calls, notices, hooks, actions: createPlanningGenerationActions(ports), poll: () => poll!() }
}

test('AI total outline opens guarded preparation before starting and reveals its completed candidate', async t => {
  const f = fixture(t)
  await f.actions.handleTotalOutlineAi()
  assert.deepEqual(f.calls, ['navigation', 'profile', 'start'])
  assert.equal(f.ports.active.value, 'preparation')
  await f.poll()
  assert.equal(f.ports.planningDraft.value?.id, 'candidate')
  assert.match(f.notices.at(-1)!, /创作筹备.*下一步.*候选尚未成为正式大纲/)
})

for (const state of ['candidate', 'running']) test(`opening ${state} never starts another generation`, async t => {
  const f = fixture(t)
  if (state === 'candidate') f.ports.planningDraft.value = { id: 'existing' }
  else f.ports.planningRunning.value = true
  await f.actions.handleTotalOutlineAi()
  assert.deepEqual(f.calls, ['navigation'])
  assert.equal(f.ports.active.value, 'preparation')
  if (state === 'candidate') assert.equal(f.ports.planningDraft.value?.id, 'existing')
})

test('rejected guarded departure preserves the source and makes zero model calls', async t => {
  const f = fixture(t)
  f.hooks.navigate = async () => {}
  await f.actions.handleTotalOutlineAi()
  assert.equal(f.ports.active.value, 'outline')
  assert.deepEqual(f.calls, ['navigation'])
})

test('book switch during navigation prevents generation in the new book', async t => {
  const f = fixture(t)
  f.hooks.navigate = async () => { f.ports.current.value = { id: 'b', path: 'book-b' }; f.ports.active.value = 'preparation' }
  await f.actions.handleTotalOutlineAi()
  assert.deepEqual(f.calls, ['navigation'])
})

test('candidate read finishing after a book switch cannot replace the new book candidate', async t => {
  const f = fixture(t)
  await f.actions.handleTotalOutlineAi()
  f.hooks.readDraft = async () => {
    f.ports.current.value = { id: 'b', path: 'book-b' }
    f.ports.planningDraft.value = { id: 'book-b-candidate' }
    return { id: 'book-a-candidate' }
  }
  await f.poll()
  assert.equal(f.ports.planningDraft.value?.id, 'book-b-candidate')
  assert.equal(f.notices.length, 0)
})

test('save-before-leave workflow refresh still starts generation in the same book', async t => {
  const f = fixture(t)
  f.hooks.navigate = async () => { f.ports.workspaceRefreshGeneration++; f.ports.active.value = 'preparation' }
  await f.actions.handleTotalOutlineAi()
  assert.deepEqual(f.calls, ['navigation', 'profile', 'start'])
})

test('reopening the same book during navigation invalidates the old generation request', async t => {
  const f = fixture(t)
  f.hooks.navigate = async () => { f.ports.workspaceRequests.begin(f.ports.current.value); f.ports.active.value = 'preparation' }
  await f.actions.handleTotalOutlineAi()
  assert.deepEqual(f.calls, ['navigation'])
})

for (const missing of ['materials', 'model']) test(`missing ${missing} opens preparation with a next-step hint without generating`, async t => {
  const f = fixture(t)
  if (missing === 'materials') f.ports.planningMaterialsReady.value = false
  else f.ports.ai.value.modelConfigured = false
  await f.actions.handleTotalOutlineAi()
  assert.deepEqual(f.calls, ['navigation'])
  assert.match(f.notices.at(-1)!, missing === 'materials' ? /素材/ : /模型设置/)
})
