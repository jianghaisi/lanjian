import assert from 'node:assert/strict'
import test from 'node:test'
import { ref } from 'vue'
import { createOutlineStorageFeedback } from '../../../src/renderer/features/planning/composables/outline-storage-feedback'
import { WorkspaceRequestGuard } from '../../../src/contracts/library/workspace-request-guard'
import type { SqliteStorageStatus } from '../../../src/contracts/index'

const { createPlanningOutlinesActions } = await import(new URL('../../../src/renderer/features/planning/composables/create-outlines-actions.js', import.meta.url).href)

const status = (textAuthority: 'files-v1' | 'legacy-sqlite'): SqliteStorageStatus => ({ textAuthority, storageMode: 'sqlite', databaseExists: true, chapterCount: 1, outlineCount: 3, outlineStorageMode: 'sqlite', promptStorageMode: 'sqlite', promptMirrorStatus: null, outlinePendingMirrors: 0, outlineConflictMirrors: 0, outlineFailedMirrors: 0, pendingMirrors: 0, conflictMirrors: 0, failedMirrors: 0 })
const nextTurn = () => new Promise(resolve => setImmediate(resolve))
function fixture(authority: 'files-v1' | 'legacy-sqlite' = 'files-v1') {
  const current = ref({ id: 'A', path: 'A-path' }), requests = new WorkspaceRequestGuard()
  requests.begin(current.value)
  const calls: string[] = [], notices: string[] = []
  const hooks = { read: async () => status(authority) }
  const feedback = createOutlineStorageFeedback(() => { calls.push('status'); return hooks.read() }, () => current.value, requests)
  const stage = { stage: 1, volume: 1, title: '新阶段', content: '已保存', chapterIds: [], mirrorStatus: 'synced' }
  const ports = {
    current, busy: ref(false), workspaceRequests: requests,
    totalOutline: ref('已保存'), lastSavedTotalOutline: ref('原稿'),
    selectedVolume: ref(1), volumeOutline: ref('已保存'), lastSavedVolumeOutline: ref('原稿'),
    selectedStage: ref(1), stageTitle: ref('新阶段'), stageOutline: ref('已保存'),
    lastSavedStageTitle: ref('旧阶段'), lastSavedStageOutline: ref('原稿'), stageOutlines: ref([stage]),
    outlineStorageFeedback: feedback,
    outlineEditor: ref({ saveReviewedDraft: async () => { calls.push('review-save'); return { snapshot: { content: '已保存', title: '新阶段' }, receipt: {} } } }),
    desktop: { outlines: {
      update: async () => assert.fail('review save cannot fall through to a second write'),
      updateStage: async () => assert.fail('review save cannot fall through to a second write'),
      list: async () => ({ stages: [stage] })
    } },
    guard: async (operation: () => Promise<unknown>) => operation(), notice: (value: string) => notices.push(value), refreshWorkflow: async () => {}
  }
  return { ports, calls, hooks, notices, feedback, actions: createPlanningOutlinesActions(ports) }
}
const entries = [
  { method: 'saveOutline', key: 'total', baseline: 'lastSavedTotalOutline' },
  { method: 'saveVolumeOutline', key: 'volume:1', baseline: 'lastSavedVolumeOutline' },
  { method: 'saveStageOutline', key: 'stage:1', baseline: 'lastSavedStageOutline' }
] as const

for (const authority of ['files-v1', 'legacy-sqlite'] as const) for (const entry of entries) test(`${entry.key} review save reads ${authority} status instead of inventing a storage receipt`, async () => {
  const f = fixture(authority); await f.feedback.refresh(); f.calls.length = 0
  await f.actions[entry.method](); await nextTurn()
  assert.equal(f.ports[entry.baseline].value, '已保存')
  assert.deepEqual(f.calls, ['review-save', 'status'])
  assert.equal(f.feedback.describe(entry.key).warning, false)
  assert.match(f.feedback.describe(entry.key).text, authority === 'files-v1' ? /存储方式：Markdown/ : /存储方式：数据库/)
  assert.doesNotMatch(f.feedback.describe(entry.key).text, /已保存|已存入|已同步/)
  assert.ok(f.notices.some(message => message.includes('已保存')))
  if (authority === 'files-v1') assert.ok(f.notices.every(message => !message.includes('存入 SQLite')))
})

test('storage status failure does not undo a confirmed outline save and retry only reads', async () => {
  const f = fixture(); await f.feedback.refresh(); f.calls.length = 0
  f.hooks.read = async () => { throw new Error('存储状态读取失败') }
  await f.actions.saveOutline(); await nextTurn()
  assert.equal(f.ports.lastSavedTotalOutline.value, '已保存'); assert.equal(f.ports.totalOutline.value, '已保存')
  assert.deepEqual(f.feedback.describe('total'), { text: '存储状态待确认', warning: true })
  f.hooks.read = async () => status('files-v1'); await f.feedback.refresh()
  assert.deepEqual(f.calls, ['review-save', 'status', 'status']); assert.equal(f.feedback.describe('total').warning, false)
})

test('outline save completes before the status read and a late result cannot enter another book', async () => {
  const f = fixture(); await f.feedback.refresh(); f.calls.length = 0
  let resolve!: (value: SqliteStorageStatus) => void
  f.hooks.read = () => new Promise(done => { resolve = done })
  await f.actions.saveOutline()
  assert.equal(f.ports.lastSavedTotalOutline.value, '已保存'); assert.equal(f.feedback.loading.value, true)
  f.ports.current.value = { id: 'B', path: 'B-path' }; f.ports.workspaceRequests.begin(f.ports.current.value); f.feedback.reset()
  f.ports.lastSavedTotalOutline.value = 'B 稿件'; f.ports.totalOutline.value = 'B 稿件'
  resolve(status('files-v1')); await nextTurn()
  assert.equal(f.ports.lastSavedTotalOutline.value, 'B 稿件'); assert.equal(f.ports.totalOutline.value, 'B 稿件')
  assert.deepEqual(f.feedback.describe('total'), { text: '存储状态待确认', warning: true })
  assert.deepEqual(f.calls, ['review-save', 'status'])
})
