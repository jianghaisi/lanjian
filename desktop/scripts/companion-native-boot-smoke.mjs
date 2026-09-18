import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { _electron } from 'playwright'

// Opt-in real installed GPT-SoVITS; an empty temporary app profile, never author books/settings.
const output = resolve('artifacts/ui/companion-native-boot')
const profile = await mkdtemp(join(tmpdir(), 'lanjian-companion-boot-'))
await mkdir(output, { recursive: true })
const env = { ...process.env, LANJIAN_USER_DATA_PATH: profile }
delete env.ELECTRON_RUN_AS_NODE
delete env.LANJIAN_SMOKE
const started = Date.now()
const app = await _electron.launch({args:['.'],env,timeout:30000})
const result = { profile, entered: false, readyMs: 0, handoffMs: 0, firstAudioMs: 0, audioBytes: 0, peak: 0, sources: 0, ended: 0, audible: false }
try {
  const page = await app.firstWindow()
  page.setDefaultTimeout(30000)
  await page.getByTestId('app-boot').waitFor()
  await page.waitForFunction(()=>document.querySelector('[data-testid="app-boot"]')?.getAttribute('data-boot-phase')==='models',{},{timeout:30000})
  await page.screenshot({path:join(output,'loading.png')})
  await page.waitForFunction(()=>document.querySelector('[data-testid="app-boot"]')?.getAttribute('data-boot-phase')==='ready',{},{timeout:180000})
  result.readyMs = Date.now()-started
  await page.screenshot({path:join(output,'ready.png')})
  const readyAt=Date.now()
  await page.getByTestId('app-boot').waitFor({state:'detached',timeout:10000})
  result.handoffMs=Date.now()-readyAt; result.entered=true
  await page.evaluate(()=>{
    window.audioEvidence={bytes:0,peak:0,sources:0,ended:0,first:0,lastEnd:0}
    window.novelDesktop.companionVoice.onEvent(event=>{
      if(event.kind!=='audio')return
      const value=window.audioEvidence;value.bytes+=event.pcm.byteLength;value.first||=performance.now()
      const view=new DataView(event.pcm.buffer,event.pcm.byteOffset,event.pcm.byteLength)
      for(let i=0;i<view.byteLength;i+=2)value.peak=Math.max(value.peak,Math.abs(view.getInt16(i,true)))
    })
    const original=AudioBufferSourceNode.prototype.start
    AudioBufferSourceNode.prototype.start=function(...args){
      window.audioEvidence.sources++
      this.addEventListener('ended',()=>{window.audioEvidence.ended++;window.audioEvidence.lastEnd=performance.now()},{once:true})
      return original.apply(this,args)
    }
  })
  await app.evaluate(({BrowserWindow})=>{const window=BrowserWindow.getAllWindows()[0];window.show();window.focus();window.webContents.focus()})
  const talk=page.getByTestId('archive-character-talk')
  await talk.focus()
  const tappedAt=await page.evaluate(()=>performance.now())
  await page.keyboard.press('Space')
  await page.getByTestId('companion-notice').waitFor({timeout:10000})
  for(let i=0;i<600;i++) {
    const audible=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.isCurrentlyAudible())
    result.audible ||= audible
    if(!await page.getByTestId('companion-notice').count())break
    await page.waitForTimeout(100)
  }
  const audio=await page.evaluate(()=>window.audioEvidence)
  result.firstAudioMs=Math.round(audio.first-tappedAt);result.audioBytes=audio.bytes;result.peak=audio.peak;result.sources=audio.sources;result.ended=audio.ended
  assert.equal(await page.getByTestId('companion-notice').count(),0,'complete notice eventually dismisses')
  assert.ok(audio.bytes>0&&audio.peak>100&&audio.sources>0&&audio.sources===audio.ended,'every scheduled non-silent source finished')
  assert.equal(result.audible,true,'Electron reports actual audio output')
  assert.ok(await page.evaluate(last=>performance.now()-last,audio.lastEnd)>=4400,'caption remains after the final source')
  assert.equal(await page.getByTestId('companion-chat-composer').count(),0)
  await page.screenshot({path:join(output,'library.png')})
  console.log(JSON.stringify(result))
} catch (error) {
  result.error = String(error)
  await app.windows()[0]?.screenshot({path:join(output,'failure.png')}).catch(()=>{})
  throw error
} finally {
  await writeFile(join(output,'verification.json'),JSON.stringify(result,null,2))
  // Only the isolated test application, including a failed renderer that cannot acknowledge quit.
  await app.evaluate(({app})=>app.exit(0)).catch(()=>{})
}
