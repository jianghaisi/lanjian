import assert from 'node:assert/strict'
import test from 'node:test'
import {
  groupForLocation,
  leafForLocation,
  parentForLeaf,
  targetForLeaf,
  workspaceCreationNavigation,
  workspaceNavigationLeaves,
  workspaceNavigationTree
} from '../../../src/renderer/features/library/services/workspace-navigation'

test('declares one ordered V3 creation hierarchy and keeps settings separate', () => {
  assert.deepEqual(workspaceCreationNavigation.map((group) => group.id), [
    'group', 'definition', 'materials', 'foundation', 'chronicle', 'planning', 'manuscript'
  ])
  assert.deepEqual(workspaceCreationNavigation.map((group) => group.sequence), ['CHAT', '01', '02', '03', '04', '05', '06'])
  assert.equal(workspaceNavigationTree.at(-1)?.id, 'settings')
  assert.equal(workspaceNavigationTree.at(-1)?.sequence, 'SYS')
  assert.ok(!workspaceCreationNavigation.some((group) => group.id === 'preparation'))
})

test('book group has one canonical destination beside definition and material stages', () => {
  assert.equal(groupForLocation({ active: 'group' }).id, 'group')
  assert.equal(leafForLocation({ active: 'group' })?.id, 'group-chat')
  assert.equal(groupForLocation({ active: 'unknown' }).id, 'definition')
})

test('planning owns all outline documents and their supporting views without a second total-outline parent', () => {
  for (const id of ['preparation', 'total-outline', 'volume-outline', 'volume-lines', 'chapter-skeleton', 'chapter-outline']) {
    assert.equal(parentForLeaf(id)?.id, 'planning')
  }
  assert.equal(workspaceNavigationTree.some(group => group.id === 'master-outline'), false)
  assert.equal(workspaceNavigationLeaves.find(leaf => leaf.id === 'chapter-skeleton')?.label, '章节安排')
  assert.equal(groupForLocation({ active: 'outline', outlineMode: 'total' }).id, 'planning')
})

test('assigns every leaf to exactly one parent with no duplicate identifiers', () => {
  const parentIds = workspaceNavigationTree.map((group) => group.id)
  const leafIds = workspaceNavigationLeaves.map((leaf) => leaf.id)
  assert.equal(new Set(parentIds).size, parentIds.length)
  assert.equal(new Set(leafIds).size, leafIds.length)

  for (const leaf of workspaceNavigationLeaves) {
    const owners = workspaceNavigationTree.filter((group) => group.children.some((candidate) => candidate.id === leaf.id))
    assert.equal(owners.length, 1, `${leaf.id} must have one parent`)
    assert.equal(parentForLeaf(leaf.id)?.id, owners[0].id)
    assert.deepEqual(targetForLeaf(leaf.id), leaf.target)
  }
})

test('resolves every canonical target back to its leaf and parent', () => {
  for (const leaf of workspaceNavigationLeaves) {
    const location = {
      active: leaf.target.active,
      materialSection: leaf.target.materialSection,
      timelineMode: leaf.target.timelineMode,
      outlineMode: leaf.target.outlineMode,
      preparationMode: leaf.target.preparationMode,
      settingsSection: leaf.target.settingsSection
    }
    assert.equal(leafForLocation(location)?.id, leaf.id, `${leaf.id} must round-trip`)
    assert.equal(groupForLocation(location).id, parentForLeaf(leaf.id)?.id)
  }
})

test('visually re-homes story records under foundation and leaves application settings global', () => {
  assert.equal(groupForLocation({ active: 'settings', settingsSection: 'story' }).id, 'foundation')
  assert.equal(leafForLocation({ active: 'settings', settingsSection: 'story' })?.id, 'characters')
  assert.equal(groupForLocation({ active: 'settings', settingsSection: 'appearance' }).id, 'settings')
  assert.equal(leafForLocation({ active: 'settings', settingsSection: 'appearance' }), undefined)
})

test('maps existing subordinate modes to their nearest canonical page', () => {
  assert.equal(leafForLocation({ active: 'outline', outlineMode: 'stage' })?.id, 'chapter-outline')
  assert.equal(leafForLocation({ active: 'outline', outlineMode: 'recovery' })?.id, 'chapter-outline')
  assert.equal(leafForLocation({ active: 'preparation', preparationMode: 'continuation' })?.id, 'preparation')
})

test('chronicle exposes events and map as primary, keeps auxiliary tools and re-homes volume overview to planning', () => {
  const chronicle = workspaceNavigationTree.find(group => group.id === 'chronicle')!
  assert.deepEqual(chronicle.children.filter(item => !item.auxiliary).map(item => item.id), ['event-timeline', 'world-map'])
  assert.deepEqual(chronicle.children.filter(item => item.auxiliary).map(item => item.label), ['伏笔备忘', '人物状态'])
  assert.equal(parentForLeaf('volume-lines')?.id, 'planning')
  assert.equal(groupForLocation({ active: 'timeline', timelineMode: 'volumes' }).id, 'planning')
})
