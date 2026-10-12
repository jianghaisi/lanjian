import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

/** Only the runner's disposable profile is changed. No author files or settings. */
export async function checkPetCareFeedback({ app, pet, profile, output, checks, observations }) {
  async function until(read, label) {
    for (let i=0;i<120;i++) { if (await read()) return; await pause(50) }
    throw new Error(`Timed out: ${label}`)
  }
  async function click(control) {
    await control.waitFor(); await control.scrollIntoViewIfNeeded(); await pause(450)
    const rect=await control.boundingBox(); assert.ok(rect)
    await app.evaluate(({BrowserWindow},point)=>{
      const contents=BrowserWindow.getAllWindows().find(w=>/pet\.html/.test(w.webContents.getURL())).webContents
      for(const type of ['mouseDown','mouseUp']) contents.sendInputEvent({type,button:'left',clickCount:1,...point})
    },{x:Math.round(rect.x+rect.width/2),y:Math.round(rect.y+rect.height/2)})
  }
  const state=()=>pet.evaluate(()=>window.companionCare.get())
  const status=pet.getByTestId('pet-status'), caption=pet.getByTestId('pet-window-menu-toggle')
  async function careMenu() { await click(caption); await click(pet.getByTestId('pet-radial-care')); await pet.getByTestId('pet-use-food').waitFor() }
  async function close() { await caption.press('Escape'); await until(async()=>!(await pet.evaluate(()=>window.desktopPet.get())).layout.kind,'panel close') }
  async function act(action) { return pet.evaluate(async action=>{
    const s=await window.companionCare.get()
    return window.companionCare.act({requestId:crypto.randomUUID(),revision:s.revision,action})
  },action) }

  const initial=await state()
  await careMenu(); await click(pet.getByTestId('pet-use-food'))
  await until(async()=>(await status.innerText()).includes('桂花糕'),'successful quick food feedback')
  assert.equal((await state()).inventory.food,initial.inventory.food-1)
  await pause(100)
  assert.ok((await status.innerText()).includes('桂花糕'),'unchanged care projection must not clear success feedback')
  assert.equal(await pet.locator('.speech').count(),0)
  await pet.locator('[data-testid="pet-artwork"][data-clip="eating"]').waitFor()
  await pet.screenshot({path:join(output,'care-food-success.png')})
  checks.push('quick food uses one item after main confirmation, plays eating and reports local status without a spoken bubble')

  await careMenu(); await click(pet.getByTestId('pet-sleep'))
  await until(async()=>(await status.innerText())==='正在休息','sleep status')
  assert.equal((await state()).sleeping,true)
  await careMenu()
  assert.equal(await pet.getByTestId('pet-use-food').isDisabled(),true)
  assert.match(await pet.getByTestId('pet-use-food').getAttribute('title'),/先唤醒/)
  assert.equal(await pet.getByTestId('pet-sleep').getAttribute('aria-label'),'唤醒')
  await click(pet.getByTestId('pet-sleep'))
  await until(async()=>(await status.innerText())==='已唤醒','wake feedback')
  assert.equal((await state()).sleeping,false)
  checks.push('sleep/wake project truthful status; disabled feeding explains waking first and the wake control remains usable')

  await careMenu()
  const file=join(profile,'companion-care.json'), original=await readFile(file), before=await state()
  try {
    // Force a real store rejection in this synthetic profile, then repair the
    // exact bytes. Waiting through a real tick exercises stale-revision retry.
    await writeFile(file,'{isolated unreadable fixture')
    await click(pet.getByTestId('pet-use-food'))
    const error=pet.getByTestId('pet-care-panel').getByRole('alert')
    await error.waitFor()
    assert.match(await error.innerText(),/档案|保存/)
    const panelRect=await pet.getByTestId('pet-care-panel').boundingBox(), retryRect=await error.getByRole('button',{name:'重试操作',exact:true}).boundingBox()
    assert.ok(retryRect.y>=panelRect.y&&retryRect.y+retryRect.height<=panelRect.y+panelRect.height,'retry must be fully visible without scrolling')
    assert.ok(!(await status.innerText()).includes('桂花糕'),'rejected food must not show success')
    await pet.screenshot({path:join(output,'care-error-retry.png')})
  } finally { await writeFile(file,original) }
  await pause(5600)
  const advanced=await state()
  assert.ok(advanced.revision>before.revision,'real background tick must advance revision before retry')
  assert.equal(advanced.inventory.food,before.inventory.food)
  await click(pet.getByTestId('pet-care-panel').getByRole('button',{name:'重试操作',exact:true}))
  await until(async()=>(await status.innerText()).includes('桂花糕'),'retry feedback')
  const after=await state()
  assert.equal(after.inventory.food,before.inventory.food-1)
  assert.equal(after.receipts.length,before.receipts.length+1)
  assert.equal(await pet.getByTestId('pet-care-panel').getByRole('alert').count(),0)
  await pet.locator('[data-testid="pet-artwork"][data-clip="eating"]').waitFor()
  observations.push({case:'care-retry-after-tick',before:before.revision,advanced:advanced.revision,after:after.revision,foodBefore:before.inventory.food,foodAfter:after.inventory.food})
  await close()
  checks.push('real failed quick care opens a recoverable side panel; retry after a background revision change consumes one item and restores feedback/animation')

  await act({type:'focus-start',minutes:5})
  await until(async()=>(await status.innerText())==='陪你专注','focus state must supersede old success message')
  await act({type:'focus-pause'})
  await until(async()=>(await status.innerText())==='专注已暂停','focus paused')
  await act({type:'focus-resume'})
  await until(async()=>(await status.innerText())==='陪你专注','focus resumed')
  await act({type:'focus-cancel'})
  await until(async()=>!(await status.innerText()).includes('专注'),'focus cancelled')
  checks.push('authoritative focus start/pause/resume/cancel clears stale transient feedback and updates the collapsed status')

  while((await state()).inventory.food>0) await act({type:'use',item:'food'})
  await careMenu()
  assert.equal(await pet.getByTestId('pet-use-food').isDisabled(),true)
  assert.match(await pet.getByTestId('pet-use-food').getAttribute('title'),/背包里没有桂花糕/)
  assert.equal(await pet.getByTestId('pet-open-care').isEnabled(),true)
  await pet.screenshot({path:join(output,'care-empty-inventory.png')})
  await close()
  checks.push('empty inventory has a specific disabled reason and keeps the backpack recovery entry available')
}
