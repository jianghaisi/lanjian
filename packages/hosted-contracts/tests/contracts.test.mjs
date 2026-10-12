import test from 'node:test'
import assert from 'node:assert/strict'
import { ContractError, decodeGrant, decodeBookCreate, pricePolicy, decodeWallet, creditScale, defaultWelcomeCredits } from '../dist/index.js'

test('strict fields, integer money and conservation', () => {
  const grant = { userId: '650aebdd-ecce-4b12-9512-859b817fca5c', amount: 10, operation: 'receipt_123', note: '赠送' }
  assert.equal(decodeGrant(grant).amount, 10)
  for (const amount of [-1, 0, 0.01, NaN, Infinity, 1e15, '10']) assert.throws(() => decodeGrant({ ...grant, amount }), ContractError)
  assert.throws(() => decodeGrant({ ...grant, role: 'admin' }), ContractError)
  assert.throws(() => decodeBookCreate({ title: '作品', operation: 'receipt_123', ownerId: grant.userId }), ContractError)
  assert.throws(() => decodeWallet({ balance: 10, reserved: 11, available: -1 }), ContractError)
  assert.throws(() => decodeWallet({ balance: 10, reserved: 2, available: 10 }), ContractError)
  assert.throws(() => pricePolicy({ mode: 'tokens', inputPerMillion: 0.1, outputPerMillion: 1 }), ContractError)
  assert.throws(() => pricePolicy({ mode: 'request', points: 1, key: 'secret' }), ContractError)
  assert.equal(defaultWelcomeCredits / creditScale, 10)
})
