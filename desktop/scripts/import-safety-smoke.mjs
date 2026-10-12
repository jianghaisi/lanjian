import assert from 'node:assert/strict'
import { mkdtemp, realpath, mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron } from 'playwright'

// Synthetic books only. Retain the small profile and evidence for inspection;
// never read the author's profile, model store, or recent-book list.
const root = await realpath(await mkdtemp(join(tmpdir(), 'lanjian-import-native-')))
const evidence = resolve('../.trellis/tasks/09-30-v3-manuscript-import-safety/evidence')
await mkdir(evidence, { recursive: true })
const inputPath = join(root, 'synthetic.txt')
const original = '第一章 安全追加\n这是隔离测试正文甲。\n\n第二章 不可覆盖\n这是隔离测试正文乙。'
await writeFile(inputPath, original)
const hash = value => createHash('sha256').update(value).digest('hex')
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('LANJIAN_') && !['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL'].includes(key)))
Object.assign(env, { LANJIAN_USER_DATA_PATH: join(root, 'profile'), LANJIAN_GLOBAL_MODEL_DATA_PATH: join(root, 'models'), LANJIAN_SMOKE_TXT_PATH: inputPath })
let app, page
const checks = [], errors = []
async function launch() {
  app = await _electron.launch({ args: [resolve(process.env.IMPORT_SAFETY_BUILD || 'out-import-safety', 'main/index.js')], env })
  page = await app.firstWindow(); page.setDefaultTimeout(30000)
  page.on('pageerror', error => errors.push(error.message))
  await page.waitForFunction(() => Boolean(window.novelDesktop))
  await page.evaluate(async () => {
    localStorage.setItem('lanjian-loading-v1', JSON.stringify({ theme: 'impact', bootStyle: 'brief', bootPalette: 'system' }))
    await window.companionSettings.update({ voice: { mute: true, textModel: false, preload: false } })
  })
}
async function enterLibrary() {
  await page.reload()
  const owner = await app.browserWindow(page)
  await owner.evaluate(win => { win.hide(); win.show(); win.focus() })
  await page.getByTestId('app-boot-enter').click()
  await page.getByTestId('app-boot').waitFor({ state: 'hidden' })
}
async function openBook(book) {
  await page.locator('[data-library-view="all"]').click()
  await page.locator('.work-item-open').filter({ hasText: book.title }).first().click()
  await page.waitForFunction(path => document.querySelector('[data-book-tab][aria-current="page"]')?.getAttribute('data-book-path') === path && !document.querySelector('main.app-frame')?.inert, book.path)
  await page.getByTestId('workspace-loading').waitFor({ state: 'hidden' })
  await page.getByTestId('chapter-transfer-toggle').waitFor()
}
async function openImport() {
  await page.getByTestId('chapter-transfer-toggle').click()
  await page.getByTestId('import-manuscript-in-book').click()
  const dialog = page.getByRole('dialog', { name: '导入文稿或资料' })
  await dialog.getByRole('button', { name: '追加到当前作品', exact: true }).click()
  await dialog.getByRole('button', { name: /导入所选/ }).click()
  return dialog
}
async function contents() {
  return page.evaluate(async () => {
    const api = window.novelDesktop, chapters = await api.chapters.list()
    return Promise.all(chapters.map(async chapter => { const saved = await api.chapters.get(chapter.id); return { id: saved.id, title: saved.title, content: saved.content } }))
  })
}
try {
  await launch()
  const books = await page.evaluate(async root => {
      const api = window.novelDesktop
    const a = (await api.projects.create({ parentPath: root, name: '导入安全甲', genre: '玄幻' })).project
    const existing = await api.chapters.create()
    await api.chapters.update(existing.id, { title: '原有章节', content: '原有正文必须逐字保留。', expectedRevision: existing.revision })
    const b = (await api.projects.create({ parentPath: root, name: '导入安全乙', genre: '玄幻' })).project
    return { a, b }
  }, root)
  await enterLibrary(); await openBook(books.a)
  const before = await contents()
  const dialog = await openImport(); await dialog.waitFor({ state: 'hidden' })
  const after = await contents()
  assert.equal(after.length, before.length + 2)
  assert.ok(after.some(chapter => chapter.content === '这是隔离测试正文甲。'))
  assert.ok(after.some(chapter => chapter.content === '这是隔离测试正文乙。'))
  for (const chapter of before) assert.deepEqual(after.find(item => item.id === chapter.id), chapter)
  const ledgerPath = join(books.a.path, '.webnovel/imports/index.json')
  const ledger = await readFile(ledgerPath)
  const record = JSON.parse(ledger).records[0]
  assert.equal(hash(await readFile(join(books.a.path, record.storagePath))), hash(Buffer.from(original)))
  checks.push({ name: 'native UI append preserves existing text and exact original source', chapterIds: after.map(c => c.id), ledgerSha256: hash(ledger), sourceSha256: record.sha256 })
  await page.screenshot({ path: join(evidence, 'import-success.png') })

  await openImport()
  await page.getByText('这份文件已经导入过，无需重复导入', { exact: true }).waitFor()
  assert.deepEqual(await contents(), after)
  assert.ok((await readFile(ledgerPath)).equals(ledger))
  await page.screenshot({ path: join(evidence, 'duplicate-rejected.png') })
  await page.getByRole('dialog', { name: '导入文稿或资料' }).getByRole('button', { name: '关闭', exact: true }).click()
  checks.push({ name: 'native visible duplicate rejection leaves chapter and ledger bytes unchanged' })

  const stale = await page.evaluate(async books => {
    const api = window.novelDesktop, preview = await api.imports.chooseText()
    await api.projects.switch(books.b.path)
    let message = ''
    try { await api.imports.commitText({ token: preview.token, ownership: 'owned', creationMethod: 'human', title: '错误目标', expectedWorkItemId: books.a.path }) }
    catch (error) { message = error.message }
    return { message, count: (await api.chapters.list()).length }
  }, books)
  assert.match(stale.message, /作品已切换/); assert.equal(stale.count, 0)
  checks.push({ name: 'real IPC rejects stale destination after switch', ...stale })

  await page.evaluate(path => window.novelDesktop.projects.switch(path), books.a.path)
  await app.close(); app = null
  await launch(); await enterLibrary(); await openBook(books.a)
  assert.deepEqual(await contents(), after)
  assert.ok((await readFile(ledgerPath)).equals(ledger))
  checks.push({ name: 'normal shutdown/relaunch preserves chapters and import ledger' })

  const broken = Buffer.from('{"version":1,"records":[')
  await writeFile(ledgerPath, broken)
  await openImport()
  await page.getByText(/导入记录无法读取，已停止写入/).waitFor()
  assert.deepEqual(await contents(), after)
  assert.ok((await readFile(ledgerPath)).equals(broken))
  await page.screenshot({ path: join(evidence, 'corrupt-ledger-rejected.png') })
  checks.push({ name: 'native visible corrupt-ledger rejection preserves exact damaged bytes and all text' })
  assert.equal(hash(await readFile(inputPath)), hash(Buffer.from(original)))
  // The global Vue handler also sees the intentionally rejected event promise;
  // distinguish the exact expected safe messages from unrelated page errors.
  const unexpected = errors.filter(message => !message.includes('这份文件已经导入过') && !message.includes('导入记录无法读取'))
  assert.deepEqual(unexpected, [])
  console.log(JSON.stringify({ root, checks, expectedErrors: errors }, null, 2))
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: join(evidence, 'failure.png') }).catch(() => {})
  throw error
} finally {
  if (app) await app.close()
  await writeFile(join(evidence, 'native-import-result.json'), JSON.stringify({ root, checks, errors }, null, 2))
}
