import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import JSZip from 'jszip'
import { validatePluginManifest, type PluginComposition, type JsonValue } from '@lanjian/writing-plugin-contracts'
import { WritingPluginManager } from '../../src/main/modules/writing-plugins/application/plugin-manager'
import { PluginPackageStore } from '../../src/main/modules/writing-plugins/adapters/package-store'
import { registerInstalledTools } from '../../src/main/modules/writing-plugins/adapters/installed-tools'
import { WritingPluginRegistry, modelToolName } from '../../src/main/modules/writing-plugins/application/registry'
import { WritingPluginDispatcher } from '../../src/main/modules/writing-plugins/application/dispatcher'
import { DurablePluginEffects } from '../../src/main/modules/writing-plugins/application/effect-journal'
import { executeGuest } from '../../src/main/modules/writing-plugins/runtime/guest-engine'
import { builtinTool } from '../../src/main/modules/writing-plugins/adapters/builtin/fields'
import { objectSchema, textSchema } from '../../src/main/modules/writing-plugins/domain/schema'
import { WritingAgentService } from '../../src/main/modules/assistant/application/writing-agent-service'
import { PlanningDraftService } from '../../src/main/modules/planning/application/planning-draft-service'
import { FoundationDraftService } from '../../src/main/modules/planning/application/foundation-draft-service'

test('real writing compiler freezes sourced optional fragments and preserves mandatory canon', async () => {
  type Args = ConstructorParameters<typeof WritingAgentService>
  let tone = '原组合', sent = ''
  const agent = new WritingAgentService({ modelFor: async () => 'original-model', complete: async (_instruction: string, _draft: string, context: string) => { sent = context; return { content: '只读建议' } } } as unknown as Args[0],
    { currentSummary: async () => ({ id: 'book', path: 'C:/book' }), currentPath: async () => 'C:/book' } as unknown as Args[1], { chapter: async () => ({ id: 1 }) } as unknown as Args[2],
    { contextBudgetPreferences: async () => ({ modelContextLimit: 32000, outputReservePercent: 25, systemReserveTokens: 1000, inputBudgetTokens: 20000 }), currentChapterCardFingerprint: async () => 'canon', promptContextCandidates: async () => [{ id: 'canon', sourceType: 'formal', sourceId: 'canon', label: '必需章契', content: '必须保留本章事实、境界与固定系统显示。', authority: 'required', truncationPolicy: 'never' }], contextFactPack: async () => ({ evidence: [] }), consistencyOverview: async () => ({ items: [] }) } as unknown as Args[3], {} as Args[4], undefined,
    async stage => [{ id:'plugin:voice',sourceType:'writing-plugin',sourceId:'author/style',sourceVersion:tone,label:'插件参考',content:`${stage}：${tone}（非正式设定）`,authority:'optional',truncationPolicy:'drop',untrusted:true }])
  const input = { chapterId:1,message:'核对动机',currentDraft:'正式原稿',preferredSkill:'query' as const }
  const prepared=await agent.prepare(input); tone='新组合'
  const plugin=prepared.contextCompilation.included.find(c=>c.id==='plugin:voice')!
  assert.equal(plugin.untrusted,true); assert.equal(plugin.sourceVersion,'原组合')
  await agent.run(input,undefined,prepared); assert.match(sent,/review：原组合/); assert.doesNotMatch(sent,/新组合/); assert.match(sent,/必须保留本章事实/)
  await assert.rejects(agent.prepare({...input,contextSelection:{pinnedIds:[],excludedIds:['canon'],temporaryAdditions:[]}}),{code:'VALIDATION_ERROR'})
})

test('planning and worldbuilding candidate services receive optional plugin sources without adoption access', async () => {
  const source={id:'style',sourceType:'writing-plugin',sourceId:'author/style',sourceVersion:'1/digest/2',content:'插件参考：古典克制',authority:'optional',untrusted:true}
  type PlanningArgs=ConstructorParameters<typeof PlanningDraftService>
  const profile={genre:'仙侠',targetWords:100000} as Awaited<ReturnType<PlanningArgs[1]['bookProfile']>>
  const foundation={creationPath:'materials' as const,sourceNotes:'原素材',worldView:'原事实',useRealms:false,useSystem:false}
  const parent={projectFingerprint:'a'.repeat(64),key:'total',kind:'summary' as const,title:'原纲',content:'原父级',revision:'b'.repeat(64)}
  let planningContext='', foundationContext=''
  const planner=new PlanningDraftService({complete:async(_i,_d,context)=>{if(_i.startsWith('复核下方完整候选'))return {content:'{"issues":[]}'};planningContext=context!;return {content:JSON.stringify({children:[{title:'子卷',content:'保留原事实',events:[{time:'翌日',characters:['主角'],location:'山门',event:'追查线索'}]}]})}}},{bookProfile:async()=>profile,foundation:async()=>foundation,planningOutline:async()=>parent},undefined,undefined,async()=>[source])
  const candidate=await planner.expandNextLayer({parentKey:'total',expectedRevision:parent.revision,count:1,instruction:'拆解'})
  assert.match(planningContext,/古典克制/); assert.match(planningContext,/不得覆盖父级/); assert.equal(candidate.source.revision,parent.revision)
  type FoundationArgs=ConstructorParameters<typeof FoundationDraftService>
  const world=new FoundationDraftService({complete:async(_i,_d,context)=>{foundationContext=context!;return {content:JSON.stringify({worldView:'候选世界',useRealms:false,realms:[],useSystem:false,systemTemplate:'',rationale:'候选理由'})}}},{bookProfile:async()=>profile,foundation:async()=>foundation,hasPlanningMaterials:async()=>true,effectivePrompt:async()=>'',promptContext:async()=>'原事实不可覆盖',contextBudgetPreferences:async()=>({structuredRepairAttempts:1})} as unknown as FoundationArgs[1],async()=>[source])
  assert.equal((await world.generate()).worldView,'候选世界'); assert.match(foundationContext,/古典克制/); assert.match(foundationContext,/原事实不可覆盖/)
})

