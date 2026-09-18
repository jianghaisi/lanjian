import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { ProjectService } from '../../../src/main/modules/library/application/project-service'
import { SettingsStore } from '../../../src/main/platform/settings/settings-store'
import { WorkspaceService } from '../../../src/main/modules/library/application/workspace-service'
import { DocumentService } from '../../../src/main/modules/manuscript/application/document-service'
import { CurrentProjectLegacyWorkspaceSource } from '../../../src/main/modules/library/application/legacy-workspace-source'
import { ShadowImportService } from '../../../src/main/modules/library/application/shadow-import-service'
import { SqliteWorkspaceDatabaseFactory } from '../../../src/main/platform/storage/workspace-database'
import { SqliteManuscriptService } from '../../../src/main/modules/manuscript/application/sqlite-manuscript-service'
import { FieldAssistantStore } from '../../../src/main/modules/assistant/adapters/field-assistant-store'
import { ProjectAiService } from '../../../src/main/modules/models/application/project-ai-service'
import { decodeFieldContext, decodeFieldPermit } from '../../../src/contracts/assistant/field-assistant-contracts'

const codec={available:()=>true,encrypt:(value:string)=>value,decrypt:(value:string)=>value}
for(const mode of ['files','sqlite'] as const)test(`${mode}: definition save preserves unrelated fields, rejects stale revisions and commits verified source metadata`,async t=>{
  const root=await mkdtemp(join(tmpdir(),'field-definition-'));t.after(()=>rm(root,{recursive:true,force:true}))
  const settings=new SettingsStore(join(root,'user-data'),codec),projects=new ProjectService(settings)
  const project=(await projects.create({parentPath:root,name:'隔离字段测试',genre:'玄幻'})).project
  const fileWorkspace=new WorkspaceService(projects)
  await fileWorkspace.saveBookProfile({...await fileWorkspace.bookProfile(),coreIdea:'初始设想'})
  let workspace=fileWorkspace
  const databases=new SqliteWorkspaceDatabaseFactory()
  if(mode==='sqlite'){
    const source=new CurrentProjectLegacyWorkspaceSource(projects,new DocumentService(projects)),importer=new ShadowImportService(source,databases)
    await importer.import(await importer.preview());const authority=new SqliteManuscriptService(databases);await authority.activate(project.path,await source.snapshot())
    workspace=new WorkspaceService(projects,undefined,undefined,undefined,undefined,undefined,authority)
  }
  const snapshot=await workspace.bookProfile(),first=await workspace.saveBookProfile({...snapshot,coreIdea:'新设想',audienceScale:'作者同时填写的受众'})
  await assert.rejects(()=>workspace.saveBookProfile({...snapshot,coreIdea:'过时修改'}),{code:'CONFLICT'})
  assert.equal((await workspace.bookProfile()).coreIdea,'新设想');assert.equal((await workspace.bookProfile()).audienceScale,'作者同时填写的受众')
  workspace.setDefinitionAssistantSources(async(_root,ids)=>ids.map(id=>({candidateId:id,field:'coreIdea',source:'ai-assisted-author-draft'})))
  const second=await workspace.saveBookProfile({...first,coreIdea:'作者采用后的字段',assistantCandidateIds:['00000000-0000-4000-8000-000000000001']})
  assert.equal(second.audienceScale,first.audienceScale);assert.notEqual(second.revision,first.revision)
  const mirror=JSON.parse(await readFile(join(project.path,'.webnovel','config',mode==='files'?'book-profile.json':'project-writing.json'),'utf8'))
  assert.equal((mode==='files'?mirror:mirror.extensions).fieldAssistantSources[0].source,'ai-assisted-author-draft')
  if(mode==='files'){
    await writeFile(join(project.path,'.webnovel','config','book-profile.json'),'{ damaged author evidence','utf8')
    await assert.rejects(()=>workspace.saveBookProfile({...second,coreIdea:'不可覆盖'}),{code:'CONFLICT'})
    assert.equal(await readFile(join(project.path,'.webnovel','config','book-profile.json'),'utf8'),'{ damaged author evidence')
  }else{
    const db=(await databases.openExisting(project.path))!;try{
      const before=db.projectWritingConfig(),hash=createHash('sha256').update(JSON.stringify(before)).digest('hex')
      db.updateProjectWritingConfig({writingStyle:'另一个保存'},hash)
      assert.throws(()=>db.updateProjectWritingConfig({writingStyle:'过时事务'},hash),{code:'CONFLICT'})
      assert.equal(db.projectWritingConfig().writingStyle,'另一个保存')
    }finally{db.close()}
  }
})
test('field candidate history fails closed on corruption and never returns credentials from result decoders',async t=>{
  const root=await mkdtemp(join(tmpdir(),'field-history-'));t.after(()=>rm(root,{recursive:true,force:true}))
  await mkdir(join(root,'field-assistant'));const file=join(root,'field-assistant',createHash('sha256').update('application').digest('hex')+'.json')
  await writeFile(file,'{ damaged history','utf8');const store=new FieldAssistantStore(root)
  await assert.rejects(()=>store.read(null),{code:'STORAGE_ERROR'});assert.equal(await readFile(file,'utf8'),'{ damaged history')
  assert.throws(()=>decodeFieldContext({apiKey:'secret'}));assert.throws(()=>decodeFieldPermit({path:'arbitrary file'}))
})
test('reading model routes for a field preview does not initialize formal AI settings',async t=>{
  const root=await mkdtemp(join(tmpdir(),'field-readonly-'));t.after(()=>rm(root,{recursive:true,force:true}))
  const settings=new SettingsStore(join(root,'user-data'),codec),projects=new ProjectService(settings)
  const project=(await projects.create({parentPath:root,name:'只读模型配置',genre:'玄幻'})).project
  await settings.updateProjectApiKey(project.path,'isolated-key')
  let imports=0
  const ai=new ProjectAiService(projects,settings,{active:async()=>true,aiSettingsReady:async()=>false,aiSettings:async()=>{throw new Error('not initialized')},importAiSettings:async()=>{imports++;throw new Error('must not migrate')},replaceAiSettings:async()=>{throw new Error('must not update')}})
  assert.equal((await ai.resolve('outline')).apiKey,'isolated-key');assert.equal(imports,0)
})
