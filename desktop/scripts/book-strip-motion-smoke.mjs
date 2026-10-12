import assert from 'node:assert/strict'
import { mkdtemp, mkdir, realpath, writeFile, readFile, readdir, copyFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { _electron } from 'playwright'

const root = await realpath(await mkdtemp(join(tmpdir(), 'lanjian-book-strip-')))
const output = resolve(process.env.BOOK_STRIP_OUTPUT || '../.trellis/tasks/09-21-v3-cinematic-boot-archive/research/10-01-book-strip-native')
await mkdir(output, { recursive: true })
const env = { ...process.env, LANJIAN_USER_DATA_PATH: join(root, 'profile'), LANJIAN_GLOBAL_MODEL_DATA_PATH: join(root, 'models') }
delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL
const app = await _electron.launch({ args: [resolve('out/main/index.js')], env, recordVideo: { dir: join(output, 'video'), size: { width: 1440, height: 900 } } })
const page = await app.firstWindow(), owner = await app.browserWindow(page)
page.setDefaultTimeout(30000)
const checks = [], errors = []
page.on('pageerror', e => errors.push(e.message))
async function capture(name) {
  const png = await owner.evaluate(async win => (await win.webContents.capturePage()).toPNG().toString('base64'))
  await writeFile(join(output, name + '.png'), Buffer.from(png, 'base64'))
}
async function observe() {
  await page.evaluate(() => {
    window.motionObserver?.disconnect(); window.motionEvents = []
    window.motionObserver = new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) if (node instanceof Element) {
        for (const selector of ['[data-testid="workspace-loading"]', '[data-testid="library-cover-flight"]']) {
          const found = node.matches(selector) ? node : node.querySelector(selector)
          if (found) window.motionEvents.push({ selector, path: found.getAttribute('data-project-path') })
        }
      }
    }); window.motionObserver.observe(document.body, { childList: true, subtree: true })
  })
}
async function waitEntry(book) {
  await page.waitForFunction(path => document.querySelector('[data-book-tab][aria-current="page"]')?.getAttribute('data-book-path') === path && !document.querySelector('.app-frame')?.inert, book.path)
  await page.getByTestId('workspace-loading').waitFor({ state: 'hidden' })
  await page.getByTestId('manuscript-input').waitFor()
}
async function library() {
  await page.getByRole('button', { name: '返回我的作品', exact: true }).click()
  await page.getByTestId('project-library').waitFor()
  await page.getByTestId('library-all-works').click()
  await page.waitForTimeout(700)
}
const open = book => page.locator('.work-item-open').filter({ hasText: book.title }).click()
try {
  await owner.evaluate(win => { win.setContentSize(1440, 900); win.show(); win.focus() })
  await page.waitForFunction(() => !!window.novelDesktop)
  await page.evaluate(async () => {
    await window.companionSettings.update({ voice: { mute: true, textModel: false, preload: false } })
    await window.novelDesktop.companionVoice.configure({ textModel: false, speechModel: false, preload: false, voice: 'ningguang' })
    localStorage.setItem('lanjian-loading-v1', JSON.stringify({ theme: 'impact', bootStyle: 'brief', bootPalette: 'dark' }))
    localStorage.setItem('lanjian-theme', 'moye')
  })
  const books = await page.evaluate(async root => {
    const api = window.novelDesktop, result = []
    for (const title of ['星河档案', '雾海来信', '长夜航行']) {
      const { project } = await api.projects.create({ parentPath: root, name: title, title })
      const chapter = await api.chapters.create(), content = `${title}：这份正文必须保持原样。`
      await api.chapters.update(chapter.id, { title: '第一章', content, expectedRevision: chapter.revision })
      result.push({ ...project, content })
    }
    return result
  }, root)
  const bodies = []
  for (const book of books) for (const name of await readdir(join(book.path, '正文'))) {
    if (name.endsWith('.md')) { const path = join(book.path, '正文', name); bodies.push({ path, bytes: await readFile(path) }) }
  }
  assert.equal(bodies.length, 3)
  await page.reload(); await page.getByTestId('app-boot-enter').click(); await page.getByTestId('app-boot').waitFor({ state: 'hidden' })
  await page.getByTestId('library-all-works').click()
  for (const book of books) {
    await open(book); await waitEntry(book); await page.waitForTimeout(700)
    if (book !== books.at(-1)) await library()
  }
  const tab = book => page.locator('[data-book-tab]').filter({ hasText: book.title })
  assert.equal(await page.locator('.book-tab').count(), 3)
  const target = tab(books[2]).locator('.library-book-cover')
  const first = await target.boundingBox(); await page.waitForTimeout(100)
  assert.deepEqual(await target.boundingBox(), first)
  checks.push('three-cold-book-entries-preserve-real-cover-target-and-editor')
  await tab(books[0]).focus(); await page.keyboard.press('ArrowRight')
  assert.equal(await tab(books[1]).evaluate(e => e === document.activeElement), true)
  await page.keyboard.press('Enter'); await waitEntry(books[1])
  await tab(books[2]).click(); await waitEntry(books[2])
  await capture('01-three-book-tabs')
  checks.push('keyboard-arrow-enter-and-warm-tab-selection')
  // Observe the actual leave phase, without delaying business close or manipulating the UI.
  await page.evaluate(() => {
    window.sawInertLeavingTab = false
    window.tabObserver = new MutationObserver(() => {
      if ([...document.querySelectorAll('.book-strip-leave-active')].some(e => e.inert)) window.sawInertLeavingTab = true
    })
    window.tabObserver.observe(document.body, { subtree:true, attributes:true, childList:true })
  })
  const before = await tab(books[2]).boundingBox()
  await page.getByRole('button', { name:`关闭《${books[1].title}》标签`, exact:true }).click()
  await page.waitForTimeout(400)
  assert.equal(await page.locator('.book-tab').count(), 2)
  assert.equal(await page.evaluate(() => window.sawInertLeavingTab), true)
  assert.ok((await tab(books[2]).boundingBox()).x < before.x)
  assert.equal(await tab(books[2]).getAttribute('aria-current'), 'page')
  assert.equal(await tab(books[2]).evaluate(e => e === document.activeElement), true)
  checks.push('closing-inactive-tab-makes-leaving-controls-inert-reflows-and-restores-focus')
  await capture('02-after-tab-close')
  await library(); await open(books[1]); await waitEntry(books[1]); await page.waitForTimeout(700)
  assert.equal(await page.locator('.book-tab').count(), 3)
  checks.push('closed-tab-reopens-the-real-book-without-deletion')
  const fixture={bookId:books[0].id,bookPath:books[0].path,bookTitle:books[0].title,taskId:'motion-notification',kind:'智能助笔',status:'running'}
  await app.evaluate(({ipcMain},item)=>{
    globalThis.tabTaskFixture=[item]
    ipcMain.removeHandler('ai:background-tasks')
    ipcMain.handle('ai:background-tasks',()=>({ok:true,value:globalThis.tabTaskFixture}))
  },fixture)
  const toggle=page.getByTestId('background-tasks-toggle')
  await page.waitForFunction(()=>document.querySelector('[data-testid="background-tasks-toggle"] b')?.textContent==='1')
  await app.evaluate(()=>{globalThis.tabTaskFixture[0].status='succeeded'})
  await page.locator('.book-completion').waitFor()
  assert.match(await page.locator('.book-completion').innerText(),/星河档案.*已完成/)
  await capture('03-real-status-notification')
  await page.getByRole('button',{name:'关闭任务通知',exact:true}).click()
  assert.equal(await toggle.evaluate(e=>e===document.activeElement),true)
  await page.locator('.book-completion').waitFor({state:'detached'})
  await toggle.click()
  await page.getByRole('button',{name:'关闭任务列表',exact:true}).waitFor()
  assert.equal(await page.getByRole('button',{name:'关闭任务列表',exact:true}).evaluate(e=>e===document.activeElement),true)
  await page.keyboard.press('Escape')
  assert.equal(await toggle.evaluate(e=>e===document.activeElement),true)
  for(let i=0;i<3;i++){await toggle.click();await page.keyboard.press('Escape')}
  await toggle.click(); await page.waitForTimeout(250)
  assert.equal(await page.locator('.book-task-popover').evaluate(e=>e.inert),false)
  await capture('04-task-list')
  await page.keyboard.press('Escape'); await page.locator('.book-task-popover').waitFor({state:'detached'})
  checks.push('background-status-notification-exit-and-rapid-popover-focus-reversal')
  await page.emulateMedia({reducedMotion:'reduce'})
  await owner.evaluate(win=>{win.setContentSize(1100,760);win.webContents.setZoomFactor(1.25)})
  await page.waitForTimeout(400)
  await tab(books[0]).focus();await page.keyboard.press('End')
  assert.equal(await tab(books[1]).evaluate(e=>e===document.activeElement),true)
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true)
  await page.getByRole('button',{name:`关闭《${books[0].title}》标签`,exact:true}).click()
  await page.waitForTimeout(100)
  assert.equal(await page.locator('.book-strip-leave-active').count(),0)
  await capture('05-compact-reduced-motion')
  checks.push('compact-keyboard-overflow-and-reduced-motion-cleanup')
  await page.getByRole('button',{name:`关闭《${books[1].title}》标签`,exact:true}).click()
  await waitEntry(books[2]); await page.waitForTimeout(400)
  assert.equal(await page.locator('.book-tab').count(),1)
  await page.getByRole('button',{name:`关闭《${books[2].title}》标签`,exact:true}).click()
  await page.getByTestId('project-library').waitFor()
  await page.waitForFunction(()=>document.querySelectorAll('.book-tab').length===0)
  assert.equal(await page.locator('.book-tab').count(),0)
  await page.getByTestId('library-all-works').click()
  assert.equal(await page.locator('.work-card').count(),3)
  checks.push('closing-current-and-last-tab-preserves-workspace-guards-and-all-library-books')
  for(const body of bodies)assert.deepEqual(await readFile(body.path),body.bytes)
  checks.push('three-manuscript-files-byte-identical')
  assert.deepEqual(errors,[])
  await writeFile(join(output,'verification.json'),JSON.stringify({checks,errors,root},null,2))
  console.log(JSON.stringify({checks,errors,output}))
} catch (error) {
  console.error(error)
  await capture('failure').catch(() => {})
  await writeFile(join(output, 'failure.json'), JSON.stringify({ error: String(error), checks, errors, root }, null, 2))
  process.exitCode = 1
} finally {
  const video = page.video(); await app.close()
  if (video) await copyFile(await video.path(), join(output, 'book-strip.webm'))
}
