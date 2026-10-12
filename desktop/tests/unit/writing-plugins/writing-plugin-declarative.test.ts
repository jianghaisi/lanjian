import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { assertJson, codePluginLimits, validatePluginRecipe, type JsonObject, type JsonValue, type PluginManifest } from '@lanjian/writing-plugin-contracts'
import { declarativeSource } from '../../../src/main/modules/writing-plugins/runtime/declarative-source'
import { executeGuest } from '../../../src/main/modules/writing-plugins/runtime/guest-engine'
import { readPluginPackage } from '../../../src/main/modules/writing-plugins/adapters/package-reader'
import { WritingPluginManager } from '../../../src/main/modules/writing-plugins/application/plugin-manager'
import { PluginPackageStore } from '../../../src/main/modules/writing-plugins/adapters/package-store'
import { registerInstalledTools } from '../../../src/main/modules/writing-plugins/adapters/installed-tools'
import { WritingPluginRegistry, modelToolName } from '../../../src/main/modules/writing-plugins/application/registry'
import { WritingPluginDispatcher } from '../../../src/main/modules/writing-plugins/application/dispatcher'
import { DurablePluginEffects } from '../../../src/main/modules/writing-plugins/application/effect-journal'

const wasm = readFile(createRequire(import.meta.url).resolve('@jitl/quickjs-wasmfile-release-sync/wasm')).then(b => new Uint8Array(b).buffer)
const schema = { type: 'object', additionalProperties: false, properties: {} } as const
const manifest: PluginManifest = { apiVersion: 1, id: 'author.recipe', name: '流程', description: '有界流程', version: '1.0.0', runtime: 'declarative', entry: 'recipe.json', capabilities: ['author.ask', 'model.generate'], tools: [{ id: 'review', description: '按作者选择审阅', effect: 'derive', capabilities: ['author.ask', 'model.generate'], inputSchema: schema, outputSchema: { ...schema, properties: { text: { type: 'string', maxLength: 10000 } }, required: ['text'] } }] }
const question = { questions: [{ id: 'direction', prompt: '选择审阅方向', mode: 'single', required: true, options: [{ id: 'pace', label: '节奏' }, { id: 'plot', label: '情节' }] }] }
const recipe = { format: 1, tools: [{ id: 'review', steps: [
  { id: 'choice', call: 'interaction.request', args: { question } },
  { id: 'model', call: 'model.generate', args: { instruction: { $join: ['按此选择审阅：', { $ref: 'steps.choice.answers.0.chosenOptionIds.0' }] } } }
], result: { text: { $ref: 'steps.model.text' } } }] }

test('recipe validator rejects executable constructs, forward/prototype references, excess steps and undeclared effects', () => {
  assert.deepEqual(validatePluginRecipe(recipe, manifest), recipe)
  for (const mutate of [
    (r: any) => { r.tools[0].steps[0].loop = 100 },
    (r: any) => { r.tools[0].steps[0].call = 'eval' },
    (r: any) => { r.tools[0].steps[0].args.question = { $ref: 'steps.model.text' } },
    (r: any) => { r.tools[0].result = { $ref: 'input.constructor.prototype' } },
    (r: any) => { r.tools[0].steps.push(...Array.from({ length: 33 }, () => r.tools[0].steps[0])) },
    (r: any) => { r.tools[0].steps[0] = { id: 'candidate', call: 'candidate.prepare', args: { kind: 'planning', key: 'x', input: {} } } },
    (r: any) => { r.tools[0].steps[0].args.checkpoint = { forged: true } },
    (r: any) => { r.tools[0].steps[0].when = { equals: [true] } }
  ]) { const copy = structuredClone(recipe); mutate(copy); assert.throws(() => validatePluginRecipe(copy, manifest)) }
})

