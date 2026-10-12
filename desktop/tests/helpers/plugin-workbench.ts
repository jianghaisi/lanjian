import { randomUUID } from 'node:crypto'
import { createPluginWorkbenchTools } from '../../src/main/modules/writing-plugins/adapters/builtin/plugin-workbench'
import type { PluginWorkbenchServices } from '../../src/main/modules/writing-plugins/adapters/builtin/plugin-workbench-shared'
import { DurablePluginEffects } from '../../src/main/modules/writing-plugins/application/effect-journal'
import { WritingPluginRegistry, modelToolName } from '../../src/main/modules/writing-plugins/application/registry'
import { WritingPluginDispatcher } from '../../src/main/modules/writing-plugins/application/dispatcher'
import type { PluginEffectReceipt } from '../../src/main/modules/writing-plugins/domain/plugin-run'
import type { JsonObject, ToolOutcome } from '../../src/main/modules/writing-plugins/domain/types'

export function workbench(ports: PluginWorkbenchServices, bookId = 'book-a', controller = new AbortController()) {
  const receipts: PluginEffectReceipt[] = [], journal = new DurablePluginEffects(receipts, async () => {})
  const factory = createPluginWorkbenchTools(ports)
  const dispatcher = () => {
    const registry = new WritingPluginRegistry(), tools = factory(journal)
    for (const tool of tools) registry.register(tool, 'builtin')
    return new WritingPluginDispatcher(registry, { workItemId: bookId, signal: controller.signal, allowedCapabilities: new Set(tools.flatMap(t => t.capabilities)), assertScope: async () => {} })
  }
  const execute = (id: string, args: JsonObject, invocation: string = randomUUID()) => dispatcher().execute(modelToolName('builtin.plugins', id), JSON.stringify(args), invocation)
  async function prepare(id: string, args: JsonObject) {
    const invocation = randomUUID(), outcome = await execute(id, args, invocation)
    if (outcome.kind !== 'waiting-input' || !outcome.checkpoint) throw new Error(`Expected question, received ${outcome.kind}`)
    return { outcome, resume: (decision = 'confirm', customText = '', checkpoint = outcome.checkpoint!) => dispatcher().resume(modelToolName('builtin.plugins', id), JSON.stringify(args), checkpoint, { answers: [{ id: 'decision', chosenOptionIds: decision ? [decision] : [], customText, skipped: false }] }, invocation) }
  }
  return { factory, journal, receipts, dispatcher, execute, prepare }
}
export function data(outcome: ToolOutcome) {
  if (outcome.kind !== 'completed' || typeof outcome.value !== 'object' || !outcome.value || Array.isArray(outcome.value) || typeof outcome.value.data !== 'string') throw new Error(`Expected completed data, received ${outcome.kind}`)
  return JSON.parse(outcome.value.data)
}
