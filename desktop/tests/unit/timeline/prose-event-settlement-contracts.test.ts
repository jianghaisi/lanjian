import assert from 'node:assert/strict'
import test from 'node:test'
import { decodeSettlementDraftArgs,decodeSettlementPreviewArgs,decodeSettlementChapterArgs,decodeSettlementStartArgs } from '../../../src/contracts/timeline/prose-event-settlement-ipc'
import { decodeSettlementReceipt,decodeSettlementTask,settlementResultDecoders } from '../../../src/contracts/timeline/prose-event-settlement-contracts'
import { unwrapValidatedIpcResponse,registeredIpcResultChannels } from '../../../src/contracts/core/ipc-response'
const hash='a'.repeat(64),fields={time:'夜',characters:['甲'],location:'屋内',event:'开门',result:''}
const draft={chapterId:1,sourceFingerprint:hash,fields,quotes:[{start:0,end:2,quote:'开门'}],supplements:[]}
test('settlement named arguments reject authority smuggling, malformed quotes, identities and unsafe batches',()=>{
 assert.deepEqual(decodeSettlementDraftArgs([draft]),[draft])
 for(const input of [{...draft,status:'approved'},{...draft,sourceFingerprint:'old'},{...draft,id:'id'},{...draft,quotes:[{start:0,end:3,quote:'开门'}]}])assert.throws(()=>decodeSettlementDraftArgs([input]),{code:'VALIDATION_ERROR'})
 for(const args of [[0],['1'],[1,2]])assert.throws(()=>decodeSettlementChapterArgs(args),{code:'VALIDATION_ERROR'})
 assert.throws(()=>decodeSettlementStartArgs([{chapterId:1,expectedWorkItemId:'book',operationId:'op',sourceFingerprint:hash,provider:'remote'}]),{code:'VALIDATION_ERROR'})
 const item={draftId:'draft',draftRevision:1,outcome:'new',plans:[]}
 for(const selections of [[],Array(21).fill(item),[item,item],[{...item,outcome:'realizes'}],[{...item,replaces:'old'}, {...item,draftId:'other',replaces:'old'}]])
  assert.throws(()=>decodeSettlementPreviewArgs([{chapterId:1,sourceFingerprint:hash,selections}]),{code:'VALIDATION_ERROR'})
})
test('all settlement channels enforce runtime result decoding and retain plain safe failures',()=>{
 const channels=Object.keys(settlementResultDecoders);assert.equal(channels.length,10)
 for(const channel of channels){assert.ok(registeredIpcResultChannels.includes(channel));assert.throws(()=>unwrapValidatedIpcResponse(channel,{ok:true,value:{wrong:true}}))}
 const receipt={operationId:'op',requestHash:hash,chapterId:1,decisionIds:['decision'],committedAt:'2026-10-01T00:00:00Z'}
 assert.deepEqual(unwrapValidatedIpcResponse('events:settlement-receipt',{ok:true,value:receipt}),receipt)
 assert.throws(()=>decodeSettlementReceipt({...receipt,decisionIds:[]}),{code:'VALIDATION_ERROR'})
 assert.throws(()=>decodeSettlementTask({id:'task',chapterId:1,status:'invented-success',error:null,drafts:[]}),{code:'VALIDATION_ERROR'})
})
