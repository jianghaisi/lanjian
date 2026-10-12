import assert from 'node:assert/strict'
import { mkdtemp, realpath, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron } from 'playwright'
const root=await realpath(await mkdtemp(join(tmpdir(),'lanjian-settlement-native-')))
const output=resolve('../.trellis/tasks/10-01-v3-prose-event-settlement/evidence/closure-native')
await mkdir(output,{recursive:true})
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('LANJIAN_')&&!['ELECTRON_RUN_AS_NODE','ELECTRON_RENDERER_URL'].includes(k)))
Object.assign(env,{LANJIAN_USER_DATA_PATH:join(root,'profile'),LANJIAN_GLOBAL_MODEL_DATA_PATH:join(root,'models')})
const entry=resolve('out-prose-settlement/main/index.js'),body='　　第一夜，林舟在古城敲门。门开了。'
let app,page,seed
const errors=[],checks=[],readConflicts=[]
const panel=()=>page.getByTestId('prose-event-settlement')
async function launch(){
 app=await _electron.launch({args:[entry],env});page=await app.firstWindow();page.setDefaultTimeout(20000)
 page.on('pageerror',error=>errors.push(error.message))
 await app.evaluate(({session})=>{
  session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_,done)=>done({cancel:true}))
  globalThis.settlementFixture={calls:[],mode:'valid',body:'',content:''}
  globalThis.fetch=async(url,options)=>{
   const fixture=globalThis.settlementFixture,address=String(url)
   if(address==='https://settlement-fixture.invalid/v1/models')return new Response(JSON.stringify({data:[{id:'settlement-fixture'}]}),{headers:{'content-type':'application/json'}})
   if(address!=='https://settlement-fixture.invalid/v1/chat/completions')throw Error('Non-fixture network request blocked')
   const request=JSON.parse(options.body)
   if(request.model!=='settlement-fixture'||!request.messages.some(m=>m.content.includes(fixture.body)&&m.content.includes('本版正文')))throw Error('Wrong captured model or source')
   fixture.calls.push({model:request.model,sourceIncluded:true,mode:fixture.mode})
   const content=fixture.mode==='invalid'?'not valid JSON':fixture.content
   if(fixture.mode==='held')await new Promise(resolve=>{fixture.release=resolve})
   return new Response(JSON.stringify({choices:[{message:{role:'assistant',content},finish_reason:'stop'}]}),{headers:{'content-type':'application/json'}})
  }
 })
 await page.waitForFunction(()=>!!window.novelDesktop)
 await page.evaluate(()=>{
  localStorage.setItem('lanjian-opening-enabled','false')
  localStorage.setItem('lanjian-loading-v1',JSON.stringify({theme:'standard',bootStyle:'brief',bootPalette:'system'}))
  localStorage.setItem('lanjian-companion-voice-v1',JSON.stringify({voice:'ningguang',mute:true,textModel:false,preload:false}))
  sessionStorage.setItem('lanjian-opening-seen','true')
 })
}
// This Playwright runtime tests a returned Promise for truthiness; poll awaited
// IPC results in Node so a false async predicate cannot pass prematurely.
async function waitForApi(predicate,arg){
 const deadline=Date.now()+30000
 while(Date.now()<deadline){
  const result=await page.evaluate(async({source,arg})=>{
   try{return {value:await (0,eval)('('+source+')')(arg)}}
   catch(error){return {error:{code:error?.code,message:error?.message||String(error)}}}
  },{source:predicate.toString(),arg})
  if(result.error){
   if(result.error.code!=='CONFLICT')throw Error(JSON.stringify(result.error))
   readConflicts.push(result.error.message)
  }else if(result.value)return
  await new Promise(resolve=>setTimeout(resolve,200))
 }
 assert.fail('Timed out waiting for the persisted API condition')
}
async function openBook(){
 await page.reload()
 await page.getByTestId('app-boot-enter').click();await page.getByTestId('app-boot').waitFor({state:'hidden'})
 await page.locator('[data-library-view="all"]').click()
 await page.locator('.work-item-open').filter({hasText:'正文结算隔离书'}).first().click()
 await page.getByTestId('workspace-loading').waitFor({state:'hidden'})
 await page.locator('[data-nav-parent="manuscript"]').click()
 await page.locator('.chapter-tree-row').filter({hasText:'敲门'}).first().click()
 await page.getByTestId('manuscript-input').waitFor()
 const open=page.getByRole('button',{name:'打开智能助笔侧栏',exact:true})
 if(await open.count())await open.click()
 await page.getByTestId('assistant-mode-checks').click()
 await panel().getByRole('button',{name:/核对本章事件/}).click()
 await panel().getByRole('button',{name:'保存候选',exact:true}).waitFor()
}
async function quote(){
 const source=panel().getByLabel('已保存正文原句');await source.focus();await source.press('Control+a')
 await panel().getByRole('button',{name:'将选中文字作为证据',exact:true}).click()
}
async function fill(event){
 const fields=panel().locator('fieldset')
 await fields.getByLabel('时间',{exact:true}).fill('第一夜')
 await fields.getByLabel('人物',{exact:true}).fill('林舟')
 await fields.getByLabel('地点',{exact:true}).fill('古城')
 await fields.getByLabel('事件',{exact:true}).fill(event)
 await fields.getByLabel('结果',{exact:true}).fill('门开了')
 await quote()
 await panel().getByRole('button',{name:'保存候选',exact:true}).click()
 await panel().getByText('候选已保存。选择结算方式后预览确认。',{exact:true}).waitFor()
}
async function screenshot(name,theme,zoom,width=1440,target){
 const win=await app.browserWindow(page)
 await win.evaluate((win,{zoom,width})=>{if(win.isMaximized())win.unmaximize();win.setContentSize(width,1000);win.webContents.setZoomFactor(zoom)},{zoom,width})
 await page.evaluate(theme=>{localStorage.setItem('lanjian-theme',theme);window.dispatchEvent(new StorageEvent('storage',{key:'lanjian-theme',newValue:theme}))},theme)
 await (target||panel().getByRole('button',{name:/核对本章事件/})).scrollIntoViewIfNeeded()
 await page.waitForTimeout(300)
 assert.equal(await panel().evaluate(el=>el.scrollWidth>el.clientWidth+1),false)
 const geometry=await panel().evaluate(el=>{const r=el.getBoundingClientRect();return {width:innerWidth,height:innerHeight,left:r.left,right:r.right,ratio:devicePixelRatio,overflow:el.scrollWidth>el.clientWidth+1}})
 await writeFile(join(output,name+'-geometry.json'),JSON.stringify(geometry,null,2))
 const png=await win.evaluate(async win=>(await win.webContents.capturePage()).toPNG().toString('base64'))
 await writeFile(join(output,name+'.png'),Buffer.from(png,'base64'))
 assert.ok(geometry.left>=0 && geometry.right<=geometry.width+1,JSON.stringify(geometry))
}
try{
 await launch()
 seed=await page.evaluate(async({root,body})=>{
  const api=window.novelDesktop
  try {
  const {project}=await api.projects.create({parentPath:root,name:'正文结算隔离书',genre:'悬疑'})
  await api.projects.switch(project.path)
  const migration=await api.events.previewMigration(),grant=await api.events.reviewMigration({previewId:migration.previewId,fingerprint:migration.fingerprint,rows:[],acknowledgedGroups:[],acknowledgedPlanningFindings:[],acknowledgedMirrors:[]})
  await api.events.commitMigration(grant.token)
  const chapters=await api.chapters.list(),chapter=chapters[0]||await api.chapters.create()
  const saved=await api.chapters.update(chapter.id,{title:'敲门',content:body,expectedRevision:chapter.revision,reason:'manual'})
  const volumes=await api.outlines.createVolume('第一卷')
  await api.outlines.placeChapter(chapter.id,volumes.volumes[0].volume)
  const plans=[]
  for(const event of ['敲门寻找证人','核对来信']){
   const projection=await api.events.projection()
   const p=await api.events.previewOperation({kind:'create',expectedOrderId:projection.state.order.id,granularity:'macro',content:{time:'第一夜',characters:['林舟'],location:'古城',event,result:'找到线索',evidenceRefs:[],confidence:1}})
   const result=await api.events.commitOperation(p.token);plans.push(result.receipt.eventId)
   await api.outlines.placeEventInChapter(result.receipt.eventId,chapter.id)
  }
  return {project,chapter:saved,plans}
  }catch(error){throw new Error(JSON.stringify(error))}
 },{root,body})
 await openBook()
 const editor=page.getByTestId('manuscript-input')
 await editor.dispatchEvent('compositionstart',{data:'第'})
 assert.equal(await panel().getByRole('button',{name:'保存候选',exact:true}).isDisabled(),true)
 await editor.dispatchEvent('compositionend',{data:'第'})
 await page.waitForFunction(()=>Array.from(document.querySelector('[data-testid="prose-event-settlement"]').querySelectorAll('button')).some(b=>b.textContent==='保存候选'&&!b.disabled))
 await page.getByRole('button',{name:'立即保存',exact:true}).click()
 await waitForApi(async ({id,body})=>{try{return (await window.novelDesktop.events.chapterSettlement(id)).source.body===body}catch{return false}},{id:seed.chapter.id,body})
 await panel().getByRole('button',{name:'刷新依据',exact:true}).click()
 await page.waitForFunction(()=>Array.from(document.querySelector('[data-testid="prose-event-settlement"]').querySelectorAll('button')).some(b=>b.textContent==='保存候选'&&!b.disabled))
 checks.push('source-editor-composition-locks-settlement-and-explicit-save-refresh-restores-it')
 const time=panel().locator('fieldset').getByLabel('时间',{exact:true})
 await time.dispatchEvent('compositionstart',{data:'第'})
 assert.equal(await panel().getByRole('button',{name:'保存候选',exact:true}).isDisabled(),true)
 assert.equal(await time.isDisabled(),false)
 await time.dispatchEvent('compositionend',{data:'第一夜'})
 checks.push('composition-blocks-confirmation-without-disabling-input')
 await fill('林舟敲门');await panel().getByRole('button',{name:'填写另一项',exact:true}).click()
 await fill('门开了，计划出现偏离');await panel().getByRole('button',{name:'填写另一项',exact:true}).click()
 await fill('林舟发现新情况')
 const rows=panel().getByTestId('settlement-candidate');assert.equal(await rows.count(),3)
 await rows.nth(0).getByRole('checkbox',{name:/选择：/}).check();await rows.nth(0).getByLabel('结算方式').selectOption('realizes')
 for(const name of ['敲门寻找证人','核对来信'])await rows.nth(0).getByRole('checkbox',{name,exact:true}).check()
 await rows.nth(1).getByRole('checkbox',{name:/选择：/}).check();await rows.nth(1).getByLabel('结算方式').selectOption('deviates-from')
 await rows.nth(1).getByRole('checkbox',{name:'敲门寻找证人',exact:true}).check()
 await rows.nth(2).getByRole('checkbox',{name:/选择：/}).check()
 await panel().getByRole('button',{name:'预览所选结算（最多 20 项）',exact:true}).click()
 await panel().getByTestId('settlement-preview').waitFor()
 await screenshot('01-preview-light','qingzhou',1,1440,panel().getByTestId('settlement-preview'))
 await panel().getByRole('button',{name:'确认保存结算',exact:true}).click()
 await waitForApi(async id=>(await window.novelDesktop.events.chapterSettlement(id)).history.length===3,seed.chapter.id)
 checks.push('three-outcomes-and-multiple-plans-confirmed-through-native-ui')
 const before=await page.evaluate(async id=>({page:await window.novelDesktop.events.chapterSettlement(id),projection:await window.novelDesktop.events.projection(),chapters:await window.novelDesktop.chapters.list()}),seed.chapter.id)
 assert.equal(before.page.source.body,body);assert.equal(before.page.history.filter(h=>h.status.state==='current').length,3)
 assert.ok(seed.plans.every(id=>before.projection.approved.some(e=>e.eventId===id&&e.phase==='planned')))
 await screenshot('02-confirmed-dark-125','moye',1.25)
 await page.evaluate(async id=>{const api=window.novelDesktop,c=(await api.chapters.list()).find(c=>c.id===id);await api.chapters.update(id,{title:c.title,content:c.content+'\n次日仍有回声。',expectedRevision:c.revision,reason:'manual'})},seed.chapter.id)
 await app.close();app=null
 await launch();await openBook()
 await panel().getByText(/需要复核/).first().waitFor()
 const stale=await page.evaluate(id=>window.novelDesktop.events.chapterSettlement(id),seed.chapter.id)
 assert.equal(stale.history.filter(h=>h.status.state==='needs-review').length,3)
 const first=panel().getByTestId('settlement-history').first()
 await first.getByRole('button',{name:'按本版重新核对',exact:true}).click();await quote()
 await panel().getByRole('button',{name:'保存候选',exact:true}).click()
 await page.waitForFunction(()=>document.querySelectorAll('[data-testid="settlement-candidate"]').length===4)
 const latest=panel().getByTestId('settlement-candidate').last();await latest.getByRole('checkbox',{name:/选择：/}).check()
 await panel().getByRole('button',{name:'预览所选结算（最多 20 项）',exact:true}).click()
 await panel().getByRole('button',{name:'确认保存结算',exact:true}).click()
 await waitForApi(async id=>(await window.novelDesktop.events.chapterSettlement(id)).history.length===4,seed.chapter.id)
 const renewed=await page.evaluate(id=>window.novelDesktop.events.chapterSettlement(id),seed.chapter.id)
 assert.equal(renewed.history[0].decision.eventId,stale.history[0].decision.eventId)
 const current=panel().getByTestId('settlement-history').first()
 await current.getByLabel('不再成立的理由').fill('本版重新判断后不再成立')
 await current.getByRole('button',{name:'预览“本版不再成立”',exact:true}).click()
 await panel().getByRole('button',{name:'确认保存结算',exact:true}).click()
 await waitForApi(async id=>(await window.novelDesktop.events.chapterSettlement(id)).history[0].status.state==='withdrawn',seed.chapter.id)
 checks.push('normal-restart-staleness-reconfirmation-stable-id-and-withdrawal')
 const historicalEvidence=panel().getByTestId('settlement-history').nth(1)
 await historicalEvidence.getByText('历史证据',{exact:true}).click()
 await screenshot('03-history-dark-125','moye',1.25,1440,historicalEvidence)
 await screenshot('04-paper-narrow-125','xuanzhi',1.25,1200,historicalEvidence)
 checks.push('light-dark-paper-and-narrow-125-layout-remain-within-window')
 const initial=await page.evaluate(id=>window.novelDesktop.events.chapterSettlement(id),seed.chapter.id)
 assert.deepEqual(await app.evaluate(()=>globalThis.settlementFixture.calls),[])
 await page.evaluate(async()=>{
  const api=window.novelDesktop,catalog=await api.modelConnections.list()
  await api.modelConnections.create({expectedRevision:catalog.revision,name:'结算隔离模型',baseUrl:'https://settlement-fixture.invalid/v1',protocol:'openai-compatible',apiKey:'synthetic-fixture-key'})
  const connection=(await api.modelConnections.list()).connections[0],edit=await api.modelConnections.book()
  await api.modelConnections.saveBook({token:edit.token,patch:{routingMode:'shared',globalReferences:[{id:'settlement-fixture',globalConnectionId:connection.id}],globalRevisions:[{id:connection.id,revision:connection.revision}],shared:{connectionId:'settlement-fixture',model:'settlement-fixture',temperature:.2,topP:1,maxTokens:4000}}})
 })
 await app.evaluate((_,body)=>{
  globalThis.settlementFixture.body=body
  globalThis.settlementFixture.content=JSON.stringify([{fields:{time:'第一夜',characters:['林舟'],location:'古城',event:'模型候选：林舟敲门',result:'门开了'},quotes:[{start:0,end:body.length,quote:body}],supplements:[]}])
 },initial.source.body)
 async function extract(mode,status){
  const before=await page.evaluate(id=>window.novelDesktop.events.chapterSettlement(id),seed.chapter.id),ids=before.tasks.map(t=>t.id)
  await app.evaluate((_,mode)=>{globalThis.settlementFixture.mode=mode},mode)
  await panel().getByRole('button',{name:'用审校模型提取候选',exact:true}).click()
  await waitForApi(async({id,ids,status})=>(await window.novelDesktop.events.chapterSettlement(id)).tasks.some(t=>!ids.includes(t.id)&&t.status===status),{id:seed.chapter.id,ids,status})
  return (await page.evaluate(id=>window.novelDesktop.events.chapterSettlement(id),seed.chapter.id)).tasks.find(t=>!ids.includes(t.id))
 }
 const completed=await extract('valid','succeeded')
 assert.equal(completed.drafts.length,1);assert.deepEqual(completed.drafts[0].supplements,[])
 await panel().getByTestId('settlement-candidate').filter({hasText:'模型候选：林舟敲门'}).waitFor()
 const failed=await extract('invalid','failed')
 assert.equal(failed.rawOutput,'not valid JSON');assert.deepEqual(failed.drafts,[])
 await panel().getByText(/提取任务：失败/).waitFor()
 const held=await extract('held','running')
 await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='停止提取'))
 await panel().getByRole('button',{name:'停止提取',exact:true}).click()
 await waitForApi(async id=>(await window.novelDesktop.events.settlementTask(id)).status==='cancelled',held.id)
 await app.evaluate(()=>globalThis.settlementFixture.release())
 await panel().getByText(/提取任务：已停止/).waitFor()
 const extracted=await page.evaluate(id=>window.novelDesktop.events.chapterSettlement(id),seed.chapter.id)
 assert.equal(extracted.drafts.length,initial.drafts.length+1);assert.deepEqual(extracted.history,initial.history);assert.equal(extracted.source.body,initial.source.body)
 const providerCalls=await app.evaluate(()=>globalThis.settlementFixture.calls)
 assert.equal(providerCalls.length,3)
 checks.push('native-model-settings-real-AiClient-IPC-candidates-invalid-raw-output-and-stop')
 await screenshot('05-model-tasks-paper-125','xuanzhi',1.25,1200)
 await app.close();app=null
 await launch();await openBook()
 const recovered=await page.evaluate(id=>window.novelDesktop.events.chapterSettlement(id),seed.chapter.id)
 for(const [id,status] of [[completed.id,'succeeded'],[failed.id,'failed'],[held.id,'cancelled']])assert.equal(recovered.tasks.find(t=>t.id===id).status,status)
 assert.equal(recovered.tasks.find(t=>t.id===failed.id).rawOutput,'not valid JSON')
 assert.equal(recovered.drafts.length,initial.drafts.length+1);assert.deepEqual(recovered.history,initial.history);assert.equal(recovered.source.body,initial.source.body)
 assert.deepEqual(await app.evaluate(()=>globalThis.settlementFixture.calls),[])
 await panel().getByTestId('settlement-candidate').filter({hasText:'模型候选：林舟敲门'}).waitFor()
 const raw=panel().getByText('查看提取原始输出 · '+failed.id,{exact:true})
 await raw.click();await panel().locator('.settlement-raw').filter({hasText:'not valid JSON'}).waitFor()
 checks.push('normal-restart-retains-model-drafts-raw-output-stopped-state-and-makes-no-model-request')
 assert.deepEqual(errors,[])
 await writeFile(join(output,'native-result.json'),JSON.stringify({root,checks,errors,readConflicts,providerCalls,passed:true},null,2))
 console.log(JSON.stringify({passed:true,checks,root,output}))
}catch(error){
 if(page){await page.screenshot({path:join(output,'failure.png')}).catch(()=>{});await writeFile(join(output,'failure.txt'),await panel().innerText().catch(()=>''))}
 await writeFile(join(output,'native-failure.json'),JSON.stringify({root,checks,errors,error:String(error),stack:error?.stack},null,2))
 throw error
}finally{if(app)await app.close()}
