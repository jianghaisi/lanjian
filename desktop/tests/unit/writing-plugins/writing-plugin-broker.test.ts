import assert from 'node:assert/strict'
import test from 'node:test'
import { WritingPluginRegistry, modelToolName } from '../../../src/main/modules/writing-plugins/application/registry'
import { WritingPluginDispatcher, ToolBudget } from '../../../src/main/modules/writing-plugins/application/dispatcher'
import { objectSchema, textSchema, pluginLimits } from '@lanjian/writing-plugin-contracts'
import type { CapabilityTool, ToolOutcome } from '../../../src/main/modules/writing-plugins/domain/types'

const completed = (): ToolOutcome => ({ kind: 'completed', value: { text: '结果' }, evidence: [] })
function definition(id: string, execute: CapabilityTool['execute']): CapabilityTool {
  return { pluginId: 'test.broker', id, version: '1.0.0', description: '工具测试', effect: 'read', capabilities: ['book.read'], inputSchema: objectSchema({ count: { type: 'integer', minimum: 1, maximum: 3 } }), outputSchema: objectSchema({ text: textSchema(30) }), isAvailable: () => true, execute }
}
function fixture(tools: CapabilityTool[], origin: 'builtin' | 'plugin' = 'builtin') {
  const registry = new WritingPluginRegistry(), controller = new AbortController()
  let validScope = true
  for (const tool of tools) registry.register(tool, origin)
  const dispatcher = new WritingPluginDispatcher(registry, { workItemId: 'book-a', signal: controller.signal, allowedCapabilities: new Set(['book.read', 'candidate.create']), async assertScope() { if (!validScope) throw new Error('scope changed') } })
  return { dispatcher, controller, revoke() { validScope = false } }
}

test('unknown, deeply malformed, extra and oversized arguments never reach a tool', async () => {
  let calls = 0
  const f = fixture([definition('read', async () => { calls++; return completed() })]), name = modelToolName('test.broker', 'read')
  for (const args of ['{', '[]', '{}', '{"count":1.1}', '{"count":4}', '{"count":1,"save":true}', '{"count":1,"__proto__":{}}', JSON.stringify({ count: '中'.repeat(pluginLimits.inputBytes) })]) await assert.rejects(() => f.dispatcher.execute(name, args))
  await assert.rejects(() => f.dispatcher.execute('not_registered', '{"count":1}'))
  assert.equal(calls, 0)
  assert.equal((await f.dispatcher.execute(name, '{"count":1}')).kind, 'completed')
})

test('invalid outputs, fabricated evidence and guest UI handoffs are rejected', async () => {
  for (const output of [{ kind: 'completed', value: { text: 'x', leaked: true }, evidence: [] }, { kind: 'completed', value: { text: 'x'.repeat(31) }, evidence: [] }, { kind: 'completed', value: { text: 'x' }, evidence: [{ kind: 'manuscript', id: 'fake', revision: 'invented' }] }, { kind: 'handoff', result: { kind: 'navigate', workspaceId: 'chapters', message: '', tools: [] } }]) {
    const f = fixture([definition('invalid', async () => output as ToolOutcome)], 'plugin')
    await f.dispatcher.execute('discover_tools', '{}')
    await assert.rejects(() => f.dispatcher.execute(modelToolName('test.broker', 'invalid'), '{"count":1}'), { code: 'AI_RESPONSE_INVALID' })
  }
})

test('nested tools cannot gain capabilities from the outer run grant', async () => {
  let privileged = false
  const target = { ...definition('candidate', async () => { privileged = true; return completed() }), capabilities: ['candidate.create'] }
  const caller = definition('caller', async (_args, host) => {
    // Mutating the exposed copy cannot enlarge the actual invocation grant.
    ;(host.allowedCapabilities as Set<string>).add('candidate.create')
    return host.invoke(modelToolName('test.broker', 'candidate'), { count: 1 })
  })
  const f = fixture([caller, target])
  await assert.rejects(() => f.dispatcher.execute(modelToolName('test.broker', 'caller'), '{"count":1}'), { code: 'AI_RESPONSE_INVALID' })
  assert.equal(privileged, false)
})

test('nested calls, SDK calls and model rounds share bounded budgets', async () => {
  const recurse = definition('recurse', async (args, host) => host.invoke(modelToolName('test.broker', 'recurse'), args))
  await assert.rejects(() => fixture([recurse]).dispatcher.execute(modelToolName('test.broker', 'recurse'), '{"count":1}'), /尚未完成目标/)
  let entered = 0
  const chain = Array.from({ length: 5 }, (_, index) => definition('depth_' + index, async (args, host) => {
    entered++
    return index === 4 ? completed() : host.invoke(modelToolName('test.broker', 'depth_' + (index + 1)), args)
  }))
  await assert.rejects(() => fixture(chain).dispatcher.execute(modelToolName('test.broker', 'depth_0'), '{"count":1}'), /尚未完成目标/)
  assert.equal(entered, pluginLimits.callDepth)
  let hostCalls = 0
  const loop = definition('loop', async (_args, host) => { for (let i = 0; i < 100; i++) await host.hostCall(async () => { hostCalls++; return 0 }); return completed() })
  await assert.rejects(() => fixture([loop]).dispatcher.execute(modelToolName('test.broker', 'loop'), '{"count":1}'), /尚未完成目标/)
  assert.equal(hostCalls, pluginLimits.calls - 1)
  const budget = new ToolBudget()
  for (let i = 0; i < pluginLimits.modelSteps; i++) budget.modelStep()
  assert.throws(() => budget.modelStep(), /尚未完成目标/)
})

test('late host results are rejected on cancellation or scope revocation; unknown errors are safe', async () => {
  for (const action of ['cancel', 'revoke']) {
    let enter!: () => void, release!: () => void
    const entered = new Promise<void>(resolve => { enter = resolve }), gate = new Promise<void>(resolve => { release = resolve })
    const f = fixture([definition('wait', async (_args, host) => { await host.hostCall(async () => { enter(); await gate }); return completed() })])
    const running = f.dispatcher.execute(modelToolName('test.broker', 'wait'), '{"count":1}')
    await entered
    if (action === 'cancel') f.controller.abort(); else f.revoke()
    release(); await assert.rejects(running)
  }
  const f = fixture([definition('error', async () => { throw new Error('secret-provider-key') })])
  await assert.rejects(() => f.dispatcher.execute(modelToolName('test.broker', 'error'), '{"count":1}'), error => { assert.doesNotMatch((error as Error).message, /secret-provider-key/); return true })
})
