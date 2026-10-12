import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { validatePluginManifest, validateCreativeAssets, resolveCreativePolicy, resolveCreativeTeam, validateCreativeTeam, policyRecords, validatePolicyRecords } from '../dist/index.js'

const policy = () => ({ apiVersion: 1, id: 'personal.method', name: '个人方法', version: '1.0.0', description: '可替换方法', runtime: 'quickjs-js', entry: 'main.js', capabilities: [], tools: [], assets: ['method.md'], contributions: [{ id: 'method', name: '设定方法', kind: 'creative-policy', slot: 'foundation', mode: 'replace', asset: 'method.md', stages: ['worldbuilding'], configSchema: { type: 'object', properties: {}, additionalProperties: false } }] })
const pkg = (text, id = 'personal.method') => { const m = policy(); m.id = id; return { manifest: validatePluginManifest(m), digest: 'a'.repeat(64), files: new Map([['method.md', text]]) } }
test('policy assets are declarations; contradictory variants, wrong scope and unsafe references fail', () => {
  assert.equal(validatePluginManifest(policy()).contributions[0].kind, 'creative-policy')
  for (const mutate of [m => m.contributions[0].asset = '../private.md', m => m.contributions[0].slot = 'confirm', m => m.contributions[0].stages = ['writing'], m => m.contributions[0].recipe = {}, m => m.contributions[0].mode = 'execute', m => m.contributions[0].kind = 'context-fragment']) {
    const m = policy(); mutate(m); assert.throws(() => validatePluginManifest(m))
  }
  assert.throws(() => validateCreativeAssets(validatePluginManifest(policy()), new Map()))
  assert.throws(() => validateCreativeAssets(validatePluginManifest(policy()), new Map([['method.md', '{{undeclared}}']])))
  assert.throws(() => validateCreativeAssets(validatePluginManifest(policy()), new Map([['method.md', 'x'.repeat(12001)]])))
})
test('selected method replaces default; explicit disabled/missing/collision fails and snapshots are detached', () => {
  const baseline = pkg('官方默认', 'lanjian.official.method'), personal = pkg('个人方法')
  const entry = { pluginId: personal.manifest.id, digest: personal.digest, contributionId: 'method', params: {} }
  const composition = { revision: 3, entries: [entry] }
  assert.equal(resolveCreativePolicy([baseline], [], {revision:0,entries:[]}, 'foundation')[0].text, '官方默认')
  const result = resolveCreativePolicy([baseline], [personal], composition, 'foundation')
  assert.deepEqual(result.map(p => p.text), ['个人方法']); assert.equal(result[0].compositionRevision, 3)
  result[0].params.fake = true; assert.deepEqual(entry.params, {})
  assert.throws(() => resolveCreativePolicy([baseline], [], composition, 'foundation'))
  const other = pkg('其他方法', 'personal.other')
  assert.throws(() => resolveCreativePolicy([baseline], [personal,other], {revision:4,entries:[entry,{...entry,pluginId:other.manifest.id}]}, 'foundation'))
  const disabled = policy(); disabled.contributions[0] = {...disabled.contributions[0], mode:'disabled'}; delete disabled.contributions[0].asset
  const off = {...personal, manifest:validatePluginManifest(disabled)}
  assert.throws(() => resolveCreativePolicy([baseline], [off], composition, 'foundation'))
})
test('team presets are bounded data without confirmation, credentials or arbitrary task permissions', () => {
  const member = {id:'editor',name:'主编',initials:'编',task:'outline',color:'jade',responsibility:'协调',capabilities:['group.delegate'],preparationKinds:['definition']}
  assert.equal(validateCreativeTeam({format:1,members:[member]}).members[0].id, 'editor')
  for (const members of [[member,member], [{...member,capabilities:['planning.confirm']}], [{...member,key:'secret'}], [{...member,task:'shell'}], Array(17).fill(member)]) assert.throws(() => validateCreativeTeam({format:1,members}))
})

