import assert from 'node:assert/strict'
import test from 'node:test'
import { WritingPluginRegistry, modelToolName, functionDefinitions } from '../../../src/main/modules/writing-plugins/application/registry'
import { WritingPluginDispatcher } from '../../../src/main/modules/writing-plugins/application/dispatcher'
import { objectSchema, textSchema } from '@lanjian/writing-plugin-contracts'
import type { CapabilityTool, ToolHostContext } from '../../../src/main/modules/writing-plugins/domain/types'

const host = (): ToolHostContext => ({ workItemId: 'book-a', allowedCapabilities: new Set(['book.read']), signal: new AbortController().signal, assertScope: async () => {} })
function tool(id: string): CapabilityTool {
  return { pluginId: 'test.tools', id, version: '1.0.0', description: '读取写作资料', effect: 'read', capabilities: ['book.read'], inputSchema: objectSchema({}), outputSchema: objectSchema({ text: textSchema(30) }), isAvailable: context => Boolean(context.workItemId), execute: async () => ({ kind: 'completed', value: { text: '资料' }, evidence: [] }) }
}

test('stable provider names preserve namespaces and reserved aliases cannot be shadowed', () => {
  assert.notEqual(modelToolName('test.a-b', 'x'), modelToolName('test.a.b', 'x'))
  const name = modelToolName('a'.repeat(100), 'b'.repeat(100))
  assert.match(name, /^[a-zA-Z0-9_]{1,64}$/)
  assert.equal(name, modelToolName('a'.repeat(100), 'b'.repeat(100)))
  const registry = new WritingPluginRegistry(), definition = tool('read_field')
  registry.register(definition)
  assert.notEqual(registry.snapshot(host())[0].name, 'read_field')
  assert.throws(() => registry.register(definition), { code: 'VALIDATION_ERROR' })
  assert.throws(() => registry.register({ ...definition, pluginId: 'builtin.core' }), { code: 'VALIDATION_ERROR' })
  registry.register({ ...definition, pluginId: 'builtin.core' }, 'builtin')
  assert.equal(registry.snapshot(host())[1].name, 'read_field')
})

test('registry copies metadata and rejects invalid schemas before a model sees them', () => {
  const registry = new WritingPluginRegistry(), definition = tool('read')
  registry.register(definition)
  definition.capabilities.push('secret.read'); definition.description = 'changed'
  assert.equal(registry.snapshot(host())[0].tool.description, '读取写作资料')
  assert.throws(() => registry.register({ ...tool('bad'), inputSchema: { type: 'object', $ref: 'https://invalid/schema' } as never }))
  assert.equal(registry.snapshot({ ...host(), allowedCapabilities: new Set() }).length, 0)
  assert.equal(registry.snapshot({ ...host(), workItemId: null }).length, 0)
})

test('discovery pages add explicit callable definitions from a frozen run catalogue', async () => {
  const registry = new WritingPluginRegistry()
  for (let i = 0; i < 17; i++) registry.register(tool('read_' + i))
  const dispatcher = new WritingPluginDispatcher(registry, host())
  assert.deepEqual(dispatcher.definitions().map(item => item.function.name), ['discover_tools'])
  await assert.rejects(() => dispatcher.execute(modelToolName('test.tools', 'read_0'), '{}'), { code: 'AI_RESPONSE_INVALID' })
  const result = await dispatcher.execute('discover_tools', '{"query":"资料"}')
  assert.equal(result.kind, 'completed')
  if (result.kind !== 'completed') assert.fail()
  assert.equal((result.value as { nextOffset: number }).nextOffset, 8)
  assert.equal(dispatcher.definitions().length, 9)
  registry.register(tool('added_after_start'))
  const last = await dispatcher.execute('discover_tools', '{"offset":16}')
  assert.equal(last.kind, 'completed')
  if (last.kind === 'completed') assert.equal((last.value as { total: number }).total, 17)
  assert.equal((await dispatcher.execute(modelToolName('test.tools', 'read_0'), '{}')).kind, 'completed')
})

