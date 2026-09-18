import { AppError } from './app-error'

export type ArgsDecoder<T extends unknown[]> = (args: unknown[]) => T

export function exactArgs(args: unknown[], expected: number): void {
  if (args.length !== expected) invalid('arguments', `参数数量应为 ${expected}`)
}

export function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(field, '必须是对象')
  return value as Record<string, unknown>
}

export function exactRecord(value: unknown, field: string, allowedFields: string[]): Record<string, unknown> {
  const result = record(value, field)
  rejectUnknown(result, field, allowedFields)
  for (const key of allowedFields) if (!(key in result)) invalid(`${field}.${key}`, '不能为空')
  return result
}

export function rejectUnknown(value: Record<string, unknown>, field: string, allowedFields: readonly string[]): void {
  if (Object.keys(value).some((key) => !allowedFields.includes(key))) invalid(field, '包含未允许的字段')
}

export function boundedString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string') invalid(field, '必须是文本')
  if (value.length > maxLength) invalid(field, `长度不能超过 ${maxLength}`)
  return value
}

export function boundedBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') invalid(field, '必须是开关值')
  return value
}

export function enumValue<const T extends readonly string[]>(value: unknown, field: string, values: T): T[number] {
  if (typeof value !== 'string' || !values.includes(value)) invalid(field, `必须是 ${values.join('、')} 之一`)
  return value as T[number]
}

export function requiredString(value: unknown, field: string, maxLength: number): string {
  const result = boundedString(value, field, maxLength).trim()
  if (!result) invalid(field, '不能为空')
  return result
}

export function uuid(value: unknown, field: string): string {
  const result = requiredString(value, field, 64)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(result))
    invalid(field, '格式无效')
  return result
}

export function boundedNumber(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    invalid(field, `必须在 ${min} 到 ${max} 之间`)
  return value
}

export function boundedInteger(value: unknown, field: string, min: number, max: number): number {
  const result = boundedNumber(value, field, min, max)
  if (!Number.isSafeInteger(result)) invalid(field, '必须是整数')
  return result
}

export function invalid(field: string, reason: string): never {
  throw new AppError('VALIDATION_ERROR', `输入无效：${field} ${reason}`, {
    recoverable: true,
    details: { field }
  })
}
