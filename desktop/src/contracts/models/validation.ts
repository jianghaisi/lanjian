import { isModelConnectionId } from './local-model-contracts'
import type { AiTask, ModelProfile } from '../index'
import { boundedNumber, invalid, record, rejectUnknown, requiredString } from '../core/validation'

export const aiTasks: AiTask[] = ['outline', 'chapterOutline', 'prose', 'review']

export function aiTask(value: unknown): AiTask {
  if (!aiTasks.includes(value as AiTask)) invalid('task', '不是受支持的 AI 任务')
  return value as AiTask
}

export function modelProfile(value: unknown, field: string): Partial<ModelProfile> {
  const profile = record(value, field)
  rejectUnknown(profile, field, ['connectionId', 'model', 'temperature', 'topP', 'maxTokens'])
  const result: Partial<ModelProfile> = {}
  if ('connectionId' in profile) {
    result.connectionId = requiredString(profile.connectionId, `${field}.connectionId`, 80)
    if (!isModelConnectionId(result.connectionId)) invalid(field, '模型接口标识无效')
  }
  if ('model' in profile) result.model = requiredString(profile.model, `${field}.model`, 200)
  if ('temperature' in profile) result.temperature = boundedNumber(profile.temperature, `${field}.temperature`, 0, 2)
  if ('topP' in profile) result.topP = boundedNumber(profile.topP, `${field}.topP`, 0, 1)
  if ('maxTokens' in profile) {
    const maxTokens = boundedNumber(profile.maxTokens, `${field}.maxTokens`, 128, 128_000)
    if (!Number.isInteger(maxTokens)) invalid(`${field}.maxTokens`, '必须是整数')
    result.maxTokens = maxTokens
  }
  return result
}

export function httpUrl(value: unknown, field: string): string {
  const input = requiredString(value, field, 2_048).trim()
  let parsed: URL
  try {
    parsed = new URL(input)
  } catch {
    invalid(field, '必须是有效的 http 或 https 地址')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') invalid(field, '只支持 http 或 https')
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    invalid(field, '不能包含用户名、密码、查询参数或片段；密钥必须使用独立密钥字段')
  }
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`
}