test('discovery accepts full tool identities even when provider names truncate them', async () => {
  const definition = { ...tool('plan_romance_arc'), pluginId: 'author.writing.' + 'long'.repeat(20) }
  const registry = new WritingPluginRegistry(); registry.register(definition)
  const name = modelToolName(definition.pluginId, definition.id)
  assert.ok(!name.includes(definition.id))
  for (const query of [definition.id, `${definition.pluginId}/${definition.id}`, ` \n${definition.id.toUpperCase()}\t`, '  写作资料  ', name, definition.pluginId]) {
    const dispatcher = new WritingPluginDispatcher(registry, host())
    const found = await dispatcher.execute('discover_tools', JSON.stringify({ query }))
    assert.equal(found.kind, 'completed')
    if (found.kind !== 'completed') assert.fail()
    assert.deepEqual(found.value, { tools: [{ name, pluginId: definition.pluginId, toolId: definition.id, description: definition.description, effect: 'read' }], total: 1, nextOffset: -1 }, query)
    assert.deepEqual(dispatcher.definitions().map(d => d.function.name), ['discover_tools', name])
    assert.equal((await dispatcher.execute(name, '{}')).kind, 'completed')
  }
})

test('full-ID discovery paginates duplicate tool IDs and qualified IDs select the right plugin', async () => {
  const registry = new WritingPluginRegistry(), id = 'audit_chapter_consistency'
  const definitions = Array.from({ length: 17 }, (_, i) => ({ ...tool(id), pluginId: `author.${'writing'.repeat(6)}.${i}` }))
  for (const definition of definitions) registry.register(definition)
  const dispatcher = new WritingPluginDispatcher(registry, host())
  registry.register({ ...tool(id), pluginId: 'author.added.after.snapshot' })
  for (const [offset, count, nextOffset] of [[0, 8, 8], [8, 8, 16], [16, 1, -1]]) {
    const found = await dispatcher.execute('discover_tools', JSON.stringify({ query: id, offset }))
    assert.equal(found.kind, 'completed')
    if (found.kind !== 'completed') assert.fail()
    assert.deepEqual(found.value, { tools: definitions.slice(offset, offset + count).map(d => ({ name: modelToolName(d.pluginId, id), pluginId: d.pluginId, toolId: d.id, description: d.description, effect: 'read' })), total: 17, nextOffset })
  }
  const isolated = new WritingPluginDispatcher(registry, host()), selected = definitions[12]
  const found = await isolated.execute('discover_tools', JSON.stringify({ query: `${selected.pluginId}/${id}` }))
  assert.equal(found.kind, 'completed')
  if (found.kind !== 'completed') assert.fail()
  assert.deepEqual(found.value, { tools: [{ name: modelToolName(selected.pluginId, id), pluginId: selected.pluginId, toolId: selected.id, description: selected.description, effect: 'read' }], total: 1, nextOffset: -1 })
  await assert.rejects(() => isolated.execute(modelToolName(definitions[0].pluginId, id), '{}'), { code: 'AI_RESPONSE_INVALID' })
})

test('identifier queries cannot expose unavailable tools or grant execution, and whitespace retains empty-query browsing', async () => {
  const registry = new WritingPluginRegistry(), id = 'read_hidden_material'
  registry.register({ ...tool(id), pluginId: 'author.denied', capabilities: ['secret.read'] })
  registry.register({ ...tool(id), pluginId: 'author.unavailable', isAvailable: () => false })
  registry.register(tool('visible'))
  const dispatcher = new WritingPluginDispatcher(registry, host())
  for (const query of [id, `author.denied/${id}`, `author.unavailable/${id}`, 'nonexistent_tool']) {
    const found = await dispatcher.execute('discover_tools', JSON.stringify({ query }))
    assert.equal(found.kind, 'completed')
    if (found.kind !== 'completed') assert.fail()
    assert.deepEqual(found.value, { tools: [], total: 0, nextOffset: -1 })
    assert.deepEqual(dispatcher.definitions().map(d => d.function.name), ['discover_tools'])
  }
  await assert.rejects(() => dispatcher.execute(modelToolName('author.denied', id), '{}'), { code: 'AI_RESPONSE_INVALID' })
  const found = await dispatcher.execute('discover_tools', JSON.stringify({ query: ' \n\t ' }))
  assert.equal(found.kind, 'completed')
  if (found.kind !== 'completed') assert.fail()
  assert.equal((found.value as { total: number }).total, 1)
})

