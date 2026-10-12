import { createHash } from 'node:crypto'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { AiClient } from '../src/main/modules/models/application/ai-client'
import { remoteModelProtocol } from '../src/contracts/models/model-connections'
import { compileGeneration } from '../src/contracts/models/generation-parameters'
import { modelRule } from '../src/contracts/models/model-rule-registry'
import type { ModelProfile } from '../src/contracts/models/types'

// Synthetic inputs only. Dry-run is the default and does not read any application data or credentials.
const args = process.argv.slice(2), option = (key: string, fallback = '') => { const index = args.indexOf(key); return index < 0 ? fallback : args[index + 1] ?? fallback }
const protocol = remoteModelProtocol(option('--protocol', 'anthropic-native')), model = option('--model', 'claude-opus-5-5'), ruleId = option('--rule', 'claude-opus-5-5')
const endpoint = option('--base-url', 'https://api.anthropic.com/v1'), url = new URL(endpoint)
if (url.username || url.password || url.search || url.hash || url.protocol !== 'https:' && url.hostname !== '127.0.0.1') throw Error('Use a key-free HTTPS API endpoint (or an isolated loopback fixture).')
const rule = modelRule(ruleId)
if (!rule || !rule.protocols.includes(protocol)) throw Error('Choose a documented rule matching the selected protocol.')
const scenarios = [
  { id: 'causality', task: 'outline' as const, prompt: '合成测试。小镇水闸失灵，修理学徒林舟发现师傅隐瞒了一次失误。镇医许岚必须在天亮前送药过河。请给出三幕因果章纲，每幕明确时间、人物、地点、事件与后果。只能依靠已知技能解决冲突，避免巧合。500字以内。' },
  { id: 'dialogue', task: 'prose' as const, prompt: '合成测试。夜雨停后，修理学徒林舟与镇医许岚在断桥前商量送药。林舟用玩笑掩饰担心，许岚温和但坚持核实风险。写一段600字以内的对话场景，用动作和措辞区分人物，不要把人物写成开会，不增加第三个人物或超能力。' },
  { id: 'completion', task: 'prose' as const, prompt: '合成测试。写一个约2000字的完整章节：凌晨两点林舟检查卡死的水闸；三点许岚带药到桥头；两人发现闸绳打结，借旧滑轮解开，恢复小渡船；天亮前药送到对岸。林舟只会普通机械维修，许岚只懂医术。保持时间、道具位置与人物知识一致，最后明确送药成功，不出现“下回待续”或创作说明。' }
]
const variants = [{ id: 'default-budget', effort: undefined, maxTokens: 16384 }, { id: 'roomier-budget', effort: undefined, maxTokens: 32768 },
  ...(rule.reasoning.efforts?.includes('high') ? [{ id: 'high-roomier', effort: 'high', maxTokens: 32768 }] : [])]
const requests = scenarios.flatMap(s => variants.map(v => {
  const profile: ModelProfile = { connectionId: 'synthetic-comparison', model, parameterPolicy: { version: 2, ruleId, mode: 'custom', overrides: { maxTokens: v.maxTokens, ...(v.effort ? { reasoning: { effort: v.effort } } : {}) } } }
  const effective = compileGeneration(profile, s.task, { protocol, model, baseUrl: endpoint })
  return { scenario: s.id, variant: v.id, task: s.task, prompt: s.prompt, inputCharacters: s.prompt.length, profile, effective }
}))
const plan = { format: 1, syntheticOnly: true, endpoint, protocol, model, ruleId, requests, calls: requests.length,
  outputTokenCeilingSum: requests.reduce((sum, r) => sum + r.effective.outputTokens, 0), inputTokenLimit: '未使用服务商 tokenizer；固定输入原文与字符数可审阅',
  price: '由所选服务商计价，客户端不能核实', rubric: ['因果与时间一致', '人物声音区分', '道具与知识一致', '有完整结尾', '文风与作者偏好（人工盲评）'] }
const serialized = JSON.stringify(plan, null, 2) + '\n', fingerprint = createHash('sha256').update(serialized).digest('hex')
const output = resolve(option('--output', '../.trellis/tasks/10-05-v3-model-parameter-compatibility/evidence/comparison-plan.json'))
if (!args.includes('--execute')) {
  await mkdir(dirname(output), { recursive: true }); await writeFile(output, serialized)
  console.log(JSON.stringify({ dryRun: true, output, fingerprint, calls: plan.calls, outputTokenCeilingSum: plan.outputTokenCeilingSum, message: 'No requests sent. Review the exact plan before paid execution.' }, null, 2))
} else {
  const approvedPath = option('--approved-plan')
  if (!approvedPath || await readFile(resolve(approvedPath), 'utf8') !== serialized) throw Error('Execution requires an unchanged, explicitly reviewed --approved-plan matching this exact configuration.')
  const apiKey = process.env.LANJIAN_EVAL_API_KEY
  if (!apiKey) throw Error('Set LANJIAN_EVAL_API_KEY explicitly; application credentials are never read.')
  const results: unknown[] = []
  for (const request of requests) {
    const c = { kind: protocol, connectionId: 'synthetic-comparison', connectionName: 'Synthetic comparison', baseUrl: endpoint, apiKey, profile: request.profile }
    const ai = new AiClient({ resolve: async () => c, resolveConnection: async () => c })
    const start = Date.now()
    try {
      const result = await ai.complete(request.prompt, '', '', request.task)
      results.push({ scenario: request.scenario, variant: request.variant, complete: true, seconds: (Date.now() - start) / 1000, ...result, characters: result.content.length, humanAssessment: null })
    } catch { results.push({ scenario: request.scenario, variant: request.variant, complete: false, seconds: (Date.now() - start) / 1000, message: '未得到完整结果；不重试，也不声称质量合格。' }) }
    // Save progress after every bounded call. Never overwrite the reviewed plan.
    await writeFile(output + '.results.json', JSON.stringify({ planFingerprint: fingerprint, results }, null, 2) + '\n')
  }
  console.log(JSON.stringify({ output: output + '.results.json', calls: results.length, literaryQuality: 'Awaiting human assessment' }))
}
