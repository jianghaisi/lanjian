import { CompanionCareStore } from '../adapters/companion-care-store'
import { applyPetCare, advancePetCare, petDay } from '../domain/companion-care'
import { decodePetCareRequest, type PetCareRequest, type PetCareState } from '../../../../contracts/companion/companion-care'
import { AppError } from '../../../core/errors/app-error'
export class CompanionCareService {
  private initialized?:Promise<void>
  constructor(private readonly store:CompanionCareStore,private readonly now=()=>new Date()){}
  private initialize():Promise<void>{
    if(!this.initialized)this.initialized=this.store.update(before=>{
      if(before.focus?.status!=='running')return before
      return {...before,revision:before.revision+1,focus:{...before.focus,status:'paused'}}
    }).then(()=>{}).catch(reason=>{this.initialized=undefined;throw reason})
    return this.initialized
  }
  async get():Promise<PetCareState>{await this.initialize();return this.store.read()}
  async act(value:PetCareRequest):Promise<PetCareState>{
    const input=structuredClone(decodePetCareRequest(value));await this.initialize()
    return this.store.update(before=>{
      try{return applyPetCare(before,input,this.now())}
      catch(reason){throw new AppError('CONFLICT',reason instanceof Error?reason.message:'操作未完成，请重试。',{recoverable:true})}
    })
  }
  async tick(seconds:number,current:()=>boolean=()=>true):Promise<PetCareState>{await this.initialize();return this.store.update(before=>current()?advancePetCare(before,seconds,petDay(this.now())):before)}
  async recover():Promise<PetCareState>{const state=await this.store.recover();this.initialized=Promise.resolve();return state}
}
