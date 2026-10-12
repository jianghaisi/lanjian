import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

export async function checkPetRadial({ app, page, pet, output, checks, observations, bounds }) {
  async function click(control) {
    await control.waitFor(); await pause(450)
    const rect = await control.boundingBox(); assert.ok(rect)
    await app.evaluate(({ BrowserWindow }, point) => {
      const contents = BrowserWindow.getAllWindows().find(w => /pet\.html/.test(w.webContents.getURL())).webContents
      for (const type of ['mouseDown','mouseUp']) contents.sendInputEvent({ type, button:'left', clickCount:1, ...point })
    }, { x:Math.round(rect.x+rect.width/2),y:Math.round(rect.y+rect.height/2) })
  }
  async function until(read, message) { for (let i=0;i<100;i++) { if (await read()) return; await pause(50) } throw new Error(message) }
  const art = pet.getByTestId('pet-artwork'), caption = pet.getByTestId('pet-window-menu-toggle')
  await pause(3200)
  assert.equal(await art.getAttribute('data-animation-system'),'frames')
  assert.equal(await art.getAttribute('data-asset-error'),'false')
  assert.ok(!(await caption.innerText()).includes('岚笺'))
  await pet.getByTestId('pet-window-handle').press('Enter')
  await until(async () => (await pet.getByTestId('pet-status').innerText()).includes('收到摸摸'),'pat status missing')
  assert.equal(await pet.locator('.speech').count(),0)
  assert.equal(await pet.getByTestId('pet-chat-panel').count(),0)
  await pet.screenshot({path:join(output,'status-pat.png')})
  checks.push('restored full-character frame sequences; pet status has no brand; pat gives a local status without a fictional spoken/chat message')
  const home = (await pet.evaluate(()=>window.desktopPet.get())).position
  const before = await art.boundingBox()
  await click(caption); await pet.getByTestId('desktop-pet-menu').waitFor(); await pause(500)
  const current = await art.boundingBox()
  assert.ok(Math.abs(current.width-before.width)<1 && Math.abs(current.height-before.height)<1)
  assert.equal(await pet.locator('.orbit-node[data-primary]').count(),6)
  assert.equal(await pet.locator('.satellite').count(),0)
  const primaryRects=await pet.locator('[data-primary]').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}}))
  const stage=await pet.getByTestId('desktop-pet-stage').boundingBox()
  for (const rect of primaryRects) { assert.equal(rect.width,56);assert.equal(rect.height,56) }
  assert.ok(primaryRects.some(r=>r.y+r.height<stage.y) && primaryRects.some(r=>r.y>stage.y+stage.height),'functions must form a full ring above and below the character')
  assert.ok(primaryRects.some(r=>r.x<stage.x) && primaryRects.some(r=>r.x>stage.x+stage.width-r.width),'functions must surround both sides')
  assert.equal(await pet.locator('[data-primary]').first().evaluate(node=>getComputedStyle(node).backgroundColor),'rgb(250, 247, 239)')
  await pet.screenshot({path:join(output,'radial-menu.png')})
  await pet.getByTestId('pet-radial-interact').hover()
  await pet.getByTestId('pet-handshake').waitFor(); await pause(350)
  await pet.screenshot({path:join(output,'radial-interact.png')})
  await click(pet.getByTestId('pet-handshake'))
  await pause(50)
  assert.equal((await pet.evaluate(()=>window.desktopPet.get())).layout.kind,'menu','native window collapsed before its leave animation')
  await pet.getByTestId('desktop-pet-menu').waitFor({state:'detached'})
  await until(async () => (await pet.evaluate(()=>window.desktopPet.get())).layout.kind===null,'orbit did not collapse')
  assert.deepEqual((await pet.evaluate(()=>window.desktopPet.get())).position,home)
  await pet.locator('[data-testid="pet-artwork"][data-intent="handshake"]').waitFor()
  await pause(1100); await pet.screenshot({path:join(output,'frames-handshake.png')})
  checks.push('six full-ring functions in archive paper/jade style, hover-expanded subactions, animated close before native collapse, unchanged character size and saved home')
  await click(caption); await click(pet.getByTestId('pet-radial-settings'))
  await pet.getByTestId('pet-open-settings').waitFor()
  await pet.getByTestId('pet-open-settings').focus(); await pet.keyboard.press('ArrowRight')
  assert.equal(await pet.getByTestId('pet-voice').evaluate(e=>e===document.activeElement),true)
  await pause(300); await pet.screenshot({path:join(output,'radial-settings.png')})
  await pet.keyboard.press('Escape')
  await pause(600)
  observations.push({case:'submenu-escape',expanded:await pet.locator('[aria-expanded="true"]').evaluateAll(nodes=>nodes.map(n=>n.dataset.testid)),focus:await pet.evaluate(()=>document.activeElement?.getAttribute('data-testid')),satellites:await pet.locator('.satellite').count()})
  await until(async()=>await pet.locator('.satellite').count()===0,'submenus did not finish their exit animation')
  await pet.getByTestId('pet-radial-care').hover()
  await pet.getByTestId('pet-use-food').waitFor()
  await pet.getByTestId('pet-use-food').press('Escape')
  await until(async()=>await pet.locator('.satellite').count()===0,'pointer-to-keyboard switch did not dismiss submenu')
  await pet.getByTestId('pet-window-menu-toggle').press('Escape')
  await pet.getByTestId('desktop-pet-menu').waitFor({state:'detached'})
  checks.push('ring keyboard navigation and two-level Escape dismissal work from a focused control')

  await pet.evaluate(()=>window.desktopPet.command({type:'settings'}))
  const preview=page.getByTestId('pet-action-preview'), canvas=preview.locator('canvas')
  await preview.waitFor(); await preview.scrollIntoViewIfNeeded()
  const inventory=await page.evaluate(()=>window.companionCare.get())
  await canvas.evaluate(canvas => {
    const stream=canvas.captureStream(60), chunks=[]
    const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp9'})
    window.petFrameRecording={stream,chunks,recorder}
    recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)}
    recorder.start(200)
  })
  const actions=['idle','blink','greet','pat','handshake','drag','land','thinking','speaking','listening','writing','success','warning','stretch','playing','eating','drinking','sleeping']
  for (const intent of actions) {
    // Sample inside the renderer from the matching clip's actual start. Two
    // CDP screenshots can both arrive after a short one-shot has already ended.
    const samples=await preview.evaluate((element,intent)=>new Promise((resolve,reject)=>{
      const art=element.querySelector('[data-testid="pet-artwork"]'), canvas=element.querySelector('canvas')
      let first, frameRequest=0
      const cleanup=()=>{clearTimeout(timeout);observer.disconnect();cancelAnimationFrame(frameRequest)}
      const timeout=setTimeout(()=>{cleanup();reject(new Error(`${intent}: no changing rendered frames within 10s`))},10000)
      const sample=()=>{
        if(art.dataset.clip!==intent){cleanup();reject(new Error(`${intent}: clip replaced before motion sample`));return}
        const frame=art.dataset.frame
        if(!first) first={frame,pixels:canvas.toDataURL('image/png')}
        else if(frame!==first.frame){
          const second={frame,pixels:canvas.toDataURL('image/png')}
          if(second.pixels!==first.pixels){cleanup();resolve([first,second]);return}
        }
        frameRequest=requestAnimationFrame(sample)
      }
      const observer=new MutationObserver(()=>{
        if(art.dataset.clip===intent&&!frameRequest) frameRequest=requestAnimationFrame(sample)
      })
      observer.observe(art,{attributes:true,attributeFilter:['data-clip']})
      document.querySelector(`[data-testid="pet-preview-${intent}"]`).click()
    }),intent)
    const a=createHash('sha256').update(samples[0].pixels).digest('hex'), b=createHash('sha256').update(samples[1].pixels).digest('hex')
    assert.notEqual(samples[0].frame,samples[1].frame,`${intent} did not advance drawn frames`)
    assert.notEqual(a,b,`${intent} did not change rendered pixels`)
    await pause(450)
    await preview.screenshot({path:join(output,`frames-${intent}.png`)})
    observations.push({case:'frame-sequence',intent,frames:samples.map(s=>s.frame),first:a,second:b,renderer:await preview.locator('[data-testid="pet-artwork"]').getAttribute('data-animation-system')})
  }
  const recording=await canvas.evaluate(async()=>{
    const {stream,chunks,recorder}=window.petFrameRecording
    await new Promise(resolve=>{recorder.onstop=resolve;recorder.stop()})
    stream.getTracks().forEach(t=>t.stop());delete window.petFrameRecording
    return Array.from(new Uint8Array(await new Blob(chunks,{type:'video/webm'}).arrayBuffer()))
  })
  await writeFile(join(output,'frames-actions.webm'),Buffer.from(recording))
  const after=await page.evaluate(()=>window.companionCare.get())
  assert.deepEqual(after.inventory,inventory.inventory);assert.equal(after.coins,inventory.coins)
  checks.push('all 18 full-character frame actions render changing poses, previews do not consume items; 60fps output stream recorded (authored frame count is separate) without microphone')
  // Leave the owner workbench available for recovery menu tests.
  await page.getByRole('button',{name:'返回写作',exact:true}).first().click().catch(async()=>{
    await pet.evaluate(()=>window.desktopPet.command({type:'return-to-writing'}))
  })
  await page.getByTestId('desktop-pet-tools-toggle').waitFor()
  observations.push({case:'radial-final-home',bounds:await bounds()})
}
