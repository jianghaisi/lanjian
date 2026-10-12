import { copyFile, lstat, mkdir, readFile, readdir } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { atomicWriteText } from '../../../platform/storage/atomic-file'
import { AppError } from '../../../core/errors/app-error'
import { decodePetCareState, type PetCareState } from '../../../../contracts/companion/companion-care'
import { newPetCare, petDay } from '../domain/companion-care'
export class CompanionCareStore {
  private queue: Promise<unknown> = Promise.resolve()
  private file: string
  constructor(private readonly directory: string, private readonly write = atomicWriteText, private readonly now = () => new Date()) {
    if (!isAbsolute(directory)) throw new Error('PET_CARE_DIRECTORY')
    this.file=join(directory,'companion-care.json')
  }
  private serial<T>(run:()=>Promise<T>):Promise<T> { const next=this.queue.then(run);this.queue=next.catch(()=>{});return next }
  private async readNow():Promise<PetCareState> {
    try {
      const info=await lstat(this.file)
      if(!info.isFile()||info.isSymbolicLink()||info.size>65536)throw new Error('PET_CARE_FILE')
      return decodePetCareState(JSON.parse(await readFile(this.file,'utf8')))
    } catch(cause) {
      if(cause&&typeof cause==='object'&&'code' in cause&&cause.code==='ENOENT'){
        const names=await readdir(this.directory).catch(reason=>{if(reason?.code==='ENOENT')return[];throw new AppError('STORAGE_ERROR','养成档案目录暂不可读，请重试。',{recoverable:true,cause:reason})})
        if(!names.some(name=>name.startsWith('companion-care.json.')&&name.endsWith('.efs-backup')))return newPetCare(petDay(this.now()))
      }
      throw new AppError('STORAGE_ERROR','养成档案无法读取，原记录已保留。可在设置中备份后恢复。',{recoverable:true,cause})
    }
  }
  read():Promise<PetCareState>{return this.serial(()=>this.readNow())}
  update(operation:(state:PetCareState)=>PetCareState):Promise<PetCareState>{return this.serial(async()=>{
    const before=await this.readNow(),next=operation(before)
    if(next!==before)await this.save(next)
    return structuredClone(next)
  })}
  recover():Promise<PetCareState>{return this.serial(async()=>{
    try {const info=await lstat(this.file);if(!info.isFile()||info.isSymbolicLink())throw new Error('PET_CARE_FILE');await copyFile(this.file,`${this.file}.${randomUUID()}.bak`)}
    catch(cause){if(!(cause&&typeof cause==='object'&&'code' in cause&&cause.code==='ENOENT'))throw new AppError('STORAGE_ERROR','未能备份养成档案，已取消恢复。',{recoverable:true,cause})}
    const state={...newPetCare(petDay(this.now())),revision:Date.now()};await this.save(state);return state
  })}
  private async save(state:PetCareState):Promise<void>{
    try {const bytes=JSON.stringify(decodePetCareState(state),null,2)+'\n';await mkdir(this.directory,{recursive:true});await this.write(this.file,bytes)}
    catch(cause){throw new AppError('STORAGE_ERROR','养成变化未能保存，本次操作未结算，请重试。',{recoverable:true,cause})}
  }
}
