import assert from 'node:assert/strict'
import test from 'node:test'
import { effectScope, ref } from 'vue'
import { createCharactersEntitiesActions } from '../../../src/renderer/features/characters/composables/create-entities-actions.js'

function fixture(recoveryStorage) {
  const scope = effectScope()
  const notices = []
  const ports = {
    recoveryStorage,
    current: ref({ path: 'A' }), storyEntityDraft: ref({ id: '', entityType: 'character', canonicalName: '甲书草稿', profileJson: '{}', status: 'approved' }),
    storyEntities: ref([]), storyEntityRelations: ref([]), storyEntitiesLoaded: ref(false), resourceLedger: ref({}), resourceLedgerDraft: ref({ resourceEntityId: '' }),
    notice: (text) => notices.push(text), refreshWorkflow: async () => {},
    guard: async (fn) => fn(),
    desktop: { workspace: {
      listStoryEntities: async () => [], listStoryEntityRelations: async () => [],
      saveStoryEntity: async (_draft) => { throw new Error('disk failure') }
    } }
  }
  const actions = scope.run(() => createCharactersEntitiesActions(ports))
  return { ports, actions, notices, close: () => scope.stop() }
}

test('failed save retains Chinese draft for retry; switching books retains separate drafts', async t => {
  const f = fixture(); t.after(f.close)
  await f.actions.saveStoryEntity()
  assert.equal(f.ports.storyEntityDraft.value.canonicalName, '甲书草稿')
  f.ports.current.value = { path: 'B' }
  assert.equal(f.ports.storyEntityDraft.value.canonicalName, '')
  f.ports.storyEntityDraft.value.canonicalName = '乙书草稿'
  f.ports.current.value = { path: 'A' }
  assert.equal(f.ports.storyEntityDraft.value.canonicalName, '甲书草稿')
  f.ports.desktop.workspace.saveStoryEntity = async () => ({ id: 'saved', status: 'approved', entityType: 'character' })
  await f.actions.saveStoryEntity()
  assert.equal(f.ports.storyEntityDraft.value.canonicalName, '')
  f.ports.current.value = { path: 'B' }
  assert.equal(f.ports.storyEntityDraft.value.canonicalName, '乙书草稿')
})

test('late loads and saves cannot publish into another book or erase newer edits', async t => {
  const f = fixture(); t.after(f.close)
  let release
  f.ports.desktop.workspace.listStoryEntities = () => new Promise(resolve => { release = resolve })
  const load = f.actions.loadStoryEntities()
  f.ports.current.value = { path: 'B' }; release([{ id: 'a' }]); await load
  assert.deepEqual(f.ports.storyEntities.value, [])
  let saved
  f.ports.storyEntityDraft.value.canonicalName = '乙书新稿'
  f.ports.desktop.workspace.saveStoryEntity = () => new Promise(resolve => { saved = resolve })
  const save = f.actions.saveStoryEntity()
  f.ports.current.value = { path: 'A' }; saved({ id: 'b' }); await save
  assert.equal(f.ports.storyEntityDraft.value.canonicalName, '甲书草稿')
  f.ports.desktop.workspace.listStoryEntities = async () => []
  const editing = f.actions.saveStoryEntity()
  f.ports.storyEntityDraft.value.canonicalName = '发送后继续输入'
  saved({ id: 'a' }); await editing
  assert.equal(f.ports.storyEntityDraft.value.canonicalName, '发送后继续输入')
})

test('restart restores unsubmitted drafts without treating malformed JSON as formal content', t => {
  const entries = new Map()
  const storage = { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value), removeItem: key => entries.delete(key) }
  const first = fixture(storage)
  first.ports.storyEntityDraft.value.profileJson = '{尚未写完'
  first.close()
  const restarted = fixture(storage); t.after(restarted.close)
  assert.equal(restarted.ports.storyEntityDraft.value.profileJson, '{尚未写完')
  restarted.ports.current.value = { path: 'B' }
  assert.equal(restarted.ports.storyEntityDraft.value.profileJson, '{}')
  restarted.ports.current.value = { path: 'A' }
  assert.equal(restarted.ports.storyEntityDraft.value.profileJson, '{尚未写完')
})
