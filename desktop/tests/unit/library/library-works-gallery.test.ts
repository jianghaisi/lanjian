import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const galleryUrl = new URL('../../../src/renderer/features/library/components/LibraryWorksGallery.vue', import.meta.url)
const libraryUrl = new URL('../../../src/renderer/features/library/components/ProjectLibrary.vue', import.meta.url)

test('all works gallery opens the latest chapter without an expandable directory', async () => {
  const source = await readFile(galleryUrl, 'utf8')
  assert.match(source, /lastEditedChapter/)
  assert.match(source, /emit\('open-chapter', project, chapter\.id\)/)
  assert.match(source, /全部作品/)
  assert.match(source, /最近编辑/)
  assert.doesNotMatch(source, /LibraryProjectTree|library-project-expand|archive-work-item|归档作品/)
})

test('gallery background sits below its toolbar and uses logical geometry', async () => {
  const source = await readFile(galleryUrl, 'utf8')
  const toolbar = source.indexOf('all-works-toolbar')
  const surface = source.indexOf('all-works-surface')
  const watermark = source.indexOf('works-watermark')
  const body = source.indexOf('all-works-body')
  assert.ok(toolbar >= 0 && body > toolbar && watermark > body && surface > watermark)
  assert.match(source, /inset-inline-end/)
  assert.match(source, /inset-block-end/)
  assert.match(source, /inline-size/)
  assert.match(source, /block-size/)
})

test('project library has one all-works view and no archive preference state', async () => {
  const [source, gallery] = await Promise.all([readFile(libraryUrl, 'utf8'), readFile(galleryUrl, 'utf8')])
  assert.match(source, /LibraryWorksGallery/)
  assert.match(source, /allWorksExpanded\.value = true/)
  assert.match(source, /library-overview-panel/)
  assert.match(source, /:class="\{ expanded: allWorksExpanded \}"/)
  assert.match(gallery, /data-testid="library-all-works-back"/)
  assert.match(gallery, /emit\('back'\)/)
  assert.doesNotMatch(source, /companionReducedMotion/)
  assert.doesNotMatch(source, /最近的作品|useLibraryShelf|archivedCount|已归档/)
})