test('discovery distinguishes same-description personal copies and preserves identities across checkpoint restore', async () => {
  const calls: string[] = [], registry = new WritingPluginRegistry()
  const sharedPrefix = 'personal.' + 'a'.repeat(110)
  const originals = ['original', 'copy'].map(suffix => ({
    ...tool('convert_chinese_text'), pluginId: sharedPrefix + suffix,
    execute: async () => { calls.push(suffix); return { kind: 'completed' as const, value: { text: suffix }, evidence: [] } }
  }))
  for (const definition of originals) registry.register(definition)
  const dispatcher = new WritingPluginDispatcher(registry, host())
  // Registration captures metadata; neither the caller's objects nor later tools
  // may change the identities that discovery reports for this run.
  const expected = originals.map(d => ({ name: modelToolName(d.pluginId, d.id), pluginId: d.pluginId, toolId: d.id, description: d.description, effect: d.effect }))
  originals[0].pluginId = 'changed.after.registration'; originals[0].id = 'changed_tool'
  const result = await dispatcher.execute('discover_tools', JSON.stringify({ query: 'convert_chinese_text' }))
  assert.equal(result.kind, 'completed')
  if (result.kind !== 'completed') assert.fail()
  assert.deepEqual(result.value, { tools: expected, total: 2, nextOffset: -1 })
  assert.equal(expected[0].name.slice(0, 44), expected[1].name.slice(0, 44))
  const found = result.value as { tools: { name: string; pluginId: string; toolId: string }[] }
  const saved = dispatcher.checkpoint(), restored = new WritingPluginDispatcher(registry, host())
  restored.restore(saved)
  for (const identity of [...expected].reverse()) {
    const selected = found.tools.find(item => item.pluginId === identity.pluginId && item.toolId === identity.toolId)
    assert.ok(selected)
    assert.equal((await restored.execute(selected.name, '{}')).kind, 'completed')
  }
  assert.deepEqual(calls, ['copy', 'original'])
  const again = await restored.execute('discover_tools', JSON.stringify({ query: 'convert_chinese_text' }))
  assert.deepEqual(again, result)
  await assert.rejects(() => restored.execute(expected[0].toolId, '{}'), { code: 'AI_RESPONSE_INVALID' })
  await assert.rejects(() => restored.execute(`${expected[0].pluginId}/${expected[0].toolId}`, '{}'), { code: 'AI_RESPONSE_INVALID' })
})

test('tool-count and aggregate-schema overflow fail instead of silently dropping tools', async () => {
  const registry = new WritingPluginRegistry()
  for (let i = 0; i < 50; i++) registry.register(tool('read_' + i))
  assert.throws(() => functionDefinitions(registry.snapshot(host())), { code: 'VALIDATION_ERROR' })
  const dispatcher = new WritingPluginDispatcher(registry, host())
  for (let offset = 0; offset < 40; offset += 8) await dispatcher.execute('discover_tools', JSON.stringify({ offset }))
  assert.equal(dispatcher.definitions().length, 41)
  await assert.rejects(() => dispatcher.execute('discover_tools', '{"offset":40}'), { code: 'VALIDATION_ERROR' })
  assert.equal(dispatcher.definitions().length, 41)
  const large = new WritingPluginRegistry()
  for (let i = 0; i < 6; i++) large.register({ ...tool('wide_' + i), inputSchema: objectSchema(Object.fromEntries(Array.from({ length: 100 }, (_, j) => ['arg' + j, { ...textSchema(10), description: '字'.repeat(80) }])) , []) })
  assert.throws(() => functionDefinitions(large.snapshot(host())), { code: 'VALIDATION_ERROR' })
})
