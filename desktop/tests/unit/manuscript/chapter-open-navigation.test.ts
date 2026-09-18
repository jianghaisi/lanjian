import assert from 'node:assert/strict'
import test from 'node:test'
import { createChapterOpenNavigation, type ChapterOpenCallbacks } from '../../../src/renderer/features/manuscript/services/chapter-open-navigation'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

type Chapter = { id: number; title: string }
function setup() {
  let selection = 0, workspace = 1, selectionGeneration = 0
  const reads: number[] = [], selected: number[] = [], revealed: number[] = []
  const navigation = createChapterOpenNavigation<Chapter>()
  function request(overrides: Partial<ChapterOpenCallbacks<Chapter>> = {}): ChapterOpenCallbacks<Chapter> {
    const initialWorkspace = workspace, initialSelection = selectionGeneration
    return {
      isCurrent: () => workspace === initialWorkspace && selectionGeneration === initialSelection,
      isWorkspaceCurrent: () => workspace === initialWorkspace,
      prepare: async () => true,
      read: async id => { reads.push(id); return { id, title: `章 ${id}` } },
      select: async chapter => { selection = chapter.id; selectionGeneration += 1; selected.push(chapter.id) },
      isSelected: id => selection === id,
      reveal: async () => { revealed.push(selection); return true },
      ...overrides
    }
  }
  return { navigation, request, reads, selected, revealed,
    chooseDirectly(id: number) { selection = id; selectionGeneration += 1 },
    switchWorkspace() { workspace += 1 },
    get selection() { return selection }
  }
}

test('latest click wins when an earlier chapter read returns after a later open', async () => {
  const state = setup(), firstRead = deferred<Chapter>(), firstReading = deferred<void>()
  const first = state.navigation.open(90, state.request({ read: async () => { firstReading.resolve(); return firstRead.promise } }))
  await firstReading.promise
  const second = await state.navigation.open(2, state.request())
  firstRead.resolve({ id: 90, title: '迟到的旧选择' })
  assert.equal(second, true)
  assert.equal(await first, false)
  assert.equal(state.selection, 2)
  assert.deepEqual(state.selected, [2])
  assert.deepEqual(state.revealed, [2])
})

test('a later open supersedes an earlier request still preparing its save', async () => {
  const state = setup(), preparing = deferred<boolean>()
  const first = state.navigation.open(90, state.request({ prepare: () => preparing.promise }))
  assert.equal(await state.navigation.open(2, state.request()), true)
  preparing.resolve(true)
  assert.equal(await first, false)
  assert.deepEqual(state.reads, [2])
})

test('direct chapter selection while a read is pending invalidates the old intent', async () => {
  const state = setup(), reading = deferred<void>(), result = deferred<Chapter>()
  const open = state.navigation.open(90, state.request({ read: async () => { reading.resolve(); return result.promise } }))
  await reading.promise
  state.chooseDirectly(7)
  result.resolve({ id: 90, title: '旧章' })
  assert.equal(await open, false)
  assert.equal(state.selection, 7)
  assert.deepEqual(state.selected, [])
  assert.deepEqual(state.revealed, [])
})

test('switch or same-book reopen invalidates pending success and late errors', async () => {
  for (const reject of [false, true]) {
    const state = setup(), reading = deferred<void>(), result = deferred<Chapter>()
    const open = state.navigation.open(90, state.request({ read: async () => { reading.resolve(); return result.promise } }))
    await reading.promise
    state.switchWorkspace()
    if (reject) result.reject(new Error('旧作品读取失败'))
    else result.resolve({ id: 90, title: '旧作品' })
    assert.equal(await open, false)
    assert.deepEqual(state.selected, [])
    assert.deepEqual(state.revealed, [])
  }
})

test('failed save preparation never reads or selects; current errors remain reportable', async () => {
  const state = setup()
  assert.equal(await state.navigation.open(90, state.request({ prepare: async () => false })), false)
  assert.deepEqual(state.reads, [])
  assert.deepEqual(state.selected, [])
  assert.deepEqual(state.revealed, [])
  const saveError = new Error('请先处理未保存的正文')
  await assert.rejects(state.navigation.open(90, state.request({ prepare: async () => { throw saveError } })), error => error === saveError)
})

test('selection failure or missing selected chapter cannot reveal the editor', async () => {
  const state = setup(), error = new Error('选章失败')
  await assert.rejects(state.navigation.open(90, state.request({ select: async () => { throw error } })), value => value === error)
  assert.equal(await state.navigation.open(90, state.request({ select: async () => {} })), false)
  assert.deepEqual(state.revealed, [])
})

test('own selection generation change is allowed; changed selection after select is not', async () => {
  const state = setup()
  assert.equal(await state.navigation.open(90, state.request()), true)
  assert.deepEqual(state.revealed, [90])
  assert.equal(await state.navigation.open(2, state.request({ select: async () => { state.chooseDirectly(7) } })), false)
  assert.deepEqual(state.revealed, [90])
})

test('reveal failures and post-reveal workspace changes cannot claim navigation success', async () => {
  const state = setup()
  assert.equal(await state.navigation.open(90, state.request({ reveal: async () => false })), false)
  assert.equal(await state.navigation.open(2, state.request({ reveal: async () => { state.switchWorkspace(); return true } })), false)
})

test('explicit invalidation suppresses late rejected reads without reporting another workspace error', async () => {
  const state = setup(), reading = deferred<void>(), result = deferred<Chapter>()
  const open = state.navigation.open(90, state.request({ read: async () => { reading.resolve(); return result.promise } }))
  await reading.promise
  state.navigation.invalidate()
  result.reject(new Error('迟到错误'))
  assert.equal(await open, false)
  assert.deepEqual(state.revealed, [])
})
