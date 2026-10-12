import type { GroupInspirationPort } from '../../../../desktop/src/main/modules/group-chat/adapters/group-inspiration-tools'
import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { lstat, mkdir, realpath } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { operation, record } from '@lanjian/hosted-contracts'
import { groupChatArgs, decodeGroupDraft, groupId } from '../../../../desktop/src/contracts/group-chat/group-chat'
import { captureGroupTeam, restoreGroupTeam } from '../../../../desktop/src/main/modules/group-chat/domain/creative-team'
import { creativePolicyRun } from '../../../../desktop/src/main/modules/writing-plugins/domain/creative-policy'
import { withCreativePolicyRun } from '../../../../desktop/src/main/modules/writing-plugins/application/creative-policy-execution'
import { decodeGroupBookCreation } from '../../../../desktop/src/contracts/group-chat/creation'
import { decodeGroupAdoptionRequest } from '../../../../desktop/src/contracts/group-chat/adoption'
import { decodeNoArgs } from '../../../../desktop/src/contracts/ipc'
import { validateIpcResponse } from '../../../../desktop/src/contracts/core/ipc-response'
import { registerValidatedIpc, type IpcRegistrar } from '../../../../desktop/src/main/platform/ipc/validated-ipc'
import { decodeModelCreationResult } from '../../../../desktop/src/contracts/models/model-connections-contracts'
import { projectSummary } from '../../../../desktop/src/contracts/app/ipc-project-result-contracts'
import type { WorkspaceService } from '../../../../desktop/src/main/modules/library/application/workspace-service'
import { FileGroupSessionStore } from '../../../../desktop/src/main/modules/group-chat/adapters/session-store'
import { GroupCreationReceipts } from '../../../../desktop/src/main/modules/group-chat/adapters/creation-receipts'
import { GroupChatService, type GroupModelCapability } from '../../../../desktop/src/main/modules/group-chat/application/group-chat-service'
import { GroupCreationService } from '../../../../desktop/src/main/modules/group-chat/application/group-creation-service'
import { GroupAdoptionService } from '../../../../desktop/src/main/modules/group-chat/application/group-adoption-service'
import { createGroupTools } from '../../../../desktop/src/main/modules/group-chat/adapters/group-tools'
import { groupBookSource, groupSourceHash } from '../../../../desktop/src/main/modules/group-chat/adapters/group-plugin-tools'
import type { GroupSession } from '../../../../desktop/src/main/modules/group-chat/domain/session'
import { withModelExecution } from '../../../../desktop/src/main/modules/models/application/model-execution-context'
import type { WritingDomainPorts } from '../../../../desktop/src/main/modules/writing-plugins/adapters/builtin/domain-ports'
import { AppError } from '../../../../desktop/src/contracts/core/app-error'
import { digest, dbNumber } from '../storage/database.ts'
import { tenantParent } from '../files/tenant-root.ts'
import { assertTenantSpace } from '../files/quota.ts'
import { readSite } from '../admin/site-store.ts'
import { fail } from './errors.ts'
import type { WritingRouteContext } from './writing-routes.ts'
import type { BookRuntime, BookRuntimes } from '../writing/book-runtime.ts'
import type { desktopServices } from '../writing/desktop-services.ts'
import type { desktopLibraryModels } from '../writing/desktop-library-models.ts'
import type { ModelStore } from '../models/model-store.ts'
import type { MeteredModels } from '../models/metered-client.ts'
import type { HostedJobs } from '../tasks/jobs.ts'

