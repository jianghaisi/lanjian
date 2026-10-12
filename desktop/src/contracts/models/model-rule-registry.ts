import type { RemoteModelProtocol } from './model-connections'

export const MODEL_RULE_REVISION = '2026-10-05.1'
export type ParameterStatus = 'supported' | 'fixed' | 'unsupported' | 'unknown'
export type SamplingRule = { status: ParameterStatus; min?: number; max?: number; exclusiveMin?: boolean; exclusiveMax?: boolean; default?: number; reason?: string }
export type ModelRule = {
  id: string; label: string; vendor: string; models: readonly string[]; protocols: readonly RemoteModelProtocol[]; sourceUrl: string
  endpoints: readonly string[]; temperature: SamplingRule; topP: SamplingRule; topK?: SamplingRule
  reasoning: { wire: 'openai' | 'anthropic' | 'gemini' | 'thinking' | 'qwen' | 'none'; modes?: readonly string[]; defaultMode?: string;
    efforts?: readonly string[]; defaultEffort?: string; budget?: { min: number; max: number; allowZero?: boolean }; exclusiveBudget?: boolean }
  outputTokens?: number; contextTokens?: number; outputField?: 'max_tokens' | 'max_completion_tokens'
  samplingRequiresNone?: boolean; toolsChat?: 'unsupported' | 'requires-none'; preserveReasoning?: boolean; note?: string
}
const supported = (max = 2): SamplingRule => ({ status: 'supported', min: 0, max })
const fixed = (value: number): SamplingRule => ({ status: 'fixed', default: value, reason: '此型号固定采样值，修改会被拒绝或忽略。' })
const unknown: SamplingRule = { status: 'unknown' }
const oa = ['https://api.openai.com/v1'], google = ['https://generativelanguage.googleapis.com', 'https://generativelanguage.googleapis.com/v1', 'https://generativelanguage.googleapis.com/v1beta']
const chat = ['openai-compatible'] as const, openai = ['openai-compatible', 'openai-responses'] as const
const qwen = ['https://dashscope.aliyuncs.com/compatible-mode/v1', 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', 'https://dashscope-us.aliyuncs.com/compatible-mode/v1']
const qwenDoc = 'https://help.aliyun.com/en/model-studio/qwen-api-via-openai-chat-completions'
const effort = (values: string[], defaultEffort = 'medium'): ModelRule['reasoning'] => ({ wire: 'openai', efforts: values, defaultEffort })
const gpt = (id: string, values: string[], toolsChat?: ModelRule['toolsChat']): ModelRule => ({
  id, label: id, vendor: 'OpenAI', models: [id], protocols: openai, endpoints: oa,
  sourceUrl: 'https://developers.openai.com/api/docs/guides/latest-model', temperature: values.includes('none') ? supported() : { status: 'unsupported' },
  topP: values.includes('none') ? supported(1) : { status: 'unsupported' }, reasoning: effort(values), samplingRequiresNone: true,
  outputField: 'max_completion_tokens', outputTokens: 128000, toolsChat
})
const gemini = (model: string, values: string[], defaultEffort: string): ModelRule => ({
  id: model, label: model, vendor: 'Google', models: [model], protocols: ['gemini-native'], endpoints: google,
  sourceUrl: 'https://ai.google.dev/gemini-api/docs/generate-content/thinking', temperature: supported(), topP: supported(1),
  reasoning: { wire: 'gemini', efforts: values, defaultEffort }
})

/** Exact documented IDs only. An explicit binding selects a reference; it never authenticates a gateway. */
export const MODEL_RULES: readonly ModelRule[] = [
  { id: 'gpt-4.1-family', label: 'GPT 4.1 / mini / nano', vendor: 'OpenAI', models: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano', 'gpt-4.1-2025-04-14', 'gpt-4.1-mini-2025-04-14', 'gpt-4.1-nano-2025-04-14'],
    protocols: openai, endpoints: oa, sourceUrl: 'https://developers.openai.com/api/docs/models/gpt-4.1', temperature: supported(), topP: supported(1), reasoning: { wire: 'none' }, outputTokens: 32768, contextTokens: 1047576, outputField: 'max_completion_tokens' },
  ...['gpt-5', 'gpt-5-mini', 'gpt-5-nano'].map(id => gpt(id, ['minimal', 'low', 'medium', 'high'])),
  ...['gpt-5.6', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-6-sol', 'gpt-6-luna'].map(id => gpt(id, ['none', 'low', 'medium', 'high', 'xhigh', 'max'], id.startsWith('gpt-6-') ? 'requires-none' : undefined)),
  ...['gpt-6.1-sol', 'gpt-6-astra'].map(id => ({ ...gpt(id, ['low', 'medium', 'high', 'xhigh', 'max'], 'unsupported'), contextTokens: 1050000 })),
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5（Messages）', vendor: 'Anthropic', models: ['claude-opus-5-5'], protocols: ['anthropic-native'], endpoints: ['https://api.anthropic.com', 'https://api.anthropic.com/v1'],
    sourceUrl: 'https://platform.claude.com/docs/en/models/opus-5-5/migration-guide', temperature: fixed(1), topP: { status: 'unsupported' }, topK: { status: 'unsupported' },
    reasoning: { wire: 'anthropic', modes: ['adaptive'], defaultMode: 'adaptive', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'medium' }, outputTokens: 128000, contextTokens: 1000000,
    note: '此型号始终自适应思考，不能关闭或指定手动思考 token 预算。' },
  ...['gemini-3.8-flash', 'gemini-3.7-flash'].map(id => gemini(id, ['low', 'medium', 'high'], 'medium')),
  ...['gemini-3.6-flash', 'gemini-3.5-flash'].map(id => gemini(id, ['minimal', 'low', 'medium', 'high'], 'medium')),
  gemini('gemini-3.1-pro-preview', ['low', 'medium', 'high'], 'high'),
  gemini('gemini-3-flash-preview', ['minimal', 'low', 'medium', 'high'], 'high'),
  ...['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite-preview'].map(id => gemini(id, ['minimal', 'low', 'medium', 'high'], 'minimal')),
  ...[{ id: 'gemini-2.5-flash', min: 1, max: 24576, allowZero: true }, { id: 'gemini-2.5-pro', min: 128, max: 32768, allowZero: false }].map(({ id, ...budget }): ModelRule => ({
    ...gemini(id, [], '自动'), reasoning: { wire: 'gemini', budget } })),
  { id: 'deepseek-v4', label: 'DeepSeek Flash / V4 Pro（官方 Chat）', vendor: 'DeepSeek', models: ['deepseek-flash', 'deepseek-v4-pro'], protocols: chat,
    endpoints: ['https://api.deepseek.com', 'https://api.deepseek.com/v1'], sourceUrl: 'https://api-docs.deepseek.com/api/create-chat-completion/',
    temperature: supported(), topP: { status: 'supported', min: 0.95, max: 1 }, reasoning: { wire: 'thinking', modes: ['enabled', 'disabled'], defaultMode: 'enabled', efforts: ['low', 'high', 'max'], defaultEffort: 'high' },
    outputTokens: 393216, contextTokens: 1048576, preserveReasoning: true, note: '温度仅在关闭思考时生效；top_p 仅在思考时生效，范围 0.95–1。' },
  ...['kimi-k3', 'kimi-k2.6', 'kimi-k2.7-code', 'kimi-k2.7-code-highspeed'].map((id): ModelRule => ({ id, label: `${id}（Moonshot Chat）`, vendor: 'Moonshot', models: [id], protocols: chat,
    endpoints: ['https://api.moonshot.ai/v1', 'https://api.moonshot.cn/v1'], sourceUrl: 'https://platform.kimi.ai/docs/api/models-overview', temperature: fixed(1), topP: fixed(0.95),
    reasoning: id === 'kimi-k3' ? effort(['low', 'high', 'max'], 'max') : { wire: 'thinking', modes: id === 'kimi-k2.6' ? ['enabled', 'disabled'] : undefined, defaultMode: 'enabled' },
    contextTokens: id === 'kimi-k3' ? 1048576 : 262144, preserveReasoning: true, note: id === 'kimi-k2.6' ? '温度随思考模式固定：开启为 1，关闭为 0.6；无需显式发送。' : undefined })),
  { id: 'qwen3.8-dashscope', label: 'Qwen 3.8 Max / Flash（百炼 Chat）', vendor: 'Alibaba', models: ['qwen3.8-max', 'qwen3.8-max-0902', 'qwen3.8-flash', 'qwen3.8-2.4t-a95b', 'qwen3.8-27b'], protocols: chat,
    endpoints: qwen, sourceUrl: qwenDoc, temperature: { ...supported(), exclusiveMax: true }, topP: { ...supported(1), exclusiveMin: true }, topK: { status: 'supported', min: 0, max: 1024, default: 20, reason: '超过 100 关闭 top_k，1024 是应用上限。' }, reasoning: { wire: 'qwen', modes: ['enabled', 'disabled'], defaultMode: 'enabled', efforts: ['low', 'medium', 'xhigh'], defaultEffort: 'xhigh', budget: { min: 0, max: 262144, allowZero: true }, exclusiveBudget: true },
    outputField: 'max_completion_tokens', preserveReasoning: true },
  { id: 'glm5.3-dashscope', label: 'GLM 5.3（百炼 Chat）', vendor: 'Zhipu / Alibaba', models: ['glm-5.3', 'ZHIPU/GLM-5.3', 'ZHIPU/GLM-5.3-Flash', 'ZHIPU/GLM-5.3-FlashX'], protocols: chat,
    endpoints: qwen, sourceUrl: qwenDoc, temperature: unknown, topP: unknown, reasoning: { wire: 'qwen', modes: ['enabled'], defaultMode: 'enabled', efforts: ['low', 'high', 'max'], defaultEffort: 'max' }, outputField: 'max_completion_tokens', preserveReasoning: true,
    note: '已核对百炼的思考规则；不能据此断言智谱原生端点或其他中转的映射。' },
  { id: 'doubao-seed-2.0', label: '豆包 Seed 2.0 Pro / Lite（火山 Chat）', vendor: 'ByteDance', models: ['doubao-seed-2-0-pro-260215', 'doubao-seed-2-0-lite-260215'], protocols: chat,
    endpoints: ['https://ark.cn-beijing.volces.com/api/v3'], sourceUrl: 'https://docs.volcengine.com/docs/ark/chat-api?lang=zh&redirect=1', temperature: fixed(1), topP: fixed(0.95), reasoning: { wire: 'none' },
    note: '已核对固定采样；思考模式与容量缺少精确型号证据，保持服务默认。' }
]

export function modelRule(id: string): ModelRule | undefined { return MODEL_RULES.find(r => r.id === id) }
export function officialModelRule(protocol: RemoteModelProtocol | 'local', baseUrl: string | undefined, model: string): ModelRule | undefined {
  if (protocol === 'local') return undefined
  try {
    const u = new URL(baseUrl ?? '')
    if (u.search || u.hash || u.username || u.password) return undefined
    const endpoint = `${u.origin}${u.pathname}`.replace(/\/$/, '')
    return MODEL_RULES.find(r => r.protocols.includes(protocol) && r.endpoints.includes(endpoint) && r.models.includes(model))
  } catch { return undefined }
}
