import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { _electron } from 'playwright'

// Real packaged-layout main/preload + validated IPC; only temporary books and a
// loopback fake provider. No developer driver or author model configuration.
const temporaryParent = await realpath(tmpdir())
const root = await realpath(await mkdtemp(join(temporaryParent, 'lanjian-author-interaction-smoke-')))
const books = join(root, 'books'), userData = join(root, 'app')
await Promise.all([mkdir(books), mkdir(userData)])
const entry = resolve(process.env.LANJIAN_BUILT_DESKTOP_DIR || 'out-author-interaction-check', 'main/index.js')
const seen = [], errors = []
let answered
const question = {questions:[
  {id:'tone',prompt:'你希望故事如何展开？',mode:'single',required:true,options:[{id:'warm',label:'温暖的相遇',description:'从小人物的善意开始。',recommended:true},{id:'dark',label:'雨夜的悬疑',description:'从一件不合常理的旧物开始。'}]},
  {id:'elements',prompt:'保留哪些元素？',mode:'multiple',required:true,options:[{id:'rain',label:'雨夜'},{id:'memory',label:'旧物记忆'}]},
  {id:'note',prompt:'还有什么想补充的？',mode:'text',required:false,options:[]}
]}
const server=createServer(async(request,response)=>{
  try{
    if(request.method==='GET'){response.setHeader('Content-Type','application/json');response.end(JSON.stringify({data:[{id:'plugin-smoke-model'}]}));return}
    let raw='';for await(const chunk of request)raw+=chunk
    const body=JSON.parse(raw);seen.push(body)
    if(!body.tools){response.setHeader('Content-Type','application/json');response.end(JSON.stringify({choices:[{message:{role:'assistant',content:JSON.stringify({value:'修复师能听见旧物的雨夜记忆。'})},finish_reason:'stop'}]}));return}
    const declared = new Set(body.messages.flatMap(message => message.tool_calls ?? []).map(call => call.id))
    assert.ok(body.messages.filter(message => message.role === 'tool').every(message => declared.has(message.tool_call_id)), 'Each tool result needs its original provider declaration')
    const results=body.messages.filter(m=>m.role==='tool')
    const user=body.messages.filter(m=>m.role==='user').at(-1).content
    const jsonReply=message=>{response.setHeader('Content-Type','application/json');response.end(JSON.stringify({choices:[{message,finish_reason:message.tool_calls?'tool_calls':'stop'}]}))}
    if(user==='FIELD'){
      const tool=(name,args)=>jsonReply({role:'assistant',content:null,tool_calls:[{id:'call-'+body.messages.length,type:'function',function:{name,arguments:JSON.stringify(args)}}]})
      const values=results.map(item=>JSON.parse(item.content))
      if(values.some(item=>item.decision))return jsonReply({role:'assistant',content:'字段候选已由作者处理，原任务接续完成。'})
      const afterNavigation=values.slice(values.findLastIndex(item=>item.navigated)+1)
      const fields=afterNavigation.find(item=>item.fields)?.fields
      if(!fields)return tool('list_editable_fields',{query:'核心设想'})
      if(!afterNavigation.some(item=>item.label==='核心设想'&&item.context))return tool('read_field',{targetId:fields[0].targetId})
      return tool('edit_field',{targetId:fields[0].targetId,instruction:'改成旧物记忆'})
    }
    const name=body.tools.find(t=>t.function.name.includes('_ask_author_')).function.name
    const message=results.length?{role:'assistant',content:'已根据作者的真实回答继续原来的故事目标。'}:{role:'assistant',content:null,tool_calls:[{id:'author-question-call',type:'function',function:{name,arguments:JSON.stringify(question)}}]}
    if(results.length)answered=JSON.parse(results.at(-1).content)
    response.setHeader('Content-Type','application/json');response.end(JSON.stringify({choices:[{message,finish_reason:results.length?'stop':'tool_calls'}]}))
  }catch(error){errors.push(error);response.statusCode=500;response.end('{}')}
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('LANJIAN_') && key !== 'ELECTRON_RUN_AS_NODE' && key !== 'ELECTRON_RENDERER_URL'))
env.LANJIAN_USER_DATA_PATH = userData
env.LANJIAN_GLOBAL_MODEL_DATA_PATH = join(userData, 'global-model-data', 'v1')
let app
try {
  app = await _electron.launch({ args: [entry, '--disable-gpu'], env })
  let page = await app.firstWindow()
  page.on('pageerror',error=>console.error('Renderer error:',error.message))
  await page.waitForFunction(() => Boolean(window.novelDesktop?.fieldAssistant), undefined, { timeout: 20000 })
  const state = await page.evaluate(async ({ books, baseUrl }) => {
    let stage = 'create'
    try {
    const api = window.novelDesktop
    const { project } = await api.projects.create({ parentPath: books, name: '原书A', genre: '仙侠' })
    stage = 'configure-model'
    const catalogue = await api.modelConnections.list()
    const created = await api.modelConnections.create({ expectedRevision: catalogue.revision, name: '插件隔离接口', baseUrl, protocol: 'openai-compatible', apiKey: 'synthetic-plugin-key' })
    const connection = created.connections.find(item => item.name === '插件隔离接口')
    const edit = await api.modelConnections.book()
    await api.modelConnections.saveBook({ token: edit.token, patch: { routingMode: 'shared', globalReferences: [{ id: 'smoke', globalConnectionId: connection.id }], globalRevisions: [{ id: connection.id, revision: connection.revision }], shared: { connectionId: 'smoke', model: 'plugin-smoke-model', temperature: .6, topP: 1, maxTokens: 8192 } } })
    const profile = await api.workspace.getBookProfile()
    await api.workspace.saveBookProfile({ ...profile, coreIdea: '原书设想A' })
    const chapter = await api.chapters.create()
    await api.chapters.update(chapter.id, { content: '原书A的雨夜正文。', title: '雨夜' })
    return { project, chapterId: chapter.id }
    } catch (error) { throw new Error(stage + ': ' + JSON.stringify(error)) }
  }, { books, baseUrl: `http://127.0.0.1:${server.address().port}/v1` })
  async function openBook(title='原书A'){
    await page.evaluate(async()=>{localStorage.setItem('lanjian-companion-voice-v1',JSON.stringify({voice:'ningguang',mute:true,textModel:false,preload:false}));await window.companionSettings?.update({voice:{mute:true,textModel:false,preload:false}})})
    await page.reload()
    await page.waitForFunction(()=>Boolean(window.novelDesktop),undefined,{timeout:60000})
    await page.waitForTimeout(1500)
    if(await page.getByTestId('app-boot-skip-models').isVisible())await page.getByTestId('app-boot-skip-models').click()
    await page.waitForFunction(()=>{const boot=document.querySelector('[data-testid="app-boot"]');return !boot||boot.getAttribute('data-boot-phase')==='ready'})
    const owner=await app.browserWindow(page)
    await owner.evaluate(win=>{win.hide();win.show();win.focus()})
    await page.getByTestId('app-boot').waitFor({state:'hidden',timeout:60000})
    if(!await page.locator('.assistant-toggle').isVisible()){
      await page.locator('[data-library-view="all"]').click()
      await page.locator('.work-item-open').filter({hasText:title}).first().click()
    }
    await page.getByTestId('workspace-loading').waitFor({state:'hidden',timeout:60000})
    await page.locator('.assistant-toggle').waitFor({timeout:60000}).catch(async error=>{console.error(await page.locator('body').innerText());throw error})
    await page.locator('.assistant-toggle').click()
    await page.getByTestId('field-assistant-instruction').waitFor()
  }
  await openBook()
  console.log('Fixture ready; checking question UI')
  await page.getByTestId('field-assistant-instruction').fill('INTERACT')
  await page.getByTestId('send-field-assistant').click()
  await page.getByTestId('author-question-card').waitFor({timeout:60000})
  const submit=page.getByTestId('submit-author-answer')
  assert.equal(await submit.isDisabled(),true,'Recommended options must not count as answers')
  await page.getByLabel('温暖的相遇').check()
  await page.getByLabel('你希望故事如何展开？：自由回答').fill('主角先帮助陌生人，再发现旧物的秘密。')
  assert.equal(await page.getByLabel('温暖的相遇').isChecked(),false)
  await page.getByLabel('雨夜',{exact:true}).check()
  await page.getByLabel('旧物记忆',{exact:true}).check()
  const note=page.getByLabel('还有什么想补充的？：自由回答')
  await note.fill('保留人物的犹豫与善意。')
  await note.dispatchEvent('compositionstart')
  await note.press('Control+Enter')
  assert.equal(seen.length,1,'Chinese composition cannot submit')
  await note.dispatchEvent('compositionend')
  await page.getByRole('button',{name:'暂不回答',exact:true}).click()
  await page.locator('.assistant-toggle').click()
  assert.equal(await note.inputValue(),'保留人物的犹豫与善意。')
  await mkdir(resolve('../.trellis/tasks/09-18-v3-author-interaction-tools/research/screenshots'),{recursive:true})
  for(const theme of ['qingzhou','moye','xuanzhi']){
    await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme)
    await page.getByTestId('author-question-card').locator('header').scrollIntoViewIfNeeded()
    await page.screenshot({path:resolve('../.trellis/tasks/09-18-v3-author-interaction-tools/research/screenshots/question-'+theme+'.png')})
    const geometry=await page.getByTestId('author-question-card').evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth,buttons:[...el.querySelectorAll('button')].map(b=>({w:b.getBoundingClientRect().width,h:b.getBoundingClientRect().height}))}))
    assert.ok(geometry.width>200&&geometry.scroll<=geometry.width+1)
    assert.ok(geometry.buttons.every(b=>b.w>20&&b.h>20))
  }
  const nativeWindow=await app.browserWindow(page)
  await nativeWindow.evaluate(win=>win.webContents.setZoomFactor(1.25))
  await page.getByTestId('author-question-card').locator('header').scrollIntoViewIfNeeded()
  const zoomFrame=await nativeWindow.evaluate(async win=>{const shot=await win.webContents.capturePage();return {bytes:shot.toPNG().toString('base64'),size:shot.getSize()}})
  assert.ok(zoomFrame.size.width>1000&&zoomFrame.size.height>600)
  await writeFile(resolve('../.trellis/tasks/09-18-v3-author-interaction-tools/research/screenshots/question-zoom-125.png'),Buffer.from(zoomFrame.bytes,'base64'))
  assert.ok(await page.getByTestId('author-question-card').evaluate(el=>el.scrollWidth<=el.clientWidth+1))
  await nativeWindow.evaluate(win=>win.webContents.setZoomFactor(1))
  await submit.click()
  await page.getByText('已根据作者的真实回答继续原来的故事目标。',{exact:true}).waitFor({timeout:60000}).catch(async error=>{console.error('UI:',await page.locator('.field-assistant-error').allTextContents());console.error('Runs:',await page.evaluate(()=>window.novelDesktop.fieldAssistant.runs.recent()));throw error})
  assert.deepEqual(answered.answers.map(a=>a.id),['tone','elements','note'])
  assert.deepEqual(answered.answers[0].chosenOptionIds,[])
  assert.deepEqual(answered.answers[1].chosenOptionIds,['rain','memory'])
  const firstRuns=await page.evaluate(()=>window.novelDesktop.fieldAssistant.runs.recent())
  assert.equal(firstRuns[0].status,'completed');assert.equal(firstRuns[0].step,2)
  assert.equal(await page.evaluate(()=>window.novelDesktop.workspace.getBookProfile().then(p=>p.coreIdea)),'原书设想A')
  assert.equal(await page.getByTestId('field-assistant-instruction').evaluate(el=>el===document.activeElement),true,'Answer completion restores composer focus')
  console.log('PASS question UI, themes, zoom and original-call answer')
  await page.getByTestId('field-assistant-instruction').fill('FIELD')
  await page.getByTestId('send-field-assistant').click()
  await page.getByTestId('apply-field-candidate').waitFor({timeout:90000}).catch(async error=>{console.error('FIELD UI:',await page.locator('.field-assistant').innerText());console.error('FIELD runs:',await page.evaluate(()=>window.novelDesktop.fieldAssistant.runs.recent()));console.error('MODEL calls:',seen.map(b=>b.tools?b.messages.filter(m=>m.role==='tool').map(m=>m.content):'field'));throw error})
  assert.equal((await page.evaluate(()=>window.novelDesktop.fieldAssistant.runs.recent().then(r=>r.find(v=>v.goal==='FIELD')))).status,'waiting-adoption')
  await page.getByTestId('apply-field-candidate').click()
  await page.getByText('字段候选已由作者处理，原任务接续完成。',{exact:true}).waitFor({timeout:60000})
  assert.equal(await page.evaluate(()=>window.novelDesktop.workspace.getBookProfile().then(p=>p.coreIdea)),'原书设想A')
  await page.getByTestId('undo-field-candidate').click()
  assert.equal(await page.locator('.profile-premise textarea').inputValue(),'原书设想A')
  console.log('PASS cross-page field adoption and undo')
  await page.getByTestId('field-assistant-instruction').fill('RESTART')
  await page.getByTestId('send-field-assistant').click()
  await page.getByTestId('author-question-card').waitFor({timeout:60000})
  const waiting=await page.evaluate(()=>window.novelDesktop.fieldAssistant.runs.recent().then(r=>r.find(v=>v.status==='waiting-input')))
  const beforeRestart=seen.length
  await app.close();app=await _electron.launch({args:[entry,'--disable-gpu'],env});page=await app.firstWindow()
  await openBook()
  await page.getByRole('button',{name:'恢复任务',exact:true}).waitFor({timeout:15000})
  assert.equal(seen.length,beforeRestart,'Restart must not invoke a model')
  await page.getByRole('button',{name:'恢复任务',exact:true}).click()
  await page.getByTestId('submit-author-answer').waitFor()
  await page.getByLabel('雨夜的悬疑').check();await page.getByLabel('雨夜',{exact:true}).check()
  await page.getByLabel('跳过这道问题').check()
  await page.getByTestId('submit-author-answer').focus()
  await page.getByTestId('submit-author-answer').press('Enter')
  await page.getByText('已根据作者的真实回答继续原来的故事目标。',{exact:true}).waitFor({timeout:60000}).catch(async error=>{console.error('UI:',await page.locator('.field-assistant-error').allTextContents());console.error('Runs:',await page.evaluate(()=>window.novelDesktop.fieldAssistant.runs.recent()));throw error})
  assert.equal((await page.evaluate(id=>window.novelDesktop.fieldAssistant.runs.status(id),waiting.id)).status,'completed')
  console.log('PASS explicit recovery after restart')
  await page.getByTestId('field-assistant-instruction').fill('SCOPE')
  await page.getByTestId('send-field-assistant').click()
  await page.getByTestId('author-question-card').waitFor({timeout:60000})
  const scopeRun=await page.evaluate(()=>window.novelDesktop.fieldAssistant.runs.recent().then(r=>r.find(v=>v.goal==='SCOPE')))
  const beforeSwitch=seen.length
  await page.getByRole('button',{name:'返回我的作品',exact:true}).click()
  await page.evaluate(parentPath=>window.novelDesktop.projects.create({parentPath,name:'另一部B',genre:'悬疑'}),books)
  await openBook('另一部B')
  assert.equal(await page.getByTestId('author-question-card').count(),0)
  const wrongBook=await page.evaluate(async id=>{try{await window.novelDesktop.fieldAssistant.runs.status(id);return false}catch(error){return error.code==='NOT_FOUND'}},scopeRun.id)
  assert.equal(wrongBook,true)
  await page.getByRole('button',{name:'返回我的作品',exact:true}).click()
  await page.locator('[data-library-view="all"]').click()
  await page.locator('.work-item-open').filter({hasText:'原书A'}).first().click()
  await page.getByTestId('workspace-loading').waitFor({state:'hidden',timeout:60000})
  if(await page.locator('.assistant-toggle').getAttribute('aria-expanded')!=='true')await page.locator('.assistant-toggle').click()
  await page.getByTestId('author-question-card').waitFor({timeout:60000})
  assert.equal(seen.length,beforeSwitch)
  await page.getByTestId('author-question-card').getByRole('button',{name:'停止任务',exact:true}).click()
  await page.getByTestId('author-question-card').waitFor({state:'hidden'})
  const late=await page.evaluate(async run=>{try{await window.novelDesktop.fieldAssistant.runs.answer({runId:run.id,questionId:run.question.id,questionVersion:run.question.version,answerSubmissionId:'late',answers:[]});return false}catch(error){return error.code==='CONFLICT'}},scopeRun)
  assert.equal(late,true);assert.equal((await page.evaluate(id=>window.novelDesktop.fieldAssistant.runs.status(id),scopeRun.id)).status,'cancelled')
  assert.deepEqual(errors,[])
  console.log(JSON.stringify({ok:true,checks:['real three-mode question UI and IPC','recommendation is not an answer','IME blocks submission','defer/reopen retains input','three themed layouts and 125% zoom','answer resumes original call','real field adoption and undo keep formal data unchanged','restart does not execute','explicit restart recovery keeps run ID','A to B to A retains pending question','explicit cancellation rejects late answer'],modelRequests:seen.length},null,2))

} finally {
  if (app) {
    // A preload failure cannot acknowledge the application's graceful close IPC.
    // Only this isolated fixture may fall back to exiting its owned process.
    const hasApi = await app.firstWindow().then(page => page.evaluate(() => Boolean(window.novelDesktop))).catch(() => false)
    if (!hasApi) await app.evaluate(({ app }) => { app.exit(1) }).catch(() => {})
    else await app.close()
  }
  await new Promise(resolve => server.close(resolve))
  // Verify the exact owned temporary directory before recursive disposal.
  const target = await realpath(root)
  assert.equal(dirname(target), temporaryParent)
  assert.ok(basename(target).startsWith('lanjian-author-interaction-smoke-'))
  await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
