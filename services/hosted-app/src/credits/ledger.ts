import { randomUUID } from 'node:crypto'
import { decodeGrant, decodePriceUpdate, decodeWallet, integer, maxCredits, modelId, operation, pricePolicy, uuid,
  type LedgerView, type PricePolicy, type PriceView, type WalletView } from '@lanjian/hosted-contracts'
import { HostedDatabase, dbNumber, dbString } from '../storage/database.ts'
import { fail } from '../http/errors.ts'
import { providerUsageBudget, providerUsageCost } from './provider-cost.ts'
import type { ModelUsage } from '../models/usage.ts'

export type Reservation = { id: string; userId: string; modelId: string; priceVersion: number; amount: number; status: string; charged: number | null }
export function usageCost(policy: PricePolicy, input: number, output: number, details?: ModelUsage): number {
  integer(input, 0, 100_000_000); integer(output, 0, 100_000_000)
  if (policy.mode === 'unconfigured') fail('pricing-required')
  if (policy.mode === 'request') return policy.points
  if (policy.mode === 'provider-tokens') return providerUsageCost(policy, { ...details, input, output })
  const amount = (BigInt(input) * BigInt(policy.inputPerMillion) + BigInt(output) * BigInt(policy.outputPerMillion) + 999999n) / 1000000n
  if (amount > BigInt(maxCredits)) fail('invalid-request')
  return Number(amount)
}
export function usageBudget(policy: PricePolicy, input: number, output: number): number {
  return policy.mode === 'provider-tokens' ? providerUsageBudget(policy, input, output) : usageCost(policy, input, output)
}
export class CreditLedger {
  constructor(readonly db: HostedDatabase) {}
  wallet(userId: string): WalletView {
    const row = this.db.get('SELECT balance,reserved FROM wallets WHERE user_id=?', userId)
    if (!row) fail('not-found')
    const balance = dbNumber(row.balance), reserved = dbNumber(row.reserved)
    return decodeWallet({ balance, reserved, available: balance - reserved })
  }
  entries(userId: string): LedgerView[] {
    return this.db.all('SELECT * FROM ledger WHERE user_id=? ORDER BY created_at DESC,rowid DESC LIMIT 100', userId).map(row => ({
      id: dbString(row.id), kind: dbString(row.kind), amount: dbNumber(row.amount), note: dbString(row.note), createdAt: dbNumber(row.created_at)
    }))
  }
  grant(actor: string, input: unknown): { receipt: string; amount: number } {
    const payload = decodeGrant(input)
    return this.db.operation('credit-grant', payload.operation, { actor, userId: payload.userId, amount: payload.amount, note: payload.note }, () => {
      const wallet = this.wallet(payload.userId)
      if (wallet.balance > maxCredits - payload.amount) fail('invalid-request')
      const receipt = randomUUID()
      this.db.run('UPDATE wallets SET balance=balance+? WHERE user_id=?', payload.amount, payload.userId)
      this.db.run('INSERT INTO ledger VALUES(?,?,?,?,?,?,?)', receipt, payload.userId, 'grant', payload.amount, payload.note, actor, this.db.now())
      this.db.audit(actor, 'credit-grant', payload.userId, { receipt, amount: payload.amount })
      return { receipt, amount: payload.amount }
    })
  }
  price(id: string, version?: number): PriceView {
    modelId(id)
    const row = version === undefined
      ? this.db.get('SELECT * FROM prices WHERE model_id=? ORDER BY version DESC LIMIT 1', id)
      : this.db.get('SELECT * FROM prices WHERE model_id=? AND version=?', id, integer(version, 1, 1_000_000_000))
    if (!row) return { modelId: id, version: 0, policy: { mode: 'unconfigured' } }
    return { modelId: id, version: dbNumber(row.version), policy: pricePolicy(JSON.parse(dbString(row.policy))) }
  }
  updatePrice(actor: string, id: string, input: unknown): PriceView {
    const payload = decodePriceUpdate(input); modelId(id)
    return this.db.transaction(() => {
      const current = this.price(id)
      if (current.version !== payload.expectedVersion) fail('conflict')
      const next = { modelId: id, version: current.version + 1, policy: payload.policy }
      this.db.run('INSERT INTO prices VALUES(?,?,?,?)', id, next.version, JSON.stringify(next.policy), this.db.now())
      this.db.audit(actor, 'price-update', id, { version: next.version, policy: next.policy })
      return next
    })
  }
  reserve(userId: string, key: string, id: string, amount: number, expectedPriceVersion: number): Reservation {
    uuid(userId); operation(key); modelId(id); integer(amount); integer(expectedPriceVersion, 1, 1_000_000_000)
    const receipt = this.db.operation(`reserve:${userId}`, key, { id, amount, expectedPriceVersion }, () => {
      const user = this.db.get('SELECT disabled FROM users WHERE id=?', userId)
      if (!user) fail('not-found')
      if (user.disabled) fail('account-disabled')
      const price = this.price(id)
      if (price.policy.mode === 'unconfigured') fail('pricing-required')
      if (price.version !== expectedPriceVersion || (price.policy.mode === 'request' && amount !== price.policy.points)) fail('conflict')
      if (this.wallet(userId).available < amount) fail('insufficient-credits')
      const reservation = randomUUID(), now = this.db.now()
      this.db.run('UPDATE wallets SET reserved=reserved+? WHERE user_id=?', amount, userId)
      this.db.run('INSERT INTO reservations VALUES(?,?,?,?,?,?,NULL,?,?)', reservation, userId, id, price.version, amount, 'reserved', now, now)
      return { id: reservation }
    })
    return this.get(receipt.id)
  }
  get(id: string): Reservation {
    const row = this.db.get('SELECT * FROM reservations WHERE id=?', uuid(id))
    if (!row) fail('not-found')
    return { id, userId: dbString(row.user_id), modelId: dbString(row.model_id), priceVersion: dbNumber(row.price_version),
      amount: dbNumber(row.amount), status: dbString(row.status), charged: row.charged === null ? null : dbNumber(row.charged) }
  }
  pending(userId?: string): Reservation[] {
    const rows = userId
      ? this.db.all("SELECT id FROM reservations WHERE user_id=? AND status IN ('reserved','sent','unknown') ORDER BY created_at DESC LIMIT 100", userId)
      : this.db.all("SELECT id FROM reservations WHERE status IN ('reserved','sent','unknown') ORDER BY created_at DESC LIMIT 500")
    return rows.map(row => this.get(dbString(row.id)))
  }
  markSent(id: string): void {
    this.db.transaction(() => {
      const r = this.get(id)
      if (r.status !== 'reserved') fail('conflict')
      this.db.run("UPDATE reservations SET status='sent',updated_at=? WHERE id=?", this.db.now(), id)
    })
  }
  markUnknown(id: string): void {
    this.db.transaction(() => {
      const r = this.get(id)
      if (r.status === 'unknown') return
      if (r.status !== 'sent') fail('conflict')
      this.db.run("UPDATE reservations SET status='unknown',updated_at=? WHERE id=?", this.db.now(), id)
    })
  }
  settle(id: string, amount: number): Reservation {
    integer(amount)
    return this.db.transaction(() => this.finish(id, amount, 'settled', 'system'))
  }
  release(id: string): Reservation {
    return this.db.transaction(() => {
      const r = this.get(id)
      if (r.status !== 'reserved' && r.status !== 'released') fail('conflict')
      return this.finish(id, 0, 'released', 'system')
    })
  }
  reconcile(actor: string, id: string, amount: number, key: string, note: string): Reservation {
    integer(amount); operation(key)
    return this.db.operation('reconcile', key, { actor, id, amount, note }, () => {
      if (this.get(id).status !== 'unknown') fail('conflict')
      const result = this.finish(id, amount, 'settled', actor)
      this.db.audit(actor, 'reconcile', id, { amount, note })
      return result
    })
  }
  private finish(id: string, amount: number, status: 'settled' | 'released', actor: string): Reservation {
    const r = this.get(id)
    if (r.status === 'settled' || r.status === 'released') {
      if (r.status !== status || r.charged !== amount) fail('conflict')
      return r
    }
    if (status === 'settled' && !['sent', 'unknown'].includes(r.status)) fail('conflict')
    if (amount > r.amount) fail('conflict')
    this.db.run('UPDATE wallets SET balance=balance-?,reserved=reserved-? WHERE user_id=?', amount, r.amount, r.userId)
    this.db.run('UPDATE reservations SET status=?,charged=?,updated_at=? WHERE id=?', status, amount, this.db.now(), id)
    this.db.run('INSERT INTO ledger VALUES(?,?,?,?,?,?,?)', randomUUID(), r.userId, status, -amount, status === 'released' ? '未发送请求，解除预占' : '模型调用结算', actor, this.db.now())
    return this.get(id)
  }
  recoverAfterRestart(): void {
    this.db.transaction(() => {
      // Only the process owning the single-instance database calls this at startup.
      this.db.run("UPDATE reservations SET status='unknown',updated_at=? WHERE status='sent'", this.db.now())
      for (const row of this.db.all("SELECT id FROM reservations WHERE status='reserved'")) this.finish(dbString(row.id), 0, 'released', 'system')
    })
  }
}
