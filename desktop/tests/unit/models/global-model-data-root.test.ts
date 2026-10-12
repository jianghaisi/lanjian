import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  GLOBAL_MODEL_DATA_DIRECTORY,
  GLOBAL_MODEL_MIGRATION_RECEIPT,
  initializeGlobalModelDataRoot,
  resolveGlobalModelDataRoot
} from '../../../src/main/modules/models/adapters/global-model-data-root'
import { GLOBAL_CONNECTIONS_FILE } from '../../../src/main/modules/models/adapters/model-connections-store'
import { decodeGlobalConnectionDocument, type ModelConnectionSecrets } from '../../../src/main/modules/models/domain/model-connections'

async function fixture(t: TestContext) {
  const root = await realpath(await mkdtemp(join(await realpath(tmpdir()), 'lanjian-global-root-')))
  const legacy = join(root, 'legacy')
  const target = join(root, 'stable')
  await mkdir(legacy)
  t.after(async () => { await rm(root, { recursive: true, force: true }) })
  return { root, legacy, target }
}

function codec(prefix: string, failDecrypt = false): ModelConnectionSecrets {
  return {
    available: () => true,
    encrypt: value => Buffer.from(`${prefix}|${value}`, 'utf8').toString('base64'),
    decrypt: value => {
      if (failDecrypt) throw Error('synthetic-decrypt-failure')
      const decoded = Buffer.from(value, 'base64').toString('utf8')
      if (!decoded.startsWith(`${prefix}|`)) throw Error('wrong synthetic envelope')
      return decoded.slice(prefix.length + 1)
    }
  }
}

function document(encryptedApiKey: string) {
  return {
    version: 1,
    revision: 1,
    connections: [{
      id: 'global-shared',
      name: 'Gemini 原生',
      protocol: 'gemini-native',
      baseUrl: 'https://provider.example.test/v1',
      enabled: true,
      revision: 1,
      encryptedApiKey
    }]
  }
}

test('production root is app-level and independent of profile roots', () => {
  const appData = join(process.platform === 'win32' ? 'C:\\Users\\fixture\\AppData\\Roaming' : '/tmp', 'app-data')
  const first = resolveGlobalModelDataRoot({ appData })
  const second = resolveGlobalModelDataRoot({ appData })
  assert.equal(first, second)
  assert.equal(first, join(appData, GLOBAL_MODEL_DATA_DIRECTORY))
  const isolated = join(appData, 'isolated-global')
  assert.equal(resolveGlobalModelDataRoot({ appData, isolatedRoot: isolated }), isolated)
})

test('migrates one legacy profile by decrypting and re-encrypting while preserving source bytes and ids', async t => {
  const f = await fixture(t)
  const sourceCodec = codec('source')
  const targetCodec = codec('target')
  const source = `${JSON.stringify(document(sourceCodec.encrypt('synthetic-key')), null, 2)}\n`
  await writeFile(join(f.legacy, GLOBAL_CONNECTIONS_FILE), source)
  const result = await initializeGlobalModelDataRoot({
    targetRoot: f.target,
    legacyRoot: f.legacy,
    secrets: sourceCodec,
    targetSecrets: targetCodec
  })
  assert.equal(result.status, 'migrated')
  assert.equal(await readFile(join(f.legacy, GLOBAL_CONNECTIONS_FILE), 'utf8'), source)
  const migrated = decodeGlobalConnectionDocument(JSON.parse(await readFile(join(f.target, GLOBAL_CONNECTIONS_FILE), 'utf8')))
  assert.equal(migrated.connections[0].id, 'global-shared')
  assert.equal(targetCodec.decrypt(migrated.connections[0].encryptedApiKey!), 'synthetic-key')
  assert.notEqual(migrated.connections[0].encryptedApiKey, JSON.parse(source).connections[0].encryptedApiKey)
  const receipt = JSON.parse(await readFile(join(f.target, GLOBAL_MODEL_MIGRATION_RECEIPT), 'utf8'))
  assert.equal(receipt.status, 'migrated')
  assert.deepEqual(receipt.recoveryConnectionIds, [])
  assert.doesNotMatch(JSON.stringify(receipt), /synthetic-key|provider\.example/)
})

