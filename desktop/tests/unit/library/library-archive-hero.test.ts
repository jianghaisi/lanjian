import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { parse, compileScript } from '@vue/compiler-sfc'
import { transformWithEsbuild } from 'vite'
import * as Vue from 'vue'
import { dossierArrivalKey } from '../../../src/renderer/features/library/composables/dossier-arrival'
import * as Icons from '@lucide/vue'
import { renderToString } from '@vue/server-renderer'
import type { ProjectSummary } from '../../../src/contracts/index'

async function render(props: Record<string, unknown>) {
  const source = await readFile(new URL('../../../src/renderer/features/library/components/LibraryArchiveHero.vue', import.meta.url), 'utf8')
  const { descriptor } = parse(source)
  const code = compileScript(descriptor, { id: 'approved-library-hero', inlineTemplate: true }).content
    .replace(/import\s*\{([^}]+)\}\s*from\s*['"]vue['"];?/g, (_, names: string) => `const { ${names.replace(/\s+as\s+/g, ': ')} } = Vue;`)
    .replace(/import\s*\{([^}]+)\}\s*from\s*['"]@lucide\/vue['"];?/g, (_, names: string) => `const { ${names} } = Icons;`)
    .replace(/import\s*\{\s*dossierArrivalKey\s*\}\s*from\s*['"][^'"]+['"];?/, '')
    .replace(/import LibraryBookCover from ['"][^'"]+['"];?/, `const LibraryBookCover = { props: ['title'], render() { return Vue.h('span', { 'data-testid': 'cover' }, this.title) } };`)
  const compiled = await transformWithEsbuild(code, 'approved-library-hero.ts', { loader: 'ts' })
  const component = new Function('Vue', 'Icons', 'dossierArrivalKey', compiled.code.replace('export default', 'return'))(Vue, Icons, dossierArrivalKey)
  return renderToString(Vue.createSSRApp(component, props))
}

const project: ProjectSummary = { id: 'fixture', path: 'E:/fixture/book', name: 'fixture', title: '我的<小说>', genre: '都市', updated_at: '2026-09-08T09:00:00.000Z', manuscript: { chapterCount: 17, fileCount: 17, wordCount: 4278, status: 'ready' } }

test('approved library hero projects real book data without mock progress or cloud status', async () => {
  const html = await render({ project, projectCount: 6, loading: false })
  assert.match(html, /我的&lt;小说&gt;/)
  assert.match(html, /4,278 字/)
  assert.match(html, /已有 17 章正文/)
  assert.match(html, /已写章节/)
  assert.match(html, /LOCAL MANUSCRIPT INDEX/)
  assert.match(html, /索引完整/)
  assert.match(html, />100%?</)
  assert.match(html, /data-testid="library-continue-writing"/)
  assert.match(html, /dossier-aging/)
  assert.match(html, /dossier-creases/)
  assert.match(html, /dossier-dot-field/)
  assert.match(html, /dossier-scratches/)
  assert.match(html, /dossier-click-fx/)
  assert.match(html, /dossier-tech-lines/)
  assert.match(html, /dossier-bolt bolt-1/)
  assert.match(html, /dossier-corner corner-start/)
  assert.match(html, /data-testid="create-work-item"/)
  assert.match(html, /新建空白作品/)
  assert.match(html, /data-testid="library-import-project"/)
  assert.match(html, /导入作品/)
  assert.doesNotMatch(html, /data-testid="create-from-txt"/)
  assert.match(html, /data-testid="library-open-trash"/)
  assert.match(html, /data-testid="library-all-works"/)
  assert.match(html, /全部作品/)
  assert.match(html, />06</)
  assert.doesNotMatch(html, /archive-import-choices|aria-expanded=|打开已有岚笺作品|从文稿创建作品/)
  assert.doesNotMatch(html, /已归档|ARCHIVED|63%|1,240|今日新增|云同步|写作进度|<小说>/)
})

test('continue-writing dossier keeps the supplied terminal texture and plays its feedback on hover', async () => {
  const source = await readFile(new URL('../../../src/renderer/features/library/components/LibraryArchiveHero.vue', import.meta.url), 'utf8')
  assert.match(source, /@keyframes dossier-hit/)
  assert.match(source, /@keyframes dossier-scan/)
  assert.match(source, /@keyframes dossier-lock/)
  assert.match(source, /@pointerenter="previewOpen\(\); emit\('continue-intent',true\)"/)
  assert.match(source, /@focus="previewOpen\(\); emit\('continue-intent',true\)"/)
  assert.match(source, /@pointerleave="emit\('continue-intent',false\)"/)
  assert.match(source, /@blur="emit\('continue-intent',false\)"/)
  assert.match(source, /@click="emit\('open', project\)"/)
  assert.match(source, /setTimeout\(\(\) => \{ previewingProject\.value = false \}, 650\)/)
  assert.match(source, /prefers-reduced-motion:reduce/)
})

test('continue-writing reuses the titled book cover instead of a background illustration', async () => {
  const [hero, cover] = await Promise.all([
    readFile(new URL('../../../src/renderer/features/library/components/LibraryArchiveHero.vue', import.meta.url), 'utf8'),
    readFile(new URL('../../../src/renderer/features/library/components/LibraryBookCover.vue', import.meta.url), 'utf8')
  ])
  assert.match(hero, /<LibraryBookCover :title="project\.title" \/>/)
  assert.doesNotMatch(hero, /\shero(?:\s|\/|>)/)
  assert.match(cover, /lanjian-quartet-workbench-v2\.png/)
  assert.doesNotMatch(cover, /cover-eclipse-tower|hero \?/)
})

test('empty and loading shelves keep creation available without claiming a recent work', async () => {
  const empty = await render({ projectCount: 0, loading: false })
  assert.match(empty, /每一个世界，始于一页/)
  assert.match(empty, /data-testid="create-work-item"/)
  assert.doesNotMatch(empty, /data-testid="library-continue-writing"/)
  const loading = await render({ projectCount: 0, loading: true })
  assert.match(loading, /正在整理作品档案/)
  assert.doesNotMatch(loading, /可继续写作/)
})

test('unknown word counts remain unknown rather than claiming zero', async () => {
  const html = await render({ project: { ...project, manuscript: { ...project.manuscript, wordCount: null } }, projectCount: 1, loading: false })
  assert.match(html, /打开后查看/)
  assert.doesNotMatch(html, />0 字</)
})

test('different continuation titles keep their own metadata and full-text hints with the same four actions', async () => {
  for (const [title, wordCount, chapterCount] of [
    ['星城少年们的日常录', 591789, 440],
    ['三千盏星灯，他们都叫我主公', 52561, 17],
    ['超长书名'.repeat(20), null, 0],
  ] as const) {
    const chapter = '这是一条需要完整提示而不能挤出卡片的章节标题'.repeat(5)
    const html = await render({ project: { ...project, title, manuscript: {
      ...project.manuscript, wordCount, chapterCount,
      lastEditedChapter: { id: 1, title: chapter, position: 1 },
    } }, projectCount: 5, loading: false })
    assert.ok(html.includes(`<h2 title="${title}"`))
    assert.ok(html.includes(`title="${chapter}"`))
    assert.ok(html.includes(wordCount === null ? '打开后查看' : `${wordCount.toLocaleString('zh-CN')} 字`))
    assert.ok(html.includes(`${chapterCount} 章`))
    assert.equal((html.match(/class="archive-action /g) || []).length, 4)
    assert.match(html, /dossier-progress/)
  }
})

test('manuscript import is explicitly bound inside the open-book writing flow, never the library', async () => {
  const source = await readFile(new URL('../../../src/renderer/app/components/WorkspaceExplorer.vue', import.meta.url), 'utf8')
  const entrance = source.match(/<button\b[^>]*data-testid="import-manuscript-in-book"[^>]*>/)?.[0] || ''
  assert.match(source, /v-if="active === 'desk' && !chapterTrashOpen"[\s\S]*?class="chapter-explorer-tools"[\s\S]*?popover="auto"[\s\S]*?data-testid="import-manuscript-in-book"/)
  assert.match(entrance, /:disabled="busy"/)
  assert.match(entrance, /@click="transfer\('inside-work-item'\)"/)
  assert.match(source, /data-testid="continue-manuscript-files"[^>]*@click="transfer\('create-from-files'\)"/)
  assert.doesNotMatch(source, /@import-files=/)
})


test('cinematic dossier uses the same truthful face without duplicating library actions', async () => {
  const html = await render({ project, projectCount: 6, loading: false, dossierOnly: true })
  assert.match(html, /我的&lt;小说&gt;/)
  assert.match(html, /4,278 字/)
  assert.match(html, /data-testid="boot-dossier"/)
  assert.doesNotMatch(html, /data-testid="library-all-works"|data-testid="create-work-item"|data-testid="library-continue-writing"/)
})
