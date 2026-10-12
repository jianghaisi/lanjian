import { randomUUID } from 'node:crypto'
import { AppError } from '../../../core/errors/app-error'
import type { InspirationSelection, InspirationSelectionReceipt } from '../../../../contracts/inspiration/types'
import type { InspirationService } from './inspiration-service'
import { inspirationDigest } from '../domain/source'

export type InspirationBook = {id:string;title:string;identity:string;run<T>(work:()=>Promise<T>):Promise<T>;find(provenance:string):Promise<string|undefined>;add(title:string,content:string,provenance:string):Promise<string>}
export type InspirationBooks = {capture(id:string):Promise<InspirationBook>}
type Permit={preview:InspirationSelection;book:InspirationBook;hash:string;expires:number}
export class InspirationSelectionService {
  private readonly permits=new Map<string,Permit>()
  private lane:Promise<unknown>=Promise.resolve()
  constructor(private readonly library:InspirationService,private readonly books:InspirationBooks){}
  async prepare(input:{bookId:string;cardId:string;sourceVersion:string;operationId:string}):Promise<InspirationSelection>{
    const card=await this.library.readCard(input.cardId)
    if(card.stale||card.sourceVersion!==input.sourceVersion)throw this.conflict()
    const document=await this.library.store.document(card.sourceId,card.sourceVersion),book=await this.books.capture(input.bookId)
    const content=`${card.narrative}\n\n冲突：${card.conflict}\n人物选择：${card.choice}\n结果：${card.outcome}\n转折：${card.turn}\n伏笔：${card.foreshadowing}\n\n来源：${document.source.title}\n版本：${card.sourceVersion}\n${card.evidence.map(e=>{const s=document.segments.find(s=>s.id===e.segmentId)!;return `${s.title}${s.startSeconds===null?'':`（${s.startSeconds}—${s.endSeconds}秒）`}：${e.quote}`}).join('\n')}`
    const preview={token:randomUUID(),operationId:input.operationId,bookId:book.id,bookTitle:book.title,card,source:document.source,content}
    for(const [key,p]of this.permits)if(p.expires<Date.now())this.permits.delete(key)
    if(this.permits.size>=32)throw this.conflict()
    this.permits.set(preview.token,{preview,book,hash:inspirationDigest([book.id,book.identity,card.id,card.sourceVersion,content]),expires:Date.now()+600_000})
    return structuredClone(preview)
  }
  commit(token:string):Promise<InspirationSelectionReceipt>{
    const result=this.lane.then(()=>this.commitNow(token));this.lane=result.then(()=>{},()=>{});return result
  }
  private async commitNow(token:string):Promise<InspirationSelectionReceipt>{
    const p=this.permits.get(token);if(!p||p.expires<Date.now())throw this.conflict()
    const {preview,book,hash}=p,old=await this.library.store.effect(preview.operationId)
    if(old&&old.inputHash!==hash)throw this.conflict()
    if(old?.receipt)return old.receipt
    const card=await this.library.readCard(preview.card.id)
    if(card.stale||card.sourceVersion!==preview.source.version||inspirationDigest(card)!==inspirationDigest(preview.card))throw this.conflict()
    await this.library.store.document(card.sourceId,card.sourceVersion)
    const fresh=await this.books.capture(book.id);if(fresh.identity!==book.identity)throw this.conflict()
    await this.library.store.saveEffect({operationId:preview.operationId,inputHash:hash,status:'intent'})
    return book.run(async()=>{
      const current=await this.library.readCard(card.id);if(current.stale)throw this.conflict()
      const provenance=`inspiration:${card.sourceId}:${card.sourceVersion}:${card.id}`
      const materialId=await book.find(provenance)??await book.add(card.title,preview.content,provenance)
      const receipt={operationId:preview.operationId,bookId:book.id,sourceId:card.sourceId,sourceVersion:card.sourceVersion,cardId:card.id,materialId,createdAt:new Date().toISOString()}
      await this.library.store.saveEffect({operationId:preview.operationId,inputHash:hash,status:'completed',receipt});return receipt
    })
  }
  private conflict(){return new AppError('CONFLICT','灵感卡、目标作品或预览依据已变化，请重新核对。',{recoverable:true})}
}