test('an unreadable legacy credential preserves metadata and aliases but requires one global recovery save', async t => {
  const f = await fixture(t)
  const source = `${JSON.stringify(document(codec('source').encrypt('synthetic-key')), null, 2)}\n`
  await writeFile(join(f.legacy, GLOBAL_CONNECTIONS_FILE), source)
  const result = await initializeGlobalModelDataRoot({ targetRoot: f.target, legacyRoot: f.legacy, secrets: codec('target', true) })
  assert.equal(result.status, 'recovery-required')
  assert.deepEqual(result.recoveryConnectionIds, ['global-shared'])
  const migrated = decodeGlobalConnectionDocument(JSON.parse(await readFile(join(f.target, GLOBAL_CONNECTIONS_FILE), 'utf8')))
  assert.equal(migrated.connections[0].id, 'global-shared')
  assert.equal(migrated.connections[0].encryptedApiKey, undefined)
  assert.equal(await readFile(join(f.legacy, GLOBAL_CONNECTIONS_FILE), 'utf8'), source)
  assert.doesNotMatch(await readFile(join(f.target, GLOBAL_CONNECTIONS_FILE), 'utf8'), /synthetic-key/)
})

test('an existing stable authority wins and the legacy profile is not merged', async t => {
  const f = await fixture(t)
  await mkdir(f.target)
  const stable = `${JSON.stringify({ version: 1, revision: 0, connections: [] }, null, 2)}\n`
  await writeFile(join(f.target, GLOBAL_CONNECTIONS_FILE), stable)
  await writeFile(join(f.legacy, GLOBAL_CONNECTIONS_FILE), `${JSON.stringify(document(codec('legacy').encrypt('synthetic-key')))}\n`)
  const result = await initializeGlobalModelDataRoot({ targetRoot: f.target, legacyRoot: f.legacy, secrets: codec('target') })
  assert.equal(result.status, 'ready')
  assert.equal(await readFile(join(f.target, GLOBAL_CONNECTIONS_FILE), 'utf8'), stable)
})

test('temporary encryption unavailability stops migration without publishing a target', async t => {
  const f = await fixture(t)
  const source = `${JSON.stringify(document(codec('source').encrypt('synthetic-key')), null, 2)}\n`
  await writeFile(join(f.legacy, GLOBAL_CONNECTIONS_FILE), source)
  await assert.rejects(
    initializeGlobalModelDataRoot({
      targetRoot: f.target,
      legacyRoot: f.legacy,
      secrets: { available: () => false, encrypt: () => { throw Error('must-not-encrypt') }, decrypt: () => { throw Error('must-not-decrypt') } }
    }),
    { code: 'STORAGE_ERROR' }
  )
  await assert.rejects(readFile(join(f.target, GLOBAL_CONNECTIONS_FILE)), { code: 'ENOENT' })
  assert.equal(await readFile(join(f.legacy, GLOBAL_CONNECTIONS_FILE), 'utf8'), source)
})

test('a nonempty uninitialized target is never treated as a migration destination', async t => {
  const f = await fixture(t)
  await mkdir(f.target)
  await writeFile(join(f.target, 'foreign.txt'), 'preserve me')
  await writeFile(join(f.legacy, GLOBAL_CONNECTIONS_FILE), `${JSON.stringify(document(codec('source').encrypt('synthetic-key')))}\n`)
  await assert.rejects(
    initializeGlobalModelDataRoot({ targetRoot: f.target, legacyRoot: f.legacy, secrets: codec('source') }),
    { code: 'STORAGE_ERROR' }
  )
  assert.equal(await readFile(join(f.target, 'foreign.txt'), 'utf8'), 'preserve me')
  await assert.rejects(readFile(join(f.target, GLOBAL_CONNECTIONS_FILE)), { code: 'ENOENT' })
})
