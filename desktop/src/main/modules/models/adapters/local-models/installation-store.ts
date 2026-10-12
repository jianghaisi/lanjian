import { mkdir,readFile,rename,writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { AppError } from '../../../../core/errors/app-error'
import { decodeLocalModels,type LocalModelView } from '../../../../../contracts/models/local-model-contracts'
export class LocalInstallationStore {
  private writes=Promise.resolve()
  constructor(private path:string){}
  async read():Promise<LocalModelView[]>{
    try{const data=JSON.parse(await readFile(this.path,'utf8'));if(data.version!==1)throw Error('version');return decodeLocalModels(data.models)}
    catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw new AppError('STORAGE_ERROR','模型超市记录无法读取，原文件已保留。',{recoverable:true})}
  }
  save(models:LocalModelView[]):Promise<void>{
    const run=async()=>{await mkdir(dirname(this.path),{recursive:true});const tmp=this.path+'.'+randomUUID()+'.tmp';await writeFile(tmp,JSON.stringify({version:1,models:decodeLocalModels(models)}),'utf8');await rename(tmp,this.path)}
    const result=this.writes.then(run,run);this.writes=result.catch(()=>{});return result
  }
}

