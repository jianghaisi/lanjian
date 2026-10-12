import assert from 'node:assert/strict'
import { mkdir,writeFile } from 'node:fs/promises'
import { join,resolve } from 'node:path'
import { _electron } from 'playwright'

// Explicit real-platform acceptance. Uses the authorized prepared private root;
// no model inference, author books, original credentials or automatic adoption.
const readExisting=process.argv.includes('--read-existing')
const root=resolve('../.local/inspiration-acceptance'),output=resolve(`../.trellis/tasks/10-11-v3-inspiration-library-video/research/${readExisting?'native-video-reading':'native-video'}`)
await mkdir(output,{recursive:true})
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('LANJIAN_')&&!['ELECTRON_RUN_AS_NODE','ELECTRON_RENDERER_URL'].includes(k)))
env.LANJIAN_USER_DATA_PATH=root;env.LANJIAN_GLOBAL_MODEL_DATA_PATH=join(root,'empty-model-settings')
const app=await _electron.launch({args:[resolve('out/main/index.js'),'--disable-gpu'],env})
const errors=[]
try{
  const page=await app.firstWindow(),owner=await app.browserWindow(page)
  page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message))
  await owner.evaluate(w=>{w.setContentSize(1440,960);w.show()})
  await page.waitForFunction(()=>Boolean(window.novelDesktop?.inspiration))
  await page.evaluate(async()=>{localStorage.setItem('lanjian-loading-v1',JSON.stringify({theme:'impact',bootStyle:'brief',bootPalette:'system'}));await window.companionSettings?.update({voice:{mute:true,textModel:false,preload:false}})})
  await page.reload();await page.waitForFunction(()=>['app-boot-enter','app-boot-skip-models'].some(id=>document.querySelector(`[data-testid="${id}"]`)?.getClientRects().length),undefined,{timeout:60000})
  if(await page.getByTestId('app-boot-skip-models').isVisible())await page.getByTestId('app-boot-skip-models').click();else await page.getByTestId('app-boot-enter').click()
  await page.getByTestId('app-boot').waitFor({state:'hidden',timeout:60000})
  await page.getByTestId('open-inspiration-library').click()
  if(readExisting){
    const source=await page.evaluate(async()=>(await window.novelDesktop.inspiration.listSources()).find(s=>s.platform==='bilibili'&&s.method==='asr'))
    assert.ok(source,'requires the saved real Bilibili acceptance source')
    await page.locator('.inspiration-source-shelf article').filter({hasText:source.title}).getByRole('button',{name:'阅读原文',exact:true}).click()
    const reader=page.getByRole('complementary',{name:'完整来源',exact:true})
    const link=reader.getByRole('link',{name:/^从 /}).nth(1);await link.waitFor()
    const expected=await link.getAttribute('href');assert.ok(Number(new URL(expected).searchParams.get('t'))>0)
    await app.evaluate(({shell})=>{globalThis.__inspirationOpened=[];shell.openExternal=async url=>{globalThis.__inspirationOpened.push(url)}})
    await link.click();let opened=[]
    for(let i=0;i<30;i++){opened=await app.evaluate(()=>globalThis.__inspirationOpened);if(opened.length)break;await page.waitForTimeout(50)}
    assert.deepEqual(opened,[expected]);assert.ok(page.url().startsWith('file:'))
    await page.screenshot({path:join(output,'01-timed-reading.png')})
    await writeFile(join(output,'checks.json'),JSON.stringify({production:true,modelCalls:0,newAcquisition:false,sourceId:source.id,externalLink:expected,errors},null,2));assert.deepEqual(errors,[])
    console.log('PASS production original video reading → real timestamp link → guarded external open; no acquisition or inference')
  }else{
  await page.getByRole('button',{name:'从视频提取',exact:true}).click()
  const capabilities=await page.evaluate(()=>window.novelDesktop.inspiration.capabilities());assert.equal(capabilities.asr,true)
  await page.getByRole('textbox',{name:'视频链接'}).fill('https://www.bilibili.com/video/BV13x41117TL')
  await page.getByRole('button',{name:'提取视频',exact:true}).click()
  await page.getByRole('button',{name:'停止视频提取'}).waitFor()
  await page.screenshot({path:join(output,'01-running.png')})
  const preview=page.getByRole('dialog',{name:'核对来源导入'})
  await preview.waitFor({timeout:15*60_000})
  await preview.locator('summary').click();assert.match(await preview.textContent(),/实际语音转写/)
  await page.screenshot({path:join(output,'02-transcript-preview.png')})
  const job=await page.evaluate(async()=>(await window.novelDesktop.inspiration.listVideoJobs())[0])
  assert.equal(job.status,'succeeded');assert.equal(job.preview.sources[0].visualCoverage,'none')
  await preview.getByRole('button',{name:'确认收入灵感库'}).click();await preview.waitFor({state:'hidden'})
  const source=await page.evaluate(async()=>(await window.novelDesktop.inspiration.listSources())[0])
  assert.equal(source.method,'asr')
  const text=await page.evaluate(s=>window.novelDesktop.inspiration.readSource({sourceId:s.id,sourceVersion:s.version,offset:0,limit:20}),source)
  assert.ok(text.segments.every(s=>s.startSeconds!==null&&s.endSeconds>=s.startSeconds))
  assert.deepEqual(errors,[])
  await page.screenshot({path:join(output,'03-imported.png')})
  await writeFile(join(output,'checks.json'),JSON.stringify({production:true,modelCalls:0,capabilities,job:{status:job.status,stage:job.stage},source,segmentCount:text.segments.length,errors},null,2))
  console.log('PASS production Electron real video → local ASR → preview → explicit private import')
  }
}catch(error){const page=await app.firstWindow().catch(()=>null);await page?.screenshot({path:join(output,'failed.png')}).catch(()=>{});await writeFile(join(output,'failure.txt'),String(error));throw error}finally{await app.close()}