test('trusted recipe interpreter treats JS-like strings as data and skips false conditions', async () => {
  const injected = '"; throw new Error("injected"); // ${process.env.SECRET}'
  const source = declarativeSource(JSON.stringify({ format: 1, tools: [{ id: 'review', steps: [{ id: 'skip', call: 'model.generate', args: { instruction: 'never' }, when: { equals: [true, false] } }], result: { text: injected } }] }), manifest)
  let called = false
  const result = await executeGuest({ invocationId: 'recipe-1', toolId: 'review', source, input: {} }, await wasm, async () => { called = true; return {} }, new AbortController().signal)
  assert.equal(called, false); assert.equal(result.ok, true)
  if (result.ok) assert.deepEqual(result.value, { text: injected })
})

for (const bom of ['', '\ufeff']) test(`recipe asks once and resumes in a fresh VM through the real installed-tool SDK and shared model budget (BOM ${Boolean(bom)})`, async t => {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-recipe-')); t.after(() => rm(root, { recursive: true, force: true }))
  const zip = join(root, 'recipe.zip'); await writeFile(zip, await new JSZip().file('lanjian-plugin.json', bom + JSON.stringify(manifest)).file('recipe.json', bom + JSON.stringify(recipe)).generateAsync({ type: 'nodebuffer' }))
  const manager = new WritingPluginManager(new PluginPackageStore(root), async () => {})
  let index = await manager.install((await manager.preview(manager.chooseNativeFile(zip))).planId)
  index = await manager.setEnabled(manifest.id, true, manifest.capabilities, index.revision)
  await manager.setBookEnabled('book-a', manifest.id, true, index.revision)
  const installed = (await manager.capture('book-a'))[0], pin = { id: manifest.id, version: manifest.version, digest: installed.digest, grants: manifest.capabilities }
  let modelCalls = 0, guests = 0
  async function dispatcher() {
    const registry = new WritingPluginRegistry()
    await registerInstalledTools(registry, 'book-a', [pin], new DurablePluginEffects([], async () => {}), { manager, scope: action => action(), runner: { async run(invocation, broker, signal) { guests++; return executeGuest(invocation, await wasm, broker, signal) }, async dispose() {} }, async generate(instruction) { modelCalls++; assert.equal(instruction, '按此选择审阅：pace'); return '已审阅节奏' } })
    const d = new WritingPluginDispatcher(registry, { workItemId: 'book-a', signal: new AbortController().signal, allowedCapabilities: new Set(manifest.capabilities), async assertScope() {} })
    await d.execute('discover_tools', JSON.stringify({ query: manifest.id })); return d
  }
  const first = await dispatcher(), name = modelToolName(manifest.id, 'review'), waiting = await first.execute(name, '{}', 'recipe-1')
  assert.equal(waiting.kind, 'waiting-input'); assert.equal(modelCalls, 0)
  if (waiting.kind !== 'waiting-input') return
  const next = await dispatcher()
  const answer = { answers: [{ id: 'direction', chosenOptionIds: ['pace'], customText: '', skipped: false }] }
  const result = await next.resume(name, '{}', waiting.checkpoint as JsonObject, answer, 'recipe-1')
  assert.equal(result.kind, 'completed'); if (result.kind === 'completed') assert.deepEqual(result.value, { text: '已审阅节奏' })
  assert.equal(modelCalls, 1); assert.equal(guests, 2); assert.equal(next.budget.snapshot().steps, 1)
})

test('invalid declarative package is rejected before installation and oversized checkpoint fails visibly', async () => {
  const zip = await new JSZip().file('lanjian-plugin.json', JSON.stringify(manifest)).file('recipe.json', JSON.stringify({ ...recipe, arbitraryCode: 'execute' })).generateAsync({ type: 'nodebuffer' })
  await assert.rejects(readPluginPackage(zip), { code: 'VALIDATION_ERROR' })
  let checkpoint: JsonValue | undefined
  const source = declarativeSource(JSON.stringify(recipe), manifest)
  const result = await executeGuest({ invocationId: 'recipe-limit', source, toolId: 'review', input: { text: 'a'.repeat(70000) } }, await wasm, async (_method, args) => {
    checkpoint = (args as JsonObject).checkpoint
    // Production broker enforces this same checkpoint ceiling.
    assertJson(checkpoint, codePluginLimits.checkpointBytes); return {}
  }, new AbortController().signal)
  assert.ok(checkpoint); assert.equal(result.ok, false)
})
