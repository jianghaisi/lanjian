import test from 'node:test'
import assert from 'node:assert/strict'
import { WindowsDpapiModelSecrets } from '../../../src/main/modules/models/adapters/windows-dpapi-model-secrets'

test('DPAPI adapter keeps process invocation bounded and returns decoded plaintext', () => {
  const calls: Array<{ args: string[]; input: string }> = []
  const secrets = new WindowsDpapiModelSecrets('powershell.exe', (_executable, args, input) => {
    calls.push({ args, input })
    return { status: 0, stdout: calls.length === 1 ? Buffer.from('cipher', 'utf8').toString('base64')
      : Buffer.from('synthetic-key', 'utf8').toString('base64') }
  }, () => true)

  const encrypted = secrets.encrypt('synthetic-key')
  assert.equal(encrypted, Buffer.from('cipher', 'utf8').toString('base64'))
  assert.equal(secrets.decrypt(encrypted), 'synthetic-key')
  assert.equal(calls.length, 2)
  assert.deepEqual(calls[0].args.slice(0, 3), ['-NoLogo', '-NoProfile', '-NonInteractive'])
  assert.equal(calls[0].input, Buffer.from('synthetic-key', 'utf8').toString('base64'))
  assert.equal(calls[1].input, encrypted)
})

test('DPAPI adapter fails closed on unavailable or malformed subprocess output', () => {
  const unavailable = new WindowsDpapiModelSecrets('missing.exe', () => ({ status: 0, stdout: 'ignored' }), () => false)
  assert.equal(unavailable.available(), false)
  assert.throws(() => unavailable.encrypt('synthetic-key'))

  const malformed = new WindowsDpapiModelSecrets('powershell.exe', () => ({ status: 0, stdout: 'not base64!' }), () => true)
  assert.throws(() => malformed.decrypt('Y2lwaGVy'))
})

test('Windows DPAPI roundtrip survives independent adapter instances', { skip: process.platform !== 'win32' }, () => {
  const encrypted = new WindowsDpapiModelSecrets().encrypt('lanjian-synthetic-restart-check')
  assert.equal(new WindowsDpapiModelSecrets().decrypt(encrypted), 'lanjian-synthetic-restart-check')
})
