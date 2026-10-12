/// <reference path="../../../src/renderer/desktop.d.ts" />
import assert from 'node:assert/strict'
import test from 'node:test'
import { createRenderer } from 'vue'
import { usePetCare } from '../../../src/renderer/features/companion/composables/use-pet-care'
import { petAchievementProgress, petCareDisabledReason, petCareFeedback, petCareStatus, petItemDisabledReason } from '../../../src/renderer/features/companion/services/pet-care-feedback'
import { applyPetCare, newPetCare } from '../../../src/main/modules/companion/domain/companion-care'
import type { PetCareRequest, PetCareState } from '../../../src/contracts/companion/companion-care'

const renderer = createRenderer<object, object>({ patchProp() {}, insert() {}, remove() {}, setText() {}, setElementText() {}, createElement: () => ({}), createText: () => ({}), createComment: () => ({}), parentNode: () => null, nextSibling: () => null })

test('item guidance agrees with main at toy energy, inventory and coin boundaries', () => {
  const before = newPetCare('2026-10-01'), now = new Date('2026-10-01T12:00:00')
  const cases: Array<{ patch: Partial<PetCareState>; action: PetCareRequest['action']; blocked: boolean }> = [
    { patch: { energy: 7.99 }, action: { type: 'use', item: 'toy' }, blocked: true },
    { patch: { energy: 8 }, action: { type: 'use', item: 'toy' }, blocked: false },
    { patch: { sleeping: true }, action: { type: 'use', item: 'food' }, blocked: true },
    { patch: { sleeping: true }, action: { type: 'buy', item: 'food' }, blocked: false },
    { patch: { inventory: { food: 0, water: 0, toy: 0 } }, action: { type: 'use', item: 'water' }, blocked: true },
    { patch: { inventory: { food: 999, water: 5, toy: 2 } }, action: { type: 'buy', item: 'food' }, blocked: true },
    { patch: { inventory: { food: 998, water: 5, toy: 2 } }, action: { type: 'buy', item: 'food' }, blocked: false },
    { patch: { coins: 7 }, action: { type: 'buy', item: 'food' }, blocked: true },
    { patch: { coins: 8 }, action: { type: 'buy', item: 'food' }, blocked: false },
  ]
  for (const { patch, action, blocked } of cases) {
    assert.ok(action.type === 'buy' || action.type === 'use')
    const state = { ...before, ...patch }, snapshot = structuredClone(state)
    assert.equal(!!petItemDisabledReason(action.type, action.item, state, true, false), blocked)
    const settle = () => applyPetCare(state, { requestId: crypto.randomUUID(), revision: state.revision, action }, now)
    if (blocked) assert.throws(settle); else assert.doesNotThrow(settle)
    assert.deepEqual(state, snapshot, 'hints and validation must not mutate the projection')
  }
})

test('item guidance prioritizes pending, disabled and missing state, and explains recovery', () => {
  const state = newPetCare('2026-10-01')
  assert.match(petItemDisabledReason('use', 'toy', state, false, true), /正在处理/)
  assert.match(petItemDisabledReason('use', 'toy', state, false, false), /设置中开启/)
  assert.match(petItemDisabledReason('use', 'toy', undefined, true, false), /读取/)
  state.energy = 7
  assert.match(petItemDisabledReason('use', 'toy', state, true, false), /8 点体力.*睡/)
  state.inventory.toy = 0
  assert.match(petItemDisabledReason('use', 'toy', state, true, false), /纸风车.*补充/)
  state.coins = 6
  assert.match(petItemDisabledReason('buy', 'toy', state, true, false), /还差 4 星币/)
})

test('achievement progress reads confirmed totals and award IDs; reaching a threshold cannot mint a badge', () => {
  const state = newPetCare('2026-10-01'), before = structuredClone(state)
  const initial = petAchievementProgress(state)
  assert.deepEqual(initial.map(badge => [badge.value, badge.target, badge.earned]), [[0,1,false],[0,5,false],[0,1,false],[1,3,false]])
  assert.deepEqual(state, before)
  state.totals = { fed: 12, played: 4, focus: 1 }; state.experience = 400
  assert.deepEqual(petAchievementProgress(state).map(badge => [badge.value, badge.earned]), [[1,false],[4,false],[1,false],[3,false]])
  const confirmed = applyPetCare(state, { requestId: crypto.randomUUID(), revision: state.revision, action: { type: 'use', item: 'toy' } }, new Date('2026-10-01T12:00:00'))
  assert.ok(petAchievementProgress(confirmed).every(badge => badge.earned))
  assert.equal(confirmed.totals.played, 5)
})

