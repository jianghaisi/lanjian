import { createReadStream } from 'node:fs'
import { access, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'
import { createHash } from 'node:crypto'
import { AppError } from '../../../../core/errors/app-error'
import type { InstallationProgress, ModelAssetSource, ModelManifest, VerifiedModelAssets } from '../../domain/local-models'
import { resolvePortablePython } from '../../../../platform/processes/portable-python-runtime'
export class ExistingModelAssets implements ModelAssetSource {
  constructor(private readonly root: string) {}
  async discover(manifest: ModelManifest): Promise<boolean> {
    try { await this.paths(manifest); return true }
    catch(error){ if((error as NodeJS.ErrnoException).code==='ENOENT' || error instanceof AppError)return false;throw error }
  }
  private async paths(manifest: ModelManifest) {
    const root=await realpath(this.root)
    const contained=async(path:string) => { const full=await realpath(path),r=relative(root,full);if(r.startsWith('..')||isAbsolute(r))throw new AppError('PATH_ESCAPE','本地模型资源位置无效。',{recoverable:true});return full }
    const modelPath=await contained(join(root,manifest.files[0]!.relativePath))
    let python:string
    try{python=(await resolvePortablePython(root,join(root,'venv'))).python}
    catch(error){throw new AppError('FEATURE_UNAVAILABLE','本地推理环境需要修复。',{recoverable:true,cause:error})}
    const sitePackages=await contained(join(root,'venv/Lib/site-packages'))
    await access(await contained(join(sitePackages,'llama_cpp/llama.py')))
    return {root,modelPath,python,sitePackages}
  }
  async prepare(manifest: ModelManifest,signal:AbortSignal,progress:InstallationProgress):Promise<VerifiedModelAssets>{
    let paths: Awaited<ReturnType<ExistingModelAssets['paths']>>
    try{paths=await this.paths(manifest)}catch(error){if(error instanceof AppError)throw error;throw new AppError('FEATURE_UNAVAILABLE','没有找到此模型或本地运行环境。',{recoverable:true})}
    if((await stat(paths.modelPath)).size!==manifest.files[0]!.bytes)throw new AppError('FEATURE_UNAVAILABLE','模型文件不完整，原文件已保留。',{recoverable:true})
    progress('verifying',0,'正在校验已有模型')
    const hash=createHash('sha256');let bytes=0
    const stream=createReadStream(paths.modelPath,{highWaterMark:4*1024*1024,signal})
    for await(const chunk of stream){if(signal.aborted)throw new AppError('CONFLICT','模型检测已停止。',{recoverable:true});hash.update(chunk);bytes+=chunk.length;progress('verifying',Math.floor(bytes/manifest.files[0]!.bytes*85),'正在校验已有模型')}
    const digest=hash.digest('hex')
    if(digest!==manifest.files[0]!.sha256)throw new AppError('FEATURE_UNAVAILABLE','模型校验未通过，原文件已保留。',{recoverable:true})
    return {...paths,fingerprint:digest+':'+manifest.revision}
  }
}

