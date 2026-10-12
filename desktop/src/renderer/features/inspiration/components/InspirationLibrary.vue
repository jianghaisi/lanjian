<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import type { DesktopApi, ProjectSummary } from '../../../../contracts'
import type { InspirationSource } from '../../../../contracts/inspiration/types'
import { NOVEL_GENRES, novelGenreLabel } from '../../../../contracts/inspiration/genres'
import { useInspiration } from '../composables/use-inspiration'
import InspirationModelPicker from './InspirationModelPicker.vue'
import InspirationSourceReader from './InspirationSourceReader.vue'
import { sourceLink, videoTime as duration } from '../utils/source-link'
import StudioIcon from '../../../ui/StudioIcon.vue'
import DialogTransition from '../../../ui/DialogTransition.vue'
import '../assets/inspiration.css'
const props=defineProps<{api:DesktopApi;visible:boolean;book:ProjectSummary|null;projects:ProjectSummary[]}>()
const emit=defineEmits<{close:[];group:[];models:[]}>()
const fileInput=ref<HTMLInputElement|null>(null),importOpen=ref(false),videoOpen=ref(false)
const library=useInspiration(props)
const {inspectedSource,readingBusy,sourceQuery,inspectSource,closeReading,preparingVideo,videoJobs,cancelVideoPreparation,includeAuxiliary,evidenceReading,sources,cards,jobs,query,kind,sourceId,total,next,selected,reading,preview,selection,video,capabilities,model,budget,url,targetBook,busy,loading,error,notice,composing,initialized,visibleSources,search,refresh,importFiles,commitImport,acquireVideo,reviewVideo,stopVideo,prepareVideo,extract,stop,resume,inspect,readMore,prepareSelection,commitSelection}=library
const {genre,section,searching,activeSource,sourceJobs,classificationError,classificationReady,classificationBusy,genreDraft,genreDirty,classificationFor,genreCount,loadClassifications,saveClassification,importGenres,lastImported,openSource,returnToList}=library
const opener=ref<HTMLElement|null>(null),sourceFilter=ref<HTMLInputElement|null>(null)
function open(source:InspirationSource,event?:Event){opener.value=event?.currentTarget as HTMLElement|null;openSource(source)}
async function back(){returnToList();await nextTick();if(opener.value?.isConnected)opener.value.focus();else sourceFilter.value?.focus()}
function chooseKind(value:string){returnToList();kind.value=value;if(value==='video')genre.value=''}
const sourceLimit=ref(30),jobLimit=ref(12),videoLimit=ref(5)
watch([sourceQuery,genre,kind],()=>{sourceLimit.value=30})
watch(sourceId,()=>{jobLimit.value=12})
const jobLabels={running:'提取中',succeeded:'完整提取', 'paused-limit':'本批已完成',cancelled:'已停止',failed:'提取失败',interrupted:'等待继续','usage-unconfirmed':'调用待核对'}
function fileChange(event:Event){void importFiles((event.target as HTMLInputElement).files);(event.target as HTMLInputElement).value=''}
</script>
<template>
  <section class="inspiration-library" data-testid="inspiration-library" :inert="!visible" :aria-hidden="!visible" aria-label="私有知识库">
    <header class="inspiration-header">
      <div><small>留住故事，读懂来处</small><h1>知识库<span>{{ sources.length }} 份资料</span></h1></div>
      <div class="inspiration-header-actions"><button @click="importOpen=!importOpen"><StudioIcon name="folder" :size="16"/>导入小说</button><button @click="chooseKind('video');videoOpen=true"><StudioIcon name="spark" :size="16"/>从视频提取</button><button aria-label="返回创作" @click="emit('close')"><StudioIcon name="close" :size="18"/></button></div>
    </header>
    <input ref="fileInput" hidden type="file" multiple accept=".txt,.md,.docx" @change="fileChange">
    <div class="inspiration-body">
      <aside class="inspiration-sidebar">
        <h2>我的知识库</h2>
        <button :class="{selected:kind!=='video'&&!genre}" @click="chooseKind('novel');genre=''">小说<span>{{ sources.filter(s=>s.kind==='novel').length }}</span></button>
        <button :class="{selected:kind==='video'}" @click="chooseKind('video')">视频<span>{{ sources.filter(s=>s.kind==='video').length }}</span></button>
        <template v-if="kind!=='video'"><div class="inspiration-rule"/><h3>小说题材</h3><button v-for="item in NOVEL_GENRES" :key="item.id" :class="{selected:genre===item.id}" :disabled="!classificationReady" @click="returnToList();kind='novel';genre=item.id">{{ item.label }}<span>{{ classificationReady?genreCount(item.id):'—' }}</span></button></template>
        <p class="inspiration-private"><StudioIcon name="definition" :size="18"/>跨作品共用的参考资料。</p><button v-if="book" @click="emit('group')">回到本书群聊 →</button>
      </aside>
      <main class="inspiration-content">
        <p v-if="error" class="inspiration-feedback error" role="alert">{{ error }}<button :disabled="busy" @click="refresh">重新读取</button></p>
        <p v-if="classificationError" class="inspiration-feedback error" role="alert">分类暂不可用：{{ classificationError }}<button :disabled="classificationBusy" @click="loadClassifications">重新读取分类</button></p>
        <div v-if="notice" class="inspiration-feedback" role="status">{{ notice }}<button v-for="source in lastImported" :key="source.id" @click="open(source,$event)">查看《{{ source.title }}》</button></div>
        <section v-if="importOpen" class="inspiration-import"><div><h2>把一本小说收入知识库</h2><p>支持 TXT、Markdown、DOCX，保留完整原文。每批最多20份，共24MB；核对时逐本选择题材。</p></div><button :disabled="busy" @click="fileInput?.click()">选择文件</button></section>
        <section v-if="kind==='video'&&!activeSource" class="knowledge-video-management">
          <button v-if="!videoOpen" @click="videoOpen=true">添加视频来源</button>
          <section v-if="videoOpen" class="inspiration-video"><h2>从视频里整理故事</h2><p>支持 B站、分P和抖音链接，单次最长60分钟。先读取字幕或语音，再提取剧情。</p><form @submit.prevent="!composing&&acquireVideo()"><input v-model="url" type="url" aria-label="视频链接" placeholder="粘贴 B站或抖音的视频链接" @compositionstart="composing=true" @compositionend="composing=false"><button class="inspiration-primary" :disabled="busy||!url.trim()||videoJobs.some(v=>v.status==='running')">提取视频</button></form><p>{{ capabilities?.notice }}</p><button v-if="api.app.platform!=='browser'&&!capabilities?.asr" :disabled="busy" @click="prepareVideo">{{ busy?'准备中…':'下载并准备视频转写' }}</button><div v-if="video" role="status"><progress :value="video.progress" max="100"/><span>{{ video.notice }}</span><button v-if="video.status==='running'" :disabled="busy" @click="stopVideo()">停止视频提取</button></div><button v-if="preparingVideo" @click="cancelVideoPreparation">停止转写组件准备</button></section>
          <details v-if="videoJobs.length" class="knowledge-video-history"><summary>视频获取记录（{{ videoJobs.length }}）</summary><section class="inspiration-jobs" aria-label="已获取的视频来源"><article v-for="item in videoJobs.slice(0,videoLimit)" :key="item.id"><p>{{ item.preview?.sources[0]?.title||item.url }} · {{ item.notice }}</p><button v-if="item.status==='running'" :disabled="busy" @click="videoOpen=true;reviewVideo(item.id)">查看进度</button><button v-if="item.status==='running'" :disabled="busy" @click="stopVideo(item.id)">停止此视频</button><button v-if="item.status==='succeeded'||item.preview" :disabled="busy" @click="reviewVideo(item.id)">核对来源</button></article><button v-if="videoJobs.length>videoLimit" @click="videoLimit+=5">更多视频记录（剩余 {{ videoJobs.length-videoLimit }}）</button></section></details>
        </section>
        <div v-if="loading&&!initialized" class="inspiration-empty" role="status">正在读取知识库…</div>
        <template v-else-if="!activeSource">
          <div class="knowledge-shelf-heading"><div><small>{{ kind==='video'?'VIDEO SOURCES':'NOVEL COLLECTION' }}</small><h2>{{ kind==='video'?'视频资料':genre&&classificationReady?novelGenreLabel(genre):'参考小说' }}</h2></div><span>{{ visibleSources.length }} {{ kind==='video'?'份':'本' }}</span></div>
          <label class="inspiration-source-filter">查找资料<input ref="sourceFilter" v-model="sourceQuery" type="search" aria-label="按标题或作者查找来源" placeholder="输入书名、标题或作者"></label>
          <div v-if="!visibleSources.length && (sourceQuery.trim() || genre)" class="inspiration-empty"><h2>没有匹配的资料</h2><p>试试其他查找词或题材。</p><button type="button" @click="sourceQuery='';genre=''">清除筛选</button></div>
          <div v-else-if="!visibleSources.length" class="inspiration-empty"><div class="inspiration-bookmark" aria-hidden="true">藏</div><h2>{{ kind==='video'?'还没有视频资料':'还没有参考小说' }}</h2><p>{{ kind==='video'?'添加视频链接，核对字幕或转写内容后收入知识库。':'导入小说后，可以阅读原文、整理情节和查看提取记录。' }}</p><button v-if="kind==='video'" type="button" @click="videoOpen=true">从视频提取</button><button v-else type="button" @click="importOpen=true;fileInput?.click()">导入第一本小说</button></div>
          <section v-if="visibleSources.length" class="inspiration-source-shelf knowledge-shelf" aria-label="知识库资料书架">
            <article v-for="source in visibleSources.slice(0,sourceLimit)" :key="source.id"><button class="knowledge-book-card" :data-source-id="source.id" :aria-label="'查看《'+source.title+'》的资料'" @click="open(source,$event)">
              <div class="knowledge-book-cover" :data-genre="classificationFor(source.id)?.genreId"><StudioIcon :name="source.kind==='novel'?'definition':'spark'" :size="30"/><span>{{ source.kind==='novel'?(classificationReady?novelGenreLabel(classificationFor(source.id)?.genreId??'unclassified'):classificationError?'分类暂不可用':'分类读取中'):source.method==='subtitle'?'视频字幕':'视频语音' }}</span></div>
              <div class="knowledge-book-info"><h3>{{ source.title }}</h3><p v-if="source.author">{{ source.author }}</p><p>{{ source.totalCharacters.toLocaleString() }} 字符 · {{ source.segmentCount }} 个片段</p><small>{{ jobs.find(j=>j.sourceId===source.id)?jobLabels[jobs.find(j=>j.sourceId===source.id)!.status]:'原文已保存，尚未提取' }}</small><span class="knowledge-open-book">查看资料 <span aria-hidden="true">↗</span></span></div>
            </button></article>
          </section><button v-if="visibleSources.length>sourceLimit" @click="sourceLimit+=30">更多来源（剩余 {{ visibleSources.length-sourceLimit }}）</button>
        </template>
        <template v-else>
          <button class="knowledge-back" @click="back">← 返回知识库</button>
          <header class="knowledge-source-heading"><div><small>{{ activeSource.kind==='novel'?'参考小说':'视频资料' }}</small><h2>{{ activeSource.title }}</h2><p>{{ activeSource.author }}{{ activeSource.author?' · ':'' }}{{ activeSource.totalCharacters.toLocaleString() }} 字符 · {{ activeSource.segmentCount }} 个片段</p><small>{{ activeSource.notice }}</small></div><StudioIcon :name="activeSource.kind==='novel'?'definition':'spark'" :size="38"/></header>
          <form v-if="activeSource.kind==='novel'&&classificationReady" class="knowledge-classification" @submit.prevent="saveClassification"><label>小说题材<select v-model="genreDraft" aria-label="小说题材" :disabled="classificationBusy"><option v-for="item in NOVEL_GENRES" :key="item.id" :value="item.id">{{ item.label }}</option></select></label><button :disabled="classificationBusy||!genreDirty">{{ classificationBusy?'保存中…':'保存分类' }}</button><span>修改题材后，原文和已提取资料继续保留。</span></form>
          <p v-else-if="activeSource.kind==='novel'" role="status">{{ classificationError?'分类暂不可用，仍可阅读本书资料。':'正在读取小说分类…' }}</p>
          <div class="knowledge-source-tabs" role="group" aria-label="本书资料"><button :aria-pressed="section==='original'" @click="section='original'">原文</button><button :aria-pressed="section==='scene'" @click="section='scene'">情节片段</button><button :aria-pressed="section==='arc'" @click="section='arc'">故事汇总</button><button :aria-pressed="section==='jobs'" @click="section='jobs'">提取记录</button></div>
          <section v-if="section==='original'" class="knowledge-original" aria-label="本书完整原文"><InspirationSourceReader :reading="reading" :busy="readingBusy" @more="readMore"/><button v-if="!reading&&!readingBusy" @click="inspectSource(activeSource)">重新读取原文</button></section>
          <template v-else-if="section==='scene'||section==='arc'">
            <section class="inspiration-search"><label><StudioIcon name="search" :size="18"/><input v-model="query" type="search" aria-label="搜索本书资料" placeholder="在这本书里查找情节、人物选择…" @compositionstart="composing=true" @compositionend="composing=false"></label><span>{{ total }} {{ section==='arc'?'份汇总':'张情节卡' }}</span></section>
            <p v-if="searching&&!cards.length" role="status">正在读取本书资料…</p><p v-else-if="!cards.length" class="inspiration-no-cards">{{ query?'本书没有匹配的资料。':section==='arc'?'本书尚无故事汇总。可在提取记录中查看进度或开始提取。':'本书尚无情节片段。原文已保存，可在提取记录中开始提取。' }}</p>
            <section class="inspiration-card-grid" aria-label="本书提取资料"><button v-for="card in cards" :key="card.id" class="inspiration-card" :class="{selected:selected?.id===card.id,stale:card.stale}" @click="inspect(card)"><div><small>{{ card.kind==='arc'?'故事汇总':'情节片段' }}</small><span v-if="card.stale">来源已更新</span></div><h2>{{ card.title }}</h2><p>{{ card.narrative }}</p><footer><span v-for="tag in card.tags.slice(0,3)" :key="tag">{{ tag }}</span></footer></button></section><button v-if="next>=0" :disabled="busy||searching" @click="search(true)">更多{{ section==='arc'?'故事汇总':'情节片段' }}</button>
          </template>
          <template v-else>
            <section class="inspiration-extraction"><InspirationModelPicker v-model="model" :api="api" :visible="visible" :disabled="busy||!visible"/><label>每批调用预算<input v-model.number="budget" aria-label="每批调用预算" type="number" min="1" max="48"></label><label><input v-model="includeAuxiliary" type="checkbox">也提取目录／作者说明</label><small>逐片提取与汇总均计入预算；已完成内容会复用。</small><button v-if="api.app.platform!=='browser'" @click="emit('models')">模型设置</button><button class="inspiration-primary" :disabled="busy||!model||sourceJobs.some(j=>j.status==='running')" @click="extract(activeSource)">提取情节</button></section>
            <p v-if="!sourceJobs.length" class="inspiration-no-cards">本书还没有提取记录。选择模型后，可开始整理故事。</p>
            <section v-else class="inspiration-jobs" aria-label="本书提取作业"><article v-for="job in sourceJobs.slice(0,jobLimit)" :key="job.id"><div><strong>{{ jobLabels[job.status] }}</strong><p>{{ job.notice }}</p><small>{{ job.processed }}/{{ job.total }} 个片段 · 已调用 {{ job.calls }} 次 · {{ job.profile.model }}</small></div><progress :value="job.processed" :max="job.total"/><button v-if="job.status==='running'" :disabled="busy" @click="stop(job)">停止</button><button v-else-if="['paused-limit','cancelled','failed','interrupted'].includes(job.status)" :disabled="busy" @click="resume(job)">继续下一批</button></article><button v-if="sourceJobs.length>jobLimit" @click="jobLimit+=12">更多提取记录（剩余 {{ sourceJobs.length-jobLimit }}）</button></section>
          </template>
        </template>
      </main>
      <aside v-if="selected&&activeSource" class="inspiration-provenance" :aria-label="selected?'情节与出处':'完整来源'">
        <header><small>{{ selected?'沿着故事的来处':'完整来源 · 随时回读' }}</small><button :aria-label="selected?'关闭情节详情':'关闭来源阅读'" @click="closeReading">×</button></header>
        <h2>{{ selected?.title||inspectedSource?.title }}</h2>
        <template v-if="selected">
          <p class="inspiration-narrative">{{ selected.narrative }}</p>
          <dl><dt>冲突</dt><dd>{{ selected.conflict||'来源未明确' }}</dd><dt>人物选择</dt><dd>{{ selected.choice||'来源未明确' }}</dd><dt>结果与转折</dt><dd>{{ selected.outcome }} {{ selected.turn }}</dd><dt>伏笔</dt><dd>{{ selected.foreshadowing||'来源未明确' }}</dd></dl>
          <h3>原文依据</h3>
          <blockquote v-for="(e,index) in selected.evidence" :key="index">{{ e.quote }}
            <small>{{ evidenceReading?.segments.find(s=>s.id===e.segmentId)?.title||'实际来源片段' }}<span v-if="evidenceReading?.segments.find(s=>s.id===e.segmentId)?.startSeconds!=null"> · {{ duration(evidenceReading?.segments.find(s=>s.id===e.segmentId)?.startSeconds??null) }}—{{ duration(evidenceReading?.segments.find(s=>s.id===e.segmentId)?.endSeconds??null) }}</span></small>
            <a v-if="evidenceReading?.source.platform==='bilibili'&&evidenceReading.segments.some(s=>s.id===e.segmentId&&s.startSeconds!==null)&&sourceLink(evidenceReading.source,evidenceReading.segments.find(s=>s.id===e.segmentId)?.startSeconds)" :href="sourceLink(evidenceReading.source,evidenceReading.segments.find(s=>s.id===e.segmentId)?.startSeconds)" target="_blank" rel="noopener noreferrer">查看对应视频片段 ↗</a>
          </blockquote>
          <p v-if="selected.stale" role="status">来源已更新，这张旧版本卡不能取用。</p>
          <label>收入哪本书<select v-model="targetBook" aria-label="目标作品"><option value="">选择已有作品</option><option v-for="project in projects" :key="project.id" :value="project.id">{{ project.title }}</option></select></label>
          <button class="inspiration-primary" :disabled="busy||selected.stale||!targetBook" @click="prepareSelection">核对并收入素材</button>
          <details><summary>阅读完整来源</summary><InspirationSourceReader :reading="reading" :busy="readingBusy" @more="readMore"/><button v-if="!reading&&!readingBusy" @click="inspect(selected)">重新读取来源</button></details>
        </template>
        <template v-else><InspirationSourceReader :reading="reading" :busy="readingBusy" @more="readMore"/><button v-if="inspectedSource&&!reading&&!readingBusy" @click="inspectSource(inspectedSource)">重新读取来源</button></template>
      </aside>
    </div>
    <DialogTransition :reading-key="preview?.token||selection?.token" @escape="preview=null;selection=null"><div v-if="preview||selection" class="inspiration-dialog-backdrop"><section class="inspiration-dialog" role="dialog" aria-modal="true" :aria-label="selection?'核对灵感取用':'核对来源导入'"><header><h2>{{ selection?'把这一页灵感收入书中':'核对来源，留住完整故事' }}</h2><button aria-label="关闭核对窗口" :disabled="busy" @click="preview=null;selection=null">×</button></header><div data-dialog-reading><template v-if="selection"><p>目标作品：<strong>{{ selection.bookTitle }}</strong> · 素材库</p><pre>{{ selection.content }}</pre><p>作为可追溯的参考素材收入；在本书群聊里重新组织人物目标、世界规则和因果。</p></template><template v-else-if="preview"><article v-for="source in preview.sources" :key="source.id"><h3>{{ source.title }}</h3><label v-if="source.kind==='novel'&&preview.classifications" class="knowledge-import-genre">小说题材<select v-model="importGenres[source.id]" :aria-label="'《'+source.title+'》的题材'"><option v-for="item in NOVEL_GENRES" :key="item.id" :value="item.id">{{ item.label }}</option></select></label><p>{{ source.totalCharacters.toLocaleString() }} 字符 · {{ source.segmentCount }} 个片段 · {{ source.method==='novel'?'完整原文':source.method==='subtitle'?'真实字幕':'实际语音转写' }}</p><small>{{ source.notice }}</small><details><summary>核对原文开头</summary><pre>{{ preview.samples.find(sample=>sample.sourceId===source.id)?.text }}</pre></details></article><p v-for="(warning,index) in preview.warnings" :key="index">{{ warning }}</p></template></div><footer><button :disabled="busy" @click="preview=null;selection=null">暂不收入</button><button class="inspiration-primary" :disabled="busy" @click="selection?commitSelection():commitImport()">{{ busy?'保存中…':selection?'确认收入这本书':'确认收入知识库' }}</button></footer></section></div></DialogTransition>
  </section>
</template>
