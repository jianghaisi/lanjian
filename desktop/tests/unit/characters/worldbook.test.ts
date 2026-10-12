import assert from 'node:assert/strict'
import test from 'node:test'
import { emptyWorldbookEntry, readWorldbookProfile, writeWorldbookProfile } from '../../../src/contracts/characters/worldbook'
import { decodeStoryEntityArgs } from '../../../src/contracts/characters/ipc'
import { selectWorldbookContext, worldbookContextVersion, worldbookFingerprint, type WorldbookEntity } from '../../../src/main/modules/characters/domain/worldbook-context'
import { compileContext } from '../../../src/main/modules/assistant/domain/context-compiler'

const chapters = [{ id: 30, position: 1 }, { id: 10, position: 2 }, { id: 20, position: 3 }]
const profile = () => ({ worldbook: { ...emptyWorldbookEntry(), aliases: ['白先生'], description: '师父在旧城教书。', authorNotes: '作者私记不要发送', secrets: [
  { id: 'reveal', text: '师父是失踪的城主', revealChapterId: 10, knownBy: ['master'] },
  { id: 'private', text: '终局将焚毁城楼', revealChapterId: null, knownBy: [] }
] }, extension: { hidden: '未知字段不要发送' } })
const entities: WorldbookEntity[] = [
  { id: 'master', type: 'character', name: '白衡', profile: profile() },
  { id: 'place', type: 'location', name: '旧城', profile: { worldbook: { ...emptyWorldbookEntry(), description: '城门夜间关闭' } } },
  { id: 'other', type: 'character', name: '陆远', profile: { worldbook: { ...emptyWorldbookEntry(), description: '远方的人' } } },
  { id: 'rule', type: 'world_rule', name: '禁飞', profile: { worldbook: { ...emptyWorldbookEntry(), description: '城内无法飞行' } } }
]
const select = (chapterId?: number, overrides: Partial<Parameters<typeof selectWorldbookContext>[0]> = {}) => selectWorldbookContext({ entities, chapters, chapterId, relations: [], focus: '白先生留在旧城', ...overrides })
const text = (items: ReturnType<typeof select>) => items.map(item => item.content).join('\n\n')

test('explicit worldbook upgrade preserves unknown legacy data and rejects unsupported/malformed extensions', () => {
  const legacy = '{"occupation":"老师","unknown":{"nested":[1,2]}}'
  assert.equal(readWorldbookProfile(JSON.parse(legacy)), null)
  const written = JSON.parse(writeWorldbookProfile(legacy, emptyWorldbookEntry()))
  assert.deepEqual(written.unknown, { nested: [1, 2] })
  assert.equal(written.occupation, '老师')
  assert.throws(() => writeWorldbookProfile('[1,2]', emptyWorldbookEntry()))
  for (const change of [{ version: 2 }, { extra: true }, { aliases: ['同名', '同名'] }, { chapterIds: [0] }, { description: 'x'.repeat(30001) }, { secrets: [{ id: 'x', text: '', revealChapterId: -1, knownBy: [] }] }]) {
    const invalid = { worldbook: { ...emptyWorldbookEntry(), ...change } }
    assert.throws(() => readWorldbookProfile(invalid))
    assert.throws(() => decodeStoryEntityArgs([{ entityType: 'character', canonicalName: '测试', profileJson: JSON.stringify(invalid) }]))
  }
})

test('selects alias, location, explicit bindings and constant rules with reasons, never the whole library', () => {
  const selected = select(30)
  assert.deepEqual(selected.map(item => item.sourceId), ['master', 'place', 'rule', 'worldbook-state'])
  assert.ok(selected.every(item => item.relevanceReasons!.length > 0 && item.truncationPolicy === 'never'))
  assert.match(text(selected), /师父在旧城教书/)
  assert.doesNotMatch(text(selected), /作者私记不要发送|未知字段不要发送|师父是失踪的城主|终局将焚毁城楼/)
  const bound = { id: 'bound', type: 'item', name: '信', profile: { worldbook: { ...emptyWorldbookEntry(), chapterIds: [30] } } }
  assert.ok(select(30, { entities: [bound], focus: '' }).some(item => item.sourceId === 'bound'))
  assert.ok(!select(10, { entities: [bound], focus: '' }).some(item => item.sourceId === 'bound'))
})

test('disclosure uses actual order and character identities; deleted or unresolved references stay private', () => {
  for (const chapterId of [10, 20]) {
    const revealed = text(select(chapterId))
    assert.match(revealed, /师父是失踪的城主/)
    assert.match(revealed, /"knownBy":\[\{"id":"master","name":"白衡"\}\]/)
    assert.match(revealed, /未列出的角色不得/)
    assert.doesNotMatch(revealed, /作者私记不要发送|终局将焚毁城楼/)
  }
  for (const selected of [select(), select(99), select(20, { chapters: chapters.filter(item => item.id !== 10) }), select(20, { chapters: [{ id: 10, position: 3 }, { id: 20, position: 1 }] })]) assert.doesNotMatch(text(selected), /师父是失踪的城主/)
  const invalid = profile(); invalid.worldbook.secrets[0].knownBy = ['missing']
  assert.doesNotMatch(text(select(20, { entities: [{ ...entities[0], profile: invalid }] })), /师父是失踪的城主/)
  const relation = { subjectEntityId: 'master', objectEntityId: 'place', predicate: '隐藏身份关系', notes: '关系备注秘密' }
  assert.doesNotMatch(text(select(30, { relations: [relation] })), /隐藏身份关系|关系备注秘密/)
})

test('legacy profiles remain readable with an explicit disclosure limitation; required lore is not truncated for budget', () => {
  const legacy = { id: 'old', type: 'world_rule', name: '旧规则', profile: { unknown: '旧内容' } }
  assert.match(text(select(30, { entities: [legacy] })), /旧内容.*尚未配置披露规则/)
  const compiled = compileContext({ task: 'prose', candidates: select(30), modelContextLimit: 50, outputReserveTokens: 10, systemReserveTokens: 10 })
  assert.equal(compiled.status, 'blocked')
  assert.equal(compiled.included.length, 0)
})

test('source version is stable across enumeration but changes for edits, chapter order and relations', () => {
  const initial = worldbookFingerprint(entities, chapters)
  assert.equal(initial, worldbookFingerprint([...entities].reverse(), [...chapters].reverse()))
  assert.equal(worldbookContextVersion(text(select(30))), initial)
  assert.notEqual(initial, worldbookFingerprint(entities, chapters.slice(1)))
  assert.notEqual(initial, worldbookFingerprint(entities.slice(1), chapters))
  assert.notEqual(initial, worldbookFingerprint(entities, chapters.map(item => ({ ...item, position: item.position + 1 }))))
})
