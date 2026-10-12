export const maxCredits = 1_000_000_000_000
export class ContractError extends Error {
  constructor() { super('invalid-input'); this.name = 'ContractError' }
}
export function record(value: unknown, keys?: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ContractError()
  const item = value as Record<string, unknown>
  if (Object.keys(item).some(k => ['__proto__', 'constructor', 'prototype'].includes(k) || (keys && !keys.includes(k)))) throw new ContractError()
  return item
}
export function text(value: unknown, maximum: number, minimum = 1): string {
  if (typeof value !== 'string' || value.length > maximum || value.trim().length < minimum || /[\u0000-\u001f\u007f]/u.test(value)) throw new ContractError()
  return value.trim()
}
export function integer(value: unknown, minimum = 0, maximum = maxCredits): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) throw new ContractError()
  return value
}
