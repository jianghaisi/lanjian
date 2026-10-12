import test from 'node:test'
import assert from 'node:assert/strict'
import { shallowRef } from 'vue'
import { useGroupWorkspaceNavigation } from '../../../src/renderer/features/group-chat/composables/use-group-workspace-navigation'
import type { ProjectSummary } from '../../../src/contracts'

test('group requires an actual book and preserves refused draft leave', async () => {
  const current = shallowRef<ProjectSummary | null>(null)
  let allow = false, transitions = 0
  const navigation = useGroupWorkspaceNavigation({ current, prepareLeave: async () => allow, selectBook: async () => { transitions++ }, closeBook: async () => {}, activate: async () => {}, refresh: async () => {} })
  await navigation.show(); assert.equal(navigation.open.value, false)
  allow = true; await navigation.show(); assert.equal(navigation.open.value, false)
  current.value = { path: 'book-A', id: 'book-A' } as ProjectSummary
  allow = false; await navigation.show(); assert.equal(navigation.open.value, false)
  allow = true; await navigation.show(); assert.equal(navigation.open.value, true)
  assert.equal(current.value.id, 'book-A'); assert.equal(transitions, 0)
})

test('returning to the library cannot leave a detached group visible', async () => {
  const current = shallowRef<ProjectSummary | null>({ path: 'book-A', id: 'book-A' } as ProjectSummary)
  let finish!: () => void
  const saved = new Promise<void>(resolve => { finish = resolve })
  const navigation = useGroupWorkspaceNavigation({ current, prepareLeave: async () => true, selectBook: async () => {}, closeBook: async () => { await saved; current.value = null }, activate: async () => {}, refresh: async () => {} })
  await navigation.show()
  const leave = navigation.library(), reopen = navigation.show()
  assert.equal(current.value?.id, 'book-A', 'the original outgoing save finishes before identity changes')
  finish(); await Promise.all([leave, reopen])
  assert.equal(current.value, null); assert.equal(navigation.open.value, false)
})

test('only successful current outline navigation leaves the group; late work cannot hide a reopened group', async () => {
  const current = shallowRef<ProjectSummary | null>({ path: 'book-A', id: 'book-A' } as ProjectSummary)
  const navigation = useGroupWorkspaceNavigation({ current, prepareLeave: async () => true, selectBook: async () => {}, closeBook: async () => {}, activate: async () => {}, refresh: async () => {} })
  await navigation.show()
  await navigation.leaveAfter(async () => false); assert.equal(navigation.open.value, true)
  let finish!: (opened: boolean) => void
  const leave = navigation.leaveAfter(() => new Promise<boolean>(resolve => { finish = resolve }))
  await navigation.show(); finish(true); await leave; assert.equal(navigation.open.value, true)
  await navigation.leaveAfter(async () => true); assert.equal(navigation.open.value, false)
})

test('an earlier book return cannot hide a later group selection', async () => {
  const current = shallowRef<ProjectSummary | null>({ path: 'book-A', id: 'book-A' } as ProjectSummary)
  let finish!: (allow: boolean) => void, delayed = false
  const navigation = useGroupWorkspaceNavigation({ current, prepareLeave: async () => delayed ? new Promise<boolean>(resolve => { finish = resolve }) : true, selectBook: async () => {}, closeBook: async () => {}, activate: async () => {}, refresh: async () => {} })
  await navigation.show(); delayed = true
  const leave = navigation.select(current.value!)
  await navigation.show(); finish(true); await leave
  assert.equal(navigation.open.value, true)
})
