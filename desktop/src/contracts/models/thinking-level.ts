import { AppError } from '../core/app-error'

export const THINKING_LEVELS = ['default', 'low', 'medium', 'high'] as const
export type ThinkingLevel = typeof THINKING_LEVELS[number]
export const thinkingLevelLabels: Record<ThinkingLevel, string> = { default: '默认（由服务决定）', low: '低', medium: '中', high: '高' }

export function decodeThinkingLevel(value: unknown): ThinkingLevel {
  if (typeof value !== 'string' || !THINKING_LEVELS.includes(value as ThinkingLevel)) {
    throw new AppError('VALIDATION_ERROR', '思考强度无效，请选择默认、低、中或高。', { recoverable: true })
  }
  return value as ThinkingLevel
}

/** Missing is the legacy service default; never silently coerce an invalid value. */
export function explicitThinkingLevel(value: unknown): Exclude<ThinkingLevel, 'default'> | undefined {
  const level = value === undefined ? 'default' : decodeThinkingLevel(value)
  return level === 'default' ? undefined : level
}

export function assertThinkingProtocol(value: unknown, protocol: string | undefined): void {
  if (explicitThinkingLevel(value) && protocol !== 'gemini-native') {
    throw new AppError('FEATURE_UNAVAILABLE', '此思考强度设置仅支持 Gemini 原生接口，请改为“默认”或选择 Gemini 原生接口。', { recoverable: true })
  }
}