test('selected checker/template/workflow/reference use actual VM, locked parameters, domain candidates and original checkpoint budget', async t => {
  const root=await mkdtemp(join(tmpdir(),'lanjian-contribution-')); t.after(()=>rm(root,{recursive:true,force:true}))
  const manifest=validatePluginManifest(JSON.parse(await readFile(new URL('../../examples/writing-plugins/writing-composition/lanjian-plugin.json',import.meta.url),'utf8')))
  const zip=join(root,'plugin.zip'); await writeFile(zip,await new JSZip().file('lanjian-plugin.json',JSON.stringify(manifest)).file('main.js','export function execute(){return {text:"提醒"}}').generateAsync({type:'nodebuffer'}))
  const manager=new WritingPluginManager(new PluginPackageStore(root),async()=>{})
  let index=await manager.install((await manager.preview(manager.chooseNativeFile(zip))).planId)
  index=await manager.setEnabled(manifest.id,true,manifest.capabilities,index.revision)
  index=await manager.setBookEnabled('book-a',manifest.id,true,index.revision)
  const version=(await manager.capture('book-a'))[0], pin={id:manifest.id,version:manifest.version,digest:version.digest,grants:manifest.capabilities}
  const entries = [['check',{focus:'因果'}],['workflow',{voice:'原组合'}],['outline',{instruction:'保留父级的动机与代价'}],['reference',{}]].map(([contributionId,params])=>({pluginId:manifest.id,digest:version.digest,contributionId:contributionId as string,params:params as Record<string,JsonValue>}))
  const composition=await manager.applyComposition('book-a',entries,index.revision,async()=>{})
  const wasm=new Uint8Array(await readFile(createRequire(import.meta.url).resolve('@jitl/quickjs-wasmfile-release-sync/wasm'))).buffer
  const instructions:string[]=[], candidates:unknown[]=[], effects:ConstructorParameters<typeof DurablePluginEffects>[0]=[]
  async function dispatcher(saved:PluginComposition) {
    const registry=new WritingPluginRegistry()
    registry.register(builtinTool('read_planning_outline','读取父级','read',['planning.read'],objectSchema({key:textSchema(100)}),objectSchema({revision:textSchema(64)}),async()=>({kind:'completed',value:{revision:'a'.repeat(64)},evidence:[]})),'builtin')
    registry.register(builtinTool('expand_outline','生成待审候选','candidate',['planning.read','planning.candidate'],objectSchema({parentKey:textSchema(100),expectedRevision:textSchema(64),count:{type:'integer'},instruction:textSchema(2000)}),objectSchema({taskId:textSchema(200),notice:textSchema(500)}),async args=>{candidates.push(args);return {kind:'completed',value:{taskId:'domain-task',notice:'待作者采用'},evidence:[]}}),'builtin')
    await registerInstalledTools(registry,'book-a',[pin],new DurablePluginEffects(effects,async()=>{}),{manager,scope:action=>action(),runner:{run:(invocation,broker,signal)=>executeGuest(invocation,wasm,broker,signal),async dispose(){}},async generate(instruction){instructions.push(instruction);return instruction}},saved)
    const d=new WritingPluginDispatcher(registry,{workItemId:'book-a',allowedCapabilities:new Set(manifest.capabilities),signal:new AbortController().signal,async assertScope(){}})
    await d.execute('discover_tools',JSON.stringify({query:manifest.id})); return d
  }
  const d=await dispatcher(composition), name=(id:string)=>modelToolName(manifest.id,`contribution__${id}`)
  const check=await d.execute(name('check'),JSON.stringify({text:'正文'}),'check-1'); assert.equal(check.kind,'completed'); assert.equal(instructions[0],'只提出检查建议：因果')
  await assert.rejects(d.execute(name('check'),JSON.stringify({text:'正文',focus:'模型覆盖'}),'check-2'))
  const candidate=await d.execute(name('outline'),JSON.stringify({parentKey:'total'}),'outline-1'); assert.equal(candidate.kind,'completed'); assert.equal(candidates.length,1); assert.equal((candidates[0] as {instruction:string}).instruction,'保留父级的动机与代价')
  assert.equal((await d.execute(name('reference'),'{}','reference-1')).kind,'completed')
  const waiting=await d.execute(name('workflow'),JSON.stringify({text:'原稿'}),'workflow-1'); assert.equal(waiting.kind,'waiting-input')
  if(waiting.kind!=='waiting-input')return
  index=await manager.list(); await manager.applyComposition('book-a',entries.map(e=>e.contributionId==='workflow'?{...e,params:{voice:'新组合'}}:e),index.revision,async()=>{})
  const restored=await dispatcher(composition); restored.restore(d.checkpoint())
  const result=await restored.resume(name('workflow'),JSON.stringify({text:'原稿'}),waiting.checkpoint!,{answers:[{id:'focus',chosenOptionIds:['pace'],customText:'',skipped:false}]},'workflow-1')
  assert.equal(result.kind,'completed'); assert.equal(instructions.at(-1),'原组合；检查：pace'); assert.equal(restored.budget.snapshot().steps,2)
  assert.ok(restored.budget.snapshot().calls>d.budget.snapshot().calls)
  assert.equal((await manager.captureComposition('book-a')).composition.entries.find(e=>e.contributionId==='workflow')!.params.voice,'新组合')
})
