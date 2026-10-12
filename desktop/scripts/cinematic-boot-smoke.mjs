import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, realpath, copyFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { _electron } from 'playwright'
const require=createRequire(import.meta.url)
const root=await realpath(await mkdtemp(join(tmpdir(),'lanjian-cinematic-')))
const empty=process.argv.includes('--empty')
const layoutOnly=process.argv.includes('--layout-only')
const dark=process.argv.includes('--dark')
const profileHandoff=process.argv.includes('--profile-handoff')
const profileSequence=process.argv.includes('--profile-sequence')
const profileCpu=process.argv.includes('--profile-cpu')
const profileTrace=process.argv.includes('--profile-trace')
const recordVideo=!profileSequence&&!process.argv.includes('--no-video')
const runName=process.env.LANJIAN_CINEMATIC_RUN
const build=process.env.LANJIAN_CINEMATIC_BUILD||'out-cinematic-revision'
const output=resolve('../.trellis/tasks/09-21-v3-cinematic-boot-archive/research',runName||(layoutOnly?'revision-layout':empty?'revision-empty':dark?'revision-dark':'revision-light'))
await mkdir(output,{recursive:true})
const env={...process.env,LANJIAN_USER_DATA_PATH:join(root,'profile'),LANJIAN_GLOBAL_MODEL_DATA_PATH:join(root,'models')}
delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;delete env.LANJIAN_SMOKE
const app=await _electron.launch({executablePath:require('electron'),args:[resolve(build,'main/index.js')],env,recordVideo:recordVideo?{dir:join(output,'video'),size:{width:1440,height:900}}:undefined})
app.process().stderr?.on('data',data=>process.stderr.write(data))
console.log('main-state',await app.evaluate(({app,BrowserWindow})=>({ready:app.isReady(),windows:BrowserWindow.getAllWindows().map(w=>({visible:w.isVisible(),url:w.webContents.getURL()}))})))
const checks=[],errors=[]
let page,owner
let frames=[]
async function capture(name){
  if(profileSequence&&name!=='failure')return
  const data=await owner.evaluate(async win=>{const i=await win.webContents.capturePage();return {size:i.getSize(),data:i.toPNG().toString('base64')}})
  assert.ok(data.size.width>600&&data.size.height>400)
  await writeFile(join(output,`${name}.png`),Buffer.from(data.data,'base64'))
}
async function assertCompleteFace(locator){
  const face=await locator.evaluate(card=>{
    const box=card.getBoundingClientRect()
    const selectors=['.dossier-progress>div>span','.dossier-copy footer>span:first-child','.dossier-copy footer>span:last-child','.dossier-side-note','.dossier-data-row small']
    return {clip:getComputedStyle(card).clipPath,parts:selectors.flatMap(selector=>Array.from(card.querySelectorAll(selector),e=>{const r=e.getBoundingClientRect();return {selector,visible:getComputedStyle(e).display!=='none'&&r.width>0&&r.height>0,fits:r.left>=box.left-1&&r.right<=box.right+1&&r.bottom<=box.bottom+1}}))}
  })
  assert.equal(face.clip,'none');assert.equal(face.parts.length,6)
  assert.ok(face.parts.every(p=>p.visible&&p.fits),JSON.stringify(face))
}
try{
  page=await app.firstWindow({timeout:60000});owner=await app.browserWindow(page)
  page.on('pageerror',error=>errors.push(error.message))
  await owner.evaluate((win,unthrottled)=>{if(win.isMaximized())win.unmaximize();win.setMinimumSize(800,600);win.setContentSize(1440,900);win.webContents.setBackgroundThrottling(!unthrottled);win.show();win.focus()},recordVideo||profileCpu||profileTrace)
  await page.waitForFunction(()=>!!window.novelDesktop)
  await page.evaluate(async()=>{
    localStorage.setItem('lanjian-companion-voice-v1',JSON.stringify({voice:'ningguang',volume:.65,mute:true,proactive:false,subtitles:true,textModel:false,speechModel:false,preload:false}))
    await window.companionSettings.update({voice:{mute:true,textModel:false,preload:false,proactive:false}})
    await window.novelDesktop.companionVoice.configure({textModel:false,speechModel:false,preload:false,voice:'ningguang'})
  })
  const books=empty?[]:await page.evaluate(async parentPath=>{
    const result=[]
    for(const title of ['雾海来信','月落于群山之间'])result.push((await window.novelDesktop.projects.create({parentPath,title,name:title})).project)
    return result
  },root)
  await page.evaluate(dark=>localStorage.setItem('lanjian-loading-v1',JSON.stringify({theme:'impact',bootStyle:'cinematic',bootPalette:dark?'dark':'light'})),dark)
  if(empty){
    await page.addInitScript(()=>{
      const original=HTMLCanvasElement.prototype.getContext
      HTMLCanvasElement.prototype.getContext=function(type,...args){return type.startsWith('webgl')?null:original.call(this,type,...args)}
    })
    await owner.evaluate(win=>win.hide())
  }
  await page.reload()
  if(empty){
    await page.waitForTimeout(1500)
    assert.equal(Number(await page.getByTestId('app-boot').getAttribute('data-cinematic-time')),0)
    await owner.evaluate(win=>{win.show();win.focus()})
    checks.push('hidden-native-reload-does-not-consume-presentation')
  }
  if(!layoutOnly){
  const started=Date.now()
  // show() alone does not restore a minimized native window on Windows.
  // Establish the intended visible test state; never forge the renderer's shown event.
  await owner.evaluate(win=>{if(win.isMinimized())win.restore();win.show();win.focus()})
  console.log('sequence-visibility', await owner.evaluate(win=>({visible:win.isVisible(),minimized:win.isMinimized(),focused:win.isFocused()})))
  await page.waitForFunction(()=>document.querySelector('[data-testid="app-boot"]')?.classList.contains('motion-ready'))
  console.log('native visible; full sequence started')
  const cpu=profileCpu?await page.context().newCDPSession(page):null
  const tracing=profileTrace?await page.context().newCDPSession(page):null
  let cpuStart=0
  if(cpu){await cpu.send('Profiler.enable');await cpu.send('Profiler.setSamplingInterval',{interval:1000});cpuStart=await page.evaluate(()=>performance.now());await cpu.send('Profiler.start')}
  await page.evaluate(()=>{
    window.__cinemaFrames=[];window.__cinemaPhaseFrames=[];let last=performance.now()
    const measure=now=>{const node=document.querySelector('[data-testid="app-boot"]');if(!node)return;const t=Number(node.getAttribute('data-cinematic-time'));if(t>=12&&t<=33){window.__cinemaFrames.push(now-last);window.__cinemaPhaseFrames.push({stage:node.getAttribute('data-cinematic-stage'),time:t,dt:now-last,now})}last=now;requestAnimationFrame(measure)}
    requestAnimationFrame(measure)
  })
  let scanCore
  for(const [name,time] of [['01-access',.6],['02-logo',2.5],['03-identity',4.5],['04-scan-large',5.3],['04-scan',7.8],['04-shutter',9],['05-welcome',10.5],['05-shutter',12],['06-wave-left',13.8],['06-array',15.3],['06-wave-right',18.2],['07-extraction',24.6],['08-macro',26.7],['08-structure',28.6],['09-front',33]]){
    await page.waitForFunction(t=>Number(document.querySelector('[data-testid="app-boot"]')?.getAttribute('data-cinematic-time')??0)>=t,time,{timeout:120000})
    await capture(name);console.log(name)
    if(!empty&&name==='05-welcome'){
      const hidden=await page.evaluate(()=>{const e=document.querySelector('.archive-telemetry');window.__firstArchiveCaption=document.querySelector('.scene-caption');return {visibility:getComputedStyle(e).visibility,hidden:e.getAttribute('aria-hidden'),paused:e.getAnimations({subtree:true}).every(a=>a.playState==='paused')}})
      assert.deepEqual(hidden,{visibility:'hidden',hidden:'true',paused:true})
    }
    if(!empty&&name==='06-array'){
      const revealed=await page.evaluate(()=>({visibility:getComputedStyle(document.querySelector('.archive-telemetry')).visibility,same:window.__firstArchiveCaption===document.querySelector('.scene-caption'),hidden:document.querySelector('.archive-telemetry').getAttribute('aria-hidden')}))
      assert.deepEqual(revealed,{visibility:'visible',same:true,hidden:'false'})
      checks.push('archive-labels-prelayout-hidden-and-retain-identity-through-reveal')
    }
    if(tracing&&name==='05-welcome')await tracing.send('Tracing.start',{categories:'devtools.timeline,blink.user_timing,disabled-by-default-devtools.timeline,gpu',transferMode:'ReturnAsStream'})
    if(tracing&&name==='06-array'){
      const done=new Promise(resolve=>tracing.once('Tracing.tracingComplete',resolve));await tracing.send('Tracing.end');const {stream}=await done
      let trace='';for(;;){const part=await tracing.send('IO.read',{handle:stream});trace+=part.data;if(part.eof)break}
      await tracing.send('IO.close',{handle:stream});await writeFile(join(output,'reveal-trace.json'),trace);await tracing.detach()
    }
    if(cpu&&name==='06-array'){const result=await cpu.send('Profiler.stop');await writeFile(join(output,'reveal-cpu.json'),JSON.stringify({cpuStart,...result,frames:await page.evaluate(()=>window.__cinemaPhaseFrames)}));await cpu.detach()}
    if(name==='04-scan-large')scanCore=await page.locator('.scan-core').boundingBox()
    if(name==='04-scan'){
      const core=await page.locator('.scan-core').boundingBox()
      assert.ok(Math.abs(core.width-scanCore.width)<1&&Math.abs(core.height-scanCore.height)<1,'only the rings shrink; core typography must stay stable')
      checks.push('scan-core-stable-during-ring-contraction')
    }
  }
  const boot=page.getByTestId('app-boot')
  assert.equal(await boot.getAttribute('data-scene-state'),empty?'fallback':'ready')
  assert.ok(Date.now()-started>=32000)
  await page.waitForTimeout(3100)
  assert.equal(await boot.count(),1)
  checks.push('full-real-time-sequence-and-waits-for-click')
  const before=empty?null:await page.locator('[data-testid="library-continue-writing"] h2').textContent()
  if(!empty)assert.equal(await page.locator('.arrival-face [data-testid="boot-dossier"] h2').textContent(),before)
  if(!empty){
    await assertCompleteFace(page.locator('.arrival-face').getByTestId('boot-dossier'))
    const colour=await page.getByTestId('library-continue-writing').evaluate(e=>getComputedStyle(e).backgroundColor)
    assert.notEqual(colour,'rgba(0, 0, 0, 0)','real target needs an opaque backing before hover removes its gradient')
    checks.push('complete-dossier-face-retains-index-quote-date-and-rectangular-frame')
  }
  await page.evaluate(()=>{
    window.__arrivalTrace=[]
    let last=performance.now()
    const measure=now=>{
      const boot=document.querySelector('[data-testid="app-boot"]')
      if(!boot)return
      const face=document.querySelector('.arrival-face'),target=document.querySelector('.project-library .continue-dossier')
      if(boot.getAttribute('data-cinematic-stage')==='handoff'&&face&&target){const a=face.getBoundingClientRect(),b=target.getBoundingClientRect();window.__arrivalTrace.push({dt:now-last,error:Math.max(...['x','y','width','height'].map(k=>Math.abs(a[k]-b[k]))),x:a.x,y:a.y})}
      last=now
      requestAnimationFrame(measure)
    };requestAnimationFrame(measure)
  })
  const profiler=await page.context().newCDPSession(page)
  await profiler.send('Performance.enable')
  const beforeMetrics=await profiler.send('Performance.getMetrics')
  if(empty)await page.locator('.arrival-face').click();else await page.locator('.arrival-face').getByTestId('boot-dossier').click()
  if(!profileHandoff){
    await page.waitForTimeout(650)
    const reveal=await page.locator('.landing-face').evaluate(e=>({opacity:getComputedStyle(e).opacity,clip:getComputedStyle(e).clipPath}))
    assert.equal(reveal.opacity,'1','destination text must replace, not translucently double, the source lettering')
    assert.notEqual(reveal.clip,'none','layout change uses a directional opaque reveal')
    await capture('10-handoff')
    await owner.evaluate(win=>{win.setContentSize(1100,760);win.webContents.setZoomFactor(1.25)})
  }
  await boot.waitFor({state:'detached',timeout:5000})
  const afterMetrics=await profiler.send('Performance.getMetrics')
  const metrics=Object.fromEntries(['LayoutCount','LayoutDuration','RecalcStyleCount','RecalcStyleDuration','TaskDuration'].map(name=>[name,afterMetrics.metrics.find(m=>m.name===name).value-beforeMetrics.metrics.find(m=>m.name===name).value]))
  await writeFile(join(output,'handoff-performance.json'),JSON.stringify(metrics,null,2))
  await profiler.detach()
  assert.equal(await page.getByTestId('workspace-loading').count(),0)
  if(!empty)assert.equal(await page.locator('[data-testid="library-continue-writing"] h2').textContent(),before)
  const trace=await page.evaluate(()=>window.__arrivalTrace)
  await writeFile(join(output,'arrival-geometry.json'),JSON.stringify(trace,null,2))
  assert.ok(trace.length>5)
  assert.ok(trace.at(-1).error<=2,JSON.stringify(trace.slice(-3)))
  checks.push(profileHandoff?'normal-handoff-final-alignment-within-two-css-pixels':'resize-during-handoff-final-alignment-within-two-css-pixels')
  await capture('11-library')
  if(!empty){await assertCompleteFace(page.getByTestId('library-continue-writing'));checks.push('compact-library-retains-all-dossier-modules')}
  checks.push('real-work-shared-face-click-enters-library-only')
  const phaseFrames=await page.evaluate(()=>window.__cinemaPhaseFrames)
  const phaseSummary=Object.fromEntries([...new Set(phaseFrames.map(f=>f.stage))].map(stage=>{
    const dts=phaseFrames.filter(f=>f.stage===stage).map(f=>f.dt).sort((a,b)=>a-b)
    return [stage,{frames:dts.length,p95:dts[Math.floor(dts.length*.95)],max:dts.at(-1),over50:dts.filter(n=>n>50).length,slowFrames:phaseFrames.filter(f=>f.stage===stage&&f.dt>50)}]
  }))
  await writeFile(join(output,'phase-performance.json'),JSON.stringify(phaseSummary,null,2))
  frames=await page.evaluate(()=>window.__cinemaFrames)
  frames.sort((a,b)=>a-b)
  console.log(JSON.stringify({frames:frames.length,median:frames[Math.floor(frames.length*.5)],p95:frames[Math.floor(frames.length*.95)]}))
  }
  // Reduced motion must bypass the full presentation, but keep a deliberate entry.
  await page.evaluate(()=>localStorage.setItem('lanjian-loading-v1',JSON.stringify({theme:'impact',bootStyle:'cinematic',bootPalette:'system'})))
  await page.emulateMedia({reducedMotion:'reduce'})
  await page.reload()
  await page.getByTestId('app-boot-enter').waitFor({timeout:20000})
  assert.equal(await page.getByTestId('app-boot').getAttribute('data-scene-state'),'fallback')
  await capture('12-reduced-motion')
  await page.keyboard.press('Enter')
  await page.getByTestId('app-boot').waitFor({state:'detached',timeout:3000})
  checks.push('reduced-motion-keyboard-entry-no-three-context')
  for(const [width,height,zoom,theme] of [[1440,900,.8,'qingzhou'],[1100,760,1.25,'moye'],[1100,760,1,'xuanzhi']]){
    await owner.evaluate((win,{width,height,zoom})=>{win.setContentSize(width,height);win.webContents.setZoomFactor(zoom)}, {width,height,zoom})
    await page.reload();await page.getByTestId('app-boot-enter').waitFor()
    await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme)
    await page.waitForFunction(theme=>theme!=='moye'||document.querySelector('.cinematic-boot')?.classList.contains('dark-archive'),theme)
    if(theme==='moye'){
      const ink=await page.locator('.arrival-heading').evaluate(e=>getComputedStyle(e).color)
      assert.equal(ink,'rgb(238, 239, 231)')
    }
    const geometry=await page.locator('.arrival-face').boundingBox()
    const heading=await page.locator('.arrival-heading').boundingBox()
    const viewport=await page.evaluate(()=>({width:innerWidth,height:innerHeight}))
    assert.ok(geometry.x>=0&&geometry.y>=0&&geometry.x+geometry.width<=viewport.width+1&&geometry.y+geometry.height<=viewport.height+1)
    assert.ok(heading.y+heading.height+8<=geometry.y,'arrival heading must not overlap the dossier')
    await capture(`13-${theme}-${zoom}`)
    if(!empty)await assertCompleteFace(page.locator('.arrival-face').getByTestId('boot-dossier'))
    await page.keyboard.press('Enter');await page.getByTestId('app-boot').waitFor({state:'detached'})
    const mark=await page.locator('.workspace-brand-actions .brand-archive-mark').boundingBox()
    assert.ok(mark.width<=40&&mark.height<=40,'shared SVG must keep the toolbar logo compact')
    checks.push(`reduced-${theme}-${zoom}-fits-and-enters`)
  }
  await page.getByRole('button',{name:'设置',exact:true}).click()
  await page.getByTestId('library-settings-opening').click()
  await page.getByTestId('boot-style-brief').click()
  await page.getByTestId('boot-palette-dark').click()
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('lanjian-loading-v1')))
  assert.equal(saved.bootStyle,'brief');assert.equal(saved.bootPalette,'dark');assert.equal(saved.theme,'impact')
  await capture('14-settings')
  await page.emulateMedia({reducedMotion:'no-preference'})
  await page.getByTestId('loader-preview-boot').click()
  await page.getByTestId('app-boot-enter').waitFor({timeout:5000})
  assert.equal(await page.getByTestId('app-boot').getAttribute('data-boot-style'),'brief')
  assert.equal(await page.getByTestId('app-boot').getAttribute('data-palette'),'dark')
  assert.equal(await page.getByTestId('app-boot').getAttribute('data-scene-state'),'fallback')
  checks.push('settings-persist-independent-boot-style-and-palette-preview')
  await page.getByRole('button',{name:'动画预览 · 关闭 ×',exact:true}).waitFor()
  await page.keyboard.press('Escape')
  await page.getByTestId('loader-preview-dialog').waitFor({state:'detached'})
  assert.equal(await page.getByTestId('loader-preview-boot').evaluate(e=>e===document.activeElement),true)
  checks.push('preview-close-restores-opener-focus')
  await page.reload();await page.getByTestId('app-boot-enter').waitFor({timeout:5000})
  assert.equal(await page.getByTestId('app-boot').getAttribute('data-palette'),'dark')
  await page.keyboard.press('Enter');await page.getByTestId('app-boot').waitFor({state:'detached'})
  checks.push('saved-brief-and-dark-survive-reload-without-os-reduced-motion')
  await page.getByRole('button',{name:'设置',exact:true}).click()
  await page.getByTestId('library-settings-opening').click()
  await page.getByTestId('boot-palette-system').click()
  await page.getByTestId('boot-style-impact').click()
  for(const theme of ['qingzhou','moye']){
    await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme)
    await page.getByTestId('loader-preview-boot').click()
    await page.locator('[data-boot-style="impact"]').waitFor()
    await page.waitForTimeout(1000)
    assert.equal(await page.locator('.archive-canvas').count(),0)
    const bootColour=await page.getByTestId('app-boot').evaluate(e=>getComputedStyle(e).backgroundColor)
    const libraryColour=await page.locator('.project-library').evaluate(e=>getComputedStyle(e).backgroundColor)
    assert.equal(bootColour,theme==='moye'?'rgb(12, 16, 14)':'rgb(16, 23, 21)','original impact colours must be preserved')
    await capture(`15-impact-${theme}`)
    await page.keyboard.press('Escape');await page.getByTestId('loader-preview-dialog').waitFor({state:'detached'})
    await page.getByTestId('loader-preview-work').click()
    await page.getByTestId('workspace-loading').waitFor()
    await page.waitForTimeout(1400)
    const workColour=await page.getByTestId('workspace-loading').evaluate(e=>getComputedStyle(e).backgroundColor)
    assert.equal(workColour,libraryColour)
    await capture(`16-work-${theme}`)
    await page.keyboard.press('Escape');await page.getByTestId('loader-preview-dialog').waitFor({state:'detached'})
  }
  checks.push('original-impact-colours-preserved-and-work-preview-keeps-library-theme')
  await page.reload()
  await page.locator('[data-boot-style="impact"]').waitFor()
  await page.getByTestId('app-boot').waitFor({state:'detached',timeout:20000})
  checks.push('restored-impact-persists-and-enters-after-real-readiness')
  assert.deepEqual(errors,[])
  const listed=await page.evaluate(()=>window.novelDesktop.projects.list())
  assert.equal(listed.projects.length,books.length)
  checks.push('synthetic-library-count-preserved')
  await writeFile(join(output,'frame-times.json'),JSON.stringify({count:frames.length,median:frames[Math.floor(frames.length*.5)],p95:frames[Math.floor(frames.length*.95)]},null,2))
}catch(error){console.error(error);await owner?.evaluate(win=>win.show()).catch(()=>{});await capture('failure').catch(()=>{});throw error}
finally{await writeFile(join(output,'verification.json'),JSON.stringify({checks,errors,profile:root},null,2));const video=page?.video();await app.close();if(video)await copyFile(await video.path(),join(output,'cinematic-boot.webm'))}
console.log(JSON.stringify({checks,errors,output}))
