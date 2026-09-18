import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { Script } from 'node:vm'
import { babelParse } from '@vue/compiler-sfc'
import { ref } from 'vue'
import type { OutlineUpdateResult, StageOutline, StageOutlineUpdateResult } from '../../../src/contracts/index'
import { WorkspaceRequestGuard, type WorkspaceIdentity } from '../../../src/contracts/library/workspace-request-guard'
import { createOutlineStorageFeedback } from '../../../src/renderer/features/planning/composables/outline-storage-feedback'

type Kind = 'total' | 'volume' | 'stage'
type Saves = { saveOutline: () => Promise<void>; saveVolumeOutline: () => Promise<void>; saveStageOutline: () => Promise<void> }
const functionNames = ['saveOutline', 'saveVolumeOutline', 'saveStageOutline', 'guard'] as const
const scriptSource = Promise.all([
  '../../../src/renderer/features/planning/composables/create-outlines-actions.js',
  '../../../src/renderer/app/composables/create-feedback-actions.js'
].map(async path => {
  const script = await readFile(new URL(path, import.meta.url), 'utf8')
  const tree = babelParse(script, { sourceType: 'module' })
  const factory = tree.program.body.find(node => node.type === 'ExportNamedDeclaration' && node.declaration?.type === 'FunctionDeclaration')
  assert.ok(factory?.type === 'ExportNamedDeclaration' && factory.declaration?.type === 'FunctionDeclaration')
  return factory.declaration.body.body.filter(node => node.type === 'FunctionDeclaration' && functionNames.includes(node.id?.name as typeof functionNames[number]))
    .map(node => script.slice(node.start!, node.end!)).join('\n')
})).then(parts => parts.join('\n'))

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: Error) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

async function harness() {
  const current = ref<WorkspaceIdentity | null>({ id: 'outline-fixture', path: 'E:\\isolated\\original' })
  const workspaceRequests = new WorkspaceRequestGuard()
  workspaceRequests.begin(current.value!)
  const state = {
    current, workspaceRequests, busy: ref(false),
    totalOutline: ref('总纲提交草稿'), lastSavedTotalOutline: ref('总纲旧基线'),
    selectedVolume: ref<number | null>(2), volumeOutline: ref('第二卷提交草稿'), lastSavedVolumeOutline: ref('第二卷旧基线'),
    selectedStage: ref<number | null>(7), stageTitle: ref('阶段提交名称'), stageOutline: ref('阶段提交草稿'),
    lastSavedStageTitle: ref('阶段旧名称'), lastSavedStageOutline: ref('阶段旧基线'),
    stageOutlines: ref<StageOutline[]>([
      { stage: 7, volume: 2, title: '阶段旧名称', content: '阶段旧基线', chapterIds: [42] },
      { stage: 8, volume: 2, title: '另一个阶段', content: '另一个阶段基线', chapterIds: [3] },
    ]),
  }
  const main = deferred<OutlineUpdateResult | StageOutlineUpdateResult>()
  const calls: Array<{ operation: 'update' | 'updateStage'; args: unknown[] }> = []
  const notices: string[] = []
  const receipts: Array<{ key: string; receipt: Pick<OutlineUpdateResult, 'storageMode' | 'mirrorStatus'> }> = []
  const effects = { workflow: 0, stageRefresh: 0, stageOpen: 0 }
  const storage = createOutlineStorageFeedback(async () => { throw new Error('Unexpected storage reread in save test') }, () => current.value, workspaceRequests)
  const ports = {
    ...state,
    desktop: { outlines: {
      update: (scope: number | 'total', content: string) => { calls.push({ operation: 'update', args: [scope, content] }); return main.promise },
      updateStage: (stage: number, title: string, content: string) => { calls.push({ operation: 'updateStage', args: [stage, title, content] }); return main.promise },
    } },
    notice: (message: string) => notices.push(message),
    outlineStorageFeedback: { record: (key: string, receipt: Pick<OutlineUpdateResult, 'storageMode' | 'mirrorStatus'>) => { receipts.push({ key, receipt: { ...receipt } }); storage.record(key, receipt) } },
    refreshWorkflow: async () => { effects.workflow += 1 },
    refreshStageOutlines: async () => { effects.stageRefresh += 1; throw new Error('A completed stage save must not reread and reopen the editor') },
    openStageOutline: () => { effects.stageOpen += 1; throw new Error('A completed stage save must not replace current stage input') },
  }
  const functions = new Script(`${await scriptSource}\n;ports.guard = guard; ({saveOutline,saveVolumeOutline,saveStageOutline})`, { filename: 'actual-outline-save-actions' }).runInNewContext({ ports, notice: ports.notice }, { timeout: 1000 }) as Saves
  const save = (kind: Kind) => ({ total: functions.saveOutline, volume: functions.saveVolumeOutline, stage: functions.saveStageOutline })[kind]()
  return { state, main, calls, notices, receipts, effects, storage, save }
}

