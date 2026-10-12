import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { DesktopApi, ProjectSummary } from '../../../../contracts'
import type { InspirationCapabilities, InspirationCard, InspirationImportPreview, InspirationJob, InspirationReadSource, InspirationSelection, InspirationSource, InspirationVideoJob } from '../../../../contracts/inspiration/types'
import type { ModelProfile } from '../../../../contracts/models/types'
import type { SourceClassification } from '../../../../contracts/inspiration/types'
import type { NovelGenreId } from '../../../../contracts/inspiration/genres'
export function useInspiration(props:{api:DesktopApi;visible:boolean;book:ProjectSummary|null;projects:ProjectSummary[]}){
  const sources=ref<InspirationSource[]>([]),cards=ref<InspirationCard[]>([]),jobs=ref<InspirationJob[]>([]),query=ref(''),kind=ref('novel'),sourceId=ref(''),total=ref(0),next=ref(-1)
  const selected=ref<InspirationCard|null>(null),reading=ref<InspirationReadSource|null>(null),preview=ref<InspirationImportPreview|null>(null),selection=ref<InspirationSelection|null>(null),video=ref<InspirationVideoJob|null>(null),capabilities=ref<InspirationCapabilities|null>(null)
  const videoJobs=ref<InspirationVideoJob[]>([]),preparingVideo=ref(false)
  const includeAuxiliary=ref(false),evidenceReading=ref<InspirationReadSource|null>(null)
  const genre=ref<NovelGenreId|''>(''),section=ref<'original'|'scene'|'arc'|'jobs'>('original'),searching=ref(false)
  const classifications=ref<SourceClassification[]>([]),classificationError=ref(''),classificationReady=ref(false),classificationBusy=ref(false),genreDraft=ref<NovelGenreId>('unclassified')
  const importGenres=ref<Record<string,NovelGenreId>>({}),lastImported=ref<InspirationSource[]>([])
  let classificationEpoch=0,classificationWriteEpoch=0
  const activeSource=computed(()=>sources.value.find(source=>source.id===sourceId.value)??null)
  const sourceJobs=computed(()=>jobs.value.filter(job=>job.sourceId===sourceId.value))
  const classificationFor=(id:string)=>classifications.value.find(value=>value.sourceId===id)
  const genreDirty=computed(()=>genreDraft.value!==(classificationFor(sourceId.value)?.genreId??'unclassified'))
  const inspectedSource=ref<InspirationSource|null>(null),readingBusy=ref(false),sourceQuery=ref('')
  const model=ref<ModelProfile|null>(null),budget=ref(8),url=ref(''),targetBook=ref(''),busy=ref(false),loading=ref(false),error=ref(''),notice=ref(''),composing=ref(false),initialized=ref(false)
  let epoch=0,readEpoch=0,selectionEpoch=0,searchEpoch=0,videoEpoch=0,disposed=false,timer:ReturnType<typeof setTimeout>|undefined,debounce:ReturnType<typeof setTimeout>|undefined
  const message=(e:unknown)=>e&&typeof e==='object'&&'message'in e?String(e.message):'知识库暂时无法读取，请稍后重试。'
  async function action<T>(work:()=>Promise<T>){if(busy.value)return;busy.value=true;error.value='';try{return await work()}catch(e){error.value=message(e)}finally{busy.value=false}}
  async function search(more=false){
    const ticket=++searchEpoch,id=sourceId.value,cardKind=section.value
    if(!id||(cardKind!=='scene'&&cardKind!=='arc')){cards.value=[];total.value=0;next.value=-1;searching.value=false;return}
    if(more&&next.value<0)return
    searching.value=true
    try{const result=await props.api.inspiration.search({query:query.value,sourceId:id,cardKind,offset:more?next.value:0,limit:30});if(disposed||ticket!==searchEpoch||id!==sourceId.value||cardKind!==section.value)return;cards.value=more?[...cards.value,...result.cards]:result.cards;total.value=result.total;next.value=result.nextOffset}catch(e){if(ticket===searchEpoch)error.value=message(e)}finally{if(ticket===searchEpoch)searching.value=false}
  }
  async function loadClassifications(){
    if(classificationBusy.value)return
    const ticket=++classificationEpoch
    try{const values=await props.api.inspiration.listClassifications();if(disposed||ticket!==classificationEpoch)return;const dirty=genreDirty.value;classifications.value=values;classificationError.value='';classificationReady.value=true;if(!dirty)genreDraft.value=classificationFor(sourceId.value)?.genreId??'unclassified'}
    catch(e){if(ticket===classificationEpoch){classificationError.value=message(e);classificationReady.value=false}}
  }
  async function saveClassification(){
    const source=activeSource.value,current=classificationFor(sourceId.value),choice=genreDraft.value
    if(!source||source.kind!=='novel'||!classificationReady.value||classificationBusy.value||!current)return
    classificationBusy.value=true;++classificationEpoch;const ticket=++classificationWriteEpoch
    try{const result=await props.api.inspiration.setClassification({sourceId:source.id,sourceVersion:source.version,genreId:choice,expectedRevision:current.revision});if(disposed||ticket!==classificationWriteEpoch)return;classifications.value=[result,...classifications.value.filter(value=>value.sourceId!==result.sourceId)];classificationError.value='';if(sourceId.value===source.id)genreDraft.value=result.genreId;notice.value=`《${source.title}》的分类已保存。`}
    catch(e){if(ticket===classificationWriteEpoch)classificationError.value=message(e)}finally{classificationBusy.value=false}
  }
  function openSource(source:InspirationSource){sourceId.value=source.id;section.value='original'}
  function returnToList(){sourceId.value=''}
  function syncVideos(values:InspirationVideoJob[]){videoJobs.value=values;video.value=values.find(v=>v.id===video.value?.id)??values.find(v=>v.status==='running')??video.value}
  async function refresh(){const ticket=++epoch,videoTicket=videoEpoch;loading.value=true;try{const [s,j,c,v]=await Promise.all([props.api.inspiration.listSources(),props.api.inspiration.listJobs(),props.api.inspiration.capabilities(),props.api.inspiration.listVideoJobs(),loadClassifications()]);if(disposed||ticket!==epoch)return;sources.value=s;jobs.value=j;capabilities.value=c;if(videoTicket===videoEpoch)syncVideos(v);initialized.value=true;if(section.value==='original'&&activeSource.value&&(inspectedSource.value?.version!==activeSource.value.version||!reading.value&&!readingBusy.value))void inspectSource(activeSource.value);await search()}catch(e){if(ticket===epoch)error.value=message(e)}finally{if(ticket===epoch)loading.value=false;schedule()}}
  async function poll(){if(!props.visible||disposed)return;const ticket=epoch,videoTicket=videoEpoch,active=video.value;try{const [j,v,updated]=await Promise.all([props.api.inspiration.listJobs(),props.api.inspiration.listVideoJobs(),active?.status==='running'?props.api.inspiration.videoJob(active.id):null]);if(disposed||ticket!==epoch||!props.visible)return;jobs.value=j;if(videoTicket===videoEpoch){syncVideos(v);if(updated&&video.value&&video.value.id===active?.id&&updated.updatedAt>=video.value.updatedAt){video.value=updated;if(updated.preview&&!preview.value&&!selection.value)preview.value=updated.preview}}if(!jobs.value.some(j=>j.status==='running'))await search()}catch(e){if(!disposed&&ticket===epoch&&props.visible&&videoTicket===videoEpoch)error.value=message(e)}finally{schedule()}}
  function schedule(){clearTimeout(timer);if(!disposed&&props.visible&&(jobs.value.some(j=>j.status==='running')||videoJobs.value.some(v=>v.status==='running')))timer=setTimeout(()=>void poll(),1500)}
  watch(()=>props.visible,visible=>{if(visible)void refresh();else{clearTimeout(timer);clearTimeout(debounce);++epoch;++readEpoch;++selectionEpoch;++searchEpoch;++classificationEpoch;loading.value=false;readingBusy.value=false;searching.value=false;selection.value=null}},{immediate:true})
  watch([sourceId,section],([id],old)=>{
    clearTimeout(debounce);++searchEpoch;++selectionEpoch;cards.value=[];total.value=0;next.value=-1;searching.value=false;selection.value=null;query.value='';closeReading()
    if(id!==old[0])genreDraft.value=classificationFor(id)?.genreId??'unclassified'
    if(section.value==='original'&&activeSource.value)void inspectSource(activeSource.value)
    else if(!composing.value)void search()
  },{flush:'sync'})
  watch(query,()=>{clearTimeout(debounce);++searchEpoch;cards.value=[];total.value=0;next.value=-1;searching.value=false;if(!composing.value)debounce=setTimeout(()=>void search(),250)},{flush:'sync'})
  watch(preview,value=>{importGenres.value=Object.fromEntries((value?.classifications??[]).map(c=>[c.sourceId,c.genreId]))},{flush:'sync'})
  watch(composing,value=>{if(!value)void search()})
  watch(()=>props.book?.id,id=>{targetBook.value=id??'';selection.value=null},{immediate:true})
  watch([targetBook,selected],()=>{++selectionEpoch;selection.value=null},{flush:'sync'})
  async function importFiles(files:FileList|null){if(!files?.length)return;await action(async()=>{const list=Array.from(files);if(list.length>20||list.reduce((n,f)=>n+f.size,0)>24*1024*1024)throw new Error('每批最多20份文件，总量不超过24MB。');const documents=[];for(const file of list){const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));documents.push({name:file.name,dataBase64:btoa(binary)})}preview.value=await props.api.inspiration.importPreview({documents})})}
  async function commitImport(){await action(async()=>{if(!preview.value)return;const p=preview.value;const choices=p.classifications?.map(c=>({sourceId:c.sourceId,genreId:importGenres.value[c.sourceId]??c.genreId,expectedRevision:c.revision}));lastImported.value=choices===undefined?await props.api.inspiration.importCommit(p.token):await props.api.inspiration.importCommit(p.token,choices);if(preview.value?.token===p.token)preview.value=null;notice.value='完整来源已收入知识库。点击书卡查看资料。';await refresh()})}
  function updateVideo(job:InspirationVideoJob){++videoEpoch;video.value=job;videoJobs.value=[job,...videoJobs.value.filter(v=>v.id!==job.id)]}
  async function acquireVideo(){await action(async()=>{updateVideo(await props.api.inspiration.videoPreview({url:url.value.trim(),operationId:crypto.randomUUID()}));schedule()})}
  async function reviewVideo(id=video.value?.id){await action(async()=>{if(id){updateVideo(await props.api.inspiration.videoJob(id));preview.value=video.value!.preview;schedule()}})}
  async function stopVideo(id=video.value?.id){await action(async()=>{if(id){updateVideo(await props.api.inspiration.stopVideo(id));schedule()}})}
  async function prepareVideo(){preparingVideo.value=true;try{await action(async()=>{capabilities.value=await props.api.inspiration.prepareVideoRuntime()})}finally{preparingVideo.value=false}}
  async function cancelVideoPreparation(){try{capabilities.value=await props.api.inspiration.cancelVideoPreparation();notice.value='已停止组件准备，已下载资源保留，可再次准备。'}catch(e){error.value=message(e)}}
  async function extract(source:InspirationSource){await action(async()=>{if(!model.value)throw new Error('请先选择提取模型。');await props.api.inspiration.extract({sourceId:source.id,sourceVersion:source.version,operationId:crypto.randomUUID(),profile:JSON.parse(JSON.stringify(model.value)),maxCalls:budget.value,includeAuxiliary:includeAuxiliary.value});await refresh()})}
  async function stop(job:InspirationJob){await action(async()=>{await props.api.inspiration.stop(job.id);await refresh()})}
  async function resume(job:InspirationJob){await action(async()=>{await props.api.inspiration.resume({jobId:job.id,expectedRevision:job.revision});await refresh()})}
  function closeReading(){++readEpoch;selected.value=null;inspectedSource.value=null;reading.value=null;evidenceReading.value=null;readingBusy.value=false}
  async function inspect(card:InspirationCard){const ticket=++readEpoch;selected.value=card;inspectedSource.value=null;reading.value=null;evidenceReading.value=null;readingBusy.value=true;try{const [evidence,result]=await Promise.all([props.api.inspiration.readEvidence(card.id),props.api.inspiration.readSource({sourceId:card.sourceId,sourceVersion:card.sourceVersion,offset:0,limit:2})]);if(!disposed&&ticket===readEpoch){evidenceReading.value=evidence;reading.value=result}}catch(e){if(!disposed&&ticket===readEpoch)error.value=message(e)}finally{if(ticket===readEpoch)readingBusy.value=false}}
  async function inspectSource(source:InspirationSource){const ticket=++readEpoch;selected.value=null;inspectedSource.value=source;reading.value=null;evidenceReading.value=null;readingBusy.value=true;try{const result=await props.api.inspiration.readSource({sourceId:source.id,sourceVersion:source.version,offset:0,limit:2});if(!disposed&&ticket===readEpoch)reading.value=result}catch(e){if(!disposed&&ticket===readEpoch)error.value=message(e)}finally{if(ticket===readEpoch)readingBusy.value=false}}
  async function readMore(){if(!reading.value||reading.value.nextOffset<0||readingBusy.value)return;const ticket=readEpoch,r=reading.value;readingBusy.value=true;try{const page=await props.api.inspiration.readSource({sourceId:r.source.id,sourceVersion:r.source.version,offset:r.nextOffset,limit:2});if(!disposed&&ticket===readEpoch)reading.value={...page,segments:[...r.segments,...page.segments]}}catch(e){if(!disposed&&ticket===readEpoch)error.value=message(e)}finally{if(ticket===readEpoch)readingBusy.value=false}}
  async function prepareSelection(){const ticket=++selectionEpoch;await action(async()=>{if(!selected.value||!targetBook.value)throw new Error('请先选择目标作品。');const result=await props.api.inspiration.prepareSelection({bookId:targetBook.value,cardId:selected.value.id,sourceVersion:selected.value.sourceVersion,operationId:crypto.randomUUID()});if(!disposed&&ticket===selectionEpoch)selection.value=result})}
  async function commitSelection(){await action(async()=>{if(!selection.value)return;const p=selection.value,receipt=await props.api.inspiration.commitSelection(p.token);notice.value=`已收入《${p.bookTitle}》的素材，回执 ${receipt.operationId.slice(0,8)}。可以回到群聊讨论改编。`;if(selection.value?.token===p.token)selection.value=null})}
  const genreCount=(id:NovelGenreId)=>classificationReady.value?sources.value.filter(s=>s.kind==='novel'&&classificationFor(s.id)?.genreId===id).length:0
  const visibleSources=computed(()=>{const needle=sourceQuery.value.trim().normalize('NFKC').toLowerCase();return sources.value.filter(s=>(!kind.value||s.kind===kind.value)&&(!genre.value||!classificationReady.value||s.kind==='novel'&&classificationFor(s.id)?.genreId===genre.value)&&(!needle||`${s.title} ${s.author}`.normalize('NFKC').toLowerCase().includes(needle)))})
  onBeforeUnmount(()=>{disposed=true;++epoch;++readEpoch;++selectionEpoch;++searchEpoch;++classificationEpoch;clearTimeout(timer);clearTimeout(debounce)})
  return {genre,section,searching,activeSource,sourceJobs,classifications,classificationError,classificationReady,classificationBusy,genreDraft,genreDirty,classificationFor,genreCount,loadClassifications,saveClassification,importGenres,lastImported,openSource,returnToList,inspectedSource,readingBusy,sourceQuery,inspectSource,closeReading,preparingVideo,videoJobs,cancelVideoPreparation,includeAuxiliary,evidenceReading,sources,cards,jobs,query,kind,sourceId,total,next,selected,reading,preview,selection,video,capabilities,model,budget,url,targetBook,busy,loading,error,notice,composing,initialized,visibleSources,action,search,refresh,importFiles,commitImport,acquireVideo,reviewVideo,stopVideo,prepareVideo,extract,stop,resume,inspect,readMore,prepareSelection,commitSelection}
}
