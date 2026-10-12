import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, symlink, rmdir, realpath, rm } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import test, { type TestContext } from 'node:test'
import { projectExistingPath, projectExistingPathSync, projectTargetPath, projectTargetPathSync } from '../../../src/main/platform/storage/project-path'

async function fixture(t: TestContext) {
  const base = await mkdtemp(join(await realpath(tmpdir()), 'lanjian-native-path-'))
  t.after(async () => {
    assert.equal(await realpath(base), base)
    await rm(base, { recursive: true, force: true })
  })
  const root = join(base, '作品 空间'), inside = join(root, '正文'), outside = join(base, '邻书')
  await Promise.all([mkdir(inside, { recursive: true }), mkdir(outside)])
  await Promise.all([writeFile(join(inside, '章节.md'), '本书正文'), writeFile(join(outside, '章节.md'), '邻书正文')])
  return { root, inside, outside }
}

test('sync containment preserves lexical paths and agrees with async checks for Unicode and missing parents', async t => {
  const { root, inside } = await fixture(t)
  const file = join(inside, '章节.md'), target = join(root, '未建立', '更深层', '新章.md')
  assert.equal(projectExistingPathSync(root, file), resolve(file))
  assert.equal(projectExistingPathSync(root, file), await projectExistingPath(root, file))
  assert.equal(projectTargetPathSync(root, target), resolve(target))
  assert.equal(projectTargetPathSync(root, target), await projectTargetPath(root, target))
  assert.throws(() => projectExistingPathSync(root, target), { code: 'ENOENT' })
  const canonical = realpathSync.native(root)
  // Windows temp paths may include a short user-directory alias. Resolution
  // may expand it, but callers still receive their original lexical target.
  assert.equal(projectExistingPathSync(canonical, join(canonical, '正文', '章节.md')), resolve(canonical, '正文', '章节.md'))
  const tempAliasRoot = join(tmpdir(), basename(dirname(root)), basename(root))
  assert.equal(projectExistingPathSync(tempAliasRoot, join(tempAliasRoot, '正文', '章节.md')), resolve(tempAliasRoot, '正文', '章节.md'))
})

test('sync containment rejects sibling paths before access', async t => {
  const { root, outside } = await fixture(t)
  for (const target of [join(outside, '章节.md'), join(root, '..', '邻书', '新章.md')]) {
    assert.throws(() => projectExistingPathSync(root, target), { code: 'PATH_ESCAPE' })
    assert.throws(() => projectTargetPathSync(root, target), { code: 'PATH_ESCAPE' })
  }
})

test('contained directory links work; external links and subsequent retargets fail closed', async t => {
  const { root, inside, outside } = await fixture(t)
  const link = join(root, '目录联接'), kind = process.platform === 'win32' ? 'junction' : 'dir'
  await symlink(inside, link, kind)
  assert.equal(projectExistingPathSync(root, join(link, '章节.md')), await projectExistingPath(root, join(link, '章节.md')))
  assert.equal(projectTargetPathSync(root, join(link, '新目录', '新章.md')), await projectTargetPath(root, join(link, '新目录', '新章.md')))
  // Remove only the junction/link, never its target, then change its destination.
  if (process.platform === 'win32') await rmdir(link)
  else await rm(link)
  await symlink(outside, link, kind)
  assert.throws(() => projectExistingPathSync(root, join(link, '章节.md')), { code: 'PATH_ESCAPE' })
  assert.throws(() => projectTargetPathSync(root, join(link, '新目录', '新章.md')), { code: 'PATH_ESCAPE' })
  await assert.rejects(projectExistingPath(root, join(link, '章节.md')), { code: 'PATH_ESCAPE' })
  await assert.rejects(projectTargetPath(root, join(link, '新目录', '新章.md')), { code: 'PATH_ESCAPE' })
})
