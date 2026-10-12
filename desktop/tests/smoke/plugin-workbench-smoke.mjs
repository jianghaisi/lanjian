import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, realpath, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { _electron } from 'playwright'

const parent = await realpath(tmpdir()), root = await realpath(await mkdtemp(join(parent, 'lanjian-workbench-ui-')))
const evidence = resolve(process.env.LANJIAN_PLUGIN_EVIDENCE_DIR || '../.trellis/tasks/09-20-v3-plugin-marketplace-and-personal-authoring/research/ui-motion-tools/workbench')
const userData = join(root, 'app'), books = join(root, 'books'), checks = [], errors = [], requests = []
await Promise.all([mkdir(userData), mkdir(books), mkdir(evidence, {recursive:true})])
let app, page, draftId, pluginId, currentGoal, exportReceipt, copiedReceipt
const server = createServer(async (request, response) => {
  try {
    let raw=''; for await (const part of request) raw+=part
    const body=JSON.parse(raw); requests.push(body)
    response.setHeader('Content-Type','application/json')
    const reply=message=>response.end(JSON.stringify({choices:[{message,finish_reason:'stop'}]}))
    const results=body.messages.filter(m=>m.role==='tool'), input=body.messages.filter(m=>m.role==='user').at(-1).content
    const values=results.map(m=>{const parsed=JSON.parse(m.content); return parsed.data?JSON.parse(parsed.data):parsed})
    const call=(id,args)=>{
      const definition=body.tools.find(t=>t.function.name.startsWith(`p_builtin_plugins_${id}_`)); assert.ok(definition,`Missing management tool ${id}`)
      reply({role:'assistant',content:null,tool_calls:[{id:`call-${results.length}`,type:'function',function:{name:definition.function.name,arguments:JSON.stringify(args)}}]})
    }
    if(input.includes('WORKBENCH_CREATE')) {
      if(!results.length) return call('create_plugin_draft',{template:'code'})
      draftId=values[0].id; pluginId=values[0].pluginId
      if(results.length===1)return call('read_plugin_draft',{id:draftId})
      if(results.length===2)return call('read_plugin_draft',{id:draftId,file:'main.js'})
      if(results.length===3){const manifest=JSON.parse(values[1].content);manifest.name='对话创建的字数工具';return call('save_plugin_draft',{id:draftId,revision:values[1].revision,manifestText:JSON.stringify(manifest),files:[{path:'main.js',content:values[2].content}]})}
      if(results.length===4)return call('build_plugin_draft',{id:draftId,revision:values[3].revision,action:'build'})
      if(results.length===5)return call('install_plugin',{source:'draft',id:draftId,revision:values[3].revision})
      if(results.length===6)return call('list_plugins',{area:'installed',pluginId})
      assert.equal(values[6].entries[0].enabled,false)
      return reply({role:'assistant',content:'已创建并安装字数工具，仍未启用或授权。'})
    }
    if(input.includes('WORKBENCH_EXPORT')) {
      if(!results.length)return call('export_plugin_draft',{id:draftId,revision:2})
      exportReceipt=values[0];assert.equal(exportReceipt.status,'exported');assert.equal(exportReceipt.fileName,'对话导出的插件.zip')
      return reply({role:'assistant',content:'插件包已导出，可以离线分享。'})
    }
    if(input.includes('WORKBENCH_IMPORT_CANCEL')) {
      if(!results.length)return call('import_plugin_package',{})
      assert.equal(values[0].status,'cancelled');return reply({role:'assistant',content:'已取消复制，没有创建新草稿。'})
    }
    if(input.includes('WORKBENCH_IMPORT')) {
      if(!results.length)return call('import_plugin_package',{})
      copiedReceipt=values[0];assert.notEqual(copiedReceipt.pluginId,pluginId);assert.equal(copiedReceipt.upstream.pluginId,pluginId)
      if(results.length===1)return call('read_plugin_draft',{id:copiedReceipt.id})
      assert.equal(JSON.parse(values[1].content).id,copiedReceipt.pluginId)
      return reply({role:'assistant',content:'已从插件包复制个人草稿，可以继续编辑。'})
    }
    if(!results.length)return call('list_plugins',{area:'installed',pluginId})
    if(input.includes('WORKBENCH_ENABLE')) {
      if(results.length===1)return call('manage_plugin',{action:'enable',id:pluginId,revision:values[0].revision,grants:[]})
      if(results.length===2)return call('list_plugins',{area:'installed',pluginId})
      if(results.length===3)return call('manage_plugin',{action:'book-use',id:pluginId,revision:values[2].revision})
      return reply({role:'assistant',content:'插件已启用，并已为本书选择。新任务可以调用。'})
    }
    if(input.includes('WORKBENCH_CANCEL')) {
      if(results.length===1)return call('manage_plugin',{action:'uninstall',id:pluginId,revision:values[0].revision})
      assert.equal(values[1].status,'cancelled'); return reply({role:'assistant',content:'已取消卸载，保留插件。'})
    }
    throw new Error(`Unexpected prompt ${input}`)
  } catch(e){errors.push(String(e));response.statusCode=500;response.end('{}')}
})
await new Promise(r=>server.listen(0,'127.0.0.1',r))
const env=Object.fromEntries(Object.entries(process.env).filter(([k,v])=>typeof v==='string'&&!k.startsWith('LANJIAN_')&&!['ELECTRON_RUN_AS_NODE','ELECTRON_RENDERER_URL'].includes(k)))
Object.assign(env,{LANJIAN_USER_DATA_PATH:userData,LANJIAN_GLOBAL_MODEL_DATA_PATH:join(userData,'global-model-data/v1')})
const build=resolve(process.env.LANJIAN_BUILT_DESKTOP_DIR||'out-plugin-marketplace-check','main/index.js')
const watchdog=setTimeout(()=>app?.process().kill('SIGKILL'),240000);watchdog.unref()
async function send(text){currentGoal=text;await page.getByTestId('field-assistant-instruction').fill(text);await page.getByTestId('send-field-assistant').click()}
async function answer(option){await page.getByTestId('author-question-card').getByLabel(option,{exact:true}).check();await page.getByTestId('submit-author-answer').click()}
async function completed(){
  for(let i=0;i<300;i++){
    const runs=await page.evaluate(()=>window.novelDesktop.fieldAssistant.runs.recent()),run=runs.find(r=>r.goal===currentGoal)
    // A picker-only operation has no author card to wait on before the start IPC finishes.
    if(!run){await page.waitForTimeout(100);continue}
    assert.ok(!['failed','cancelled','interrupted'].includes(run.status),run.message)
    if(run.status==='completed'){assert.deepEqual(errors,[]);return}
    await page.waitForTimeout(100)
  }
  throw new Error('Current goal did not complete')
}
async function shot(name){await page.screenshot({path:join(evidence,name+'.png')})}
try {
  app=await _electron.launch({args:[build,'--disable-gpu'],env});page=await app.firstWindow();page.setDefaultTimeout(30000);await page.emulateMedia({reducedMotion:'reduce'});page.on('pageerror',e=>errors.push(e.message))
  await page.waitForFunction(()=>Boolean(window.novelDesktop?.writingPlugins))
  await page.evaluate(async()=>{localStorage.setItem('lanjian-opening-enabled','false');sessionStorage.setItem('lanjian-opening-seen','true');await window.companionSettings.update({voice:{mute:true,textModel:false,preload:false}})})
  const state=await page.evaluate(async({books,baseUrl})=>{
    const api=window.novelDesktop,{project}=await api.projects.create({parentPath:books,name:'对话插件隔离验收',genre:'仙侠'})
    const list=await api.modelConnections.list(),made=await api.modelConnections.create({expectedRevision:list.revision,name:'本地协议测试',baseUrl,protocol:'openai-compatible',apiKey:'synthetic-only'})
    const connection=made.connections.find(c=>c.name==='本地协议测试'),edit=await api.modelConnections.book()
    await api.modelConnections.saveBook({token:edit.token,patch:{routingMode:'shared',globalReferences:[{id:'plugin-model',globalConnectionId:connection.id}],globalRevisions:[{id:connection.id,revision:connection.revision}],shared:{connectionId:'plugin-model',model:'plugin-test',temperature:.6,topP:1,maxTokens:8192}}})
    const chapter=await api.chapters.create();await api.chapters.update(chapter.id,{title:'原稿',content:'这段正式正文必须保留。'})
    return{project,chapterId:chapter.id}
  },{books,baseUrl:`http://127.0.0.1:${server.address().port}/v1`})
  await page.reload();await page.getByTestId('app-boot-enter').click();await page.getByTestId('app-boot').waitFor({state:'hidden'})
  if(await page.locator('.project-library').isVisible()){await page.locator('.work-item-open').filter({hasText:'对话插件隔离验收'}).first().click();await page.getByTestId('workspace-loading').waitFor({state:'hidden'})}
  await page.locator('.assistant-toggle').click()
  await send('WORKBENCH_CREATE：帮我创建一个字数工具并安装。')
  // This first review follows six real model/service/persistence steps.
  await page.getByTestId('author-action-review').waitFor({timeout:60000})
  assert.match(await page.getByTestId('author-action-review').innerText(),/安装 对话创建的字数工具/)
  assert.equal(await page.getByTestId('submit-author-answer').isDisabled(),true)
  const before=await page.evaluate(()=>window.novelDesktop.writingPlugins.list(true));assert.equal(before.plugins.length,0)
  const draft=(await page.evaluate(()=>window.novelDesktop.writingPlugins.listDrafts()))[0];assert.equal(draft.revision,2);assert.equal(JSON.parse(draft.manifestText).name,'对话创建的字数工具')
  await shot('install-review-light')
  await page.getByTestId('author-action-review').getByText('插件清单与所需能力',{exact:true}).click()
  assert.match(await page.getByTestId('author-action-review').locator('pre').first().innerText(),/count_text/)
  assert.equal(await page.getByTestId('author-question-card').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true)
  await shot('install-review-expanded');await answer('确认执行');await completed()
  const installed=await page.evaluate(()=>window.novelDesktop.writingPlugins.list(true));assert.equal(installed.plugins[0].enabled,false);assert.deepEqual(installed.plugins[0].versions[0].grants,[])
  checks.push('Real renderer conversation creates, reads, saves and builds source; host preview waits for explicit author confirmation; installs disabled and ungranted')
  const exportedPath=join(root,'对话导出的插件.zip')
  await app.evaluate(({dialog},filePath)=>{globalThis.__exportDialogs=0;dialog.showSaveDialog=async()=>{globalThis.__exportDialogs++;return{canceled:false,filePath}}},exportedPath)
  await send('WORKBENCH_EXPORT：把刚才的插件导出，我来选择保存位置。')
  await page.getByTestId('author-action-review').getByRole('heading',{name:/导出插件包/}).waitFor()
  assert.equal(await app.evaluate(()=>globalThis.__exportDialogs),0);assert.equal(await page.getByTestId('submit-author-answer').isDisabled(),true)
  await page.getByTestId('author-action-review').scrollIntoViewIfNeeded()
  await shot('export-tool-review');await answer('确认执行');await completed()
  assert.equal(await app.evaluate(()=>globalThis.__exportDialogs),1)
  assert.equal(createHash('sha256').update(await readFile(exportedPath)).digest('hex'),exportReceipt.digest)
  assert.equal(JSON.stringify(exportReceipt).includes(root),false)
  checks.push('Real export tool waits for the author review, opens the substituted native picker once, writes exact bytes and returns a path-free receipt to model continuation')
  await app.evaluate(({dialog},filePath)=>{globalThis.__copyDialogs=0;dialog.showOpenDialog=async()=>{globalThis.__copyDialogs++;return{canceled:false,filePaths:[filePath]}}},exportedPath)
  await send('WORKBENCH_IMPORT：选择刚导出的插件包，复制一个可修改的个人版本。');await completed()
  assert.equal(await app.evaluate(()=>globalThis.__copyDialogs),1)
  const afterCopy=await page.evaluate(()=>window.novelDesktop.writingPlugins.listDrafts())
  assert.equal(afterCopy.length,2);assert.ok(afterCopy.some(d=>d.id===copiedReceipt.id));assert.equal(copiedReceipt.upstream.digest,exportReceipt.digest)
  assert.equal((await page.evaluate(()=>window.novelDesktop.writingPlugins.list(true))).plugins.length,1)
  assert.equal(createHash('sha256').update(await readFile(exportedPath)).digest('hex'),exportReceipt.digest)
  assert.equal(JSON.stringify(copiedReceipt).includes(root),false)
  checks.push('Model import uses native-selected exported ZIP, creates exactly one new identity, reads it back and preserves source/installed state')
  await app.evaluate(({dialog})=>{dialog.showOpenDialog=async()=>({canceled:true,filePaths:[]})})
  await send('WORKBENCH_IMPORT_CANCEL：再选择一个包，我会取消选择。');await completed()
  assert.equal((await page.evaluate(()=>window.novelDesktop.writingPlugins.listDrafts())).length,2)
  checks.push('Native picker cancellation returns cancelled to the model without a new draft')
  await send('WORKBENCH_ENABLE：启用刚才的插件并为本书使用。')
  await page.getByTestId('author-action-review').getByRole('heading',{name:/启用插件并授权/}).waitFor();await answer('确认执行')
  await page.getByTestId('author-action-review').getByRole('heading',{name:/为本书使用插件/}).waitFor();assert.equal(await page.getByTestId('submit-author-answer').isDisabled(),true);await answer('确认执行');await completed()
  const enabled=await page.evaluate(()=>window.novelDesktop.writingPlugins.list(true));assert.equal(enabled.plugins[0].enabled,true);assert.equal(enabled.plugins[0].bookEnabled,true)
  checks.push('Separate real confirmations for global enable and current-book selection; no answer reused for the following operation')
  await send('WORKBENCH_CANCEL：预览卸载，然后我会取消。')
  await page.getByTestId('author-action-review').getByRole('heading',{name:/卸载插件/}).waitFor();await answer('取消这项操作');await completed()
  assert.equal((await page.evaluate(()=>window.novelDesktop.writingPlugins.list(true))).plugins.length,1)
  assert.equal((await page.evaluate(id=>window.novelDesktop.chapters.get(id),state.chapterId)).content,'这段正式正文必须保留。')
  checks.push('Cancellation returns to the model without uninstalling; formal manuscript unchanged')
  const sizes=requests.map(r=>({count:r.tools.length,bytes:Buffer.byteLength(JSON.stringify(r.tools))}));assert.ok(sizes.every(s=>s.count<=48&&s.bytes<=96*1024))
  const report={ok:true,checks,requests:requests.length,toolBudget:sizes,liveProvider:false,errors};await writeFile(join(evidence,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
}catch(e){await shot('failure').catch(()=>{});await writeFile(join(evidence,'failure.json'),JSON.stringify({error:String(e),checks,errors,requests:requests.length,runs:await page?.evaluate(()=>window.novelDesktop.fieldAssistant.runs.recent()).catch(()=>[]),body:await page?.locator('body').innerText().catch(()=>'' )},null,2));throw e}
finally{
  clearTimeout(watchdog);if(app){const owned=app.process(),timer=setTimeout(()=>owned.kill('SIGKILL'),10000);await app.close().catch(()=>{});clearTimeout(timer)}server.closeAllConnections();await new Promise(r=>server.close(r))
  const checked=await realpath(root);if(dirname(checked)!==parent||!basename(checked).startsWith('lanjian-workbench-ui-'))throw new Error('Refusing cleanup outside owned test profile')
  await rm(checked,{recursive:true,force:true,maxRetries:5,retryDelay:200})
}
