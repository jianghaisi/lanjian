import { _electron as electron } from 'playwright'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'
const root=await mkdtemp(join(tmpdir(),'lanjian-local-ui-'))
const evidence=resolve('artifacts/local-model-store');await mkdir(evidence,{recursive:true})
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('LANJIAN_')&&key!=='ELECTRON_RUN_AS_NODE'))
let app,page
let writingResults={}
try{
  app=await electron.launch({args:[resolve('out/main/index.js')],env:{...env,LANJIAN_USER_DATA_PATH:join(root,'profile')},timeout:60000})
  page=await app.firstWindow();page.setDefaultTimeout(30000)
  await page.waitForFunction(()=>Boolean(window.novelDesktop))
  await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('index.html'));w.unmaximize();w.setContentSize(1440,900);w.webContents.setZoomFactor(1)})
  const created=await page.evaluate(parentPath=>window.novelDesktop.projects.create({parentPath,name:'本地模型商店试写',genre:'悬疑'}),root)
  await page.reload();await page.getByTestId('library-continue-writing').click();await page.waitForSelector('.studio:not(.library-mode)',{timeout:60000})
  await page.getByTestId('workspace-loading').waitFor({state:'hidden',timeout:60000})
  await page.locator('.activitybar [data-activity="settings"]').focus()
  await page.keyboard.press('Enter')
  await page.getByTestId('settings-category-ai').click()
  await page.getByTestId('settings-nav-local-models').click()
  await page.getByTestId('local-model-store').waitFor()
  console.log('store visible')
  await page.getByTestId('inspect-qwen3-1.7b-q8_0').click()
  await page.locator('[data-state="ready"]').waitFor({timeout:180000})
  console.log('Qwen inspected in UI')
  await page.getByTestId('assign-local-model').click()
  await page.waitForFunction(async()=> (await window.novelDesktop.ai.getSettings()).shared.connectionId==='local:llama-cpp')
  const settings=await page.evaluate(()=>window.novelDesktop.ai.getSettings())
  assert.equal(settings.shared.maxTokens,2048);assert.equal(settings.modelConfigured,true);assert.equal(settings.apiKeyConfigured,false)
  await page.waitForTimeout(1700)
  await page.screenshot({path:join(evidence,'store-ready.png')})
  for(const task of ['outline','chapterOutline','prose','review']){
    await page.getByLabel('本地模型使用模块').selectOption(task)
    await page.getByTestId('assign-local-model').click()
    await page.waitForFunction(async task=>{const s=await window.novelDesktop.ai.getSettings();return s.routingMode==='perTask'&&s.tasks[task].connectionId==='local:llama-cpp'},task)
  }
  await page.getByLabel('本地模型使用模块').selectOption('shared');await page.getByTestId('assign-local-model').click()
  await page.waitForFunction(async()=> (await window.novelDesktop.ai.getSettings()).routingMode==='shared')
  await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('index.html'));w.unmaximize();w.setContentSize(1100,800);w.webContents.setZoomFactor(1.25)})
  await page.waitForFunction(()=>window.innerWidth<1000)
  await page.getByTestId('assign-local-model').scrollIntoViewIfNeeded()
  assert.ok(await page.getByTestId('local-model-store').evaluate(el=>el.scrollWidth<=el.clientWidth+1))
  await page.screenshot({path:join(evidence,'store-compact.png')})
  await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('index.html'));w.unmaximize();w.setContentSize(1440,900);w.webContents.setZoomFactor(1)})
  const check=await page.evaluate(()=>window.novelDesktop.ai.testConnection({connectionId:'local:llama-cpp',model:'qwen3-1.7b-q8_0'}))
  assert.equal(check.success,true)
  // Real local tool decisions traverse the normal application dispatcher.
  const result=await page.evaluate(async workItemId=>window.novelDesktop.fieldAssistant.conversation({operationId:crypto.randomUUID(),workItemId,page:'definition',message:'请把核心设想改为：档案员沈清在旧邮局收到自己十年前寄出的信。请先查看可编辑内容，再读取核心设想，最后生成修改候选。',targets:[{fieldId:'definition.bookProfile.coreIdea',instanceId:'local-smoke-core',editorSessionId:'local-smoke',workItemId,pageId:'definition',label:'核心设想',revision:0,value:'档案员发现一封旧信。'}],focusedTargetId:'local-smoke-core',chapterId:null,selectedCharacters:0,history:[],connectionId:'local:llama-cpp',model:'qwen3-1.7b-q8_0',maxTokensOverride:512}),created.project.id)
  console.log(JSON.stringify({conversation:result}))
  assert.equal(result.kind,'field')
  const task=await page.evaluate(async id=>{for(let i=0;i<180;i++){const t=await window.novelDesktop.fieldAssistant.task(id);if(t.status!=='running')return t;await new Promise(r=>setTimeout(r,1000))}throw Error('field timeout')},result.task.id)
  assert.equal(task.status,'completed');assert.ok(task.candidate?.after)
  const chapter=await page.evaluate(()=>window.novelDesktop.chapters.create())
  const body='沈清推开旧邮局的门，雨从伞尖滴下。她看见周伯手里捏着一封发黄的信。'
  const request={chapterId:chapter.id,currentDraft:body,message:'扩写为900至1200字，用六个自然段，详写雨声、动作、环境与两人的对话；不要增加人物，信还未拆开。每段至少150字。',preferredSkill:'expand',model:'qwen3-1.7b-q8_0',modelConnectionId:'local:llama-cpp',maxTokensOverride:2048,selection:{start:0,end:body.length,text:body}}
  await page.evaluate(async()=>{
    let storage=await window.novelDesktop.projects.sqliteStorageStatus()
    if(storage.storageMode==='files'){const preview=await window.novelDesktop.projects.previewSqliteShadowMigration();if(!preview.canImport||!preview.token)throw Error(JSON.stringify(preview));await window.novelDesktop.projects.importSqliteShadowMigration(preview.token)}
    storage=await window.novelDesktop.projects.sqliteStorageStatus()
    if(storage.storageMode!=='sqlite'){const preview=await window.novelDesktop.projects.previewSqliteActivation();if(!preview.canActivate||!preview.token)throw Error(JSON.stringify(preview));await window.novelDesktop.projects.activateSqliteStorage(preview.token)}
  })
  const beforeBody=await page.evaluate(id=>window.novelDesktop.chapters.get(id),chapter.id)
  const proseHandoff=await page.evaluate(async ({workItemId,chapterId})=>window.novelDesktop.fieldAssistant.conversation({operationId:crypto.randomUUID(),workItemId,page:'desk',message:'请润色正文中选中的这段文字，保留人物和事件。',targets:[],chapterId,selectedCharacters:35,history:[],connectionId:'local:llama-cpp',model:'qwen3-1.7b-q8_0',maxTokensOverride:512}),{workItemId:created.project.id,chapterId:chapter.id})
  assert.equal(proseHandoff.kind,'prose')
  const preview=await page.evaluate(request=>window.novelDesktop.ai.previewWritingAgentContext(request),request)
  assert.equal(preview.status,'ready')
  const writing=await page.evaluate(async request=>{try{return await window.novelDesktop.ai.startWritingAgent({operationId:crypto.randomUUID(),request})}catch(error){throw Error(JSON.stringify(error))}},request)
  const completed=await page.evaluate(async id=>{for(let i=0;i<240;i++){const t=await window.novelDesktop.ai.writingAgentTask(id);if(!['queued','preparing','running','streaming'].includes(t.status))return t;await new Promise(r=>setTimeout(r,1000))}throw Error('writing timeout')},writing.id)
  console.log(JSON.stringify({writing:completed.status,error:completed.error}))
  assert.equal(completed.status,'succeeded');assert.ok(completed.turn?.candidate?.content)
  const afterBody=await page.evaluate(id=>window.novelDesktop.chapters.get(id),chapter.id)
  assert.equal(afterBody.content,beforeBody.content)
  writingResults={proseHandoff,preview,completed,bodyPreserved:true}
  await writeFile(join(evidence,'ui-result.json'),JSON.stringify({root,settings,check,conversation:result,task,writingResults},null,2))
  await app.close();app=await electron.launch({args:[resolve('out/main/index.js')],env:{...env,LANJIAN_USER_DATA_PATH:join(root,'profile')},timeout:60000});page=await app.firstWindow();await page.waitForFunction(()=>Boolean(window.novelDesktop));await page.getByTestId('library-continue-writing').click();await page.waitForFunction(async()=> (await window.novelDesktop.ai.getSettings()).shared.connectionId==='local:llama-cpp')
  console.log('PASS: store, assignment, local generation, field tool chain, restart persistence')
}catch(error){if(page)await page.screenshot({path:join(evidence,'failure.png')}).catch(()=>{});console.error(error);process.exitCode=1}
finally{if(app)await app.close().catch(()=>{});console.log('Evidence: '+evidence+'; isolated data: '+root)}