const actualTeam = () => {
  const base = new URL('../../writing-plugin-package/official/creative-team/', import.meta.url)
  const manifest = validatePluginManifest(JSON.parse(readFileSync(new URL('lanjian-plugin.json', base), 'utf8')))
  return { manifest, digest: 'b'.repeat(64), files: new Map(manifest.assets.map(path => [path, readFileSync(new URL(path, base), 'utf8')])) }
}
test('actual team assets supply the sole default and selected literal members, with detached metadata and parameters', () => {
  const original = actualTeam(), personal = actualTeam()
  personal.manifest.id = 'personal.team'
  personal.manifest.contributions[0].configSchema.properties.label = { type: 'string', maxLength: 40 }
  const team = JSON.parse(personal.files.get('team.json'))
  team.members = team.members.slice(0, 3).map((member, index) => ({ ...member, id: ['constructor', 'prototype', 'researcher'][index], responsibility: '{{label}}', capabilities: ['book.read'], preparationKinds: ['research'] }))
  personal.files.set('team.json', JSON.stringify(team))
  const composition = { revision: 8, entries: [{ pluginId: personal.manifest.id, digest: personal.digest, contributionId: 'team', params: { label: '原参数' } }] }
  assert.deepEqual(resolveCreativeTeam([original], [], { revision: 0, entries: [] }).team, validateCreativeTeam(JSON.parse(original.files.get('team.json'))))
  const selected = resolveCreativeTeam([original], [personal], composition)
  assert.equal(selected.pluginId, 'personal.team'); assert.equal(selected.compositionRevision, 8)
  assert.deepEqual(selected.team, team); assert.equal(selected.team.members[0].responsibility, '{{label}}')
  selected.team.members[0].capabilities.push('planning.candidate'); selected.params.label = '变更'
  assert.deepEqual(resolveCreativeTeam([original], [personal], composition).team, team)
  assert.equal(composition.entries[0].params.label, '原参数')
})
test('missing, conflicting, undeclared and malformed selected teams fail instead of restoring seven members', () => {
  const original = actualTeam(), personal = actualTeam(), other = actualTeam()
  personal.manifest.id = 'personal.team'; other.manifest.id = 'personal.other-team'
  const entry = { pluginId: personal.manifest.id, digest: personal.digest, contributionId: 'team', params: {} }
  assert.throws(() => resolveCreativeTeam([], [], { revision: 0, entries: [] }))
  assert.throws(() => resolveCreativeTeam([original, original], [], { revision: 0, entries: [] }))
  assert.throws(() => resolveCreativeTeam([original], [], { revision: 1, entries: [entry] }))
  assert.throws(() => resolveCreativeTeam([original], [personal, other], { revision: 1, entries: [entry, { ...entry, pluginId: other.manifest.id }] }))
  assert.throws(() => resolveCreativeTeam([original], [personal], { revision: 1, entries: [{ ...entry, contributionId: 'missing' }] }))
  assert.throws(() => resolveCreativeTeam([original], [personal], { revision: 1, entries: [{ ...entry, params: { permission: true } }] }))
  personal.files.set('team.json', '{malformed')
  assert.throws(() => resolveCreativeTeam([original], [personal], { revision: 1, entries: [entry] }))
  personal.files.delete('team.json')
  assert.throws(() => resolveCreativeTeam([original], [personal], { revision: 1, entries: [entry] }))
})
test('only finite review capability is admitted; metadata never introduces confirmation or arbitrary dispatch', () => {
  const team = JSON.parse(actualTeam().files.get('team.json'))
  team.members = [{ ...team.members[0], capabilities: ['manuscript.read', 'review.read'] }]
  assert.deepEqual(validateCreativeTeam(team).members[0].capabilities, ['manuscript.read', 'review.read'])
  for (const capability of ['planning.confirm', 'shell.execute', 'ipc.invoke', 'credentials.read']) {
    team.members[0].capabilities = [capability]
    assert.throws(() => validateCreativeTeam(team))
  }
})

