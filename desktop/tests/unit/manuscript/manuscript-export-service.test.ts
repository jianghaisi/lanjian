import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { Chapter, ProjectSummary } from '../../../src/contracts/index'
import { buildManuscriptExport, ManuscriptExportService, safeExportFileName } from '../../../src/main/modules/manuscript/application/manuscript-export-service'

const chapter = (id: number, position: number, title: string, content: string): Chapter => ({
  id, position, title, content, word_count: content.length, summary: '', revision: `revision-${id}`
})

test('builds ordered TXT and Markdown reading copies without task or project metadata', () => {
  const chapters = [chapter(20, 2, '旧城回声', '第二章正文。'), chapter(10, 1, '雨夜来信', '第一章正文。\r\n下一段。')]
  assert.equal(buildManuscriptExport('雨城异闻', chapters, 'txt'), '雨城异闻\n\n第1章　雨夜来信\n\n第一章正文。\n下一段。\n\n第2章　旧城回声\n\n第二章正文。\n')
  assert.equal(buildManuscriptExport('雨城异闻', chapters, 'markdown'), '# 雨城异闻\n\n## 第1章　雨夜来信\n\n第一章正文。\n下一段。\n\n## 第2章　旧城回声\n\n第二章正文。\n')
  assert.equal(safeExportFileName(' 雨城：异闻？ '), '雨城_异闻_')
})

test('exports only the current ordered manuscript and refuses managed or unsupported targets', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-export-'))
  context.after(async () => rm(root, { recursive: true, force: true }))
  const workItemPath = join(root, 'work-item')
  const summary = { id: workItemPath, path: workItemPath, name: '雨城异闻', title: '雨城异闻', genre: '', updated_at: '', manuscript: { chapterCount: 2, fileCount: 2, wordCount: 12, status: 'ready' as const } } satisfies ProjectSummary
  const service = new ManuscriptExportService(
    { currentPath: async () => workItemPath, currentSummary: async () => summary },
    { chapters: async () => [chapter(2, 2, '回声', '后章。'), chapter(1, 1, '来信', '前章。')] }
  )
  const target = join(root, 'exports', '雨城异闻.md')
  await mkdir(join(root, 'exports'))
  const result = await service.export(target)
  assert.equal(result.format, 'markdown')
  assert.equal(result.chapterCount, 2)
  assert.match(await readFile(target, 'utf8'), /^# 雨城异闻\n\n## 第1章　来信/)
  await assert.rejects(service.export(join(workItemPath, '导出.txt')), (error: { code?: string }) => error.code === 'VALIDATION_ERROR')
  await assert.rejects(service.export(join(root, '导出.pdf')), (error: { code?: string }) => error.code === 'VALIDATION_ERROR')
})

test('does nothing after save-dialog cancellation and discards a cross-book export', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-export-race-'))
  context.after(async () => rm(root, { recursive: true, force: true }))
  const firstPath = join(root, 'first')
  const secondPath = join(root, 'second')
  const target = join(root, 'reading-copy.txt')
  let pathReads = 0
  let chapterReads = 0
  const summary = { id: firstPath, path: firstPath, name: '第一本', title: '第一本', genre: '', updated_at: '', manuscript: { chapterCount: 1, fileCount: 1, wordCount: 3, status: 'ready' as const } } satisfies ProjectSummary
  const service = new ManuscriptExportService(
    { currentPath: async () => pathReads++ === 0 ? firstPath : secondPath, currentSummary: async () => summary },
    { chapters: async () => { chapterReads += 1; return [chapter(1, 1, '开篇', '正文。')] } }
  )

  assert.equal(await service.exportSelected(undefined), null)
  assert.equal(pathReads, 0)
  assert.equal(chapterReads, 0)
  await assert.rejects(service.export(target), (error: { code?: string }) => error.code === 'CONFLICT')
  await assert.rejects(access(target))
})
