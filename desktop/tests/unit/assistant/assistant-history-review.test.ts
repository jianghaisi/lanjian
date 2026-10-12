import assert from 'node:assert/strict'
import test from 'node:test'
import { createRenderer, nextTick } from 'vue'
import { useFieldAssistant } from '../../../src/renderer/features/assistant/composables/use-field-assistant'
import { updateFieldScope } from '../../../src/renderer/features/assistant/services/assistant-field-registry'
import type { FieldAssistantApi } from '../../../src/contracts/assistant/field-assistant-contracts'
import type { AssistantRunView } from '../../../src/contracts/assistant/assistant-run-contracts'

const record: AssistantRunView = {id:'history',operationId:'op',workItemId:'history-book',bookTitle:'旧物',page:'profile',goal:'讨论动机',status:'completed',revision:1,step:1,message:'已完成',tools:[],createdAt:'',updatedAt:'',needsResume:false,result:{kind:'message',message:'完整的分析。',tools:[]}}
function fixture(status: () => Promise<AssistantRunView>) {
  updateFieldScope('history-book','profile','定义')
  const api = {recent:async()=>[],runs:{recent:async()=>[],status}} as unknown as FieldAssistantApi
  const renderer=createRenderer({createComment:()=>({}),insert(){},remove(){},parentNode:()=>null,nextSibling:()=>null} as any)
  let assistant!:ReturnType<typeof useFieldAssistant>
  const app=renderer.createApp({setup(){assistant=useFieldAssistant(api,{page:()=> 'profile',chapterId:()=>null,selectedCharacters:()=>0,proseSnapshot:()=>'',requiresPreview:()=>false,async prose(){throw new Error('History cannot generate prose')}});return ()=>null}})
  app.mount({})
  return {assistant,app}
}
test('revisiting the same completed run always shows its full original result',async()=>{
  const {assistant,app}=fixture(async()=>record)
  try {
    await assistant.viewRun(record)
    await assistant.viewRun(record)
    assert.deepEqual(assistant.turns.value.map(t=>t.content),['讨论动机','完整的分析。'])
    assert.equal(assistant.candidate.value,null)
  } finally {app.unmount()}
})
test('a history read resolving after a book change cannot replace the new scope',async()=>{
  let resolve!: (value:AssistantRunView)=>void
  const {assistant,app}=fixture(()=>new Promise(done=>{resolve=done}))
  try {
    const loading=assistant.viewRun(record)
    updateFieldScope('another-book','profile','定义');await nextTick()
    resolve(record);await loading
    assert.deepEqual(assistant.turns.value,[])
    assert.equal(assistant.run.value,null)
  } finally {app.unmount()}
})
