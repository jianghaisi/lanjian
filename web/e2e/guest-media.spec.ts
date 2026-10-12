import { test, expect } from '@playwright/test'

test('guest uses original library and editor with immutable full sample', async ({page}) => {
  const errors:string[]=[]
  await page.addInitScript(()=>window.addEventListener('unhandledrejection', event => console.error('guest-rejection', JSON.stringify(event.reason))))
  page.on('console',message=>{if(message.text().startsWith('guest-rejection')) errors.push(message.text())})
  page.on('pageerror',error=>errors.push(error.message))
  await page.goto('/login')
  await page.getByRole('link',{name:/以游客身份进入/}).click()
  await page.getByRole('button',{name:'直接进入 ↗',exact:true}).click({timeout:60000})
  await expect(page.getByText('游客 · 只读浏览')).toBeVisible()
  await page.getByRole('button',{name:/打开作品.*渡口最后一盏灯|继续创作/}).first().click()
  await expect(page.getByTestId('workspace-loading')).not.toBeVisible({timeout:60000})
  await page.locator('[data-activity="desk"]').click()
  await page.getByRole('button',{name:/^第 1 章，/}).click()
  await expect(page.getByTestId('manuscript-input')).toContainText('沈禾')
  await expect(page.getByTestId('manuscript-input')).toHaveAttribute('contenteditable','false')
  await expect(page.getByRole('textbox',{name:'章节标题',exact:true})).toHaveAttribute('readonly','')
  const before=await page.evaluate(()=>window.novelDesktop!.chapters.get(1))
  const denied=await page.evaluate(async()=>{try{await window.novelDesktop!.chapters.update(1,{title:'修改',content:'修改'} as never);return false}catch{return true}})
  expect(denied).toBe(true)
  expect(await page.evaluate(()=>window.novelDesktop!.chapters.get(1))).toEqual(before)
  await page.getByTestId('desktop-companion-notice').click()
  await expect(page.getByText('独立桌宠需下载完整版体验。')).toBeVisible()
  await page.screenshot({path:'test-results/guest-original-editor.png'})
  await expect(page.getByRole('button',{name:'立即保存',exact:true})).toBeDisabled()
  for (const name of ['定义','素材','设定','纪事','谋篇','书稿']) {
    await page.getByRole('navigation',{name:'创作流程'}).getByRole('button',{name,exact:true}).click()
    await page.waitForTimeout(250)
  }
  await test.info().attach('errors',{body:JSON.stringify(errors),contentType:'application/json'})
  expect(errors).toEqual([])
})

test('slow product images do not block entry and sound can be retried',async({page})=>{
  await page.route('**/*.webp',async route=>{await new Promise(resolve=>setTimeout(resolve,2500));await route.continue()})
  await page.addInitScript(()=>{
    const original=HTMLMediaElement.prototype.play
    let rejected=false
    HTMLMediaElement.prototype.play=function(){if(!rejected){rejected=true;return Promise.reject(new DOMException('Autoplay blocked','NotAllowedError'))}return original.call(this)}
  })
  await page.goto('/',{waitUntil:'domcontentloaded'})
  await expect(page.locator('.product-sound')).toHaveAttribute('data-state','idle')
  await expect(page.locator('.product-sound')).toHaveAttribute('aria-pressed','true')
  await expect(page.locator('.product-sound')).toHaveText(/声音已开启/)
  await expect(page.getByRole('link',{name:'开始创作'})).toBeVisible()
  await page.getByRole('button',{name:'作品书库',exact:true}).click()
  await expect(page.locator('.product-sound')).toHaveAttribute('data-state','playing')
  await page.setViewportSize({width:390,height:844})
  await page.waitForTimeout(1200)
  await expect(page.locator('.product-sound')).toBeVisible()
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await page.screenshot({path:'test-results/portal-mobile-music.png'})
})

test('product homepage supports randomized ambient music and muting',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message))
  await page.goto('/')
  await expect(page.getByRole('link',{name:'开始创作'})).toBeVisible()
  await page.getByRole('button',{name:'正文编辑',exact:true}).click()
  await expect(page.locator('.product-sound')).toHaveAttribute('data-state','playing')
  await page.getByRole('button',{name:'作品书库',exact:true}).click()
  await expect.poll(()=>page.evaluate(()=>Array.from(document.querySelectorAll('audio')).filter(a=>!a.paused).map(a=>a.dataset.portalScene))).toEqual(['reveal'])
  await page.locator('.product-sound').click()
  await expect.poll(()=>page.evaluate(()=>Array.from(document.querySelectorAll('audio')).every(a=>a.paused))).toBe(true)
  await page.locator('.product-sound').click()
  await expect.poll(()=>page.evaluate(()=>Array.from(document.querySelectorAll('audio')).filter(a=>!a.paused).map(a=>a.dataset.portalScene))).toEqual(['reveal'])
  await page.screenshot({path:'test-results/portal-music-welcome.png'})
  expect(errors).toEqual([])
})

test('default-enabled sound can be muted before autoplay is allowed and remembers that choice',async({page})=>{
  await page.addInitScript(()=>{
    HTMLMediaElement.prototype.play=function(){return Promise.reject(new DOMException('Autoplay blocked','NotAllowedError'))}
  })
  await page.goto('/')
  const sound=page.locator('.product-sound')
  await expect(sound).toHaveAttribute('data-state','idle')
  await expect(sound).toHaveAttribute('aria-pressed','true')
  await sound.click()
  await expect(sound).toHaveAttribute('data-state','muted')
  await expect(sound).toHaveAttribute('aria-pressed','false')
  await page.getByRole('button',{name:'作品书库',exact:true}).click()
  await expect(sound).toHaveAttribute('data-state','muted')
  await page.reload()
  await expect(sound).toHaveAttribute('data-state','muted')
  await expect(sound).toHaveAttribute('aria-pressed','false')
  expect(await page.evaluate(()=>Array.from(document.querySelectorAll('audio')).every(a=>a.paused))).toBe(true)
})