function receipt(kind: Kind, mirrorStatus: 'synced' | 'pending' | 'conflict' | 'failed' = 'synced'): OutlineUpdateResult | StageOutlineUpdateResult {
  return kind === 'stage'
    ? { success: true, storageMode: 'sqlite', stage: { stage: 7, volume: 2, title: '主进程确认的阶段名称', content: '主进程确认的阶段正文', chapterIds: [42], mirrorStatus } }
    : { success: true, volume: kind === 'total' ? 'total' : 2, content: `主进程确认的${kind}正文`, storageMode: 'sqlite', mirrorStatus }
}

for (const kind of ['total', 'volume', 'stage'] as const) {
  test(`${kind}: actual throwing guard leaves draft, saved baseline and storage feedback untouched on failure`, async () => {
    const ctx = await harness(), { state } = ctx
    const before = JSON.stringify({ total: state.lastSavedTotalOutline.value, volume: state.lastSavedVolumeOutline.value, stage: state.lastSavedStageOutline.value, title: state.lastSavedStageTitle.value, stages: state.stageOutlines.value })
    const operation = ctx.save(kind)
    assert.equal(state.busy.value, true)
    assert.equal(ctx.calls.length, 1)
    const failure = new Error('隔离测试：正式写入失败')
    ctx.main.reject(failure)
    await assert.rejects(operation, error => error === failure)
    assert.equal(state.busy.value, false)
    assert.equal(JSON.stringify({ total: state.lastSavedTotalOutline.value, volume: state.lastSavedVolumeOutline.value, stage: state.lastSavedStageOutline.value, title: state.lastSavedStageTitle.value, stages: state.stageOutlines.value }), before)
    assert.equal(state.totalOutline.value, '总纲提交草稿')
    assert.equal(state.volumeOutline.value, '第二卷提交草稿')
    assert.equal(state.stageOutline.value, '阶段提交草稿')
    assert.equal(state.stageTitle.value, '阶段提交名称')
    assert.equal(ctx.receipts.length, 0)
    assert.deepEqual(ctx.notices, [failure.message])
    assert.deepEqual(ctx.effects, { workflow: 0, stageRefresh: 0, stageOpen: 0 })
  })

  test(`${kind}: saves the captured submission and advances only the acknowledged baseline while preserving later input`, async () => {
    const ctx = await harness(), { state } = ctx
    const operation = ctx.save(kind)
    const expectedArgs = kind === 'total' ? ['total', '总纲提交草稿'] : kind === 'volume' ? [2, '第二卷提交草稿'] : [7, '阶段提交名称', '阶段提交草稿']
    assert.deepEqual(ctx.calls[0]!.args, expectedArgs)
    state.totalOutline.value = '等待保存期间追加的总纲'
    state.volumeOutline.value = '等待保存期间追加的卷纲'
    state.stageOutline.value = '等待保存期间追加的阶段正文'
    state.stageTitle.value = '等待保存期间修改的阶段名称'
    ctx.main.resolve(receipt(kind)); await operation
    assert.equal(state.totalOutline.value, '等待保存期间追加的总纲')
    assert.equal(state.volumeOutline.value, '等待保存期间追加的卷纲')
    assert.equal(state.stageOutline.value, '等待保存期间追加的阶段正文')
    assert.equal(state.stageTitle.value, '等待保存期间修改的阶段名称')
    if (kind === 'total') {
      assert.equal(state.lastSavedTotalOutline.value, '主进程确认的total正文')
      assert.match(ctx.notices.at(-1)!, /后续输入仍待保存/)
    } else if (kind === 'volume') assert.equal(state.lastSavedVolumeOutline.value, '主进程确认的volume正文')
    else {
      assert.equal(state.lastSavedStageOutline.value, '主进程确认的阶段正文')
      assert.equal(state.lastSavedStageTitle.value, '主进程确认的阶段名称')
      assert.equal(state.stageOutlines.value[0]!.content, '主进程确认的阶段正文')
      assert.deepEqual(ctx.effects, { workflow: 0, stageRefresh: 0, stageOpen: 0 })
    }
    assert.equal(ctx.receipts.length, 1)
    assert.equal(ctx.storage.describe(kind === 'total' ? 'total' : kind === 'volume' ? 'volume:2' : 'stage:7').warning, false)
    assert.equal(state.busy.value, false)
  })

  test(`${kind}: a late acknowledgement from the same work-item ID at a different path cannot alter the new book`, async () => {
    const ctx = await harness(), { state } = ctx
    const operation = ctx.save(kind)
    // Deliberately keep generation unchanged, proving path is independently checked.
    state.current.value = { id: 'outline-fixture', path: 'E:\\isolated\\different-copy' }
    state.totalOutline.value = '新书总纲草稿'; state.lastSavedTotalOutline.value = '新书总纲基线'
    state.volumeOutline.value = '新书卷纲草稿'; state.lastSavedVolumeOutline.value = '新书卷纲基线'
    state.stageOutline.value = '新书阶段草稿'; state.lastSavedStageOutline.value = '新书阶段基线'
    state.stageTitle.value = '新书阶段名称'; state.lastSavedStageTitle.value = '新书阶段名称基线'
    const stages = JSON.stringify(state.stageOutlines.value)
    ctx.main.resolve(receipt(kind)); await operation
    assert.equal(state.totalOutline.value, '新书总纲草稿'); assert.equal(state.lastSavedTotalOutline.value, '新书总纲基线')
    assert.equal(state.volumeOutline.value, '新书卷纲草稿'); assert.equal(state.lastSavedVolumeOutline.value, '新书卷纲基线')
    assert.equal(state.stageOutline.value, '新书阶段草稿'); assert.equal(state.lastSavedStageOutline.value, '新书阶段基线')
    assert.equal(state.stageTitle.value, '新书阶段名称'); assert.equal(state.lastSavedStageTitle.value, '新书阶段名称基线')
    assert.equal(JSON.stringify(state.stageOutlines.value), stages)
    assert.equal(ctx.receipts.length, 0); assert.equal(ctx.notices.length, 0)
    assert.deepEqual(ctx.effects, { workflow: 0, stageRefresh: 0, stageOpen: 0 })
  })

  test(`${kind}: closing and reopening the same path invalidates the old save generation`, async () => {
    const ctx = await harness()
    const operation = ctx.save(kind)
    ctx.state.workspaceRequests.invalidate()
    ctx.state.workspaceRequests.begin(ctx.state.current.value!)
    ctx.main.resolve(receipt(kind)); await operation
    assert.equal(ctx.receipts.length, 0)
    assert.equal(ctx.notices.length, 0)
    assert.equal(ctx.state.lastSavedTotalOutline.value, '总纲旧基线')
    assert.equal(ctx.state.lastSavedVolumeOutline.value, '第二卷旧基线')
    assert.equal(ctx.state.lastSavedStageOutline.value, '阶段旧基线')
    assert.equal(ctx.state.lastSavedStageTitle.value, '阶段旧名称')
  })
}

