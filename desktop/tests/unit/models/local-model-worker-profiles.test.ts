import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { LocalTextRuntime } from '../../../src/main/modules/models/adapters/local-models/text-runtime'
import { testPython } from '../../helpers/python'
import { localPromptProfiles, type VerifiedModelAssets } from '../../../src/main/modules/models/domain/local-models'
import type { LocalTextRequest } from '../../../src/main/modules/models/domain/model-provider'

// Real production worker and framed IPC; the injected inference module contains no weights.
test('production worker switches all six profiles, hides reasoning and budgets the complete output', async t => {
  const python = testPython()
  const root = await mkdtemp(join(tmpdir(), 'lanjian-profile-worker-'))
  const sitePackages = join(root, 'packages'), modelPath = join(root, 'fixture.model')
  await mkdir(sitePackages); await writeFile(modelPath, 'not a model')
  await writeFile(join(sitePackages, 'llama_cpp.py'), `
class LlamaGrammar:
 @staticmethod
 def from_json_schema(schema, verbose=False): return schema
class Llama:
 def __init__(self, **kwargs): pass
 def tokenize(self, content, **kwargs): return list(content)
 def create_completion(self, prompt, grammar, stop, **kwargs):
  text=bytes(prompt).decode('utf8')
  reasoning='<｜Assistant｜><think>\\n' in text
  if reasoning:
   assert stop==['<｜end▁of▁sentence｜>', '<｜User｜>']
  if grammar:
   if reasoning: assert text.endswith('</think>\\n\\n')
   chunks=['{"ok":', 'true}']
  elif reasoning:
   chunks=['private reasoning', '</thi', 'nk>', '雨夜', '来信']
   if 'unfinished' in text: chunks=['private reasoning only']
   if 'empty-answer' in text: chunks=['private reasoning</think>']
  else: chunks=['雨夜', '来信']
  for chunk in chunks: yield {'choices':[{'text':chunk,'finish_reason':None}]}
  yield {'choices':[{'text':'','finish_reason':'stop'}]}
`, 'utf8')
  const runtime = new LocalTextRuntime(resolve('src/main/modules/models/adapters/local-models/text-worker.py'))
  t.after(() => runtime.stop())
  const assets: VerifiedModelAssets = { root, python, modelPath, sitePackages, fingerprint: 'fixture' }
  const request = (content = 'test', schema?: Record<string, unknown>): LocalTextRequest => ({
    action: 'complete', messages: [{ role: 'system', content: 'system' }, { role: 'user', content }],
    maxTokens: 128, temperature: .1, topP: .9, ...(schema ? { schema } : {})
  })
  let previousPid: number | undefined
  for (const promptProfile of localPromptProfiles) {
    const deltas: string[] = [], selected = { ...assets, promptProfile }
    const result = await runtime.run(selected, request(), undefined, delta => { deltas.push(delta) })
    assert.equal(result.content, '雨夜来信'); assert.deepEqual(deltas, ['雨夜', '来信'])
    assert.notEqual(runtime.pid, previousPid, 'a changed profile must release the old resident')
    previousPid = runtime.pid
    const tokens = await runtime.run(selected, { ...request(), action: 'tokenize' })
    assert.equal(tokens.promptTokens, result.promptTokens); assert.equal(tokens.completionTokens, 0)
    assert.equal(runtime.pid, previousPid, 'same verified resource/profile reuses its resident')
    if (promptProfile === 'deepseek-r1') assert.equal(result.completionTokens, Buffer.byteLength('private reasoning</think>雨夜来信'))
  }
  const deepseek = { ...assets, promptProfile: 'deepseek-r1' as const }
  assert.equal((await runtime.run(deepseek, request('json', { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] }))).content, '{"ok":true}')
  const hidden: string[] = []
  await assert.rejects(runtime.run(deepseek, request('unfinished'), undefined, text => { hidden.push(text) }), /尚未完成思考/)
  assert.deepEqual(hidden, [])
  await assert.rejects(runtime.run(deepseek, request('empty-answer')), /运行失败/)
  assert.equal((await runtime.run(deepseek, request())).content, '雨夜来信', 'failed output does not poison the next request')
})
