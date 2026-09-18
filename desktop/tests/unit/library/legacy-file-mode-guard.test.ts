import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { assertLegacyFileMode } from '../../../scripts/legacy-file-mode-guard.cjs'

// The private source snapshot deliberately omits the author's old batch tools.
// Keep their regression checks active in the author's complete local workspace.
// A partially missing tool set still fails instead of silently losing coverage.
const privateToolsOmitted = ['refresh-novel-outlines.ts', 'generate-prose-batch.cjs', 'probe-project-models.cjs']
  .every(name => !existsSync(resolve('scripts', name)))
const privateToolCheck = { skip: privateToolsOmitted ? 'Private author batch tools are not distributed' : false }

async function fixture(context: { after: (fn: () => Promise<void>) => void }, mode?: string) {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-legacy-guard-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, '.webnovel'))
  const file = join(root, '.webnovel', 'workspace.sqlite')
  if (mode) {
    const db = new DatabaseSync(file)
    db.exec('CREATE TABLE projects(storage_mode TEXT)')
    db.prepare('INSERT INTO projects VALUES (?)').run(mode)
    db.close()
  }
  return { root, file }
}

test('SQLite formal mode is refused without changing its database', async context => {
  const { root, file } = await fixture(context, 'sqlite')
  const before = await readFile(file)
  assert.throws(() => assertLegacyFileMode(root), /SQLite 正式数据/)
  assert.deepEqual(await readFile(file), before)
})

test('file and shadow modes require explicit offline acknowledgement and are never silently activated', async context => {
  const { root } = await fixture(context)
  const shadow = await fixture(context, 'shadow')
  const previous = process.env.LANJIAN_LEGACY_OFFLINE
  try {
    delete process.env.LANJIAN_LEGACY_OFFLINE
    assert.throws(() => assertLegacyFileMode(root), /LANJIAN_LEGACY_OFFLINE=1/)
    assert.throws(() => assertLegacyFileMode(shadow.root), /LANJIAN_LEGACY_OFFLINE=1/)
    process.env.LANJIAN_LEGACY_OFFLINE = '1'
    assert.doesNotThrow(() => assertLegacyFileMode(root))
    assert.doesNotThrow(() => assertLegacyFileMode(shadow.root))
    const db = new DatabaseSync(shadow.file)
    db.exec("UPDATE projects SET storage_mode='sqlite'")
    db.close()
    assert.throws(() => assertLegacyFileMode(shadow.root), /SQLite 正式数据/)
  } finally {
    if (previous === undefined) delete process.env.LANJIAN_LEGACY_OFFLINE
    else process.env.LANJIAN_LEGACY_OFFLINE = previous
  }
})

test('unknown or damaged databases fail closed and retain exact bytes', async context => {
  const { root, file } = await fixture(context, 'unknown')
  assert.throws(() => assertLegacyFileMode(root), /无法确认作品的数据模式/)
  await writeFile(file, 'not a database')
  assert.throws(() => assertLegacyFileMode(root), /无法确认作品的数据模式/)
  assert.equal(await readFile(file, 'utf8'), 'not a database')
})

test('metadata junction outside the explicit project is rejected before database access', async context => {
  const outer = await fixture(context, 'shadow')
  const root = await mkdtemp(join(tmpdir(), 'lanjian-legacy-link-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  await symlink(join(outer.root, '.webnovel'), join(root, '.webnovel'), 'junction')
  assert.throws(() => assertLegacyFileMode(root), /路径越界/)
})

test('actual outline maintenance command stops before touching a formal fixture and requires an explicit project', privateToolCheck, async context => {
  const { root, file } = await fixture(context, 'sqlite')
  const before = await readFile(file)
  const cli = resolve('node_modules/tsx/dist/cli.mjs')
  const script = resolve('scripts/refresh-novel-outlines.ts')
  const env = { ...process.env, LANJIAN_PROJECT_PATH: root, LANJIAN_LEGACY_OFFLINE: '1' }
  const result = spawnSync(process.execPath, [cli, script], { env, encoding: 'utf8', timeout: 15000 })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /SQLite 正式数据/)
  assert.deepEqual(await readFile(file), before)
  const missing = spawnSync(process.execPath, [cli, script], { env: { ...env, LANJIAN_PROJECT_PATH: '' }, encoding: 'utf8', timeout: 15000 })
  assert.notEqual(missing.status, 0)
  assert.match(missing.stderr, /请明确提供/)
})

test('legacy credential tools check authority before decrypting and prose rechecks before promotion', privateToolCheck, async () => {
  for (const name of ['generate-prose-batch.cjs', 'probe-project-models.cjs']) {
    const source = await readFile(resolve('scripts', name), 'utf8')
    const gate = source.indexOf('assertLegacyFileMode(projectPath)')
    assert.ok(gate > 0 && gate < source.indexOf('safeStorage.decryptString('))
  }
  const source = await readFile(resolve('scripts/generate-prose-batch.cjs'), 'utf8')
  assert.match(source, /assertLegacyFileMode\(projectPath\)\s+await rename\(temporary, target\)/)
})
