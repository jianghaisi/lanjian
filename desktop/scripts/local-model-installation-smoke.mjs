import { _electron as electron } from 'playwright'
import { mkdtemp, mkdir, readFile, copyFile, realpath, rename, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import assert from 'node:assert/strict'
import { withChronicleBuildSnapshot } from './chronicle-build-snapshot.mjs'

const evidence=resolve('artifacts/local-model-installation'),profileRecipe=JSON.parse(await readFile(resolve('../.trellis/tasks/09-30-v3-local-model-installation/research/runtime-profile.json'),'utf8'))
await mkdir(join(evidence,'profiles'),{recursive:true})
const root=await realpath(await mkdtemp(join(tmpdir(),'lanjian-model-native-'))),userData=join(root,'profile')
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('LANJIAN_')&&key!=='ELECTRON_RUN_AS_NODE'))
const modelId='qwen3-1.7b-q8_0',hash='061b54daade076b5d3362dac252678d17da8c68f07560be70818cace6590cb1a'
const downloaded=JSON.parse(await readFile(join(evidence,'full-download-result.json'),'utf8'))
const downloadedRoot=await realpath(downloaded.root),downloadedRelative=relative(await realpath(join(evidence,'profiles')),downloadedRoot)
assert.ok(downloadedRelative&&!downloadedRelative.startsWith('..')&&!isAbsolute(downloadedRelative),'weight fixture must belong to this task')
await withChronicleBuildSnapshot(resolve('out-local-installation'),join(evidence,'snapshots'),async snapshot=>{
  let app,page
  const start=async()=>{
    app=await electron.launch({...(process.argv[2]?{executablePath:resolve(process.argv[2]),args:[]}:{args:[join(snapshot,'out/main/index.js')]}),env:{...env,LANJIAN_USER_DATA_PATH:userData,LANJIAN_GLOBAL_MODEL_DATA_PATH:join(root,'models')},timeout:60000})
    page=await app.firstWindow();page.setDefaultTimeout(30000);await page.waitForFunction(()=>Boolean(window.novelDesktop))
  }
  const store=async()=>{
    await page.locator('.activitybar [data-activity="settings"]').click()
    await page.getByTestId('settings-category-ai').click();await page.getByTestId('settings-nav-local-models').click()
    await page.getByTestId('local-model-store').waitFor()
  }
  const enter=async()=>{
    await page.waitForFunction(()=>document.querySelector('[data-testid="app-boot"]')||document.querySelector('[data-testid="library-continue-writing"]'))
    const deadline=Date.now()+60000
    while(Date.now()<deadline&&await page.getByTestId('app-boot').isVisible()){
      const skip=page.getByTestId('app-boot-skip-models'),button=page.getByTestId('app-boot-enter')
      if(await skip.isVisible())await skip.click()
      else if(await button.isVisible())await button.click()
      await page.waitForTimeout(250)
    }
    await page.getByTestId('app-boot').waitFor({state:'hidden'})
  }
  const modelUntil=async predicate=>{
    const deadline=Date.now()+240000;let row
    while(Date.now()<deadline){row=(await page.evaluate(()=>window.novelDesktop.localModels.list()))[0];if(predicate(row))return row;await page.waitForTimeout(400)}
    throw Error('model state timeout: '+JSON.stringify(row))
  }
  try{
    await start()
    const initial=await page.evaluate(()=>window.novelDesktop.localModels.list())
    assert.equal(initial[0].state,'not-installed');assert.equal(initial[0].canDownload,true)
    await page.evaluate(parentPath=>window.novelDesktop.projects.create({parentPath,name:'模型安装隔离验收',genre:'悬疑'}),root)
    await page.reload();await enter();await page.getByTestId('library-continue-writing').click();await page.getByTestId('workspace-loading').waitFor({state:'hidden',timeout:60000});await store()
    await page.getByTestId('install-'+modelId).waitFor();assert.equal(await page.getByTestId('assign-local-model').isEnabled(),false)
    console.log('PASS empty-machine store')
    const cache=join(userData,'local-models/downloads');await mkdir(cache,{recursive:true})
    for(const file of profileRecipe.files)await copyFile(join(evidence,'downloads',file.name),join(cache,file.sha256+'.asset'))
    await copyFile(join(downloadedRoot,'managed/downloads',hash+'.asset'),join(cache,hash+'.asset'))
    const digest=await app.evaluate(async(_electron,path)=>{const{createReadStream}=process.getBuiltinModule('fs');const{createHash}=process.getBuiltinModule('crypto');const h=createHash('sha256');let bytes=0;for await(const chunk of createReadStream(path,{highWaterMark:4*1024*1024})){h.update(chunk);bytes+=chunk.length}return{bytes,hash:h.digest('hex')}},join(cache,hash+'.asset'))
    console.log('Electron cache hash',JSON.stringify(digest));assert.equal(digest.hash,hash)
    await page.getByTestId('install-'+modelId).click()
    const operation=(await modelUntil(row=>Boolean(row.operationId))).operationId
    assert.equal(await page.evaluate(({modelId})=>window.novelDesktop.localModels.cancel(modelId,'00000000-0000-0000-0000-000000000000'),{modelId}),false)
    await app.close();app=undefined
    await start();await enter()
    const stoppedAfterRestart=(await page.evaluate(()=>window.novelDesktop.localModels.list()))[0]
    assert.ok(['cancelled','interrupted'].includes(stoppedAfterRestart.state),JSON.stringify(stoppedAfterRestart))
    assert.equal(stoppedAfterRestart.operationId,undefined)
    const installationFile=join(userData,'local-models/installations.json'), stoppedRecord=await readFile(installationFile)
    await page.waitForTimeout(500)
    assert.deepEqual(await readFile(installationFile),stoppedRecord)
    await page.getByTestId('library-continue-writing').click();await page.getByTestId('workspace-loading').waitFor({state:'hidden',timeout:60000});await store()
    await page.getByTestId('install-'+modelId).click()
    const resumedOperation=(await modelUntil(row=>Boolean(row.operationId))).operationId
    assert.notEqual(resumedOperation,operation)
    assert.equal(await page.evaluate(({modelId,operation})=>window.novelDesktop.localModels.cancel(modelId,operation),{modelId,operation}),false)
    console.log('PASS normal exit stops installation; restart waits for explicit retry')
    await page.getByTestId('settings-category-ai').click();await page.getByTestId('settings-nav-local-models').click()
    const prepared=await modelUntil(row=>!row.operationId)
    assert.equal(prepared.state,'ready',JSON.stringify(prepared))
    console.log('PASS initial installation and real probes')
    assert.ok(operation);await page.getByTestId('assign-local-model').click()
    for(let i=0;i<50;i++){if((await page.evaluate(()=>window.novelDesktop.ai.getSettings())).shared.connectionId==='local:llama-cpp')break;await page.waitForTimeout(200)}
    const settings=await page.evaluate(()=>window.novelDesktop.ai.getSettings());assert.equal(settings.shared.connectionId,'local:llama-cpp');assert.equal(settings.apiKeyConfigured,false)
    await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('index.html'));w.unmaximize();w.setContentSize(1100,800);w.webContents.setZoomFactor(1.25)})
    await page.waitForTimeout(300);assert.ok(await page.getByTestId('local-model-store').evaluate(el=>el.scrollWidth<=el.clientWidth+1))
    await writeFile(join(evidence,'store-installed.png'),Buffer.from(await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('index.html')).capturePage()).toPNG().toString('base64')),'base64'))
    await app.close();app=undefined
    await start();await enter();const reopened=await page.evaluate(()=>window.novelDesktop.localModels.list());assert.equal(reopened[0].state,'ready')
    await app.close();app=undefined
    const receiptPath=join(userData,'local-models/runtime-current.json'), previousReceipt=await readFile(receiptPath,'utf8')
    const previousRuntime=JSON.parse(previousReceipt), python=join(userData,'local-models/runtimes',previousRuntime.directory,profileRecipe.python)
    const savedPython=await readFile(python)
    await rename(python,python+'.preserved')
    await start();await enter();await page.getByTestId('library-continue-writing').click();await page.getByTestId('workspace-loading').waitFor({state:'hidden',timeout:60000});await store()
    const missing=(await page.evaluate(()=>window.novelDesktop.localModels.list()))[0]
    assert.equal(missing.state,'not-installed');assert.equal(missing.downloadBytes,profileRecipe.files.reduce((n,file)=>n+file.bytes,0))
    assert.equal(await page.getByTestId('assign-local-model').isEnabled(),false)
    assert.equal(await readFile(receiptPath,'utf8'),previousReceipt)
    assert.deepEqual(await page.evaluate(()=>window.novelDesktop.ai.getSettings()),{...settings,modelConfigured:false})
    console.log('PASS missing runtime disables selection and keeps assignments')
    await page.getByTestId('install-'+modelId).click()
    await modelUntil(row=>Boolean(row.operationId));const repaired=await modelUntil(row=>!row.operationId)
    assert.equal(repaired.state,'ready',JSON.stringify(repaired))
    assert.notEqual(JSON.parse(await readFile(receiptPath,'utf8')).directory,previousRuntime.directory)
    assert.deepEqual(await readFile(python+'.preserved'),savedPython)
    assert.deepEqual(await page.evaluate(()=>window.novelDesktop.ai.getSettings()),settings)
    console.log('PASS repaired runtime keeps old files and assignments')
    await app.close();app=undefined
    await start();await enter();const repairedRestart=(await page.evaluate(()=>window.novelDesktop.localModels.list()))[0]
    assert.equal(repairedRestart.state,'ready')
    const currentReceipt=await readFile(receiptPath,'utf8'),currentRuntime=JSON.parse(currentReceipt)
    const runtimeRoot=await realpath(join(userData,'local-models/runtimes',currentRuntime.directory))
    const llama=await realpath(join(runtimeRoot,profileRecipe.sitePackages,'llama_cpp/llama.py')),llamaRelative=relative(root,llama)
    assert.ok(llamaRelative&&!llamaRelative.startsWith('..')&&!isAbsolute(llamaRelative),'corruption fixture must stay inside this temporary profile')
    const originalLlama=await readFile(llama),damagedLlama=Buffer.from(originalLlama);damagedLlama[0]^=1
    await writeFile(llama,damagedLlama)
    await page.getByTestId('library-continue-writing').click();await page.getByTestId('workspace-loading').waitFor({state:'hidden',timeout:60000});await store()
    const generationFailure=await page.evaluate(async()=>{try{await window.novelDesktop.ai.complete('请只回复检测成功','','outline');return null}catch(error){return {code:error.code,message:error.message}}})
    assert.ok(generationFailure);assert.match(generationFailure.message,/校验/)
    const invalidated=await modelUntil(row=>row.state==='failed')
    await page.locator('.model-state[data-state="failed"]').waitFor()
    assert.equal(await page.getByTestId('assign-local-model').isEnabled(),false)
    assert.match(await page.locator('.model-message.store-error').innerText(),/校验/)
    assert.deepEqual(await readFile(llama),damagedLlama);assert.equal(await readFile(receiptPath,'utf8'),currentReceipt)
    assert.deepEqual(await page.evaluate(()=>window.novelDesktop.ai.getSettings()),{...settings,modelConfigured:false})
    await page.screenshot({path:join(evidence,'store-integrity-failed.png')})
    await app.close();app=undefined
    await start();await enter()
    const invalidatedRestart=(await page.evaluate(()=>window.novelDesktop.localModels.list()))[0]
    assert.equal(invalidatedRestart.state,'failed')
    await writeFile(llama,originalLlama)
    assert.equal((await page.evaluate(()=>window.novelDesktop.localModels.list()))[0].state,'failed')
    await page.getByTestId('library-continue-writing').click();await page.getByTestId('workspace-loading').waitFor({state:'hidden',timeout:60000});await store()
    await page.getByTestId('install-'+modelId).click();await modelUntil(row=>Boolean(row.operationId))
    const rechecked=await modelUntil(row=>!row.operationId);assert.equal(rechecked.state,'ready',JSON.stringify(rechecked))
    assert.equal(await readFile(receiptPath,'utf8'),currentReceipt)
    assert.deepEqual(await page.evaluate(()=>window.novelDesktop.ai.getSettings()),settings)
    await app.close();app=undefined
    await start();await enter();assert.equal((await page.evaluate(()=>window.novelDesktop.localModels.list()))[0].state,'ready')
    await writeFile(join(evidence,process.argv[2]?'packaged-integrity-result.json':'native-integrity-result.json'),JSON.stringify({root,initial,stoppedAfterRestart,reopened,missing,repaired,repairedRestart,generationFailure,invalidated,invalidatedRestart,rechecked,settings,checks:['empty store','disabled assignment','cached real installation','stale cancellation rejected','normal exit during installation','restart waits for explicit retry','stale pre-exit cancellation rejected','page return','real probes','explicit assignment','narrow UI','normal restart','missing Python disables selection','missing environment estimate','explicit repair in a new directory','old environment retained','assignment unchanged','normal restart after repair','same-size runtime corruption blocks generation','failed status and disabled selection visible','failed status persists across restart','restored files still require explicit detection','explicit retry reuses resources and passes real probes','normal restart after recheck']},null,2))
    console.log('PASS installed runtime, missing environment repair, integrity failure, explicit recheck and normal restarts')
  }catch(error){if(page)await page.screenshot({path:join(evidence,'native-failure.png')}).catch(()=>{});throw error}
  finally{if(app)await app.close()}
})
