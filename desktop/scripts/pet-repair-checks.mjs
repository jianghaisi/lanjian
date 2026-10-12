import assert from 'node:assert/strict'
import { join } from 'node:path'
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

export async function checkPetRepairs({ app, page, pet, output, checks, observations, nativeMouse, point, bounds }) {
  async function waitForPetState(target, matches) {
    for (let attempt = 0; attempt < 100; attempt++) {
      const value = await target.evaluate(() => window.desktopPet.get())
      if (matches(value)) return value
      await pause(50)
    }
    assert.fail('The main process did not confirm the requested pet preference')
  }
  async function clickPet(testId) {
    const control = pet.getByTestId(testId)
    await control.scrollIntoViewIfNeeded()
    const window = await bounds(), rect = await control.boundingBox()
    assert.ok(rect)
    // Hit testing uses the real OS cursor. CDP-only input can miss a transparent
    // window when that cursor is elsewhere, even though the DOM target exists.
    await nativeMouse([{x:window.x+rect.x+rect.width/2,y:window.y+rect.y+rect.height/2,down:true,up:true}])
  }
  const settings = page.getByTestId('desktop-pet-settings'), preview = page.getByTestId('pet-action-preview')
  const before = await page.evaluate(() => window.companionCare.get())
  for (const intent of ['eating', 'handshake', 'pat', 'sleeping']) {
    await page.getByTestId(`pet-preview-${intent}`).click()
    await preview.locator(`[data-intent="${intent}"]`).waitFor()
    await pause(550)
    await preview.screenshot({ path: join(output, `preview-${intent}.png`) })
  }
  await page.getByRole('button', { name: '↻ 重播动作', exact: true }).click()
  await preview.locator('[data-intent="sleeping"]').waitFor()
  await preview.locator('[data-intent="idle"]').waitFor()
  const after = await page.evaluate(() => window.companionCare.get())
  assert.deepEqual(after.inventory, before.inventory); assert.equal(after.coins, before.coins)
  checks.push('four distinct action previews and replay return to idle without inventory/currency changes')

  await settings.getByRole('button', { name: '动作与提醒', exact: true }).click()
  await settings.getByLabel('减少动画').check()
  await preview.getByRole('button', { name: '握手', exact: true }).click()
  await preview.locator('[data-motion="paused"][data-intent="handshake"]').waitFor()
  await preview.screenshot({ path: join(output, 'reduced-motion.png') })
  await settings.getByLabel('减少动画').uncheck()
  await settings.getByRole('button', { name: '麦克风', exact: true }).click()
  assert.ok(await settings.getByLabel('允许语音输入').isVisible())
  await settings.getByRole('button', { name: '养成与活动', exact: true }).click()
  assert.ok(await settings.getByLabel('自动活动').isVisible())
  await settings.getByRole('button', { name: '外观与位置', exact: true }).click()

  for (const scale of ['0.6', '1', '1.8']) {
    await page.getByTestId('pet-scale').selectOption(scale)
    await waitForPetState(pet, value => value.preferences.scale === Number(scale))
    await pause(200)
    const metrics = await pet.getByTestId('pet-artwork').evaluate(e => { const c = e.querySelector('canvas'), r = c.getBoundingClientRect(); return { width:r.width,height:r.height,backingWidth:c.width,dpr:devicePixelRatio,right:r.right,bottom:r.bottom,viewport:[innerWidth,innerHeight] } })
    assert.ok(metrics.backingWidth >= metrics.width * Math.min(3, metrics.dpr) - 2)
    assert.ok(metrics.right <= metrics.viewport[0] && metrics.bottom <= metrics.viewport[1])
    observations.push({ case:'character-size', scale, metrics })
    await pet.screenshot({path:join(output,`size-${scale}.png`)})
  }
  await page.getByTestId('pet-scale').selectOption('1')
  await page.getByTestId('pet-position-lock').check()
  await waitForPetState(pet, value => value.preferences.positionLocked)
  await page.evaluate(() => window.companionSettings.update({followCursor:true}))
  const locked = await bounds(), p = await point()
  await nativeMouse([{...p,down:true},{x:p.x-15,y:p.y},{x:p.x-90,y:p.y+15},{x:p.x-90,y:p.y+15,up:true}])
  await nativeMouse([{x:10,y:10}]); await pause(400)
  assert.deepEqual(await bounds(), locked)
  await page.evaluate(() => window.companionSettings.update({followCursor:false}))
  await page.getByTestId('pet-position-lock').uncheck()
  const start = await point()
  await nativeMouse([{...start,down:true},{x:start.x-15,y:start.y},{x:start.x-90,y:start.y-15},{x:start.x-120,y:start.y-15},{x:start.x-120,y:start.y-15,up:true}])
  await pause(250)
  const moved = await bounds()
  assert.ok(moved.x < locked.x - 40, 'unlock restores actual native drag')
  assert.equal(await pet.locator('.desktop-pet-window.dragging').count(),0)
  checks.push('60/100/180% character size fits; native lock blocks drag/follow and unlocking restores drag')

  await clickPet('pet-window-menu-toggle')
  await clickPet('pet-handshake')
  await pet.locator('[data-testid="pet-artwork"][data-intent="handshake"]').waitFor()
  await pause(500); await pet.screenshot({path:join(output,'native-handshake.png')})
  const interrupt = await point()
  await nativeMouse([{...interrupt,down:true},{x:interrupt.x-14,y:interrupt.y},{x:interrupt.x-60,y:interrupt.y},{x:interrupt.x-60,y:interrupt.y,up:true}])
  await pet.locator('[data-testid="pet-artwork"][data-intent="idle"]').waitFor()
  assert.equal(await pet.locator('.desktop-pet-window.dragging').count(),0)
  checks.push('native drag interrupts handshake and does not replay it or trigger a pat on release')
  await clickPet('pet-window-menu-toggle')
  await clickPet('pet-open-care')
  const stock = await pet.evaluate(() => window.companionCare.get())
  await clickPet('pet-use-food')
  await pet.locator('[data-testid="pet-artwork"][data-intent="eating"]').waitFor()
  assert.equal((await pet.evaluate(() => window.companionCare.get())).inventory.food, stock.inventory.food-1)
  await clickPet('pet-use-water')
  await pet.locator('[data-testid="pet-artwork"][data-intent="drinking"]').waitFor()
  assert.equal((await pet.evaluate(() => window.companionCare.get())).inventory.water, stock.inventory.water-1)
  await clickPet('pet-sleep')
  await pet.locator('[data-testid="pet-artwork"][data-intent="sleeping"]').waitFor()
  await pause(3000)
  assert.equal(await pet.getByTestId('pet-artwork').getAttribute('data-intent'),'sleeping')
  await clickPet('pet-sleep')
  await pet.locator('[data-testid="pet-artwork"][data-intent="idle"]').waitFor()
  await pet.getByRole('button',{name:'关闭照料面板'}).click()
  checks.push('native menu handshake; confirmed feeding/drinking each consume exactly one item; sleep remains until wake')

  for (const color of ['#fbf8f0','#17231e']) {
    await preview.locator('.preview-art').evaluate((e,color) => e.style.backgroundColor = color,color)
    await preview.screenshot({path:join(output,color==='#fbf8f0'?'edge-light.png':'edge-dark.png')})
  }
  await preview.locator('.preview-art').evaluate(e=>e.style.removeProperty('background-color'))
  // Page zoom exercises CSS/layout/backing-store changes; physical monitor DPI is reported separately.
  for (const zoom of [1,1.25,1.5]) {
    await app.evaluate(({BrowserWindow},zoom)=>{const w=BrowserWindow.getAllWindows().find(w=>!/pet\.html/.test(w.webContents.getURL()));w.setSize(1100,900);w.webContents.setZoomFactor(zoom)},zoom)
    await settings.scrollIntoViewIfNeeded();await pause(250)
    assert.equal(await settings.evaluate(e=>e.scrollWidth > e.clientWidth+1),false)
    const viewport = await settings.evaluate(e=>({right:e.getBoundingClientRect().right,width:innerWidth,controls:[...e.querySelectorAll('input,select,button')].filter(c=>c.getClientRects().length).map(c=>({text:c.textContent,right:c.getBoundingClientRect().right,left:c.getBoundingClientRect().left}))}))
    observations.push({case:'settings-zoom',zoom,viewport})
    assert.ok(viewport.right <= viewport.width + 1,`settings page clipped at zoom ${zoom}: ${JSON.stringify(viewport)}`)
    assert.ok(viewport.controls.every(c=>c.left>=0&&c.right<=viewport.width+1),'settings controls must remain inside the actual viewport')
    await page.screenshot({path:join(output,`settings-zoom-${zoom}.png`)})
  }
  checks.push('settings tabs, reduced motion, light/dark edges and responsive settings at page zoom 100/125/150%')
  await page.getByTestId('pet-position-lock').check()
  // waitForFunction tests truthiness, so a Promise-returning IPC predicate can
  // resolve before its boolean value. Await each authoritative read explicitly.
  const persisted = await waitForPetState(page, value => value.preferences.positionLocked)
  assert.equal(persisted.preferences.positionLocked,true)
}
