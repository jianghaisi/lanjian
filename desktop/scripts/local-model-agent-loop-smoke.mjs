import { _electron as electron } from 'playwright'
import { mkdtemp, mkdir, readFile, writeFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'
const root=await mkdtemp(join(tmpdir(),'lanjian-agent-loop-'))
const buildDir=process.env.LANJIAN_QA_BUILD_DIR||'out'
const evidence=resolve('artifacts/local-model-store');await mkdir(evidence,{recursive:true})
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('LANJIAN_')&&key!=='ELECTRON_RUN_AS_NODE'))
let app,page
const results={root}
const resume=process.argv.includes('--resume')
// Beta acceptance exercises tools and navigation; long-form probes are opt-in diagnostics.
const navigationOnly=!resume&&!process.argv.includes('--writing-sample')
const initialMessage='帮我写一个1000字正文的测试小说，我就测试本地模型用的'
const conversationText=text=>text.replace(/^智能助笔\s*/, '').replace(/\n\n已查看 \d+ 项\s*$/, '')
async function send(message){
  const replies=await page.locator('.assistant-chat-message.assistant').count()
  await page.getByTestId('field-assistant-instruction').fill(message)
  await page.getByTestId('send-field-assistant').click()
  await page.waitForFunction(count=>document.querySelectorAll('.assistant-chat-message.assistant').length>count||Boolean(document.querySelector('.field-assistant-error')),replies,{timeout:360000})
  await page.locator('.assistant-chat-progress').waitFor({state:'hidden',timeout:360000})
  const error=await page.locator('.field-assistant-error').count()?await page.locator('.field-assistant-error').textContent():null
  assert.equal(error,null,error||'no conversation error')
  return page.locator('.assistant-chat-message.assistant').last().innerText()
}
try{
  app=await electron.launch({args:[resolve(buildDir,'main/index.js')],env:{...env,LANJIAN_USER_DATA_PATH:join(root,'profile')},timeout:60000})
  page=await app.firstWindow();page.setDefaultTimeout(30000)
  await page.waitForFunction(()=>Boolean(window.novelDesktop))
  const created=await page.evaluate(parentPath=>window.novelDesktop.projects.create({parentPath,name:'跨页本地助笔回归',genre:'悬疑'}),root)
  results.project=created.project.path
  assert.equal((await page.evaluate(()=>window.novelDesktop.localModels.inspect('qwen3-1.7b-q8_0'))).state,'ready')
  results.outputBudget=navigationOnly?512:2048
  await page.evaluate(async maxTokens=>{
    const settings=await window.novelDesktop.ai.getSettings()
    await window.novelDesktop.ai.updateSettings({routingMode:'shared',shared:{...settings.shared,connectionId:'local:llama-cpp',model:'qwen3-1.7b-q8_0',maxTokens}})
  },results.outputBudget)
  await page.reload();await page.getByTestId('library-continue-writing').click()
  await page.waitForSelector('.studio:not(.library-mode)',{timeout:60000})
  await page.getByTestId('workspace-loading').waitFor({state:'hidden',timeout:60000})
  await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('index.html'));w.unmaximize();w.setContentSize(1440,900);w.webContents.setZoomFactor(1)})
  await page.locator('.activitybar [data-activity="world"]').focus();await page.keyboard.press('Enter')
  await page.locator('[data-nav-leaf="world"]').click()
  await page.locator('[data-assistant-field="AppShell.foundation.worldView"]').waitFor()
  await page.getByRole('button',{name:'打开智能助笔侧栏',exact:true}).click()
  const profilePath=join(created.project.path,'.webnovel/config/book-profile.json')
  const before=await readFile(profilePath,'utf8')
  if(resume){
    const previous=JSON.parse(await readFile(join(evidence,'agent-loop-ui-retry-timeout.json'),'utf8'))
    assert.equal(previous.continuations.length,1)
    const history=[{role:'user',content:initialMessage},{role:'assistant',content:conversationText(previous.sample)},{role:'user',content:'继续'},{role:'assistant',content:conversationText(previous.continuations[0].content)}]
    const operationId=crypto.randomUUID()
    const request={operationId,workItemId:created.project.id,page:'world',message:'继续',chapterId:null,selectedCharacters:0,history,targets:[],connectionId:'local:llama-cpp',model:'qwen3-1.7b-q8_0',maxTokensOverride:2048}
    let status=''
    const timer=setInterval(()=>void page.evaluate(id=>window.novelDesktop.fieldAssistant.conversationProgress(id),operationId).then(progress=>{if(progress&&status!==progress.message){status=progress.message;console.log(JSON.stringify({stage:'resume-progress',message:status}))}}).catch(()=>{}),1500)
    const start=Date.now()
    try{
      const result=await page.evaluate(request=>window.novelDesktop.fieldAssistant.conversation(request),request)
      assert.equal(result.kind,'message');assert.match(result.message,/未写入正文/)
      const chinese=(result.message.match(/\p{Script=Han}/gu)||[]).length
      assert.ok(chinese>=500)
      const reference=history.filter(turn=>turn.role==='assistant').map(turn=>turn.content).join('\n\n')
      assert.ok(!result.message.split(/\n\s*\n/).some(part=>part.length>=40&&reference.includes(part)))
      results.resumedContinuation={source:'agent-loop-ui-retry-timeout.json',result,chinese,elapsedMs:Date.now()-start}
      console.log(JSON.stringify({stage:'resumed-continue',chinese,elapsedMs:Date.now()-start}))
      history.push({role:'user',content:'继续'},{role:'assistant',content:result.message})
      results.longHistoryNavigation=await page.evaluate(request=>window.novelDesktop.fieldAssistant.conversation(request),{...request,operationId:crypto.randomUUID(),history,message:'请把作品定义里的计划卷数改为2，其他内容保持原样。'})
      assert.equal(results.longHistoryNavigation.kind,'navigate');assert.equal(results.longHistoryNavigation.workspaceId,'profile')
    }finally{clearInterval(timer)}
  }else if(!navigationOnly){
  const started=Date.now()
  results.sample=await send(initialMessage)
  results.sampleMs=Date.now()-started
  results.chinese=(results.sample.match(/\p{Script=Han}/gu)||[]).length
  assert.ok(results.chinese>=1000,'The actual UI must show the requested prose')
  assert.match(results.sample,/未写入正文/)
  assert.equal(await readFile(profilePath,'utf8'),before)
  console.log(JSON.stringify({stage:'sample',chinese:results.chinese,elapsedMs:results.sampleMs}))
  results.continuations=[]
  for(let turn=0;turn<2;turn++){
    const start=Date.now(),content=await send('继续')
    const chinese=(content.match(/\p{Script=Han}/gu)||[]).length
    assert.ok(chinese>=500)
    results.continuations.push({content,chinese,elapsedMs:Date.now()-start})
    console.log(JSON.stringify({stage:'continue',turn,chinese,elapsedMs:Date.now()-start}))
  }
  }
  results.crossPage=await send('请把作品定义里的计划卷数改为2，其他内容保持原样。')
  await page.locator('[data-assistant-field="definition.bookProfile.plannedVolumes"]').waitFor()
  const tasks=await page.evaluate(id=>window.novelDesktop.fieldAssistant.recent(id),created.project.id)
  const latest=tasks[0]
  assert.equal(latest.status,'completed');assert.equal(latest.candidate.target.fieldId,'definition.bookProfile.plannedVolumes');assert.equal(latest.candidate.after,2)
  assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('data-assistant-field')),'definition.bookProfile.plannedVolumes','The edited input must be visibly focused')
  assert.equal(await readFile(profilePath,'utf8'),before,'Candidate/navigation must not save the profile')
  assert.equal(await access(join(created.project.path,'.webnovel/workspace.sqlite')).then(()=>true,()=>false),false,'No database migration for conversation work')
  results.crossPageTask=latest;results.originalProfilePreserved=true
  await writeFile(join(evidence,'agent-loop-ui.png'),await app.evaluate(async({BrowserWindow})=>Array.from((await BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('index.html')).capturePage()).toPNG())).then(bytes=>Buffer.from(bytes)))
  console.log('PASS: '+(navigationOnly?'':resume?'resumed second continuation through actual IPC, long-history navigation, ':'real UI sample and two continuations, ')+'actual UI cross-page list/read/edit, original profile preserved, no database')
}catch(error){results.error=String(error);if(page){results.visibleText=(await page.locator('body').innerText().catch(()=>'' )).slice(-5000);await page.screenshot({path:join(evidence,'agent-loop-ui-failure.png')}).catch(()=>{})}console.error(error);process.exitCode=1}
finally{await writeFile(join(evidence,'agent-loop-ui.json'),JSON.stringify(results,null,2));if(app)await app.close().catch(()=>{});console.log('Evidence: '+evidence)}
