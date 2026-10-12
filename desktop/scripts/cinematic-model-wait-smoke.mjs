import assert from 'node:assert/strict'
import {mkdtemp,realpath,mkdir,writeFile,copyFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {resolve,join} from 'node:path'
import {createRequire} from 'node:module'
import {_electron} from 'playwright'

// Real built renderer/preload/lifecycle; only the optional model IPC job is deferred.
// This fixture proves waiting behavior, not actual model inference or cold-start speed.
const require=createRequire(import.meta.url)
const profile=await realpath(await mkdtemp(join(tmpdir(),'lanjian-wait-')))
const output=resolve('../.trellis/tasks/09-21-v3-cinematic-boot-archive/research',process.env.LANJIAN_CINEMATIC_RUN||'model-wait-native')
await mkdir(output,{recursive:true})
const env={...process.env,LANJIAN_USER_DATA_PATH:join(profile,'profile'),LANJIAN_GLOBAL_MODEL_DATA_PATH:join(profile,'models')}
delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL
const app=await _electron.launch({executablePath:require('electron'),args:[resolve(process.env.LANJIAN_CINEMATIC_BUILD||'out-cinematic-wait','main/index.js')],env,recordVideo:{dir:join(output,'video'),size:{width:1440,height:900}}})
let page,owner
const checks=[],errors=[]
async function capture(name){const data=await owner.evaluate(async win=>(await win.webContents.capturePage()).toPNG().toString('base64'));await writeFile(join(output,`${name}.png`),Buffer.from(data,'base64'))}
const time=async t=>page.waitForFunction(t=>Number(document.querySelector('[data-testid="app-boot"]')?.getAttribute('data-cinematic-time'))>=t,t,{timeout:60000})
const waitElapsed=async t=>page.waitForFunction(t=>Number(document.querySelector('[data-testid="app-boot"]')?.getAttribute('data-array-wait')??-1)>=t,t,{timeout:30000})
const settle=async value=>app.evaluate((_,value)=>{const pending=globalThis.__modelFixture.pending.splice(0);for(const done of pending)done({ok:true,value})},value)
try{
  page=await app.firstWindow();owner=await app.browserWindow(page)
  page.on('pageerror',e=>errors.push(e.message))
  await owner.evaluate(win=>{if(win.isMaximized())win.unmaximize();win.setContentSize(1440,900);win.webContents.setBackgroundThrottling(false);win.show();win.focus()})
  await page.waitForFunction(()=>!!window.novelDesktop)
  await app.evaluate(({ipcMain})=>{
    globalThis.__modelFixture={calls:0,pending:[],suspends:0}
    for(const name of ['configure','warmup','suspend'])ipcMain.removeHandler(`companion-voice:${name}`)
    ipcMain.handle('companion-voice:configure',()=>({ok:true,value:true}))
    ipcMain.handle('companion-voice:warmup',()=>{globalThis.__modelFixture.calls++;return new Promise(done=>globalThis.__modelFixture.pending.push(done))})
    ipcMain.handle('companion-voice:suspend',()=>{globalThis.__modelFixture.suspends++;return {ok:true,value:true}})
  })
  await page.evaluate(async root=>{
    await window.novelDesktop.projects.create({parentPath:root,title:'等待之后的故事',name:'等待之后的故事'})
    await window.companionSettings.update({voice:{mute:true,textModel:true,preload:true,proactive:false}})
    localStorage.setItem('lanjian-loading-v1',JSON.stringify({theme:'impact',bootStyle:'cinematic',bootPalette:'dark'}))
  },profile)
  await page.reload()
  await time(10)
  assert.equal(await page.getByTestId('app-boot').getAttribute('data-boot-phase'),'models')
  assert.equal(await page.getByTestId('app-boot').getAttribute('data-cinematic-stage'),'welcome')
  assert.equal(await page.getByTestId('app-boot-skip-models').count(),0)
  assert.match(await page.getByTestId('boot-live-load').innerText(),/正在接入本地模型/)
  await capture('01-welcome-while-loading')
  checks.push('pending-model-does-not-freeze-scan-or-welcome')
  await waitElapsed(1)
  assert.equal(await page.getByTestId('boot-dossier').count(),0)
  await page.getByTestId('app-boot-skip-models').waitFor()
  const button=await page.getByTestId('app-boot-skip-models').boundingBox()
  const viewport=await page.evaluate(()=>({w:innerWidth,h:innerHeight}))
  assert.ok(button.x>viewport.w*.6&&button.y>viewport.h*.8)
  await capture('02-first-repeat')
  await waitElapsed(9.5)
  await capture('03-second-repeat')
  assert.equal(await page.getByTestId('app-boot').getAttribute('data-cinematic-stage'),'array')
  assert.equal(await page.getByTestId('boot-dossier').count(),0)
  checks.push('first-pass-then-repeat-array-with-bottom-right-skip-and-no-extraction')
  const releasedAt=Date.now()
  await settle(true)
  await page.waitForTimeout(500)
  assert.equal(await page.getByTestId('app-boot').getAttribute('data-cinematic-stage'),'array')
  await time(20.2)
  assert.ok(Date.now()-releasedAt>3500,'readiness must finish the current sweep')
  await capture('04-ready-after-current-wave')
  await time(33)
  await page.locator('.arrival-face').getByTestId('boot-dossier').waitFor()
  await page.keyboard.press('Enter')
  await page.getByTestId('app-boot').waitFor({state:'detached',timeout:7000})
  assert.equal(await page.getByTestId('workspace-loading').count(),0)
  checks.push('ready-mid-repeat-finishes-wave-then-extraction-and-deliberate-entry')

  await page.reload()
  await waitElapsed(1)
  const before=await app.evaluate(()=>({pending:globalThis.__modelFixture.pending.length,suspends:globalThis.__modelFixture.suspends}))
  await page.getByTestId('app-boot-skip-models').click()
  await page.getByTestId('app-boot').waitFor({state:'detached',timeout:4000})
  assert.equal(await page.getByTestId('workspace-loading').count(),0)
  const after=await app.evaluate(()=>({pending:globalThis.__modelFixture.pending.length,suspends:globalThis.__modelFixture.suspends}))
  assert.deepEqual(after,before,'skip must leave the existing model job running')
  await capture('05-skipped-directly-to-library')
  await settle(true)
  assert.equal(await page.getByTestId('app-boot').count(),0)
  checks.push('skip-enters-library-directly-without-cancelling-or-restarting-model-job')

  await page.emulateMedia({reducedMotion:'reduce'})
  await page.reload()
  await page.getByTestId('app-boot-skip-models').waitFor()
  await settle(false)
  await page.getByRole('button',{name:'重新尝试',exact:true}).waitFor()
  await page.getByTestId('app-boot-skip-models').click()
  await page.getByTestId('app-boot').waitFor({state:'detached',timeout:4000})
  checks.push('failed-model-keeps-retry-and-model-only-skip-in-reduced-motion')
  assert.deepEqual(errors,[])
}catch(error){await capture('failure').catch(()=>{});throw error}
finally{await writeFile(join(output,'verification.json'),JSON.stringify({checks,errors,profile},null,2));const video=page?.video();await app.close();if(video)await copyFile(await video.path(),join(output,'model-wait.webm'))}
console.log(JSON.stringify({checks,errors,output}))
