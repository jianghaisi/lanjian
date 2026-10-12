import test from 'node:test'
import assert from 'node:assert/strict'
import { decodeLocalModels, isModelConnectionId, localModelResultDecoders, localOutputOverride, localModelId, LOCAL_CONNECTION_ID, type LocalModelView } from '../../../src/contracts/models/local-model-contracts'
import { LocalFrameReader, encodeLocalFrame, MAX_LOCAL_FRAME } from '../../../src/main/modules/models/adapters/local-models/protocol'
import { buildModelCatalog } from '../../../src/renderer/features/models/services/model-catalog'
import { decodeAiConnectionDraftArgs, decodeWritingAgentArgs } from '../../../src/contracts/ipc'
import { decodeFieldRequest } from '../../../src/contracts/assistant/field-assistant-contracts'
import { decodeAssistantConversationRequest } from '../../../src/contracts/assistant/assistant-conversation-contracts'

const modelRow: LocalModelView = {
  id: 'fixture-a', name: '同名模型', family: 'fixture', description: '', revision: 'revision-a',
  bytes: 1024, quantization: 'Q4_K_M', license: 'MIT', state: 'ready', capabilities: ['text'],
  contextTokens: 8192, maxOutputTokens: 4096, recommendedOutputTokens: 2048,
  progress: 100, message: '测试记录', canDownload: true
}

for (const [label, patch] of [
  ['identical rows', {}],
  ['conflicting readiness', { state: 'failed', capabilities: [] }],
  ['different revisions', { revision: 'revision-b' }]
] satisfies [string, Partial<LocalModelView>][]) {
  test(`model lists reject duplicate IDs with ${label}`, () => {
    assert.throws(() => decodeLocalModels([modelRow, { ...modelRow, ...patch }]), /LOCAL_MODEL_CONTRACT/)
  })
}

test('list IPC decoding preserves distinct same-name IDs and legacy optional metadata', () => {
  const rows = [modelRow, { ...modelRow, id: 'fixture-b' }]
  assert.deepEqual(localModelResultDecoders['local-models:list'](rows), rows)
  assert.deepEqual(decodeLocalModels([]), [])
  assert.throws(() => localModelResultDecoders['local-models:list']([modelRow, { ...modelRow }]), /LOCAL_MODEL_CONTRACT/)
})

test('fixed local namespace, bounded one-off budgets, and path-free catalog IDs',()=>{
  assert.equal(isModelConnectionId(LOCAL_CONNECTION_ID),true)
  assert.equal(isModelConnectionId('primary'),true)
  for(const id of ['local:custom','../model','https://host','local:llama-cpp/'])assert.equal(isModelConnectionId(id),false)
  for(const value of [127,4097,NaN,128.5,'512'])assert.throws(()=>localOutputOverride(value,LOCAL_CONNECTION_ID))
  assert.throws(()=>localOutputOverride(512,'primary'))
  assert.deepEqual(localOutputOverride(2048,LOCAL_CONNECTION_ID),{maxTokensOverride:2048})
  assert.throws(()=>localModelId('../models/qwen'))
})
test('private frames preserve split multibyte Chinese and reject oversized or malformed payloads',()=>{
  const reader=new LocalFrameReader(),frame=encodeLocalFrame({id:'one',text:'雨夜来信🌙'})
  const values=[];for(const byte of frame)values.push(...reader.push(Buffer.from([byte])))
  assert.deepEqual(values,[{id:'one',text:'雨夜来信🌙'}])
  const header=Buffer.alloc(4);header.writeUInt32LE(MAX_LOCAL_FRAME+1);assert.throws(()=>new LocalFrameReader().push(header),/LIMIT/)
  assert.throws(()=>new LocalFrameReader().push(encodeLocalFrame(['not-a-record'])),/INVALID/)
  const invalid=Buffer.from([1,0,0,0,255]);assert.throws(()=>new LocalFrameReader().push(invalid))
})
test('same-name online and unavailable local entries retain distinct identity',()=>{
  const rows=buildModelCatalog([{id:'primary',name:'在线',baseUrl:'https://example.test'},{id:LOCAL_CONNECTION_ID,name:'本地'}],{primary:['qwen'],[LOCAL_CONNECTION_ID]:['qwen']})
  assert.equal(rows.length,2);assert.notEqual(rows[0].key,rows[1].key)
  assert.equal(rows.find(r=>r.connectionId==='primary')?.disabledReason,undefined)
  assert.match(rows.find(r=>r.connectionId===LOCAL_CONNECTION_ID)?.disabledReason||'',/超市检测/)
})

test('the same bounded budget survives field, conversation and prose request decoders',()=>{
  const budget={connectionId:LOCAL_CONNECTION_ID,model:'qwen3-1.7b-q8_0',maxTokensOverride:1024}
  const target={fieldId:'definition.bookProfile.coreIdea',instanceId:'target',editorSessionId:'editor',workItemId:'book',pageId:'definition',label:'核心设想',revision:0,value:'旧信'}
  assert.equal(decodeFieldRequest({operationId:'one',target,instruction:'修改',...budget}).maxTokensOverride,1024)
  assert.equal(decodeAssistantConversationRequest({operationId:'two',workItemId:'book',page:'definition',message:'修改设想',targets:[target],chapterId:null,selectedCharacters:0,history:[],...budget}).maxTokensOverride,1024)
  assert.equal(decodeWritingAgentArgs([{chapterId:1,message:'润色',currentDraft:'旧信',model:budget.model,modelConnectionId:budget.connectionId,maxTokensOverride:1024}])[0].maxTokensOverride,1024)
  assert.equal(decodeWritingAgentArgs([{chapterId:1,message:'润色',currentDraft:'旧信',expectedWorkItemId:'book-a'}])[0].expectedWorkItemId,'book-a')
  assert.throws(() => decodeWritingAgentArgs([{chapterId:1,message:'润色',currentDraft:'旧信',expectedWorkItemId:''}]))
  assert.throws(()=>decodeAiConnectionDraftArgs([{connectionId:LOCAL_CONNECTION_ID,apiKey:'fake'}]))
})
