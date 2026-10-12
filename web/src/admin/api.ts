import { boolean, decodeUser, decodeWallet, integer, modelId, pricePolicy, record, siteSettings, text, uuid, type PriceView, type SiteSettings } from '@lanjian/hosted-contracts'
import { http } from '../api/http'
export const list = <T>(v: unknown, parse: (v: unknown) => T): T[] => { if (!Array.isArray(v)) throw new Error('服务响应格式不正确'); return v.map(parse) }
export function units(value: string): number {
  if (!/^\d+(?:\.\d{1,3})?$/.test(value)) throw new Error('积分须为非负数，最多保留三位小数。')
  const [whole, decimal = ''] = value.split('.')
  return integer(Number(whole) * 1000 + Number(decimal.padEnd(3, '0')))
}
const operations = new Map<string, string>()
export function receiptKey(value: unknown) {
  const key = JSON.stringify(value), existing = operations.get(key)
  if (existing) return existing
  const id = crypto.randomUUID(); operations.set(key, id); return id
}
export function user(v: unknown) { const p = record(v), { wallet, subject, ...identity } = p; return { ...decodeUser(identity), subject: text(subject, 30), wallet: decodeWallet(wallet) } }
export type AdminUser = ReturnType<typeof user>
export function model(v: unknown) {
  const p = record(v)
  if (p.protocol !== 'openai-compatible' && p.protocol !== 'gemini-native') throw new Error('未知接口协议')
  return { id: modelId(p.id), name: text(p.name, 80), protocol: p.protocol, baseUrl: text(p.baseUrl, 1000), model: text(p.model, 150), enabled: boolean(p.enabled), maxInputTokens: integer(p.maxInputTokens), maxOutputTokens: integer(p.maxOutputTokens), revision: integer(p.revision), keyConfigured: boolean(p.keyConfigured) }
}
export type AdminModel = ReturnType<typeof model>
export function price(v: unknown): PriceView { const p = record(v); return { modelId: modelId(p.modelId), version: integer(p.version), policy: pricePolicy(p.policy) } }
export function reservation(v: unknown) {
  const p = record(v); return { id: uuid(p.id), userId: uuid(p.userId), modelId: modelId(p.modelId), amount: integer(p.amount), status: text(p.status, 30), priceVersion: integer(p.priceVersion) }
}
export type Reservation = ReturnType<typeof reservation>
export async function getUsers() { return list(record(await http.request('/api/admin/users')).users, user) }
export async function getModels() { return list(record(await http.request('/api/admin/models')).models, model) }
export async function getSite(): Promise<SiteSettings> { return siteSettings(await http.request('/api/admin/site')) }
