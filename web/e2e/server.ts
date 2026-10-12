import { inspirationFixture } from './inspiration-fixture'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { buildApp } from '../../services/hosted-app/src/http/app.ts'
import { registerStatic } from '../../services/hosted-app/src/http/static.ts'
const parent = resolve(tmpdir()), root = await mkdtemp(join(parent, 'lanjian-hosted-browser-'))
const origin = 'http://127.0.0.1:5175'
const prose = Array.from({ length: 24 }, () => '林舟沿着湿漉漉的石阶走进旧城。他展开信纸，反复核对落款，发现名字不符，于是决定前去寻找证人。').join('\n\n')
const instance = buildApp({ config: { origin, dataDir: root, masterKey: randomBytes(32), adminIds: new Set(['42']), host: '127.0.0.1', port: 43130, development: true, oauth: { clientId: 'synthetic', clientSecret: 'synthetic' } },
  oauth: { authorizationUrl: state => `${origin}/api/auth/linuxdo/callback?state=${encodeURIComponent(state)}&code=synthetic`, exchange: async code => ({ subject: /^\d{2,10}$/.test(code) ? code : '123', username: 'fixture_author', name: '测试作者' }) },
  modelFetcher: async (_url, init) => {
    const body = JSON.parse(String(init?.body))
    const inspiration=inspirationFixture(body);if(inspiration)return inspiration
    if (body.tools?.some((t: { function: { name: string } }) => t.function.name.includes('_save_preparation_candidate_'))) {
      const results = body.messages.filter((m: { role: string }) => m.role === 'tool')
      const tool = (name: string, args: unknown) => ({ id: `group-${body.messages.length}-${name}`, type: 'function', function: { name: body.tools.find((t: { function: { name: string } }) => t.function.name.includes(`_${name}_`)).function.name, arguments: JSON.stringify(args) } })
      const message = body.model === 'world-fixture-model' ? results.length ? { role: 'assistant', content: '世界规则已经整理，请作者核对。' } : { role: 'assistant', content: '记忆的代价需要写入世界规则。', tool_calls: [tool('save_preparation_candidate', { kind: 'world', title: '记忆与代价', content: '旧物记录记忆，每次修复必须舍弃一段往事。' }), ...(body.tools.some((t: { function: { name: string } }) => t.function.name.includes('_request_book_creation_')) ? [tool('request_book_creation', { title: '浏览器雨夜修复师', summary: '关于记忆的都市奇幻。' })] : [])] } : results.length ? { role: 'assistant', content: '世界观成员继续整理。' } : { role: 'assistant', content: '先明确故事的方向。', tool_calls: [tool('save_preparation_candidate', { kind: 'definition', title: '故事的起点', content: '修复师听见旧物的记忆。' }), tool('delegate_to_member', { memberId: 'world', instruction: '整理世界规则并请求建书。' })] }
      return new Response(JSON.stringify({ choices: [{ message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 32, completion_tokens: 16 } }), { headers: { 'content-type': 'application/json' } })
    }
    let content = body.stream ? prose : JSON.stringify({ passed: true, summary: '测试审校逐项通过', beats: Array.from({ length: 12 }, (_, i) => ({ id: `B${i + 1}`, status: 'covered', evidence: '核对落款' })), boundary: { entryRespected: true, exitReached: true, evidence: '决定前去寻找证人' }, violations: [], introducedFacts: [], characterChanges: [], characterConflicts: [], literaryFindings: [] })
    const request = String(init?.body)
    if (request.includes('生成创作蓝图。')) content = JSON.stringify({ premise: '追查旧信的来源', worldView: '没有超自然力量的旧城', characters: [{ name: '林舟', role: '送信人', arcSeed: '从怀疑到查明真相' }], powerSystem: '', cheatSystem: '', rationale: '依靠人物选择推进故事。' })
    else if (request.includes('生成覆盖全书的总纲候选。')) content = JSON.stringify({ title: '旧信之谜', summary: '林舟找到旧信来源。', content: '因为旧信落款不符，林舟走访旧城，随后发现证人隐瞒实情，最终查明发信人的身份。' })
    else if (request.includes('把总纲拆成恰好')) content = JSON.stringify({ volumes: [{ order: 1, title: '旧城来信', goal: '寻找证人', summary: '林舟核对旧信并调查旧城。', ending: '得知发信人住处。' }] })
    await new Promise(resolve => setTimeout(resolve, 200))
    return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 1200, completion_tokens: 300, total_tokens: 1500 } }), { headers: { 'content-type': 'application/json' } })
  }
})
instance.models.update('fixture', 'browser-fixture', { name: '合成测试模型', protocol: 'openai-compatible', baseUrl: 'https://synthetic.invalid/v1', model: 'fixture-model', enabled: true, maxInputTokens: 100000, maxOutputTokens: 4096, expectedRevision: 0, apiKey: 'synthetic-model-secret' })
instance.credits.updatePrice('fixture', 'browser-fixture', { expectedVersion: 0, policy: { mode: 'request', points: 1000 } })
instance.models.update('fixture', 'world-fixture', { name: '世界观测试模型', protocol: 'openai-compatible', baseUrl: 'https://synthetic.invalid/v1', model: 'world-fixture-model', enabled: true, maxInputTokens: 100000, maxOutputTokens: 4096, expectedRevision: 0, apiKey: 'synthetic-world-secret' })
instance.credits.updatePrice('fixture', 'world-fixture', { expectedVersion: 0, policy: { mode: 'request', points: 1000 } })
instance.models.select('fixture', { modelId: 'browser-fixture', expectedRevision: 0 })
// Exercise the production assets/CSP without a development HMR connection.
// Partial page releases keep their hashed assets in a dedicated URL prefix.
const assetPrefix = process.env.LANJIAN_WEB_BASE
if (assetPrefix && /^\/ui-pages\/[a-zA-Z0-9._-]+\/$/.test(assetPrefix)) instance.app.addHook('onRequest', async request => {
  if (request.raw.url?.startsWith(assetPrefix)) request.raw.url = '/' + request.raw.url.slice(assetPrefix.length)
})
await registerStatic(instance.app, resolve(process.env.LANJIAN_TEST_DIST || 'dist'))
await instance.app.listen({ host: '127.0.0.1', port: 5175 })
let stopping = false
async function stop() { if (stopping) return; stopping = true; await instance.app.close(); if (dirname(root) !== parent || !root.startsWith(join(parent, 'lanjian-hosted-browser-'))) throw new Error('Invalid cleanup root'); await rm(root, { recursive: true, force: true }); process.exit(0) }
process.on('SIGINT', () => { void stop() }); process.on('SIGTERM', () => { void stop() })