test('care status follows acknowledged sleep/focus state and ignores disabled care', () => {
  const state = newPetCare('2026-10-01')
  state.focus = { id: crypto.randomUUID(), duration: 300, elapsed: 2, status: 'running' }
  assert.equal(petCareStatus(state, true), '陪你专注')
  state.sleeping = true; assert.equal(petCareStatus(state, true), '正在休息')
  state.sleeping = false; state.focus.status = 'paused'; assert.equal(petCareStatus(state, true), '专注已暂停')
  state.focus.status = 'complete'; assert.equal(petCareStatus(state, true), '这一段专注完成了')
  assert.equal(petCareStatus(state, false), '')
  assert.equal(petCareStatus(undefined, true), '')
  assert.equal(petCareFeedback({ type: 'use', item: 'food' }), '已使用桂花糕')
  assert.equal(petCareFeedback({ type: 'buy', item: 'water' }), '清泉水已放入背包')
})

test('disabled care actions explain readiness, opt-in, sleeping and inventory, while wake and recovery remain reachable', () => {
  const state = { busy: false, careEnabled: true, careReady: true, sleeping: false, food: 1, water: 1 }
  assert.equal(petCareDisabledReason('food', state), '')
  assert.match(petCareDisabledReason('food', { ...state, food: 0 }), /背包里没有桂花糕/)
  assert.match(petCareDisabledReason('water', { ...state, sleeping: true }), /先唤醒/)
  assert.equal(petCareDisabledReason('sleep', { ...state, sleeping: true }), '')
  assert.match(petCareDisabledReason('sleep', { ...state, careReady: false }), /尚未就绪/)
  assert.match(petCareDisabledReason('food', { ...state, careEnabled: false }), /开启养成/)
  assert.equal(petCareDisabledReason('care', { ...state, careReady: false }), '')
  assert.match(petCareDisabledReason('care', { ...state, busy: true }), /正在处理/)
})

for (const [committed, updated] of [[false, false], [true, false], [false, true]]) test(`care retry preserves intent/receipt; committed=${committed}, newer broadcast=${updated}`, async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window')
  let state = newPetCare('2026-10-01'), first = true
  const before = state.inventory.food, calls: PetCareRequest[] = []
  let receive!: (state: PetCareState) => void
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { companionCare: {
    get: async () => structuredClone(state), onChange: (listener: typeof receive) => { receive = listener; return () => {} }, onError: () => () => {},
    act: async (request: PetCareRequest) => {
      calls.push(structuredClone(request))
      if (first) { first = false; if (committed) state = applyPetCare(state, request, new Date('2026-10-01T12:00:00+08:00')); throw new Error('结果未确认') }
      state = applyPetCare(state, request, new Date('2026-10-01T12:00:00+08:00')); return structuredClone(state)
    }
  } } })
  let care!: ReturnType<typeof usePetCare>
  const app = renderer.createApp({ setup() { care = usePetCare(); return () => null } })
  try {
    app.mount({}); await new Promise(setImmediate)
    assert.equal(await care.act({ type: 'use', item: 'food' }), false)
    assert.deepEqual(care.pendingAction, { type: 'use', item: 'food' })
    assert.equal(care.state.value!.inventory.food, before, 'unconfirmed result must not be shown as settled')
    assert.equal(await care.act({ type: 'use', item: 'water' }), false)
    assert.equal(calls.length, 1, 'another action must not replace an unconfirmed request')
    if (updated) { state = { ...state, revision: state.revision + 1, hunger: state.hunger - 1 }; receive(structuredClone(state)) }
    assert.equal(await care.act(care.pendingAction!), true)
    assert.deepEqual(calls[1], { ...calls[0], revision: updated ? calls[0].revision + 1 : calls[0].revision })
    assert.equal(care.state.value!.inventory.food, before - 1)
    assert.equal(care.pendingAction, undefined)
    assert.equal(care.error.value, '')
  } finally { app.unmount(); if (previous) Object.defineProperty(globalThis, 'window', previous); else Reflect.deleteProperty(globalThis, 'window') }
})

test('care requested before its projection exists exposes a recoverable error', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} })
  let care!: ReturnType<typeof usePetCare>
  const app = renderer.createApp({ setup() { care = usePetCare(); return () => null } })
  try {
    app.mount({}); await new Promise(setImmediate)
    assert.equal(await care.act({ type: 'sleep' }), false)
    assert.ok(care.error.value)
    assert.equal(care.pendingAction, undefined)
  } finally { app.unmount(); if (previous) Object.defineProperty(globalThis, 'window', previous); else Reflect.deleteProperty(globalThis, 'window') }
})
