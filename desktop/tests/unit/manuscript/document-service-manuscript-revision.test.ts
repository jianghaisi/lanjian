import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { ProjectService } from '../../../src/main/modules/library/application/project-service'
import { DocumentService } from '../../../src/main/modules/manuscript/application/document-service'

test('tracks chapter metadata and the order ledger without reading a persisted index', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-manuscript-revision-'))
  try {
    await mkdir(join(root, '正文'), { recursive: true })
    await mkdir(join(root, '.webnovel', 'manuscript'), { recursive: true })
    const chapterPath = join(root, '正文', '第1章-起笔.md')
    await writeFile(chapterPath, '第一版', 'utf8')
    const documents = new DocumentService({ currentPath: async () => root } as ProjectService)

    const initial = await documents.manuscriptRevision()
    await writeFile(chapterPath, '第二版内容更长', 'utf8')
    const contentChanged = await documents.manuscriptRevision()
    assert.notEqual(contentChanged, initial)

    await writeFile(join(root, '.webnovel', 'manuscript', 'chapter-order.json'), '{"version":1,"chapterIds":[1]}\n', 'utf8')
    const orderChanged = await documents.manuscriptRevision()
    assert.notEqual(orderChanged, contentChanged)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('fails closed when duplicate physical chapter ids appear in the revision scan', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-manuscript-duplicate-'))
  try {
    await mkdir(join(root, '正文'), { recursive: true })
    await writeFile(join(root, '正文', '第1章-甲.md'), '甲', 'utf8')
    await writeFile(join(root, '正文', '第1章-乙.md'), '乙', 'utf8')
    const documents = new DocumentService({ currentPath: async () => root } as ProjectService)
    await assert.rejects(documents.manuscriptRevision(), (error: { code?: string }) => error.code === 'INVALID_PROJECT_STATE')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('keeps a named snapshot in file compatibility mode without changing正文', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-named-file-revision-'))
  try {
    await mkdir(join(root, '正文'), { recursive: true })
    await writeFile(join(root, '正文', '第1章-起笔.md'), '雨停之前，沈砚没有回头。', 'utf8')
    const documents = new DocumentService({ currentPath: async () => root } as ProjectService)
    const before = await documents.chapter(1)
    const named = await documents.nameCurrentRevision(1, '雨夜段落定稿')
    assert.equal(named.label, '雨夜段落定稿')
    assert.equal(named.content, before.content)
    assert.equal((await documents.chapter(1)).revision, before.revision)
    assert.equal((await documents.revisions(1))[0]?.label, '雨夜段落定稿')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