type Scope = { session: GroupSession; runtime?: BookRuntime; domains?: WritingDomainPorts }
const commands = ['list','openBook','createForBook','create','get','send','stop','resume','saveMember','answer','saveDraft','createBook','prepareAdoption','adopt','modelCatalog'] as const
/** Account-owned preparation uses the original group engine and paid transport. */
export function registerGroupChatRoutes(ctx: WritingRouteContext, runtimes: BookRuntimes, jobs: HostedJobs, models: ModelStore, meter: MeteredModels,
  library: ReturnType<typeof desktopLibraryModels>, getRuntime: (r: BookRuntime) => ReturnType<typeof desktopServices>, getInspiration?: (owner:string)=>Promise<GroupInspirationPort>) {
  const accounts = new Map<string, Promise<{ groups: GroupChatService; handlers: Map<string, Parameters<IpcRegistrar['handle']>[1]> }>>()
  const execution = new AsyncLocalStorage<Scope>()
  function account(owner: string) {
    let current = accounts.get(owner)
    if (!current) {
      if (accounts.size >= 128) fail('request-limit')
      current = compose(owner).catch(error => { accounts.delete(owner); throw error }); accounts.set(owner,current)
    }
    return current
  }
  async function compose(owner: string) {
    const appRoot = dirname(await tenantParent(ctx.db.root, owner, true))
    const inspiration = await getInspiration?.(owner)
    async function guard(extra = 0) {
      if (ctx.db.get('SELECT disabled FROM users WHERE id=?', owner)?.disabled !== 0) fail('account-disabled')
      if (dirname(await tenantParent(ctx.db.root, owner, false)) !== appRoot) fail('conflict')
      await assertTenantSpace(ctx.db.root, owner, null, extra, readSite(ctx.db).limits)
      // Check each operational segment before the shared atomic store uses it.
      for (const path of [join(appRoot,'group-chat'),join(appRoot,'group-chat',digest(owner))]) {
        await mkdir(path,{mode:0o700}).catch(error=>{if(error?.code!=='EEXIST')throw error})
        const stat=await lstat(path);if(!stat.isDirectory()||stat.isSymbolicLink()||await realpath(path)!==path)fail('conflict')
      }
    }
    await guard()
    const files=new FileGroupSessionStore(appRoot,owner)
    const scoped=async <T>(session: GroupSession, work: () => Promise<T>): Promise<T> => {
      await guard()
      if(!session.bound)return execution.run({session},work)
      return runtimes.run(owner,session.view.book!.id,async r=>{
        if(r.root!==session.bound!.root)fail('conflict')
        const captured=await r.projects.captureCreatedBook(r.root)
        if(captured.identity.physicalIdentity!==session.bound!.physicalIdentity)fail('conflict')
        const services=await getRuntime(r), writing=jobs.services(r)
        const domains: WritingDomainPorts={projects:r.projects,workspace:r.workspace,research:r.research,documents:r.documents,planning:services.planningJobs,expansion:services.outlineExpansions,writing:writing.tasks,review:writing.agent}
        return execution.run({session,runtime:r,domains},work)
      })
    }
    async function cancelOwned(s: GroupSession) { await scoped(s,async()=>{const domains=execution.getStore()?.domains;if(domains)for(const job of s.jobs)try{await domains[job.kind].cancel(job.id)}catch(error){if(!(error instanceof AppError&&error.code==='NOT_FOUND'))throw error}}) }
    const groups=new GroupChatService(owner,{
      list:async()=>{await guard();return files.list()},read:async id=>{await guard();return files.read(id)},
      write:async(s,before)=>{await guard(Buffer.byteLength(JSON.stringify(s)));await files.write(s,async()=>{await guard();await before?.()})}
    },{
      team:async()=>captureGroupTeam(),
      defaults:async team=>{const selected=models.selected();return team.members.map(m=>({memberId:m.id,profile:selected?{connectionId:`global-hosted-${selected.id}`,model:selected.model,maxTokens:selected.maxOutputTokens,temperature:.7,topP:.95}:null}))},
      assertReadScope:async s=>{if(s.owner!==owner)fail('not-found');await scoped(s,async()=>{})},
      assertScope:async s=>{if(s.owner!==owner)fail('not-found');await scoped(s,async()=>{if(s.format===2&&s.origin)await restoreGroupTeam(async()=>creativePolicyRun(),s.origin,s.view.team)})},
      inScope:(s,work)=>scoped(s,async()=>{if(s.format!==2||!s.origin)fail('conflict');const policy=await restoreGroupTeam(async()=>creativePolicyRun(),s.origin,s.view.team);return withCreativePolicyRun(policy,work)}),cancelOwned,
      captureTools:async s=>{if(!s.bound)return undefined;if(!s.origin||s.origin.policy.installed.length)fail('conflict');return{pins:[],composition:structuredClone(s.origin.policy.composition)}},
      fingerprint:s=>scoped(s,async()=>{const domains=execution.getStore()?.domains;return groupSourceHash(domains?await groupBookSource(domains):null)}),
      tools:(s,work,_capability,_checkpoint,ownJob)=>createGroupTools(s,work,execution.getStore()?.domains,undefined,inspiration,ownJob),
      async capture(profile,task):Promise<GroupModelCapability>{
        if(!profile.connectionId.startsWith('global-hosted-'))fail('invalid-request')
        const model=models.get(profile.connectionId.slice('global-hosted-'.length)),price=ctx.credits.price(model.id)
        if(!model.enabled||!model.keyConfigured||model.model!==profile.model||profile.maxTokens!==undefined&&profile.maxTokens>model.maxOutputTokens)fail('configuration-required')
        if(price.policy.mode==='unconfigured')fail('pricing-required')
        return {identity:digest(JSON.stringify({profile,revision:model.revision,protocol:model.protocol,task})),
          model:{step:async(...args)=>(await meter.ai.prepareToolConversation(task)).step(...args)},
          async run<T>(work:()=>Promise<T>,signal?:AbortSignal):Promise<T>{
            const s=execution.getStore()?.session;if(!s)fail('internal-error');signal?.throwIfAborted()
            const id=randomUUID(),controller=new AbortController(),firstJob=s.jobs.length
            ctx.db.transaction(()=>{
              const total=dbNumber(ctx.db.get("SELECT (SELECT COUNT(*) FROM jobs WHERE status IN ('queued','running'))+(SELECT COUNT(*) FROM group_model_jobs WHERE status='running') AS count")?.count)
              if(total>=readSite(ctx.db).limits.concurrentJobs||ctx.db.get("SELECT id FROM jobs WHERE owner_id=? AND status IN ('queued','running')",owner)||ctx.db.get("SELECT id FROM group_model_jobs WHERE owner_id=? AND status='running'",owner))fail('request-limit')
              ctx.db.run('INSERT INTO group_model_jobs VALUES(?,?,?,?,?,?,?, ?,NULL,?,?)',id,owner,s.view.id,s.view.book?.id??null,model.id,model.revision,price.version,'running',ctx.db.now(),ctx.db.now())
            })
            let scope:ReturnType<MeteredModels['createScope']>|undefined,complete=false
            // Cancel real domain controllers while their metered scope is still
            // alive; closing the transport first can orphan a candidate task.
            const abort=()=>{void cancelOwned(s).catch(()=>{}).then(()=>controller.abort(signal?.reason))};signal?.addEventListener('abort',abort,{once:true})
            if(signal?.aborted)abort()
            const deadline=setTimeout(abort,10*60_000)
            try{
              scope=meter.createScope(id,owner,s.view.book?.id??null,model.id,model.revision,price.version,controller,s.view.id)
              return await meter.run(scope,async()=>withModelExecution(meter.groupConnection(profile),async()=>{
                const value=await work(), domains=execution.getStore()?.domains
                // Domain tasks inherit this same model/meter scope. Keep it alive
                // until their real status settles, including author-wait exits.
                if(domains)for(;;){controller.signal.throwIfAborted();const states=await Promise.all(s.jobs.slice(firstJob).map(j=>Promise.resolve(domains[j.kind].status(j.id))));if(states.every(t=>!['queued','preparing','running','streaming','resuming','stopping'].includes(t.status)))break;await delay(200,undefined,{signal:controller.signal})}
                signal?.throwIfAborted();complete=true;return value
              }))
            }finally{
              clearTimeout(deadline);signal?.removeEventListener('abort',abort)
              if(controller.signal.aborted)await cancelOwned(s).catch(()=>{})
              if(scope)await meter.finish(scope,complete)
              ctx.db.run('UPDATE group_model_jobs SET status=?,updated_at=? WHERE id=?',controller.signal.aborted?'cancelled':complete?'succeeded':'failed',ctx.db.now(),id)
            }
          }}
      }
    })
    const receipts=new GroupCreationReceipts(appRoot,owner)
    const creation=new GroupCreationService(groups,{read:id=>receipts.read(id),write:async(id,r)=>{await guard(128*1024);await receipts.write(id,r)},
      validateBeforeCreate:async input=>{library.validate(owner,input.token,input.project)},
      create:async input=>decodeModelCreationResult(await library.create(owner,input.token,input.project),v=>projectSummary(v,'project')),retry:async()=>fail('conflict'),
      captureBook:result=>runtimes.run(owner,result.project.id,async r=>(await r.projects.captureCreatedBook(r.root)).identity)})
    // Only these existing domain adoption methods cross the preparation boundary.
    const runtime=()=>{const r=execution.getStore()?.runtime;if(!r)fail('not-found');return r}
    const workspace:Pick<WorkspaceService,'bookProfile'|'saveBookProfile'|'foundation'|'foundationSnapshot'|'adoptPlanningWorldView'>={bookProfile:()=>runtime().workspace.bookProfile(),saveBookProfile:input=>runtime().workspace.saveBookProfile(input),foundation:readOnly=>runtime().workspace.foundation(readOnly),foundationSnapshot:()=>runtime().workspace.foundationSnapshot(),adoptPlanningWorldView:input=>runtime().workspace.adoptPlanningWorldView(input)}
    const research={listSources:()=>runtime().research.listSources(),createSource:(input:Parameters<BookRuntime['research']['createSource']>[0])=>runtime().research.createSource(input)}
    const adoption=new GroupAdoptionService(groups,(id,work)=>groups.scope(id,work),workspace,research,{
      characters:{list:()=>runtime().manuscripts.storyEntities(runtime().root),save:input=>runtime().manuscripts.saveStoryEntity(runtime().root,input)},
      events:{read:()=>runtime().events.projection.read(),preview:input=>runtime().events.operations.previewMaterialCandidate(input),prepareAdopt:input=>runtime().events.operations.preview(input),commit:token=>runtime().events.operations.commit(token)}
    },inspiration)
    const handlers=new Map<string,Parameters<IpcRegistrar['handle']>[1]>(),ipc:IpcRegistrar={handle:(channel,handler)=>{handlers.set(channel,handler)}}
    registerValidatedIpc(ipc,'group-chat:list',decodeNoArgs,()=>groups.list())
    registerValidatedIpc(ipc,'group-chat:openBook',groupChatArgs.openBook,bookId=>runtimes.run(owner,bookId,async r=>{
      const captured=await r.projects.captureCreatedBook(r.root)
      return groups.openBook({id:bookId,title:captured.summary.title},captured.identity)
    }))
    registerValidatedIpc(ipc,'group-chat:createForBook',groupChatArgs.createForBook,bookId=>runtimes.run(owner,bookId,async r=>{
      const captured=await r.projects.captureCreatedBook(r.root)
      return groups.create(`${captured.summary.title.slice(0,180)}创作群`,{book:{id:bookId,title:captured.summary.title},bound:captured.identity})
    }))
    registerValidatedIpc(ipc,'group-chat:create',groupChatArgs.create,title=>groups.create(title))
    registerValidatedIpc(ipc,'group-chat:get',groupChatArgs.get,input=>groups.get(input))
    registerValidatedIpc(ipc,'group-chat:send',groupChatArgs.send,input=>groups.send(input))
    registerValidatedIpc(ipc,'group-chat:stop',groupChatArgs.stop,input=>groups.stop(input))
    registerValidatedIpc(ipc,'group-chat:resume',groupChatArgs.resume,input=>groups.resume(input))
    registerValidatedIpc(ipc,'group-chat:saveMember',groupChatArgs.saveMember,input=>groups.saveMember(input))
    registerValidatedIpc(ipc,'group-chat:answer',groupChatArgs.answer,input=>groups.answer(input))
    const one=<T>(decode:(v:unknown)=>T)=>(args:unknown[]):[T]=>{if(args.length!==1)fail('invalid-request');return[decode(args[0])]}
    registerValidatedIpc(ipc,'group-chat:saveDraft',one(decodeGroupDraft),input=>groups.saveDraft(input))
    registerValidatedIpc(ipc,'group-chat:createBook',one(decodeGroupBookCreation),input=>creation.create(input))
    registerValidatedIpc(ipc,'group-chat:prepareAdoption',one(decodeGroupAdoptionRequest),input=>adoption.prepare(input))
    registerValidatedIpc(ipc,'group-chat:adopt',one(groupId),token=>adoption.adopt(token))
    registerValidatedIpc(ipc,'group-chat:modelCatalog',decodeNoArgs,async()=>{
      const entries=models.list().filter(m=>m.enabled&&m.keyConfigured&&ctx.credits.price(m.id).policy.mode!=='unconfigured')
      return {connections:{revision:entries.reduce((n,m)=>n+m.revision,0),connections:entries.map(m=>({id:`global-hosted-${m.id}`,name:m.name,baseUrl:m.baseUrl,protocol:m.protocol,enabled:true,revision:m.revision,credentialState:'stored'}))},models:Object.fromEntries(entries.map(m=>[`global-hosted-${m.id}`,[m.model]]))}
    })
    return {groups,handlers}
  }
  for(const name of commands)ctx.app.post(`/api/desktop/library/group-chat/${name}`,async request=>{
    const current=ctx.write(request),input=record(request.body,['args','operation']);operation(input.operation)
    if(!Array.isArray(input.args))fail('invalid-request');ctx.rate(`group-chat:${current.user.id}`,300)
    const {handlers}=await account(current.user.id)
    return validateIpcResponse(`group-chat:${name}`,await handlers.get(`group-chat:${name}`)!(undefined,...input.args))
  })
  return {account,close:async()=>{await Promise.allSettled([...accounts.values()].map(async value=>{await(await value).groups.shutdown()}))}}
}