test('genre assets inject only matching guidance, explicit params win and invalid tables fail package validation', () => {
  const manifest = policy(); manifest.contributions[0].slot = 'genre-guidance'; manifest.contributions[0].stages = ['planning']
  manifest.contributions[0].configSchema.properties = { genre: { type: 'string', maxLength: 120 }, subgenre: { type: 'string', maxLength: 120 } }
  const table = { format: 'genre-guidance-v1', fallback: '通用指导', genres: [
    { id: '都市', guidance: '都市指导', subgenres: [{ id: '职场', guidance: '职场指导' }] },
    { id: '仙侠', guidance: '仙侠指导', subgenres: [] }
  ] }
  const p = { manifest: validatePluginManifest(manifest), digest: 'a'.repeat(64), files: new Map([['method.md', JSON.stringify(table)]]) }
  const resolve = params => resolveCreativePolicy([p], [], { revision: 0, entries: [] }, 'genre-guidance', params)[0].text
  assert.equal(resolve({ genre: '都市', subgenre: '职场' }), '都市指导\n职场指导')
  assert.equal(resolve({ genre: '其他', subgenre: '职场' }), '通用指导')
  const chosen = resolveCreativePolicy([p], [p], { revision: 1, entries: [{ pluginId: p.manifest.id, digest: p.digest, contributionId: 'method', params: { genre: '仙侠' } }] }, 'genre-guidance', { genre: '都市' })
  assert.equal(chosen[0].text, '仙侠指导')
  const emptySelection = resolveCreativePolicy([p], [p], { revision: 1, entries: [{ pluginId: p.manifest.id, digest: p.digest, contributionId: 'method', params: {} }] }, 'genre-guidance', { genre: '都市', subgenre: '职场' })
  assert.equal(emptySelection[0].text, '都市指导\n职场指导')
  const noParams = structuredClone(manifest); noParams.contributions[0].configSchema.properties = {}
  const authored = { ...p, manifest: validatePluginManifest(noParams), files: new Map([['method.md', '个人题材指导']]) }
  assert.equal(resolveCreativePolicy([p], [authored], { revision: 1, entries: [{ pluginId: p.manifest.id, digest: p.digest, contributionId: 'method', params: {} }] }, 'genre-guidance', { genre: '都市' })[0].text, '个人题材指导')
  for (const invalid of [{ ...table, secret: 'credential' }, { ...table, genres: [...table.genres, table.genres[0]] }, { ...table, genres: [{ ...table.genres[0], subgenres: Array(129).fill(table.genres[0].subgenres[0]) }] }]) {
    assert.throws(() => validateCreativeAssets(p.manifest, new Map([['method.md', JSON.stringify(invalid)]])))
  }
})

test('policy source records are detached diagnostics with strict fields and bounded values', () => {
  const source = resolveCreativePolicy([pkg('默认')], [], { revision: 0, entries: [] }, 'foundation')
  const records = policyRecords(source)
  assert.ok(!('text' in records[0])); records[0].params.genre = 'changed'; assert.deepEqual(source[0].params, {})
  for (const patch of [{ text: 'execute' }, { confirmed: true }, { version: '' }, { digest: 'bad' }, { compositionRevision: -1 }, { params: { huge: 'x'.repeat(8193) } }, { mode: 'disabled' }]) assert.throws(() => validatePolicyRecords([{ ...records[0], ...patch }]))
  assert.throws(() => validatePolicyRecords(Array(33).fill(records[0])))
})

test('actual team starters are bounded detached metadata and old teams retain their original shape', () => {
  const team = JSON.parse(actualTeam().files.get('team.json'))
  assert.equal(validateCreativeTeam(team).starters.length, 3)
  const old = structuredClone(team); delete old.starters
  assert.ok(!Object.hasOwn(validateCreativeTeam(old), 'starters'))
  const decoded = validateCreativeTeam(team); decoded.starters[0].message = 'changed'
  assert.notEqual(team.starters[0].message, 'changed')
  for (const starters of [Array(9).fill(team.starters[0]), [...team.starters, team.starters[0]], [{ ...team.starters[0], confirmed: true }], [{ ...team.starters[0], id: '../run' }], [{ ...team.starters[0], message: 'x'.repeat(12001) }], [{ ...team.starters[0], label: '' }]]) assert.throws(() => validateCreativeTeam({ ...team, starters }))
  const member = { ...team.members[0], capabilities: ['assets.read'] }
  assert.deepEqual(validateCreativeTeam({ ...old, members: [member] }).members[0].capabilities, ['assets.read'])
  assert.throws(() => validateCreativeTeam({ ...old, members: [{ ...member, capabilities: ['assets.write'] }] }))
})
