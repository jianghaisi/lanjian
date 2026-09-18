import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { reactive, createRenderer } from 'vue'
import { useFieldAssistant } from '../../../src/renderer/features/assistant/composables/use-field-assistant'
import type { FieldAssistantApi } from '../../../src/contracts/assistant/field-assistant-contracts'
import type { AssistantConversationRequest, AssistantConversationResult } from '../../../src/contracts/assistant/assistant-conversation-contracts'
import { registerAssistantField, updateFieldScope, fieldRegistry, fieldIsCurrent, applyFieldDraft, undoFieldDraft, markFieldSource, fieldSourceIds, clearSavedFieldSources } from '../../../src/renderer/features/assistant/services/assistant-field-registry'
import type { FieldCandidate } from '../../../src/contracts/assistant/field-assistant-contracts'
import { assistantFieldCatalog } from '../../../src/contracts/assistant/assistant-field-catalog'

async function vueFiles(root: string): Promise<string[]> {
  const files: string[] = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) files.push(...await vueFiles(path))
    else if (entry.isFile() && path.endsWith('.vue')) files.push(path)
  }
  return files
}

test('every literal assistant field used by a Vue surface has a reviewed catalog entry', async () => {
  const root = fileURLToPath(new URL('../../../src/renderer/', import.meta.url))
  const missing: Array<{ file: string; id: string }> = []
  for (const file of await vueFiles(root)) {
    const source = await readFile(file, 'utf8')
    for (const match of source.matchAll(/v-assist-field="\{\s*id:\s*'([^']+)'/g)) {
      const id = match[1]!
      if (!assistantFieldCatalog[id]) missing.push({ file, id })
    }
  }
  assert.deepEqual(missing, [])
})

test('direct registration rejects an unreviewed field with its exact developer-facing id', () => {
  assert.throws(
    () => registerAssistantField({ id: 'UnknownSurface.field', read: () => '', write: () => {} }),
    /Unregistered assistant field: UnknownSurface\.field/
  )
})

test('explicit field transaction changes one draft, supports undo, and preserves concurrent typing',async()=>{
  updateFieldScope('book-a','profile','作品定义');const draft=reactive({coreIdea:'旧设想',other:'未保存的另一个字段'})
  const reg=registerAssistantField({id:'definition.bookProfile.coreIdea',read:()=>draft.coreIdea,write:value=>{draft.coreIdea=String(value)},identity:()=>draft})
  try{
    const target={...fieldRegistry.get(reg.key)!.target},candidate:FieldCandidate={id:'candidate',operationId:'op',target,before:target.value,after:'新设想',dependencyFingerprint:'fingerprint',model:'fixture',connectionId:'fixture',createdAt:'2026-09-10',status:'candidate'}
    const undo=await applyFieldDraft(reg.key,candidate);assert.equal(String(draft.coreIdea),'新设想');assert.equal(draft.other,'未保存的另一个字段')
    markFieldSource(candidate);markFieldSource({...candidate,id:'newer-candidate'});clearSavedFieldSources(['candidate']);assert.deepEqual(fieldSourceIds('definition.'),['newer-candidate']);clearSavedFieldSources(['newer-candidate']);assert.deepEqual(fieldSourceIds('definition.'),[])
    undoFieldDraft(undo);assert.equal(String(draft.coreIdea),'旧设想')
    assert.equal(fieldIsCurrent(reg.key,target),false)
    candidate.target={...fieldRegistry.get(reg.key)!.target};const second=await applyFieldDraft(reg.key,candidate)
    draft.coreIdea+='，作者继续写';assert.throws(()=>undoFieldDraft(second));assert.equal(draft.coreIdea,'新设想，作者继续写')
  }finally{reg.dispose()}
})

test('a preference adapter that refused a write cannot report a successful application',async()=>{
  updateFieldScope(null,'library','我的作品')
  const reg=registerAssistantField({id:'LibraryAppearance.scale',read:()=>1,write:()=>{}})
  const target={...fieldRegistry.get(reg.key)!.target}
  try{await assert.rejects(()=>applyFieldDraft(reg.key,{id:'failed',operationId:'op',target,before:1,after:1.5,dependencyFingerprint:'hash',model:'fixture',connectionId:'fixture',createdAt:'2026-09-11',status:'candidate'}),/未能回填/)}finally{reg.dispose()}
})
test('composition, deletion, object replacement and book switches invalidate the original snapshot',()=>{
  updateFieldScope('book-a','realms','境界');const draft=reactive({row:{name:'初境'}})
  const reg=registerAssistantField({id:'AppShell.item.name',read:()=>draft.row.name,write:value=>{draft.row.name=String(value)},identity:()=>draft.row})
  const original={...fieldRegistry.get(reg.key)!.target}
  reg.composing(true);assert.equal(fieldIsCurrent(reg.key,original),false);reg.composing(false);assert.equal(fieldIsCurrent(reg.key,original),true)
  draft.row={name:'初境'};assert.equal(fieldIsCurrent(reg.key,original),false)
  const replaced={...fieldRegistry.get(reg.key)!.target};updateFieldScope('book-b','realms','境界');assert.equal(fieldIsCurrent(reg.key,replaced),false)
  reg.dispose();assert.equal(fieldRegistry.has(reg.key),false)
})


test('the single composer sends natural dialogue and refuses a prose handoff after draft changes',async()=>{
  updateFieldScope('book-a','desk','正文')
  const sent:AssistantConversationRequest[]=[],prose:string[]=[];let snapshot='draft-one',release!: (result:AssistantConversationResult)=>void
  const api={async conversation(input:AssistantConversationRequest){sent.push(input);return new Promise<AssistantConversationResult>(r=>release=r)},async cancelConversation(){return true},async recent(){return []}} as unknown as FieldAssistantApi
  const renderer=createRenderer({createComment:()=>({}),insert(){},remove(){},parentNode:()=>null,nextSibling:()=>null} as any)
  let assistant!:ReturnType<typeof useFieldAssistant>
  const app=renderer.createApp({setup(){assistant=useFieldAssistant(api,{page:()=> 'desk',chapterId:()=>1,selectedCharacters:()=>12,proseSnapshot:()=>snapshot,requiresPreview:()=>false,async prose(input){prose.push(input.message)}});return ()=>null}})
  app.mount({})
  try{
    assistant.instruction.value='把选中的这段改得简洁些';const run=assistant.send();assert.equal(sent[0].message,'把选中的这段改得简洁些');assert.equal(assistant.selectedKey.value,'')
    snapshot='author-typed-new-draft';release({kind:'prose',message:'处理正文',instruction:'润色选段',tools:['交给正文助笔']});await run
    assert.equal(prose.length,0);assert.match(assistant.error.value,/已变化/);assert.equal(assistant.instruction.value,'把选中的这段改得简洁些')
    const next=assistant.send();release({kind:'prose',message:'处理正文',instruction:'润色选段',tools:['交给正文助笔']});await next;assert.deepEqual(prose,['润色选段'])
  }finally{app.unmount()}
})

test('one send automatically resumes the same goal after a model-selected workspace change',async()=>{
  updateFieldScope('book-loop','world','世界观')
  let page='world',calls=0,navigations=0
  const sent:AssistantConversationRequest[]=[]
  const api={async conversation(input:AssistantConversationRequest){sent.push(input);calls++;return calls===1?{kind:'navigate',workspaceId:'profile',message:'定位作品定义',tools:['定位作品定义']}:{kind:'message',message:'已读取目标',tools:['读取计划卷数']}},async recent(){return []},async cancelConversation(){return true}} as unknown as FieldAssistantApi
  const renderer=createRenderer({createComment:()=>({}),insert(){},remove(){},parentNode:()=>null,nextSibling:()=>null} as any)
  let assistant!:ReturnType<typeof useFieldAssistant>
  const app=renderer.createApp({setup(){assistant=useFieldAssistant(api,{page:()=>page,chapterId:()=>null,selectedCharacters:()=>0,proseSnapshot:()=>'',requiresPreview:()=>false,async navigate(id){navigations++;page=id;updateFieldScope('book-loop',id,'作品定义')},async prose(){throw Error('not prose')}});return ()=>null}})
  app.mount({})
  try{
    assistant.model.value='qwen3-1.7b-q8_0';assistant.connectionId.value='local:llama-cpp';assistant.maxTokensOverride.value=1024
    assistant.instruction.value='把作品定义的计划卷数改为2';await assistant.send()
    assert.equal(calls,2);assert.equal(navigations,1);assert.equal(sent[1].message,sent[0].message);assert.notEqual(sent[1].operationId,sent[0].operationId)
    assert.equal(sent[1].page,'profile');assert.equal(sent[1].model,sent[0].model);assert.equal(sent[1].maxTokensOverride,1024)
    assert.equal(assistant.turns.value.filter(t=>t.role==='user').length,1);assert.equal(assistant.error.value,'');assert.equal(assistant.busy.value,false)
  }finally{app.unmount()}
})

test('navigation loops stop with a visible error instead of requiring endless continue messages',async()=>{
  updateFieldScope('book-loop','world','世界观')
  let calls=0
  const api={async conversation(){calls++;return {kind:'navigate',workspaceId:'profile',message:'定位',tools:[]}},async recent(){return []},async cancelConversation(){return true}} as unknown as FieldAssistantApi
  const renderer=createRenderer({createComment:()=>({}),insert(){},remove(){},parentNode:()=>null,nextSibling:()=>null} as any)
  let assistant!:ReturnType<typeof useFieldAssistant>
  const app=renderer.createApp({setup(){assistant=useFieldAssistant(api,{page:()=> 'world',chapterId:()=>null,selectedCharacters:()=>0,proseSnapshot:()=>'',requiresPreview:()=>false,async navigate(){},async prose(){}});return ()=>null}})
  app.mount({})
  try{assistant.instruction.value='修改计划卷数';await assistant.send();assert.equal(calls,2);assert.match(assistant.error.value,/未能定位/);assert.equal(assistant.instruction.value,'修改计划卷数')}finally{app.unmount()}
})
