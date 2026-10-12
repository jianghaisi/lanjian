import { ContractError, integer, record, text, maxCredits } from './validation.js'
import { decodeProviderTokenPolicy, type ProviderTokenPolicy } from './provider-price.js'
export * from './provider-price.js'
export { ContractError, integer, record, text, maxCredits } from './validation.js'
export * from './site.js'
/** HTTP/SQLite amounts use thousandths of one displayed point. */
export const creditScale = 1000
export const defaultWelcomeCredits = 10 * creditScale
export type Role = 'member' | 'admin'
export type UserView = { id: string; username: string; name: string; role: Role; disabled: boolean }
export type WalletView = { balance: number; reserved: number; available: number }
export type BookView = { id: string; title: string; createdAt: number; updatedAt: number }
export type PricePolicy =
  | ProviderTokenPolicy
  | { mode: 'unconfigured' }
  | { mode: 'tokens'; inputPerMillion: number; outputPerMillion: number }
  | { mode: 'request'; points: number }
export type PriceView = { modelId: string; version: number; policy: PricePolicy }
export type LedgerView = { id: string; kind: string; amount: number; note: string; createdAt: number }
export const capabilities = Object.freeze({
  hosted: true, localModels: false, speechSynthesis: false,
  speechRecognition: false, nativePetWindow: false, externalCodePlugins: false
})

export function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new ContractError()
  return value
}
export function uuid(value: unknown): string {
  const result = text(value, 36)
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(result)) throw new ContractError()
  return result
}
export function operation(value: unknown): string {
  const result = text(value, 100, 8)
  if (!/^[a-z0-9_-]+$/iu.test(result)) throw new ContractError()
  return result
}
export function modelId(value: unknown): string {
  const result = text(value, 150)
  if (!/^[a-z0-9][a-z0-9._:/-]*$/iu.test(result)) throw new ContractError()
  return result
}
export function pricePolicy(value: unknown): PricePolicy {
  const item = record(value)
  if (item.mode === 'provider-tokens') return decodeProviderTokenPolicy(item)
  if (item.mode === 'unconfigured') { record(item, ['mode']); return { mode: 'unconfigured' } }
  if (item.mode === 'tokens') {
    record(item, ['mode', 'inputPerMillion', 'outputPerMillion'])
    return { mode: 'tokens', inputPerMillion: integer(item.inputPerMillion, 0, 1_000_000_000), outputPerMillion: integer(item.outputPerMillion, 0, 1_000_000_000) }
  }
  if (item.mode === 'request') { record(item, ['mode', 'points']); return { mode: 'request', points: integer(item.points) } }
  throw new ContractError()
}
export function decodeGrant(value: unknown) {
  const item = record(value, ['userId', 'amount', 'operation', 'note'])
  return { userId: uuid(item.userId), amount: integer(item.amount, 1), operation: operation(item.operation), note: text(item.note, 200, 0) }
}
export function decodeBookCreate(value: unknown) {
  const item = record(value, ['title', 'operation'])
  return { title: text(item.title, 200), operation: operation(item.operation) }
}
export function decodePriceUpdate(value: unknown) {
  const item = record(value, ['expectedVersion', 'policy'])
  return { expectedVersion: integer(item.expectedVersion, 0, 1_000_000_000), policy: pricePolicy(item.policy) }
}
export function decodeUser(value: unknown): UserView {
  const item = record(value, ['id', 'username', 'name', 'role', 'disabled'])
  if (item.role !== 'admin' && item.role !== 'member') throw new ContractError()
  return { id: uuid(item.id), username: text(item.username, 100), name: text(item.name, 200), role: item.role, disabled: boolean(item.disabled) }
}
export function decodeWallet(value: unknown): WalletView {
  const item = record(value, ['balance', 'reserved', 'available'])
  const balance = integer(item.balance), reserved = integer(item.reserved, 0, balance)
  if (item.available !== balance - reserved) throw new ContractError()
  return { balance, reserved, available: balance - reserved }
}
export function decodeBook(value: unknown): BookView {
  const item = record(value, ['id', 'title', 'createdAt', 'updatedAt'])
  return { id: uuid(item.id), title: text(item.title, 200), createdAt: integer(item.createdAt, 0, Number.MAX_SAFE_INTEGER), updatedAt: integer(item.updatedAt, 0, Number.MAX_SAFE_INTEGER) }
}
export { decodeReferenceBook, type ReferenceBookView } from './reference.js'
