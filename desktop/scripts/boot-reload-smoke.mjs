import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron } from 'playwright'

// A fresh profile and no-model reloads isolate native visibility from inference cost.
// No injected window-shown signal or author preferences/work files are used.
const profile=await mkdtemp(join(tmpdir(),'lanjian-boot-reload-'))
const output=resolve('artifacts/ui/boot-reload')
await mkdir(output,{recursive:true})
const env={...process.env,LANJIAN_USER_DATA_PATH:profile}
delete env.ELECTRON_RUN_AS_NODE;delete env.LANJIAN_SMOKE
const app=await _electron.launch({args:['.'],env})
const checks=[],errors=[]
try {
  const page=await app.firstWindow()
  page.on('pageerror',error=>errors.push(error.message))
  const boot=page.getByTestId('app-boot')
  // The original bug requires a reload AFTER the first native show, not before it.
  await page.waitForFunction(()=>document.querySelector('[data-testid="app-boot"]')?.classList.contains('motion-ready'))
  await page.evaluate(async()=>{
    localStorage.setItem('lanjian-companion-voice-v1',JSON.stringify({voice:'ningguang',volume:.65,mute:true,proactive:false,subtitles:true,textModel:false,preload:false}))
    await window.novelDesktop.companionVoice.configure({textModel:false,speechModel:false,preload:false,voice:'ningguang'})
  })
  for(let index=1;index<=2;index++) {
    await page.reload()
    await page.waitForFunction(()=>document.querySelector('[data-testid="app-boot"]')?.getAttribute('data-boot-phase')==='ready')
    await page.waitForFunction(()=>document.querySelector('[data-testid="app-boot"]')?.classList.contains('motion-ready'))
    assert.equal(await page.getByTestId('app-boot-enter').count(),1)
    assert.equal(await page.locator('.boot-note').count(),0)
    if(index===1)await page.screenshot({path:join(output,'ready-after-reload.png')})
    await boot.waitFor({state:'detached',timeout:7000})
    checks.push(`shown-window-reload-${index}-automatically-enters`)
  }
  // Reloading while genuinely hidden must NOT consume completion time.
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].hide())
  await page.reload()
  await page.waitForFunction(()=>document.querySelector('[data-testid="app-boot"]')?.getAttribute('data-boot-phase')==='ready',null,{polling:100})
  await page.waitForTimeout(3500)
  assert.equal(await boot.count(),1)
  assert.equal(await boot.evaluate(element=>element.classList.contains('motion-ready')),false)
  const shownAt=Date.now()
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].show())
  await boot.waitFor({state:'detached',timeout:7000})
  assert.ok(Date.now()-shownAt>=2800)
  checks.push('hidden-reload-waits-until-native-show')

  await page.reload()
  await page.getByTestId('app-boot-enter').waitFor()
  await page.getByTestId('app-boot-enter').click()
  await boot.waitFor({state:'detached',timeout:1500})
  checks.push('native-ready-entry-button-works')
  await page.screenshot({path:join(output,'entered-library.png')})
  assert.deepEqual(errors,[])
  console.log(JSON.stringify({checks,errors,output}))
} finally {
  await writeFile(join(output,'verification.json'),JSON.stringify({checks,errors,profile},null,2))
  await app.close()
}
