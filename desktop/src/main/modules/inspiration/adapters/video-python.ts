import { mkdir, rename, statfs } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { atomicJson, fileMatches, installError, ownedPath, readSmallJson, safeRelative } from '../../models/adapters/local-models/install-files'
import { ModelDownloader } from '../../models/adapters/local-models/model-download'
import { extractRuntime, type InstalledFile } from '../../models/adapters/local-models/runtime-extract'
import { runtimeProfile } from '../../models/adapters/local-models/runtime-profile'

/** Reuses the reviewed portable Python archive installer, without a writing model. */
export class VideoPython {
  constructor(private readonly root:string){}
  async resolve(signal:AbortSignal):Promise<string|undefined>{
    let value:unknown
    try{value=await readSmallJson(await ownedPath(this.root,'python-current.json'))}
    catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error}
    const receipt=value as {version:number;archive:string;directory:string;files:InstalledFile[]}
    if(!receipt||receipt.version!==1||receipt.archive!==runtimeProfile.files[0].sha256||!/^python-[a-f0-9-]{36}$/.test(receipt.directory)||!Array.isArray(receipt.files)||receipt.files.length<1||receipt.files.length>20000)throw installError('视频 Python 安装记录无效，原环境保留。')
    const directory=await ownedPath(this.root,receipt.directory),seen=new Set<string>()
    for(const file of receipt.files){
      if(typeof file.path!=='string'||!Number.isSafeInteger(file.bytes)||file.bytes<0||!/^[a-f0-9]{64}$/.test(file.sha256)||seen.has(file.path.toLowerCase()))throw installError('视频 Python 文件记录无效。')
      safeRelative(file.path);seen.add(file.path.toLowerCase())
      if(!await fileMatches(await ownedPath(directory,file.path),file,signal))throw installError('视频 Python 校验失败，原环境保留。')
    }
    if(!seen.has(runtimeProfile.python.toLowerCase()))throw installError('视频 Python 入口缺失。')
    return ownedPath(directory,runtimeProfile.python)
  }
  async prepare(signal:AbortSignal):Promise<string>{
    // Explicit prepare may replace a damaged installation from the verified
    // archive. Never bless changed bytes or alter the previous directory.
    let existing:string|undefined
    try{existing=await this.resolve(signal)}catch{signal.throwIfAborted()}
    if(existing)return existing
    if(process.platform!==runtimeProfile.platform||process.arch!==runtimeProfile.arch)throw installError('本地视频转写组件当前支持 Windows x64。')
    const recipe=runtimeProfile.files[0],space=await statfs(this.root)
    if(space.bavail*space.bsize<recipe.bytes+recipe.expandedBytes+1024*1024*1024)throw installError('视频转写准备需要至少约 1GB 可用空间。')
    const archive=await new ModelDownloader(join(this.root,'downloads')).download(recipe,signal,()=>{})
    const id=randomUUID(),stage=await ownedPath(this.root,`staging-${id}`);await mkdir(stage)
    const files=await extractRuntime(archive,recipe,stage,signal,new Set());signal.throwIfAborted()
    const directory=`python-${id}`;await rename(stage,await ownedPath(this.root,directory));signal.throwIfAborted()
    await atomicJson(this.root,'python-current.json',{version:1,archive:recipe.sha256,directory,files})
    return (await this.resolve(signal))!
  }
}
