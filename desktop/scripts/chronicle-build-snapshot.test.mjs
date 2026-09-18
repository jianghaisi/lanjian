import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { withChronicleBuildSnapshot } from './chronicle-build-snapshot.mjs'

async function fixture(t) {
  const parent = await realpath(tmpdir())
  const root = await mkdtemp(join(parent, 'lanjian-snapshot-test-'))
  t.after(async () => {
    const target = await realpath(root)
    assert.equal(target, root)
    assert.equal(dirname(target), parent)
    assert.ok(basename(target).startsWith('lanjian-snapshot-test-'))
    await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })
  const source = join(root, 'source'), cache = join(root, 'cache')
  await mkdir(source); await mkdir(cache)
  await writeFile(join(source, 'main.cjs'), 'original build')
  await writeFile(join(cache, 'neighbor.txt'), 'keep neighboring evidence')
  return { root, source, cache }
}

test('success awaits the callback then removes only its snapshot', async t => {
  const { source, cache } = await fixture(t)
  const result = await withChronicleBuildSnapshot(source, cache, async snapshot => {
    await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal(await readFile(join(snapshot, 'out/main.cjs'), 'utf8'), 'original build')
    await writeFile(join(snapshot, 'out/main.cjs'), 'changed copy')
    return 'completed'
  })
  assert.equal(result, 'completed')
  assert.equal(await readFile(join(source, 'main.cjs'), 'utf8'), 'original build')
  assert.equal(await readFile(join(cache, 'neighbor.txt'), 'utf8'), 'keep neighboring evidence')
  assert.deepEqual(await readdir(cache), ['neighbor.txt'])
})

test('test or Electron setup failure is preserved and leaves no snapshot', async t => {
  const { source, cache } = await fixture(t)
  const failure = new Error('synthetic setup failure')
  await assert.rejects(withChronicleBuildSnapshot(source, cache, async () => { throw failure }), error => error === failure)
  assert.deepEqual(await readdir(cache), ['neighbor.txt'])
})

test('copy failure cleans the allocated snapshot without starting Electron', async t => {
  const { root, cache } = await fixture(t)
  await assert.rejects(withChronicleBuildSnapshot(join(root, 'missing-build'), cache, () => assert.fail('must not launch')), { code: 'ENOENT' })
  assert.deepEqual(await readdir(cache), ['neighbor.txt'])
})

test('junction replacement cannot redirect recursive cleanup outside the snapshot', async t => {
  const { root, source, cache } = await fixture(t)
  const outside = join(root, 'outside')
  await mkdir(outside); await writeFile(join(outside, 'evidence.txt'), 'must survive')
  await assert.rejects(withChronicleBuildSnapshot(source, cache, async snapshot => {
    await rename(snapshot, join(cache, 'saved-original'))
    await symlink(outside, snapshot, process.platform === 'win32' ? 'junction' : 'dir')
  }), /Unexpected chronicle snapshot path/)
  assert.equal(await readFile(join(outside, 'evidence.txt'), 'utf8'), 'must survive')
})

test('cleanup failure retains the original test failure as evidence', async t => {
  const { source, cache } = await fixture(t)
  const failure = new Error('original smoke failure')
  await assert.rejects(withChronicleBuildSnapshot(source, cache, async snapshot => {
    await rename(snapshot, join(cache, 'saved-original'))
    throw failure
  }), error => error instanceof AggregateError && error.errors[0] === failure && error.errors[1].code === 'ENOENT')
})
