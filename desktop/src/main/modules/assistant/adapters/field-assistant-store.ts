import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { AppError } from '../../../core/errors/app-error'
import { decodeFieldTask, type FieldTask } from '../../../../contracts/assistant/field-assistant-contracts'
import { projectDirectory } from '../../../platform/storage/project-path'
import { writeJson } from '../../../platform/storage/json-store'

/** Application candidate history; this is never a formal book-data authority. */
export class FieldAssistantStore {
  private writes:Promise<void>=Promise.resolve()
  constructor(private readonly appRoot:string){}
  private file(scope:string|null){return projectDirectory(this.appRoot,join(this.appRoot,'field-assistant',`${createHash('sha256').update(scope||'application').digest('hex')}.json`))}
  async read(scope:string|null):Promise<FieldTask[]>{
    await this.writes
    return this.readNow(scope)
  }
  private async readNow(scope:string|null):Promise<FieldTask[]>{
    try{
      const parsed:unknown=JSON.parse(await readFile(await this.file(scope),'utf8'))
      if(!Array.isArray(parsed)||parsed.length>100)throw new Error('Invalid history')
      return parsed.map(decodeFieldTask).filter(task=>task.target.workItemId===scope)
    }catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw new AppError('STORAGE_ERROR','助笔候选记录暂时无法读取，原记录已保留。',{recoverable:true,cause:error})}
  }
  write(task:FieldTask):Promise<void>{
    const operation=this.writes.then(async()=>{
      const tasks=await this.readNow(task.target.workItemId)
      const next=[structuredClone(task),...tasks.filter(t=>t.id!==task.id)].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).slice(0,100)
      await writeJson(await this.file(task.target.workItemId),next)
    })
    this.writes=operation.catch(()=>{})
    return operation
  }
}
