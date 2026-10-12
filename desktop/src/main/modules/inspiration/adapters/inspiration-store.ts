import { DatabaseSync } from 'node:sqlite'
import { mkdir, lstat, readFile, realpath, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { InspirationSource, InspirationCard, InspirationJob, InspirationSearch, InspirationSearchResult, InspirationSelectionReceipt } from '../../../../contracts/inspiration/types'
import { decodeInspirationSource, decodeInspirationSegment, decodeInspirationCard, decodeInspirationJob, inspirationId, inspirationHash } from '../../../../contracts/inspiration/validation'
import { AppError } from '../../../core/errors/app-error'
import { writeJson } from '../../../platform/storage/json-store'
import { decodeCreativePolicySnapshot, type CreativePolicySnapshot } from '../../writing-plugins/domain/creative-policy-snapshot'
import { inspirationDigest, SOURCE_DOCUMENT_BYTES, serializeSourceDocument, type SourceDocument } from '../domain/source'
import { decodeSelectionReceipt } from '../../../../contracts/inspiration/bridge'
import { inspirationObject, inspirationText } from '../../../../contracts/inspiration/validation'
import { decodeVideoJob } from '../../../../contracts/inspiration/bridge'
import type { InspirationVideoJob } from '../../../../contracts/inspiration/types'
import type { ClassificationRequest, ImportClassification, SourceClassification } from '../../../../contracts/inspiration/types'
import { decodeClassificationRequest, decodeImportClassifications, decodeSourceClassification } from '../../../../contracts/inspiration/validation'

export type SelectionEffect = { operationId: string; inputHash: string; status: 'intent' | 'completed'; receipt?: InspirationSelectionReceipt }
export type ClassificationTarget = { sourceId: string | null; sourceVersion: string | null; revision: number }
const sourceKey = (source: InspirationSource) => inspirationDigest([source.kind,source.url??source.title.normalize('NFKC')])
const stored = <T>(value: unknown, decode: (v: unknown) => T): T => {try{return decode(JSON.parse(String(value)))}catch(error){throw new AppError('STORAGE_ERROR','知识库记录无法读取，原文件保留，请修复后再试。',{recoverable:true,cause:error})}}
/** Owner-private authority with immutable full source bytes and a SQLite index. */
export class InspirationStore {
  private canonicalAppRoot?: string
  private storageRoot: string
  get root(){return this.storageRoot}
  private db?: DatabaseSync
  private identity?: string
  private opening?: Promise<DatabaseSync | undefined>
  constructor(private readonly appRoot: string, readonly owner: string, private readonly guard: (extraBytes?: number) => Promise<void> = async()=>{}) {this.storageRoot=join(resolve(appRoot),'inspiration',inspirationDigest(owner))}
  private async open(create=false):Promise<DatabaseSync|undefined>{
    await this.guard()
    if(this.db){await this.assertPath();return this.db}
    if(this.opening){await this.opening;if(this.db)return this.open(create)}
    this.opening=this.openNow(create)
    try{return await this.opening}finally{this.opening=undefined}
  }
  private async openNow(create:boolean){
    const canonical=await realpath(this.appRoot),rootStat=await lstat(this.appRoot)
    if(rootStat.isSymbolicLink()||!rootStat.isDirectory()||this.canonicalAppRoot&&canonical!==this.canonicalAppRoot)throw this.conflict()
    this.canonicalAppRoot=canonical;this.storageRoot=join(canonical,'inspiration',inspirationDigest(this.owner))
    const parent=join(canonical,'inspiration'),file=join(this.root,'library.sqlite')
    for(const path of [parent,this.root]){
      try{const s=await lstat(path);if(!s.isDirectory()||s.isSymbolicLink()||await realpath(path)!==path)throw this.conflict()}
      catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;if(!create)return undefined;await mkdir(path,{mode:0o700})}
    }
    let existed=true
    try{const s=await lstat(file);if(!s.isFile()||s.isSymbolicLink()||await realpath(file)!==file)throw this.conflict()}
    catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;existed=false;if(!create)return undefined}
    const db=new DatabaseSync(file,{allowExtension:false})
    try {
      const version=Number(db.prepare('PRAGMA user_version').get()?.user_version)
      if(existed&&![1,2,3,4].includes(version))throw new AppError('UNSUPPORTED_PROJECT_VERSION','知识库版本不受支持，原库保留。',{recoverable:true})
      if(!existed)db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; BEGIN IMMEDIATE;
        CREATE TABLE identity(owner TEXT NOT NULL); CREATE TABLE sources(id TEXT PRIMARY KEY, source_key TEXT UNIQUE NOT NULL, payload TEXT NOT NULL);
        CREATE TABLE cards(id TEXT PRIMARY KEY,source_id TEXT NOT NULL,source_version TEXT NOT NULL,kind TEXT NOT NULL,search_text TEXT NOT NULL,payload TEXT NOT NULL);
        CREATE INDEX cards_source ON cards(source_id,source_version);
        CREATE TABLE jobs(id TEXT PRIMARY KEY,operation TEXT UNIQUE NOT NULL,input_hash TEXT NOT NULL,payload TEXT NOT NULL);
        CREATE TABLE versions(source_id TEXT NOT NULL,version TEXT NOT NULL,digest TEXT NOT NULL,PRIMARY KEY(source_id,version));
        CREATE TABLE operations(operation TEXT PRIMARY KEY,job_id TEXT NOT NULL,input_hash TEXT NOT NULL);
        CREATE TABLE video_jobs(id TEXT PRIMARY KEY,payload TEXT NOT NULL); CREATE TABLE video_results(id TEXT PRIMARY KEY,digest TEXT NOT NULL);
        CREATE TABLE selections(operation TEXT PRIMARY KEY,payload TEXT NOT NULL);
        CREATE TABLE job_policies(job_id TEXT PRIMARY KEY,payload TEXT NOT NULL);
        CREATE TABLE source_classifications(source_id TEXT PRIMARY KEY,genre_id TEXT NOT NULL,revision INTEGER NOT NULL,updated_at TEXT NOT NULL); PRAGMA user_version=4;`)
      if(!existed){db.prepare('INSERT INTO identity VALUES(?)').run(this.owner);db.exec('COMMIT')}
      if(db.prepare('SELECT owner FROM identity').get()?.owner!==this.owner)throw this.conflict()
      if(existed&&version<4){
        db.exec('BEGIN IMMEDIATE')
        try{
          if(version===1)db.exec('CREATE TABLE video_results(id TEXT PRIMARY KEY,digest TEXT NOT NULL);')
          if(version<3)db.exec('CREATE TABLE job_policies(job_id TEXT PRIMARY KEY,payload TEXT NOT NULL);')
          db.exec('CREATE TABLE source_classifications(source_id TEXT PRIMARY KEY,genre_id TEXT NOT NULL,revision INTEGER NOT NULL,updated_at TEXT NOT NULL); PRAGMA user_version=4; COMMIT;')
        }catch(error){db.exec('ROLLBACK');throw error}
      }
      this.db=db;const stat=await lstat(file);this.identity=`${stat.dev}:${stat.ino}`;return db
    }catch(error){db.close();throw error}
  }
  private async assertPath(){if(await realpath(this.appRoot)!==this.canonicalAppRoot)throw this.conflict();for(const path of [join(this.canonicalAppRoot!,'inspiration'),this.root,join(this.root,'library.sqlite')]){const s=await lstat(path);if(s.isSymbolicLink()||await realpath(path)!==path)throw this.conflict();if(path.endsWith('library.sqlite')&&`${s.dev}:${s.ino}`!==this.identity)throw this.conflict()}}
  private conflict(){return new AppError('CONFLICT','知识库位置或归属已变化，原资料保留。',{recoverable:true})}
  async listSources():Promise<InspirationSource[]>{const db=await this.open();return db?db.prepare('SELECT payload FROM sources ORDER BY rowid DESC').all().map(r=>stored(r.payload,decodeInspirationSource)):[]}
  private classification(db:DatabaseSync|undefined,sourceId:string):SourceClassification{
    const row=db?.prepare('SELECT source_id AS sourceId,genre_id AS genreId,revision,updated_at AS updatedAt FROM source_classifications WHERE source_id=?').get(sourceId)
    return row?stored(JSON.stringify(row),decodeSourceClassification):{sourceId,genreId:'unclassified',revision:0,updatedAt:null}
  }
  async listClassifications():Promise<SourceClassification[]>{
    const db=await this.open(),sources=await this.listSources()
    return sources.filter(source=>source.kind==='novel').map(source=>this.classification(db,source.id))
  }
  async previewClassifications(documents:SourceDocument[]){
    const db=await this.open(),classifications:SourceClassification[]=[],targets=new Map<string,ClassificationTarget>()
    for(const document of documents){
      if(document.source.kind!=='novel')continue
      const row=db?.prepare('SELECT payload FROM sources WHERE source_key=?').get(sourceKey(document.source))
      const old=row?stored(row.payload,decodeInspirationSource):undefined
      const current=this.classification(db,old?.id??document.source.id)
      classifications.push({...current,sourceId:document.source.id})
      targets.set(document.source.id,{sourceId:old?.id??null,sourceVersion:old?.version??null,revision:current.revision})
    }
    return {classifications,targets}
  }
  private writeClassification(db:DatabaseSync,input:ImportClassification):SourceClassification{
    const current=this.classification(db,input.sourceId)
    if(current.revision!==input.expectedRevision)throw new AppError('CONFLICT','分类已变化，请重新读取后保存；原资料保留。',{recoverable:true})
    if(current.genreId===input.genreId)return current
    const next=decodeSourceClassification({sourceId:input.sourceId,genreId:input.genreId,revision:current.revision+1,updatedAt:new Date().toISOString()})
    db.prepare('INSERT INTO source_classifications VALUES(?,?,?,?) ON CONFLICT(source_id) DO UPDATE SET genre_id=excluded.genre_id,revision=excluded.revision,updated_at=excluded.updated_at').run(next.sourceId,next.genreId,next.revision,next.updatedAt!)
    return next
  }
  async setClassification(value:ClassificationRequest):Promise<SourceClassification>{
    const input=decodeClassificationRequest(value);await this.guard(512)
    const db=await this.open(),row=db?.prepare('SELECT payload FROM sources WHERE id=?').get(input.sourceId)
    if(!db||!row)throw new AppError('NOT_FOUND','该小说不属于此知识库。',{recoverable:true})
    await this.assertPath();db.exec('BEGIN IMMEDIATE')
    try{
      const source=stored(db.prepare('SELECT payload FROM sources WHERE id=?').get(input.sourceId)?.payload,decodeInspirationSource)
      if(source.kind!=='novel'||source.version!==input.sourceVersion)throw this.conflict()
      const result=this.writeClassification(db,input);db.exec('COMMIT');return result
    }catch(error){db.exec('ROLLBACK');throw error}
  }
  async commitDocuments(documents: SourceDocument[],classifications:ImportClassification[]=[],targets=new Map<string,ClassificationTarget>()):Promise<InspirationSource[]>{
    decodeImportClassifications(classifications)
    if(classifications.some(c=>!documents.some(d=>d.source.id===c.sourceId&&d.source.kind==='novel')||!targets.has(c.sourceId)))throw this.conflict()
    const sizes=documents.map(d=>Buffer.byteLength(serializeSourceDocument(d),'utf8'))
    if(sizes.some(n=>n>SOURCE_DOCUMENT_BYTES))throw new AppError('VALIDATION_ERROR','完整来源超过64MB，请拆分后导入。',{recoverable:true})
    await this.guard(sizes.reduce((n,size)=>n+size*2,0))
    const db=(await this.open(true))!,result:InspirationSource[]=[],staged:Array<{key:string;prior:unknown;source:InspirationSource;digest?:string}>=[]
    const keys=documents.map(d=>sourceKey(d.source))
    if(new Set(keys).size!==keys.length)throw new AppError('VALIDATION_ERROR','同一批有重复名称或链接，请分别导入各个版本。',{recoverable:true})
    // Publish the batch index in one transaction. Staged immutable bytes may
    // survive interruption, but a failed batch exposes no partial imports.
    for(const [index,original] of documents.entries()){const key=keys[index],prior=db.prepare('SELECT payload FROM sources WHERE source_key=?').get(key);const old=prior?stored(prior.payload,decodeInspirationSource):undefined
      if(old?.acquisitionCoverage==='complete'&&original.source.acquisitionCoverage==='partial')throw new AppError('CONFLICT','部分视频来源不能替换已保留的完整版本，原资料保留。',{recoverable:true})
      if(old?.version===original.source.version){result.push(old);staged.push({key,prior:prior?.payload,source:old});continue}
      const known=old&&db.prepare('SELECT version FROM versions WHERE source_id=? AND version=?').get(old.id,original.source.version)
      if(known){const d=await this.document(old!.id,original.source.version),source={...d.source,revision:old!.revision+1};staged.push({key,prior:prior?.payload,source});result.push(source);continue}
      let d=structuredClone(original);if(old){d.source.id=old.id;d.source.revision=old.revision+1;d.segments.forEach(s=>s.sourceId=old.id)}
      const file=join(this.root,`${d.source.id}-${d.source.version}.json`)
      await this.assertPath()
      try{await writeFile(file,serializeSourceDocument(d),{encoding:'utf8',flag:'wx'})}
      catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error
        const stat=await lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>SOURCE_DOCUMENT_BYTES||await realpath(file)!==file)throw this.conflict()
        const previous=this.decodeDocument(await readFile(file,'utf8'),d.source.id,d.source.version)
        if(previous.text!==d.text)throw this.conflict();previous.source.revision=d.source.revision;d=previous
      }
      const digest=inspirationDigest(await readFile(file,'utf8'));staged.push({key,prior:prior?.payload,source:decodeInspirationSource(d.source),digest});result.push(d.source)
    }
    await this.guard();await this.assertPath()
    db.exec('BEGIN IMMEDIATE');try{
      for(const row of staged){if(db.prepare('SELECT payload FROM sources WHERE source_key=?').get(row.key)?.payload!==row.prior)throw this.conflict()}
      for(const choice of classifications){
        const index=documents.findIndex(d=>d.source.id===choice.sourceId),target=targets.get(choice.sourceId)!
        const prior=staged[index].prior?stored(staged[index].prior,decodeInspirationSource):undefined
        if((prior?.id??null)!==target.sourceId||(prior?.version??null)!==target.sourceVersion||choice.expectedRevision!==target.revision)throw this.conflict()
      }
      for(const row of staged){db.prepare('INSERT INTO sources VALUES(?,?,?) ON CONFLICT(source_key) DO UPDATE SET payload=excluded.payload').run(row.source.id,row.key,JSON.stringify(row.source));if(row.digest)db.prepare('INSERT INTO versions VALUES(?,?,?)').run(row.source.id,row.source.version,row.digest)}
      for(const choice of classifications){const index=documents.findIndex(d=>d.source.id===choice.sourceId);this.writeClassification(db,{...choice,sourceId:result[index].id})}
      db.exec('COMMIT')
    }catch(e){db.exec('ROLLBACK');throw e}
    return result
  }
  async document(id:string,version:string):Promise<SourceDocument>{
    inspirationId(id);inspirationHash(version);const db=await this.open();if(!db?.prepare('SELECT id FROM sources WHERE id=?').get(id))throw new AppError('NOT_FOUND','该来源不属于此知识库。',{recoverable:true})
    const file=join(this.root,`${id}-${version}.json`),stat=await lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>SOURCE_DOCUMENT_BYTES||await realpath(file)!==file)throw this.conflict()
    const bytes=await readFile(file,'utf8'),record=db.prepare('SELECT digest FROM versions WHERE source_id=? AND version=?').get(id,version)
    if(!record||record.digest!==inspirationDigest(bytes))throw this.conflict()
    return this.decodeDocument(bytes,id,version)
  }
  private decodeDocument(bytes:string,id:string,version:string):SourceDocument{return stored(bytes,v=>{const d=v as SourceDocument;const source=decodeInspirationSource(d.source);if(source.id!==id||source.version!==version||typeof d.text!=='string'||d.text.length!==source.totalCharacters||!Array.isArray(d.segments)||d.segments.length!==source.segmentCount)throw this.conflict();const segments=d.segments.map(decodeInspirationSegment);if(segments.some((s,i)=>s.sourceId!==id||s.version!==version||s.index!==i||d.text.slice(s.start,s.end)!==s.text||inspirationDigest(s.text)!==s.contentHash))throw this.conflict();return {source,text:d.text,segments}})}
  async readCard(id:string):Promise<InspirationCard>{const db=await this.open(),row=db?.prepare('SELECT payload FROM cards WHERE id=?').get(inspirationId(id));if(!row)throw new AppError('NOT_FOUND','情节卡不属于此知识库。',{recoverable:true});const card=stored(row.payload,decodeInspirationCard);const source=db!.prepare('SELECT payload FROM sources WHERE id=?').get(card.sourceId);return {...card,stale:!source||stored(source.payload,decodeInspirationSource).version!==card.sourceVersion}}
  async search(input:InspirationSearch):Promise<InspirationSearchResult>{
    const db=await this.open(),sources=await this.listSources();if(!db)return {cards:[],sources:[],total:0,nextOffset:-1}
    const terms=input.query.normalize('NFKC').toLocaleLowerCase().split(/[\s，,；;、]+/u).filter(Boolean).slice(0,16)
    const selected=sources.filter(s=>(!input.kind||s.kind===input.kind)&&(!input.sourceId||s.id===input.sourceId)),allowed=new Set(selected.map(s=>s.id))
    if(!allowed.size)return {cards:[],sources:selected,total:0,nextOffset:-1}
    const clauses=[`source_id IN (${selected.map(()=>'?').join(',')})`],params:string[]=[...allowed]
    for(const term of terms){clauses.push("(instr(search_text,?)>0 OR instr(lower(json_extract((SELECT payload FROM sources WHERE id=cards.source_id),'$.title')),?)>0)");params.push(term,term)}
    if(input.tag){clauses.push("EXISTS(SELECT 1 FROM json_each(cards.payload,'$.tags') WHERE value=?)");params.push(input.tag)}
    if(input.cardKind){clauses.push('kind=?');params.push(input.cardKind)}
    const where=clauses.join(' AND '),total=Number(db.prepare(`SELECT count(*) AS n FROM cards WHERE ${where}`).get(...params)?.n??0)
    const offset=input.offset??0,limit=input.limit??30
    const cards=db.prepare(`SELECT payload FROM cards WHERE ${where} ORDER BY rowid DESC LIMIT ? OFFSET ?`).all(...params,limit,offset).map(r=>stored(r.payload,decodeInspirationCard)).map(c=>({...c,stale:selected.find(s=>s.id===c.sourceId)?.version!==c.sourceVersion}))
    return {cards,sources:selected,total,nextOffset:offset+cards.length<total?offset+cards.length:-1}
  }

  async jobs():Promise<InspirationJob[]>{const db=await this.open();return db?db.prepare('SELECT payload FROM jobs ORDER BY rowid DESC').all().map(r=>stored(r.payload,decodeInspirationJob)):[]}
  async job(id:string){const db=await this.open(),row=db?.prepare('SELECT payload FROM jobs WHERE id=?').get(inspirationId(id));if(!row)throw new AppError('NOT_FOUND','提取任务不属于此知识库。',{recoverable:true});return stored(row.payload,decodeInspirationJob)}
  async operation(id:string,hash:string){const db=await this.open(),r=db?.prepare('SELECT job_id,input_hash FROM operations WHERE operation=?').get(inspirationId(id));if(!r)return undefined;if(r.input_hash!==hash)throw this.conflict();return this.job(String(r.job_id))}
  async policy(jobId:string):Promise<CreativePolicySnapshot|undefined>{const db=await this.open(),row=db?.prepare('SELECT payload FROM job_policies WHERE job_id=?').get(inspirationId(jobId));return row?stored(row.payload,decodeCreativePolicySnapshot):undefined}
  async rememberOperation(jobId:string,operation:string,hash:string,assertBeforeCommit?:()=>Promise<void>){const db=(await this.open(true))!;await assertBeforeCommit?.();await this.assertPath();db.prepare('INSERT INTO operations VALUES(?,?,?)').run(inspirationId(operation),inspirationId(jobId),inspirationHash(hash))}
  async createJob(job:InspirationJob,operation:string,hash:string,policy?:CreativePolicySnapshot,assertBeforeCommit?:()=>Promise<void>){
    const snapshot=policy===undefined?undefined:decodeCreativePolicySnapshot(policy)
    if(Boolean(snapshot)!==Boolean(job.creativePolicy))throw this.conflict()
    await this.guard(Buffer.byteLength(JSON.stringify([job,snapshot]))*2);const db=(await this.open(true))!
    await assertBeforeCommit?.();await this.assertPath()
    db.exec('BEGIN IMMEDIATE');try{
      db.prepare('INSERT INTO jobs VALUES(?,?,?,?)').run(job.id,operation,hash,JSON.stringify(decodeInspirationJob(job)))
      if(snapshot)db.prepare('INSERT INTO job_policies VALUES(?,?)').run(job.id,JSON.stringify(snapshot))
      db.prepare('INSERT INTO operations VALUES(?,?,?)').run(operation,job.id,hash);db.exec('COMMIT')
    }catch(e){db.exec('ROLLBACK');throw e}
  }
  async saveJob(job:InspirationJob,cards:InspirationCard[]=[],expectedRevision?:number,assertBeforeCommit?:()=>Promise<void>){
    await this.guard(Buffer.byteLength(JSON.stringify([job,cards]))*2);const db=(await this.open(true))!
    await assertBeforeCommit?.();await this.assertPath()
    const previous=stored(db.prepare('SELECT payload FROM jobs WHERE id=?').get(job.id)?.payload,decodeInspirationJob)
    if(expectedRevision!==undefined&&previous.revision!==expectedRevision)throw this.conflict()
    const current=stored(db.prepare('SELECT payload FROM sources WHERE id=?').get(job.sourceId)?.payload,decodeInspirationSource)
    if(cards.length&&current.version!==job.sourceVersion)throw this.conflict()
    db.exec('BEGIN IMMEDIATE');try{for(const c of cards){decodeInspirationCard(c);if(c.sourceId!==job.sourceId||c.sourceVersion!==job.sourceVersion)throw this.conflict();const existing=db.prepare('SELECT payload FROM cards WHERE id=?').get(c.id);if(existing&&String(existing.payload)!==JSON.stringify(c))throw this.conflict();db.prepare('INSERT OR IGNORE INTO cards VALUES(?,?,?,?,?,?)').run(c.id,c.sourceId,c.sourceVersion,c.kind,JSON.stringify([c.title,c.narrative,c.tags,c.characters,c.conflict,c.choice,c.outcome,c.turn,c.foreshadowing]).normalize('NFKC').toLowerCase(),JSON.stringify(c))}db.prepare('UPDATE jobs SET payload=? WHERE id=?').run(JSON.stringify(decodeInspirationJob(job)),job.id);db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}
  }
  async effect(operation:string):Promise<SelectionEffect|undefined>{const db=await this.open(),row=db?.prepare('SELECT payload FROM selections WHERE operation=?').get(inspirationId(operation));return row?stored(row.payload,v=>{const o=inspirationObject(v,['operationId','inputHash','status','receipt']);if(o.status!=='intent'&&o.status!=='completed')throw this.conflict();const receipt=o.receipt===undefined?undefined:decodeSelectionReceipt(o.receipt);if(o.status==='completed'&&!receipt)throw this.conflict();return {operationId:inspirationId(o.operationId),inputHash:inspirationHash(o.inputHash),status:o.status, ...(receipt?{receipt}:{})}}):undefined}
  async saveEffect(effect:SelectionEffect){await this.guard(Buffer.byteLength(JSON.stringify(effect))*2);const db=(await this.open(true))!;const old=await this.effect(effect.operationId);if(old&&old.inputHash!==effect.inputHash)throw this.conflict();db.prepare('INSERT INTO selections VALUES(?,?) ON CONFLICT(operation) DO UPDATE SET payload=excluded.payload').run(effect.operationId,JSON.stringify(effect))}
  close(){this.db?.close();this.db=undefined}
  async videoJobs(){const db=await this.open();return db?db.prepare('SELECT payload FROM video_jobs ORDER BY rowid DESC').all().map(r=>stored(r.payload,decodeVideoJob)):[]}
  async saveVideoResult(id:string,document:SourceDocument){
    inspirationId(id);const bytes=Buffer.byteLength(serializeSourceDocument(document),'utf8')
    if(bytes>SOURCE_DOCUMENT_BYTES)throw new AppError('VALIDATION_ERROR','完整视频来源超过64MB，请拆分后导入。',{recoverable:true})
    await this.guard(bytes*2);const db=(await this.open(true))!
    const file=join(this.root,`${id}-video.json`);await writeJson(file,document,()=>this.assertPath());const digest=inspirationDigest(await readFile(file,'utf8'))
    db.prepare('INSERT INTO video_results VALUES(?,?) ON CONFLICT(id) DO UPDATE SET digest=excluded.digest').run(id,digest)
  }
  async videoResult(id:string):Promise<SourceDocument|undefined>{
    const db=await this.open(),record=db?.prepare('SELECT digest FROM video_results WHERE id=?').get(inspirationId(id));if(!record)return
    const file=join(this.root,`${id}-video.json`),s=await lstat(file);if(!s.isFile()||s.isSymbolicLink()||s.size>SOURCE_DOCUMENT_BYTES||await realpath(file)!==file)throw this.conflict()
    const raw=await readFile(file,'utf8');if(inspirationDigest(raw)!==record.digest)throw this.conflict()
    return stored(raw,v=>{const d=v as SourceDocument;const source=decodeInspirationSource(d.source),segments=d.segments.map(decodeInspirationSegment);if(typeof d.text!=='string'||source.totalCharacters!==d.text.length||source.segmentCount!==segments.length||segments.some(s=>s.sourceId!==source.id||s.version!==source.version||d.text.slice(s.start,s.end)!==s.text||inspirationDigest(s.text)!==s.contentHash))throw this.conflict();return {source,text:d.text,segments}})
  }
  async saveVideo(job:InspirationVideoJob){await this.guard(Buffer.byteLength(JSON.stringify(job))*2);const db=(await this.open(true))!;db.prepare('INSERT INTO video_jobs VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(job.id,JSON.stringify(decodeVideoJob(job)))}
}
