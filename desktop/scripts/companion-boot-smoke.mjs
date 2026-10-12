import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { chromium } from 'playwright'

// Isolated real Vue opening + runtime owner. Deferred models are a deterministic IPC fixture,
// not evidence of real model cold-start speed. No author profile or work files are accessed.
const root = process.cwd(), output = resolve(root, 'artifacts/ui/companion-boot')
await mkdir(output, { recursive: true })
const entry = `
import {createApp,h,ref} from 'vue';
import Boot from '/src/renderer/app/components/AppBootScreen.vue';
import {useCompanionRuntime} from '/src/renderer/features/companion/composables/use-companion-runtime';
import {useCompanionBoot} from '/src/renderer/features/companion/composables/use-companion-boot';
import {useCompanionVoicePreferences} from '/src/renderer/features/companion/composables/use-companion-voice-preferences';
import '/src/renderer/assets/narrative-tokens.css';
const q=new URLSearchParams(location.search);
document.documentElement.dataset.theme=q.get('appTheme')||'moye';
window.calls={configure:0,warmup:0,complete:0}; window.events=[];
let settle, shown;
window.finishModels=value=>settle(value); window.showNative=()=>shown();
window.novelDesktop={app:{onWindowShown(callback){shown=callback;return()=>{}}},companionVoice:{
 configure:async()=>{window.calls.configure++;return true}, warmup:()=>{window.calls.warmup++;return new Promise(resolve=>settle=resolve)}, suspend:async()=>true}};
useCompanionVoicePreferences().update({textModel:q.has('text'),mute:q.has('no-models'),preload:!q.has('on-demand')});
createApp({setup(){
 const core=ref('ready'),error=ref(''),preview=ref(q.has('preview')),open=ref(true);
 if(!preview.value)useCompanionRuntime();
 const boot=useCompanionBoot(core,error,preview);
 window.failCore=()=>error.value='作品索引暂时不可读';
 const enter=()=>{window.calls.complete++;window.events.push({event:'entered',time:performance.now()});open.value=false};
 return()=>h('main',{},[h('div',{'data-testid':'library'},'作品库'),open.value?h(Boot,{phase:boot.phase.value,error:boot.error.value,detail:boot.detail.value,modelsRequired:boot.required.value&&!boot.skipped.value,canSkipModels:boot.canSkip.value,preview:preview.value,theme:q.get('style')||'impact',onComplete:enter,onSkip:enter,onSkipModels:boot.skipWaiting,onRetry:boot.retryModels}):null])
}}).mount('#app');`
const server = await createServer({ root, configFile: false, plugins: [vue(), {
  name: 'companion-boot-smoke', resolveId(id) { if (id === '/companion-boot-entry.js') return id },
  load(id) { if (id === '/companion-boot-entry.js') return entry },
  configureServer(server) { server.middlewares.use((req,res,next) => {
    if (!req.url?.startsWith('/companion-boot-smoke')) return next()
    res.setHeader('Content-Type','text/html; charset=utf-8')
    res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;--sans:"Microsoft YaHei UI",sans-serif}</style><div id="app"></div><script type="module" src="/companion-boot-entry.js"></script></html>')
  }) },
}], server: {host:'127.0.0.1',port:0} })
await server.listen()
const browser = await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true})
const page = await browser.newPage({ viewport: {width:1440,height:900} })
const errors=[],checks=[]
page.on('pageerror', error => errors.push(error.message))
const start=async query=>{await page.goto(server.resolvedUrls.local[0]+'companion-boot-smoke?'+query);await page.getByTestId('app-boot').waitFor();await page.waitForFunction(()=>typeof window.showNative==='function')}
try {
  await start('')
  await page.waitForFunction(()=>window.calls.warmup===1)
  await page.waitForTimeout(3500)
  assert.equal(await page.getByTestId('app-boot').getAttribute('data-boot-phase'),'models')
  assert.equal(await page.evaluate(()=>window.calls.complete),0)
  await page.evaluate(()=>window.showNative())
  await page.waitForTimeout(1200)
  await page.screenshot({path:resolve(output,'loading.png')})
  assert.equal(await page.locator('.boot-note').count(),0,'ordinary loading has no animation-mechanics copy')
  const waitingFooter = await page.locator('.boot-footer').boundingBox()
  assert.ok(Math.abs(waitingFooter.y + waitingFooter.height - 900) < 1)
  const readyAt=await page.evaluate(()=>{window.finishModels(true);return performance.now()})
  await page.waitForFunction(()=>document.querySelector('[data-testid="app-boot"]')?.getAttribute('data-boot-phase')==='ready')
  assert.equal(await page.locator('.boot-current').evaluate(el => getComputedStyle(el).opacity), '0')
  assert.equal(await page.locator('.boot-ready-check').count(), 0)
  const readyFooter = await page.locator('.boot-footer').boundingBox()
  assert.deepEqual(readyFooter, waitingFooter, 'footer must not move when skip action disappears')
  assert.equal(await page.locator('.boot-note').count(),0,'ready does not explain its animation implementation')
  await page.screenshot({path:resolve(output,'ready.png')})
  await page.waitForTimeout(2400)
  assert.equal(await page.getByTestId('app-boot').count(),1)
  await page.getByTestId('app-boot').waitFor({state:'detached'})
  const elapsed=await page.evaluate(at=>window.events[0].time-at,readyAt)
  assert.ok(elapsed>=2900&&elapsed<4500,`completion duration ${elapsed}`)
  assert.equal(await page.evaluate(()=>window.calls.warmup),1)
  checks.push({name:'models-gate-then-three-seconds',elapsed})

  await start('appTheme=xuanzhi&style=standard')
  await page.waitForFunction(()=>window.calls.warmup===1)
  await page.evaluate(()=>window.finishModels(true))
  await page.waitForTimeout(3500)
  assert.equal(await page.evaluate(()=>window.calls.complete),0,'native visibility gate must hold completion')
  assert.equal(await page.getByTestId('app-boot-enter').count(),0)
  await page.evaluate(()=>window.showNative())
  await page.getByTestId('app-boot').waitFor({state:'detached'})
  checks.push({name:'native-gate-then-auto-entry'})

  await start('')
  await page.waitForFunction(()=>window.calls.warmup===1)
  await page.evaluate(()=>{window.showNative();window.finishModels(false)})
  await page.getByTestId('app-boot-retry').waitFor()
  await page.screenshot({path:resolve(output,'failed.png')})
  await page.getByTestId('app-boot-retry').click()
  await page.waitForFunction(()=>window.calls.warmup===2)
  await page.getByTestId('app-boot-skip-models').click()
  assert.match(await page.locator('.boot-current').innerText(),/已跳过模型等待/)
  assert.doesNotMatch(await page.locator('.boot-steps').innerText(),/准备看板娘模型/)
  await page.getByTestId('app-boot').waitFor({state:'detached'})
  checks.push({name:'failure-retry-explicit-skip'})

  for(const query of ['no-models=1','on-demand=1','preview=1']) {
    await start(query); await page.evaluate(()=>window.showNative()); await page.waitForTimeout(3500)
    assert.equal(await page.evaluate(()=>window.calls.warmup),0)
    assert.equal(await page.getByTestId('app-boot').count(),query.includes('preview')?1:0)
    checks.push({name:query})
  }
  await start('no-models=1'); await page.evaluate(()=>{window.failCore();window.showNative()})
  await page.waitForTimeout(3500)
  assert.equal(await page.getByTestId('app-boot').count(),1)
  assert.equal(await page.getByTestId('app-boot-enter').count(),0)
  checks.push({name:'core-error-never-enters'})
  for (const [width,height] of [[1024,640],[760,540],[480,600]]) {
    await page.setViewportSize({width,height})
    await start(''); await page.evaluate(()=>window.showNative())
    await page.getByTestId('app-boot-skip-models').waitFor()
    const pending=await page.locator('.boot-footer').boundingBox()
    assert.ok(Math.abs(pending.y+pending.height-height)<1, `footer anchored at ${width}`)
    await page.evaluate(()=>window.finishModels(false))
    await page.getByTestId('app-boot-retry').waitFor()
    const failed=await page.locator('.boot-footer').boundingBox()
    assert.deepEqual(failed,pending, `failure does not grow footer at ${width}`)
    await page.getByTestId('app-boot-skip-models').click()
    const ready=await page.locator('.boot-footer').boundingBox()
    assert.deepEqual(ready,pending, `ready does not shrink footer at ${width}`)
    await page.screenshot({path:resolve(output,`ready-${width}.png`)})
    checks.push({name:`stable-footer-${width}x${height}`})
  }
  assert.deepEqual(errors,[])
  await writeFile(resolve(output,'verification.json'),JSON.stringify({checks,errors},null,2))
  console.log(JSON.stringify({checks,errors,output}))
} finally { await browser.close(); await server.close() }
