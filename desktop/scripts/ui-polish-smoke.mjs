import assert from 'node:assert/strict'
import { mkdtemp, realpath, mkdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron } from 'playwright'

const root=await realpath(await mkdtemp(join(tmpdir(),'lanjian-ui-polish-')))
const output=resolve('../.trellis/tasks/09-20-v3-worktree-consolidation/evidence/ui-polish')
await mkdir(output,{recursive:true})
const imported=join(root,'两章旧稿.txt'), exported=join(root,'阅读稿.txt')
await writeFile(imported,'第一章 旧日来信\n这是第一章的旧稿正文。\n\n第二章 山中回声\n这是第二章的旧稿正文。','utf8')
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('LANJIAN_')&&key!=='ELECTRON_RUN_AS_NODE'&&key!=='ELECTRON_RENDERER_URL'))
Object.assign(env,{LANJIAN_USER_DATA_PATH:join(root,'profile'),LANJIAN_SMOKE_TXT_PATH:imported,LANJIAN_SMOKE_MANUSCRIPT_EXPORT_PATH:exported})
const app=await _electron.launch({args:[resolve('out/main/index.js')],env})
const checks=[],errors=[]
let page
try {
  page=await app.firstWindow();page.setDefaultTimeout(30000)
  const owner=await app.browserWindow(page)
  await owner.evaluate(win=>{win.webContents.setBackgroundThrottling(false);win.setMinimumSize(800,600);win.show();win.focus()})
  page.on('pageerror',e=>errors.push(e.message))
  await page.waitForFunction(()=>Boolean(window.novelDesktop))
  await page.evaluate(()=>{
    localStorage.setItem('lanjian-opening-enabled','false')
    localStorage.setItem('lanjian-companion-voice-v1',JSON.stringify({voice:'ningguang',mute:true,textModel:false,preload:false}))
  })
  const seed=await page.evaluate(async parentPath=>{
    const api=window.novelDesktop;let project
    for(let i=1;i<=9;i++)project=(await api.projects.create({parentPath,name:`界面检查作品${i}`,title:`界面检查作品${i}`})).project
    await api.projects.switch(project.path)
    for(const [title,content] of [['第一封信','导出前的第一章正文'],['第二封信','第二章独立正文保留']]) {
      const chapter=await api.chapters.create()
      await api.chapters.update(chapter.id,{title,content,expectedRevision:chapter.revision})
    }
    return project
  },root)
  await page.reload();await page.getByTestId('app-boot').waitFor({state:'hidden'})
  const resize=async(width,height,zoom,theme)=>{
    await owner.evaluate(win=>{if(win.isMaximized())win.unmaximize();if(win.isMinimized())win.restore()})
    await page.waitForTimeout(250)
    await owner.evaluate((win,{width,height,zoom})=>{win.setContentSize(width,height);win.webContents.setZoomFactor(zoom);win.focus()},{width,height,zoom})
    await page.waitForFunction(({width,height,zoom})=>Math.abs(innerWidth-width/zoom)<2&&Math.abs(innerHeight-height/zoom)<2,{width,height,zoom})
    await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme)
  }
  const capture=async name=>{
    await page.evaluate(()=>document.fonts.ready)
    await owner.evaluate(win=>{win.show();win.focus();win.webContents.focus()})
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
    await page.waitForTimeout(650)
    const viewport=await page.evaluate(()=>({width:innerWidth*devicePixelRatio,height:innerHeight*devicePixelRatio}))
    const frame=await owner.evaluate(async win=>{const frame=await win.webContents.capturePage();return {size:frame.getSize(),png:frame.toPNG().toString('base64')}})
    assert.ok(Math.abs(frame.size.width-viewport.width)<2&&Math.abs(frame.size.height-viewport.height)<2)
    await writeFile(join(output,name+'.png'),Buffer.from(frame.png,'base64'))
  }
  for(const [width,height,zoom,theme] of [[1440,900,1,'qingzhou'],[1100,800,1.25,'moye'],[1000,720,1,'xuanzhi']]) {
    await resize(width,height,zoom,theme)
    const geometry=await page.evaluate(()=>{
      const surface=document.querySelector('.all-works-surface'),scene=document.querySelector('.works-watermark'),body=document.querySelector('.all-works-body')
      surface.scrollTop=0;const before=scene.getBoundingClientRect().toJSON();surface.scrollTop=surface.scrollHeight
      const after=scene.getBoundingClientRect().toJSON(),bounds=body.getBoundingClientRect()
      const heading=document.querySelector('.library-heading').getBoundingClientRect(),clock=document.querySelector('.heading-clock').getBoundingClientRect()
      return {scroll:surface.scrollTop,before,after,bottom:bounds.bottom,right:bounds.right,clockFits:clock.right<=heading.right+1,clockSize:parseFloat(getComputedStyle(document.querySelector('.heading-clock>span')).fontSize)}
    })
    assert.ok(geometry.scroll>30,JSON.stringify(geometry));assert.deepEqual(geometry.before,geometry.after)
    assert.ok(Math.abs(geometry.after.bottom-geometry.bottom)<2&&Math.abs(geometry.after.right-geometry.right)<2)
    assert.ok(geometry.clockFits,JSON.stringify(geometry));assert.ok(geometry.clockSize>=44)
    await capture(`library-${theme}`)
    checks.push({name:`anchored-scene-clock-${theme}`,geometry})
  }
  await resize(1440,900,1,'moye')
  await page.locator('.library-header-actions [aria-label="设置"]').click()
  await page.getByRole('dialog',{name:'外观设置',exact:true}).waitFor()
  await page.getByTestId('theme-moye').check()
  const marks=await page.locator('.local-appearance-dialog .theme-settings > header h3,.local-appearance-dialog .library-appearance-settings > header h3').evaluateAll(nodes=>nodes.map(el=>getComputedStyle(el).borderInlineStartWidth))
  assert.ok(marks.length===2&&marks.every(x=>parseFloat(x)>=2),JSON.stringify(marks));await capture('appearance-module-rules')
  await page.getByRole('button',{name:'关闭外观设置'}).click()
  await page.locator('[data-library-view="all"]').click()
  await page.locator('.work-item-open').filter({hasText:seed.title}).first().click()
  await page.getByTestId('workspace-loading').waitFor({state:'hidden'})
  await page.getByTestId('manuscript-input').waitFor()
  const edited='刚刚输入的中文正文，必须随整书导出。'
  await page.getByTestId('manuscript-input').fill(edited)
  await page.getByTestId('chapter-transfer-toggle').click()
  assert.equal(await page.locator('#chapter-transfer-menu:popover-open').count(),1)
  await capture('chapter-transfer-menu')
  await page.keyboard.press('Escape')
  assert.equal(await page.locator('#chapter-transfer-menu:popover-open').count(),0)
  assert.equal(await page.getByTestId('chapter-transfer-toggle').evaluate(el=>el===document.activeElement),true)
  await page.getByTestId('chapter-transfer-toggle').click()
  await page.getByTestId('export-manuscript-in-book').click()
  await page.waitForFunction(()=>document.querySelector('.toast')?.textContent.includes('整书阅读稿已导出'))
  const reading=await readFile(exported,'utf8')
  assert.ok(reading.includes(seed.title)&&reading.includes(edited));assert.ok(reading.includes('第一封信')&&reading.includes('第二封信'))
  const chapters=await page.evaluate(()=>window.novelDesktop.chapters.list())
  assert.equal(chapters.length,2);assert.ok(chapters.some(x=>x.content.trim()===edited))
  assert.ok(chapters.every(x=>reading.includes(x.content.trimEnd())))
  checks.push('export-menu-flushes-current-draft-and-writes-two-chapter-reading-copy')
  await page.getByTestId('chapter-transfer-toggle').click();await page.getByTestId('import-manuscript-in-book').click()
  await page.getByRole('dialog',{name:'导入文稿或资料'}).waitFor()
  assert.ok((await page.locator('.file-rubbing').textContent()).includes('2 章'))
  await page.getByRole('dialog',{name:'导入文稿或资料'}).getByRole('button',{name:'关闭',exact:true}).click()
  await page.getByTestId('chapter-transfer-toggle').click();await page.getByTestId('continue-manuscript-files').click()
  await page.getByTestId('add-continuation-documents').waitFor()
  await page.getByRole('dialog',{name:'从文稿创建作品'}).getByRole('button',{name:'关闭',exact:true}).click()
  checks.push('single-file-two-chapter-preview-and-multi-file-continuation-remain-distinct')
  await page.locator('.activitybar [data-activity="settings"]').click()
  await page.getByTestId('settings-category-advanced').click();await page.getByTestId('settings-nav-research').click()
  const contrast=await page.locator('.settings-category-sections .tree-item.selected .file-glyph').evaluate(el=>{
    const style=getComputedStyle(el)
    const lum=color=>{const rgb=color.match(/[\d.]+/g).slice(0,3).map(Number).map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4});return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722}
    const a=lum(style.color),b=lum(style.backgroundColor);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)
  })
  assert.ok(contrast>=4.5,String(contrast));await capture('settings-dark-contrast');checks.push({name:'selected-settings-glyph-contrast',contrast})
  await page.getByTestId('settings-category-ai').click();await page.getByTestId('settings-nav-local-models').click()
  const card=page.locator('.store-model').first();await card.waitFor()
  for(const [width,height,zoom] of [[1440,900,1],[1100,800,1.25]]) {
    await resize(width,height,zoom,'moye');await card.scrollIntoViewIfNeeded()
    const closed=await card.boundingBox();assert.ok(closed.height<300,JSON.stringify(closed))
    assert.equal(await card.locator('details[open]').count(),0)
    await capture(`local-model-compact-${width}`)
    await card.locator('summary').focus();await page.keyboard.press('Enter')
    assert.equal(await card.locator('details[open]').count(),1)
    assert.ok((await card.boundingBox()).height>closed.height+80)
    assert.ok(await card.locator('.model-facts').isVisible());await capture(`local-model-expanded-${width}`)
    await card.locator('summary').click()
    checks.push({name:`compact-model-${width}-${zoom}`,height:closed.height})
  }
  assert.deepEqual(errors,[])
  console.log(JSON.stringify({ok:true,root,checks}))
} catch(error) {
  errors.push(error.stack);if(page)await page.screenshot({path:join(output,'failure.png')}).catch(()=>{})
  console.error(error);process.exitCode=1
} finally {
  await writeFile(join(output,'result.json'),JSON.stringify({root,checks,errors},null,2))
  await app.evaluate(({app})=>app.exit()).catch(()=>{});await app.close().catch(()=>{})
}
