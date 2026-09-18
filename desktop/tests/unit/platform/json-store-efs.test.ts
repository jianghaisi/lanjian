import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { recoverableFileReplace } from '../../../src/main/platform/storage/recoverable-file-replace'
import { readJson } from '../../../src/main/platform/storage/json-store'

test('recoverable copy replacement preserves the previous JSON until verified', async context => {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-json-efs-'))
  context.after(async () => rm(root, { recursive: true, force: true }))
  const path = join(root, 'settings.json')
  const temporary = join(root, 'settings.next.tmp')
  const next = '{\n  "currentProject": "new"\n}\n'
  await writeFile(path, '{\n  "currentProject": "old"\n}\n')
  await writeFile(temporary, next)

  await recoverableFileReplace(temporary, path, Buffer.from(next))

  assert.equal(await readFile(path, 'utf8'), next)
  assert.deepEqual(await readdir(root), ['settings.json'])
})

test('JSON reads use the recovery copy when an interrupted target is invalid', async context => {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-json-recovery-'))
  context.after(async () => rm(root, { recursive: true, force: true }))
  const path = join(root, 'settings.json')
  await writeFile(path, '{')
  await writeFile(`${path}.recovery`, '{"currentProject":"preserved"}')

  assert.deepEqual(await readJson(path, { currentProject: null }), { currentProject: 'preserved' })
})

test('failed EFS-compatible replacement restores the previous JSON', async context => {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-json-restore-'))
  context.after(async () => rm(root, { recursive: true, force: true }))
  const path = join(root, 'settings.json')
  const temporary = join(root, 'settings.next.tmp')
  const previous = '{"currentProject":"old"}'
  await writeFile(path, previous)
  await writeFile(temporary, '{"currentProject":"new"}')

  await assert.rejects(recoverableFileReplace(temporary, path, Buffer.from('{"different":true}')), /verification failed/)

  assert.equal(await readFile(path, 'utf8'), previous)
})
