import test from 'node:test'
import assert from 'node:assert/strict'
import { fixture } from './helpers.ts'
import { usageCost } from '../src/credits/ledger.ts'

test('grant receipt binds payload and is atomic, bounded and durable', async t => {
  const f = fixture(t), user = await f.login(), admin = await f.login('42')
  const grant = { userId: user.me.user.id, amount: 1000, operation: 'grant_001', note: '活动赠送' }
  const results = await Promise.all(Array.from({ length: 10 }, () => f.app.inject({ method: 'POST', url: '/api/admin/credits', cookies: admin.cookies, headers: admin.headers, payload: grant })))
  assert.ok(results.every(r => r.statusCode === 200))
  assert.equal(new Set(results.map(r => r.json().receipt)).size, 1)
  assert.equal(f.credits.wallet(user.me.user.id).balance, 11000)
  assert.equal(f.credits.entries(user.me.user.id).filter(x => x.kind === 'grant').length, 1)
  assert.throws(() => f.credits.grant(admin.me.user.id, { ...grant, amount: 2000 }), /conflict/)
  for (const amount of [-100, 0.5, 1e15]) assert.throws(() => f.credits.grant(admin.me.user.id, { ...grant, operation: 'grant_002', amount }))
  assert.equal(f.credits.wallet(user.me.user.id).balance, 11000)
})
test('concurrent reservation attempts cannot spend more than available; duplicates never resend', async t => {
  const f = fixture(t), user = await f.login(), id = user.me.user.id
  assert.throws(() => f.credits.reserve(id, 'reserve_0', 'missing', 100, 1), /pricing-required/)
  f.credits.updatePrice('admin', 'model', { expectedVersion: 0, policy: { mode: 'request', points: 3000 } })
  const results = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => Promise.resolve().then(() => f.credits.reserve(id, `reserve_${i}`, 'model', 3000, 1))))
  const successes = results.filter(r => r.status === 'fulfilled')
  assert.equal(successes.length, 3)
  assert.deepEqual(f.credits.wallet(id), { balance: 10000, reserved: 9000, available: 1000 })
  const r = f.credits.reserve(id, 'reserve_0', 'model', 3000, 1)
  f.credits.markSent(r.id)
  assert.equal(f.credits.reserve(id, 'reserve_0', 'model', 3000, 1).status, 'sent')
  assert.throws(() => f.credits.markSent(r.id), /conflict/)
  assert.throws(() => f.credits.reserve(id, 'reserve_0', 'model', 2000, 1), /conflict/)
  assert.throws(() => f.credits.release(r.id), /conflict/)
  f.credits.settle(r.id, 3000); f.credits.settle(r.id, 3000)
  assert.throws(() => f.credits.settle(r.id, 2000), /conflict/)
  assert.deepEqual(f.credits.wallet(id), { balance: 7000, reserved: 6000, available: 1000 })
  assert.equal(f.credits.entries(id).filter(x => x.kind === 'settled').length, 1)
})
test('prices freeze at reservation, unknown results freeze funds until audited reconciliation', async t => {
  const f = fixture(t), user = await f.login(), id = user.me.user.id
  f.credits.updatePrice('admin', 'model', { expectedVersion: 0, policy: { mode: 'tokens', inputPerMillion: 1000, outputPerMillion: 3000 } })
  const r = f.credits.reserve(id, 'reserve_1', 'model', 1000, 1)
  f.credits.updatePrice('admin', 'model', { expectedVersion: 1, policy: { mode: 'request', points: 5000 } })
  assert.throws(() => f.credits.updatePrice('admin', 'model', { expectedVersion: 1, policy: { mode: 'unconfigured' } }), /conflict/)
  assert.equal(f.credits.price('model', r.priceVersion).policy.mode, 'tokens')
  f.credits.markSent(r.id); f.credits.markUnknown(r.id); f.credits.markUnknown(r.id)
  assert.throws(() => f.credits.release(r.id), /conflict/)
  assert.throws(() => f.credits.settle(r.id, 1001), /conflict/)
  assert.equal(f.credits.wallet(id).reserved, 1000)
  const receipt = f.credits.reconcile('admin', r.id, 500, 'resolve_1', '核对上游账单')
  assert.equal(receipt.status, 'settled')
  assert.deepEqual(f.credits.reconcile('admin', r.id, 500, 'resolve_1', '核对上游账单'), receipt)
  assert.throws(() => f.credits.reconcile('admin', r.id, 0, 'resolve_1', '核对上游账单'), /conflict/)
  assert.deepEqual(f.credits.wallet(id), { balance: 9500, reserved: 0, available: 9500 })
  assert.equal(f.db.all("SELECT * FROM audit WHERE action='reconcile'").length, 1)
})
test('token arithmetic uses bounded integers without floating-point overflow', () => {
  assert.equal(usageCost({ mode: 'tokens', inputPerMillion: 1000, outputPerMillion: 3000 }, 100, 200), 1)
  assert.equal(usageCost({ mode: 'tokens', inputPerMillion: 1_000_000_000, outputPerMillion: 1_000_000_000 }, 100_000_000, 100_000_000), 200_000_000_000)
  assert.throws(() => usageCost({ mode: 'unconfigured' }, 1, 1), /pricing-required/)
  assert.throws(() => usageCost({ mode: 'request', points: 1000 }, -1, 1))
})