test('volume selection during save keeps the newly selected volume draft and baseline', async () => {
  const ctx = await harness(), { state } = ctx
  const operation = ctx.save('volume')
  state.selectedVolume.value = 3
  state.volumeOutline.value = '第三卷正在编辑'; state.lastSavedVolumeOutline.value = '第三卷保存基线'
  ctx.main.resolve(receipt('volume')); await operation
  assert.equal(state.selectedVolume.value, 3)
  assert.equal(state.volumeOutline.value, '第三卷正在编辑')
  assert.equal(state.lastSavedVolumeOutline.value, '第三卷保存基线')
  assert.equal(ctx.receipts[0]!.key, 'volume:2')
  assert.match(ctx.storage.describe('volume:3').text, /待确认/)
})

test('stage selection during save updates only that stage row, never the newly selected draft or baseline', async () => {
  const ctx = await harness(), { state } = ctx
  const operation = ctx.save('stage')
  state.selectedStage.value = 8; state.selectedVolume.value = 3
  state.stageTitle.value = '后选阶段名称'; state.stageOutline.value = '后选阶段正在编辑'
  state.lastSavedStageTitle.value = '后选阶段名称基线'; state.lastSavedStageOutline.value = '后选阶段正文基线'
  ctx.main.resolve(receipt('stage')); await operation
  assert.equal(state.selectedStage.value, 8); assert.equal(state.selectedVolume.value, 3)
  assert.equal(state.stageTitle.value, '后选阶段名称'); assert.equal(state.stageOutline.value, '后选阶段正在编辑')
  assert.equal(state.lastSavedStageTitle.value, '后选阶段名称基线'); assert.equal(state.lastSavedStageOutline.value, '后选阶段正文基线')
  assert.equal(state.stageOutlines.value[0]!.content, '主进程确认的阶段正文')
  assert.equal(state.stageOutlines.value[1]!.content, '另一个阶段基线')
  assert.equal(ctx.receipts[0]!.key, 'stage:7')
  assert.deepEqual(ctx.effects, { workflow: 0, stageRefresh: 0, stageOpen: 0 })
})

for (const mirrorStatus of ['pending', 'conflict', 'failed'] as const) {
  test(`stage ${mirrorStatus} mirror receipt advances SQLite baseline but never claims Markdown synced`, async () => {
    const ctx = await harness()
    const operation = ctx.save('stage')
    ctx.main.resolve(receipt('stage', mirrorStatus)); await operation
    assert.equal(ctx.state.lastSavedStageOutline.value, '主进程确认的阶段正文')
    assert.equal(ctx.state.stageTitle.value, '主进程确认的阶段名称')
    assert.equal(ctx.state.stageOutline.value, '阶段提交草稿')
    assert.match(ctx.notices.at(-1)!, /SQLite/)
    assert.doesNotMatch(ctx.notices.join('\n'), /已同步/)
    assert.match(ctx.storage.describe('stage:7').text, /镜像待处理/)
    assert.equal(ctx.storage.describe('stage:7').warning, true)
    assert.equal(ctx.receipts[0]!.receipt.mirrorStatus, mirrorStatus)
  })
}
