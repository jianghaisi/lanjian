import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { checkArchitecture } from './check-architecture.mjs'

async function check(t, files) {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-architecture-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  for (const [name, content] of Object.entries(files)) {
    const path = join(root, 'src', name)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, content)
  }
  return checkArchitecture(root)
}

test('rejects renderer Node access hidden behind a re-export and dynamic import', async t => {
  const result = await check(t, {
    'renderer/app.js': "export const load = () => import('../contracts/barrel.js')",
    'contracts/barrel.js': "export { read } from './reader.js'",
    'contracts/reader.js': "import { readFileSync as read } from 'node:fs'; export { read }",
  })
  assert.ok(result.violations.some(message => /renderer\/app.js.*contracts\/barrel.js.*contracts\/reader.js.*node:fs/.test(message)))
})

test('permits Electron in preload but rejects transitive Node in that sandbox', async t => {
  const result = await check(t, {
    'preload/index.ts': "import { contextBridge } from 'electron'; import '../contracts/reader'",
    'contracts/reader.ts': "const fs = require('fs')",
  })
  assert.ok(result.violations.some(message => /preload\/index.ts.*reader.ts.*fs/.test(message)))
  assert.ok(!result.violations.some(message => message.endsWith('-> electron')))
})

test('detects runtime cycles while allowing type-only recursion', async t => {
  const result = await check(t, {
    'contracts/a.ts': "export type { B } from './b'; export type A = string",
    'contracts/b.ts': "import type { A } from './a'; export type B = A",
    'main/a.ts': "export * from './b'",
    'main/b.ts': "export * from './a'",
  })
  assert.equal(result.violations.length, 1)
  assert.match(result.violations[0], /Runtime cycle: src\/main\/a.ts -> src\/main\/b.ts/)
})

test('rejects reverse domain dependencies, missing imports and computed loaders', async t => {
  const result = await check(t, {
    'main/modules/book/domain/rule.ts': "import '../runtime/ipc'; import './missing'; export const load = name => import(name)",
    'main/modules/book/runtime/ipc.ts': 'export {}',
  })
  assert.ok(result.violations.some(message => message.includes('domain imports outer implementation')))
  assert.ok(result.violations.some(message => message.includes('unresolved import ./missing')))
  assert.ok(result.violations.some(message => message.includes('computed module loading')))
})
