import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { _electron } = require('playwright')
const root = await realpath(await mkdtemp(join(tmpdir(), 'lanjian-layout-')))
const output = resolve(process.env.LANJIAN_LAYOUT_EVIDENCE_DIR || '../.trellis/tasks/09-20-v3-boot-workspace-layout/evidence')
await mkdir(output, { recursive: true })
const env = { ...process.env, LANJIAN_USER_DATA_PATH: join(root, 'profile') }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_RENDERER_URL
const app = await _electron.launch({ executablePath: require('electron'), args: [resolve(process.env.LANJIAN_BUILT_DESKTOP_DIR || 'node_modules/.cache/boot-workspace-layout/out', 'main/index.js')], env })
const checks = [], errors = []
let page
try {
  page = await app.firstWindow()
  const owner = await app.browserWindow(page)
  await owner.evaluate(win => { win.webContents.setBackgroundThrottling(false); win.setMinimumSize(800,600); win.show(); win.focus() })
  page.setDefaultTimeout(20000)
  page.on('pageerror', error => errors.push(error.message))
  await page.waitForFunction(() => Boolean(window.novelDesktop))
  await page.evaluate(() => {
    localStorage.setItem('lanjian-opening-enabled', 'false')
    localStorage.setItem('lanjian-companion-voice-v1', JSON.stringify({ voice:'ningguang', mute:true, textModel:false, preload:false }))
  })
  const books = await page.evaluate(async parentPath => {
    const results=[]
    for (const title of ['双书甲', '双书乙', '这是一部长书名的布局检查作品用于确认标签省略与横向滚动']) {
      results.push((await window.novelDesktop.projects.create({ parentPath, title, name:title })).project)
    }
    return results
  }, root)
  await page.reload()
  await page.getByTestId('app-boot').waitFor({state:'hidden'})
  const resize = async (width,height,zoom,theme) => {
    await owner.evaluate(win => { if(win.isMaximized())win.unmaximize(); if(win.isMinimized())win.restore() })
    await page.waitForTimeout(300)
    await owner.evaluate((win,{width,height,zoom}) => { win.setContentSize(width,height);win.webContents.setZoomFactor(zoom);win.focus() }, {width,height,zoom})
    await page.waitForFunction(({width,height,zoom}) => Math.abs(innerWidth-width/zoom)<2 && Math.abs(innerHeight-height/zoom)<2,{width,height,zoom})
    await page.evaluate(theme => document.documentElement.dataset.theme=theme, theme)
  }
  const capture = async name => {
    await page.evaluate(() => document.fonts.ready)
    await owner.evaluate(win => { win.show(); win.focus(); win.webContents.focus() })
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await page.waitForTimeout(300)
    const viewport=await page.evaluate(()=>({width:innerWidth*devicePixelRatio,height:innerHeight*devicePixelRatio}))
    const image=await owner.evaluate(async win => {const image=await win.webContents.capturePage();return {size:image.getSize(),png:image.toPNG().toString('base64')}})
    assert.ok(Math.abs(image.size.width-viewport.width)<2&&Math.abs(image.size.height-viewport.height)<2,JSON.stringify({name,viewport,size:image.size}))
    await writeFile(join(output, name+'.png'), Buffer.from(image.png,'base64'))
  }
  for (const book of books) {
    const all = page.locator('[data-library-view="all"]')
    if (await all.isVisible()) await all.click()
    await page.locator('.work-item-open').filter({hasText:book.title}).first().click()
    await page.getByTestId('workspace-loading').waitFor({state:'hidden'})
    await page.locator('[data-book-tab][aria-current="page"]').waitFor()
    assert.equal((await page.evaluate(() => window.novelDesktop.projects.status())).project.title, book.title)
    await page.getByRole('button',{name:'返回我的作品',exact:true}).click()
    await page.locator('.project-library').waitFor()
  }
  for (const [width,height,zoom,theme] of [[1440,900,1,'qingzhou'],[1100,800,1.25,'moye'],[1000,720,1,'xuanzhi']]) {
    await resize(width,height,zoom,theme)
    await page.waitForTimeout(300)
    const geometry=await page.evaluate(() => {
      const bar=document.querySelector('.book-tabs'),rect=bar.getBoundingClientRect()
      const controls=['.workspace-brand-actions','.book-library','[data-book-tab]','.library-header-actions [aria-label="设置"]','[data-testid="background-tasks-toggle"]']
      return {height:rect.height,secondHeader:!!document.querySelector('.library-topbar'),overflow:bar.scrollWidth>bar.clientWidth+1,contentTop:document.querySelector('.library-content').getBoundingClientRect().top,barBottom:rect.bottom,
        controls:controls.map(selector=>{const el=document.querySelector(selector),r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {selector,usable:el===hit||el.contains(hit),within:r.top>=rect.top&&r.bottom<=rect.bottom}})}
    })
    assert.equal(geometry.secondHeader,false)
    assert.equal(geometry.overflow,false,JSON.stringify(geometry))
    assert.equal(geometry.height,48)
    assert.ok(Math.abs(geometry.contentTop-geometry.barBottom)<2,JSON.stringify(geometry))
    assert.ok(geometry.controls.every(item=>item.usable&&item.within),JSON.stringify(geometry))
    await capture(`library-${width}-${zoom}-${theme}`)
    await page.locator('.library-header-actions [aria-label="设置"]').click()
  await page.getByTestId('library-global-models').click()
    await page.locator('.global-models-dialog[open]').waitFor()
    await page.locator('.global-models-dialog').getByRole('button',{name:'关闭',exact:true}).click()
    await page.locator('.library-header-actions [aria-label="设置"]').click()
    await page.getByRole('dialog',{name:'外观设置',exact:true}).waitFor()
    await page.getByRole('button',{name:'关闭外观设置'}).click()
    checks.push({name:`library-single-row-${width}-${zoom}-${theme}`,geometry})
  }
  await page.locator('[data-library-view="all"]').click()
  assert.equal(await page.locator('.library-header-search,.library-local-status,[data-testid="library-model-setup"]').count(),0)
  assert.equal(await page.locator('.work-item-open').count(),3)
  checks.push('library-topbar-simplified-and-all-books-accessible')
  await page.locator('[data-book-tab]').first().click()
  await page.getByTestId('workspace-loading').waitFor({state:'hidden'})
  await page.locator('[data-nav-parent="planning"]').click()
  await page.locator('.planning-sidebar').waitFor()
  assert.equal(await page.locator('.planning-sidebar-heading,.project-title-return,.studio>.titlebar').count(),0)
  checks.push('three-books-open-and-return-through-single-library-button')
  for (const [width,height,zoom,theme] of [[1440,900,1,'qingzhou'],[1100,800,1.25,'moye'],[1000,720,1,'xuanzhi']]) {
    await resize(width,height,zoom,theme)
    await page.waitForTimeout(300)
    const geometry=await page.evaluate(() => {
      const bar=document.querySelector('.book-tabs'), sidebar=document.querySelector('.planning-sidebar'), search=sidebar.querySelector('.planning-search')
      const rect=bar.getBoundingClientRect(), s=sidebar.getBoundingClientRect()
      const controls=['.book-library','[data-testid="open-workspace-guidance"]','[data-testid="background-tasks-toggle"]','.assistant-toggle','[data-testid="open-quick-chapter"]']
      return {overflow:bar.scrollWidth>bar.clientWidth+1, barBottom:rect.bottom,sidebarTop:s.top,searchOffset:search.getBoundingClientRect().top-s.top,
        controls:controls.map(selector=>{const el=document.querySelector(selector),r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {selector,noClippedText:el.scrollWidth<=el.clientWidth+1,usable:el===hit||el.contains(hit),within:r.top>=rect.top&&r.bottom<=rect.bottom}})}
    })
    assert.equal(geometry.overflow,false,JSON.stringify(geometry))
    assert.ok(Math.abs(geometry.barBottom-geometry.sidebarTop)<2,JSON.stringify(geometry))
    assert.ok(geometry.searchOffset<20,JSON.stringify(geometry))
    assert.ok(geometry.controls.every(item=>item.usable&&item.within&&item.noClippedText),JSON.stringify(geometry))
    await page.getByTestId('open-workspace-guidance').click()
    await page.locator('#workspace-guidance-panel').waitFor({state:'visible'})
    await capture(`planning-${width}-${zoom}-${theme}`)
    await page.keyboard.press('Escape')
    await capture(`planning-clean-${width}-${zoom}-${theme}`)
    await page.getByTestId('background-tasks-toggle').click()
    await page.locator('.book-task-popover').waitFor()
    await page.getByRole('button',{name:'关闭任务列表'}).click()
    checks.push({name:`single-row-${width}-${zoom}-${theme}`,geometry})
  }
  await page.locator('[data-book-tab]').first().focus()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Enter')
  await page.waitForFunction(path=>document.querySelector('[data-book-tab][aria-current="page"]')?.getAttribute('data-book-path')===path, books[1].path)
  assert.equal((await page.evaluate(()=>window.novelDesktop.projects.status())).project.title,books[1].title)
  checks.push('keyboard-switches-to-second-book')
  await page.getByRole('button',{name:`关闭《${books[2].title}》标签`}).click()
  assert.equal(await page.locator('[data-book-tab]').count(),2)
  assert.equal((await page.evaluate(()=>window.novelDesktop.projects.list())).projects.length,3)
  checks.push('closing-tab-preserves-library-book')
  assert.deepEqual(errors,[])
  console.log(JSON.stringify({ok:true,root,output,checks}))
} catch(error) {
  errors.push(error.stack)
  if(page)await page.screenshot({path:join(output,'failure.png')}).catch(()=>{})
  console.error(error)
  process.exitCode=1
} finally {
  await writeFile(join(output,'result.json'),JSON.stringify({root,checks,errors},null,2))
  await app.evaluate(({app})=>app.exit()).catch(()=>{})
  await app.close().catch(()=>{})
}
