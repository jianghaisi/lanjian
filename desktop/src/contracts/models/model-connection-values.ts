import { AppError } from '../core/app-error'

export const MAX_MODEL_KEY_LENGTH = 4096
export const MAX_MODEL_CIPHERTEXT_LENGTH = 16384

function invalid(): never {
  throw new AppError('VALIDATION_ERROR', '全局模型接口数据格式无效。', { recoverable: true })
}

export function connectionRecord(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid()
  const proto = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) invalid()
  if (Reflect.ownKeys(value).some(key => typeof key !== 'string' || !allowed.includes(key))) invalid()
  return value as Record<string, unknown>
}

export function connectionRevision(value: unknown, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) invalid()
  return value
}

export function nextConnectionRevision(value: number): number {
  return connectionRevision(value + 1, 1)
}

export function globalConnectionId(value: unknown): string {
  if (typeof value !== 'string' || !/^global-[a-zA-Z0-9][a-zA-Z0-9_-]{0,72}$/.test(value)) invalid()
  return value
}

function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) invalid()
  return value.trim()
}

export function modelConnectionName(value: unknown): string { return text(value, 80) }

export function modelConnectionEndpoint(value: unknown): string {
  const input = text(value, 2048)
  let parsed: URL
  try { parsed = new URL(input) } catch { return invalid() }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname
    || parsed.username || parsed.password || parsed.search || parsed.hash
    || input.includes('?') || input.includes('#')) invalid()
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`
}

export function modelConnectionKey(value: unknown): string { return text(value, MAX_MODEL_KEY_LENGTH) }

export function modelConnectionCiphertext(value: unknown): string {
  if (typeof value !== 'string' || !value.length || value.length > MAX_MODEL_CIPHERTEXT_LENGTH
    || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) invalid()
  return value
}

