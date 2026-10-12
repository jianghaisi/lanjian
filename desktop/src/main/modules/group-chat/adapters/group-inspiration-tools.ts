import { createHash, randomUUID } from 'node:crypto'
import { AppError } from '../../../core/errors/app-error'
import type { InspirationApi, InspirationCard } from '../../../../contracts/inspiration/types'
import type { GroupSession, GroupWork } from '../domain/session'
import { builtinTool } from '../../writing-plugins/adapters/builtin/fields'
import { objectSchema, textSchema } from '../../writing-plugins/domain/schema'
export type GroupInspirationPort=Pick<InspirationApi,'search'|'readCard'|'readSource'>
export const inspirationCardRevision=(card:InspirationCard)=>createHash('sha256').update(JSON.stringify({...card,stale:false})).digest('hex')
export function groupInspirationTools(s:GroupSession,work:GroupWork,library:GroupInspirationPort){
  const kinds=s.view.team.members.find(member=>member.id===work.memberId)?.preparationKinds
  if(!kinds)throw new AppError('CONFLICT','该成员不属于原讨论团队。',{recoverable:true})
  const reading=new Map<string,string>()
  return [
    builtinTool('search_inspiration_library','检索作者私有的跨作品知识库。返回真实情节卡和出处，按文本与标签匹配；未分析的来源没有情节卡，不宣称已读整本。','read',['book.read'],objectSchema({query:textSchema(500)}),objectSchema({cards:{type:'array',maxItems:12,items:objectSchema({id:textSchema(100),title:textSchema(200),sourceId:textSchema(100),revision:textSchema(64),summary:textSchema(300)})},total:{type:'integer',minimum:0}}),async(args,host)=>{
      const result=await host.hostCall(()=>library.search({query:String(args.query),limit:12,offset:0})),cards=result.cards.filter(c=>!c.stale)
      return {kind:'completed',trace:`检索私有知识库：${result.total}项`,evidence:cards.map(c=>({kind:'inspiration',id:`inspiration:${c.id}`,revision:inspirationCardRevision(c)})),value:{total:result.total,cards:cards.map(c=>({id:c.id,title:c.title,sourceId:c.sourceId,revision:inspirationCardRevision(c),summary:c.narrative.slice(0,300)}))}}
    }),
    builtinTool('read_inspiration_card','读取完整情节卡和逐字出处。视频保留实际字幕/语音时间范围；没有画面证据不能补出无台词动作。阅读后才能保存附出处的改编候选。','read',['book.read'],objectSchema({cardId:textSchema(100,1)}),objectSchema({id:textSchema(100),revision:textSchema(64),title:textSchema(200),narrative:textSchema(14000),evidence:{type:'array',maxItems:24,items:objectSchema({segmentId:textSchema(100),quote:textSchema(500)})},sourceId:textSchema(100),sourceVersion:textSchema(64)}),async(args,host)=>{
      const card=await host.hostCall(()=>library.readCard(String(args.cardId)));if(card.stale)throw new AppError('CONFLICT','灵感卡的来源已更新，请重新提取或选择当前版本。',{recoverable:true})
      const revision=inspirationCardRevision(card);reading.set(card.id,revision)
      return {kind:'completed',trace:`阅读灵感卡：${card.title}`,evidence:[{kind:'inspiration',id:`inspiration:${card.id}`,revision}],value:{id:card.id,revision,title:card.title,narrative:card.narrative,evidence:card.evidence,sourceId:card.sourceId,sourceVersion:card.sourceVersion}}
    }),
    builtinTool('read_inspiration_source','分页阅读某一真实来源版本的原小说或视频字幕，每次至多2片。不能把未读片段算作全书分析。','read',['book.read'],objectSchema({sourceId:textSchema(100,1),sourceVersion:textSchema(64,64),offset:{type:'integer',minimum:0,maximum:10000}}),objectSchema({content:textSchema(18000),nextOffset:{type:'integer',minimum:-1}}),async(args,host)=>{
      const result=await host.hostCall(()=>library.readSource({sourceId:String(args.sourceId),sourceVersion:String(args.sourceVersion),offset:Number(args.offset),limit:2}))
      return {kind:'completed',trace:`阅读灵感出处：${result.source.title}`,evidence:[{kind:'inspiration-source',id:result.source.id,revision:result.source.version}],value:{content:result.segments.map(s=>`${s.title}${s.startSeconds===null?'':` [${s.startSeconds}—${s.endSeconds}秒]`}\n${s.text}`).join('\n\n'),nextOffset:result.nextOffset}}
    }),
    builtinTool('save_inspiration_adaptation','根据已读灵感卡重新组织本书的人物目标、世界规则、因果和结局，保存待作者核对的改编候选。仅替换人名不算改编。不要复述长篇原文。','candidate',['group.prepare'],objectSchema({cardId:textSchema(100,1),revision:textSchema(64,64),title:textSchema(200,1),content:textSchema(20000,1),changes:textSchema(4000,1)}),objectSchema({candidateId:textSchema(100)}),async(args,host)=>{
      if(!kinds.includes('adaptation'))throw new AppError('FEATURE_UNAVAILABLE','原成员没有改编候选职责。',{recoverable:true})
      const card=await host.hostCall(()=>library.readCard(String(args.cardId))),revision=inspirationCardRevision(card)
      const durableRead=s.current&&s.histories[s.current.historyKey]?.some(m=>{if(m.role!=='tool'||!m.content)return false;try{const r=JSON.parse(m.content);return r.value?.id===card.id&&r.value?.revision===revision&&Array.isArray(r.value?.evidence)}catch{return false}})
      if(card.stale||revision!==args.revision||reading.get(card.id)!==revision&&!durableRead)throw new AppError('CONFLICT','请先读取当前灵感卡的情节和出处，再提交改编。',{recoverable:true})
      if(s.view.candidates.length>=100)throw new AppError('FEATURE_UNAVAILABLE','筹备候选已满，请先核对已有成果。',{recoverable:true})
      const id=randomUUID();s.view.candidates.push({id,kind:'adaptation',title:String(args.title),content:`${String(args.content)}\n\n改编说明\n${String(args.changes)}`,references:[{id:`inspiration:${card.id}`,title:card.title,revision}],memberId:work.memberId,createdAt:new Date().toISOString(),status:'proposed'})
      return {kind:'completed',trace:'已保存附灵感出处的改编候选，待作者核对',evidence:[{kind:'inspiration',id:`inspiration:${card.id}`,revision}],value:{candidateId:id}}
    })
  ].filter(tool=>tool.id!=='save_inspiration_adaptation'||kinds.includes('adaptation'))
}
