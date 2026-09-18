import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { LocalModelService } from '../src/main/modules/models/application/local-model-service'
import { AssistantConversationService } from '../src/main/modules/assistant/application/assistant-conversation-service'
import { draftAssistantSample } from '../src/main/modules/assistant/application/assistant-sample-service'
import { LocalTextRuntime } from '../src/main/modules/models/adapters/local-models/text-runtime'
import { ExistingModelAssets } from '../src/main/modules/models/adapters/local-models/existing-assets'
import { LocalInstallationStore } from '../src/main/modules/models/adapters/local-models/installation-store'
import { localModelCatalog } from '../src/main/modules/models/adapters/local-models/catalog'
import type { AssistantConversationRequest } from '../src/contracts/assistant/assistant-conversation-contracts'

const baseline = process.argv.includes('--baseline')
const root = await mkdtemp(join(tmpdir(), 'lanjian-local-conversation-'))
const evidence = resolve('artifacts/local-model-store')
await mkdir(evidence, { recursive: true })
const runtime = new LocalTextRuntime(resolve('src/main/modules/models/adapters/local-models/text-worker.py'))
const provider = new LocalModelService(localModelCatalog, new ExistingModelAssets(resolve('../../.local/companion-voice')), runtime, new LocalInstallationStore(join(root, 'installations.json')))
const profile = { connectionId: 'local:llama-cpp', model: localModelCatalog[0]!.id, maxTokens: 2048, temperature: .6, topP: .9 }
const history: AssistantConversationRequest['history'] = []
const outputs: unknown[] = []
let fieldsStarted = 0
const service = new AssistantConversationService({
  async assertScope(scope) { assert.equal(scope, 'synthetic-test-book') },
  async context() { return '当前区域：作品定义；输入：核心设想。已保存核心设想：围绕《本地试写回归》展开的故事。' },
  async prepare() { return { step: (messages, tools, signal) => provider.toolStep(profile.model, profile, messages, tools, signal) } },
  async draftSample(input,instruction,signal,progress) { return draftAssistantSample(input,instruction,{complete:(text,draft,context,signal)=>provider.complete({model:profile.model,profile,signal,messages:[{role:'system',content:context},{role:'user',content:text+(draft?'\n\n当前正文：\n'+draft:'')}]}),completeMessages:(messages,signal)=>provider.complete({model:profile.model,profile,messages,signal})},'',signal,progress) },
  async startField(input) { fieldsStarted++; return { id: input.operationId, target: input.target, status: 'running', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } },
  async cancelField() {}
})
try {
  assert.equal((await provider.inspect(profile.model)).state, 'ready')
  for (const message of (baseline ? ['帮我写一个1000字正文的测试小说，我就测试本地模型用的'] : ['帮我写一个1000字正文的测试小说，我就测试本地模型用的', '继续', '继续'])) {
    const input: AssistantConversationRequest = { operationId: crypto.randomUUID(), workItemId: 'synthetic-test-book', page: 'worldView', message, chapterId: null, selectedCharacters: 0, history: structuredClone(history), targets: [{ fieldId: 'definition.bookProfile.coreIdea', instanceId: 'core-idea', editorSessionId: 'regression', workItemId: 'synthetic-test-book', pageId: 'profile', label: '核心设想', revision: 1, value: '围绕《本地试写回归》展开的故事' }] }
    const start = Date.now()
    const result = await service.run(input)
    const chinese = (result.message.match(/\p{Script=Han}/gu) || []).length
    outputs.push({ input: message, result, chinese, elapsedMs: Date.now() - start })
    console.log(JSON.stringify({ input: message, kind: result.kind, chinese, tools: result.tools, elapsedMs: Date.now() - start }))
    if (!baseline) { assert.equal(result.kind, 'message'); assert.equal(fieldsStarted, 0); assert.ok(chinese >= (history.length ? 200 : 900), 'Expected actual prose, not an acknowledgement or field edit') }
    history.push({ role: 'user', content: message }, { role: 'assistant', content: result.message })
  }
} finally {
  provider.clear()
  await writeFile(join(evidence, baseline ? 'conversation-before.json' : 'conversation-after.json'), JSON.stringify({ root, fieldsStarted, outputs }, null, 2))
  console.log('Evidence: ' + evidence)
}
