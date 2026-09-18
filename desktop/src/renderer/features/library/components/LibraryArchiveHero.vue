<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { ArrowDownRight, ArrowRight, BookOpen, FolderOpen, Plus, Trash2 } from '@lucide/vue'
import type { ProjectSummary } from '../../../../contracts/index'
import LibraryBookCover from './LibraryBookCover.vue'

const props = defineProps<{ project?: ProjectSummary; projectCount: number; loading: boolean }>()
const emit = defineEmits<{ open: [project: ProjectSummary]; create: []; all: []; trash: []; 'import-project': []; 'continue-intent': [active:boolean] }>()
const previewingProject = ref(false)
let previewTimer: ReturnType<typeof setTimeout> | undefined
const wordCount = computed(() => {
  const count = props.project?.manuscript.wordCount
  return count === null || count === undefined || !Number.isFinite(count) ? '打开后查看' : `${count.toLocaleString('zh-CN')} 字`
})
const chapterCount = computed(() => `${props.project?.manuscript.chapterCount ?? 0} 章`)
const indexProgress = computed(() => props.project?.manuscript.status === 'ready' ? 100 : props.project?.manuscript.status === 'chapter-review' ? 66 : 33)
const indexState = computed(() => props.project?.manuscript.status === 'ready' ? '索引完整' : props.project?.manuscript.status === 'chapter-review' ? '章节待核对' : '身份待核对')
const modified = computed(() => {
  const value = props.project?.updated_at
  const date = new Date(value ?? '')
  return !value || Number.isNaN(date.getTime()) ? '暂无记录' : date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
})
function previewOpen() {
  if (!props.project || previewingProject.value) return
  previewingProject.value = true
  previewTimer = setTimeout(() => { previewingProject.value = false }, 650)
}
onBeforeUnmount(() => { if (previewTimer) clearTimeout(previewTimer) })
</script>

<template>
  <section class="archive-hero" aria-label="继续创作与作品操作">
    <button v-if="project" class="continue-dossier" :class="{ 'is-previewing': previewingProject }" type="button" data-testid="library-continue-writing" @pointerenter="previewOpen(); emit('continue-intent',true)" @pointerleave="emit('continue-intent',false)" @focus="previewOpen(); emit('continue-intent',true)" @blur="emit('continue-intent',false)" @click="emit('open', project)">
      <span class="dossier-texture dossier-aging" aria-hidden="true" />
      <span class="dossier-texture dossier-creases" aria-hidden="true" />
      <span class="dossier-dot-field" aria-hidden="true" />
      <span class="dossier-texture dossier-scratches" aria-hidden="true" />
      <span class="dossier-click-fx" aria-hidden="true" />
      <span class="dossier-tech-lines" aria-hidden="true"><i /><i /><i /><b /></span>
      <span v-for="corner in 4" :key="corner" :class="`dossier-bolt bolt-${corner}`" aria-hidden="true" />
      <span class="dossier-corner corner-start" aria-hidden="true" /><span class="dossier-corner corner-end" aria-hidden="true" />
      <i class="dossier-registration" aria-hidden="true" />
      <header><div><span class="dossier-kicker">// CONTINUE WRITING</span><strong>继续创作 <ArrowDownRight :size="25" /></strong></div><span class="dossier-side-note" aria-hidden="true">A DIFFERENT<br>WORLD AWAITS.</span><ArrowRight class="dossier-arrow" :size="24" /></header>
      <div class="dossier-book">
        <LibraryBookCover :title="project.title" />
        <div class="dossier-copy">
          <h2 :title="project.title">{{ project.title }}</h2>
          <p v-if="project.manuscript.lastEditedChapter" :title="project.manuscript.lastEditedChapter.title">第 {{ project.manuscript.lastEditedChapter.position }} 章 · {{ project.manuscript.lastEditedChapter.title }}</p>
          <p v-else :title="`${project.genre || '未分类'} · 已有 ${project.manuscript.chapterCount} 章正文`">{{ project.genre || '未分类' }} · 已有 {{ project.manuscript.chapterCount }} 章正文</p>
          <div class="dossier-data-row"><span><b>{{ wordCount }}</b><small>正文字数</small></span><span><b>{{ chapterCount }}</b><small>已写章节</small></span></div>
          <div class="dossier-progress"><div><span>LOCAL MANUSCRIPT INDEX · {{ indexState }}</span><b>{{ indexProgress }}%</b></div><i aria-hidden="true"><span :style="{ inlineSize: `${indexProgress}%` }" /></i></div>
          <footer><span>“ 故事仍在继续，而你，正创造它。 ”</span><span>LAST EDIT<br>{{ modified }}</span></footer>
        </div>
      </div>
    </button>
    <section v-else class="continue-dossier empty-dossier"><span class="dossier-kicker">// YOUR NEXT WORLD</span><h2>{{ loading ? '正在整理作品档案' : '每一个世界，始于一页。' }}</h2><p>{{ loading ? '读取本机作品索引…' : '创建一部新作品，或从已有文稿接续。' }}</p><BookOpen :size="44" :stroke-width="1" /></section>
    <nav class="archive-quick-actions" aria-label="作品管理">
      <button class="archive-action dark all-works-action" type="button" data-library-view="all" data-testid="library-all-works" @click="emit('all')"><BookOpen :size="24"/><span><strong>全部作品</strong><small>ALL WORKS</small></span><b>{{ projectCount.toString().padStart(2, '0') }}</b><ArrowRight :size="18"/></button>
      <button class="archive-action dark" type="button" data-testid="library-open-trash" @click="emit('trash')"><Trash2 :size="24"/><span><strong>回收站</strong><small>RECYCLE BIN</small></span><ArrowRight :size="18"/></button>
      <button class="archive-action light" type="button" data-testid="library-import-project" @click="emit('import-project')"><FolderOpen :size="24"/><span><strong>导入作品</strong><small>IMPORT</small></span><ArrowRight :size="18"/></button>
      <button class="archive-action orange" type="button" data-testid="create-work-item" @click="emit('create')"><Plus :size="27"/><span><strong>新建空白作品</strong><small>CREATE A BLANK WORK</small></span><ArrowRight :size="18"/></button>
    </nav>
  </section>
</template>

<style scoped>
.archive-hero{display:grid;grid-template-columns:minmax(0,1.82fr) minmax(0,1fr);gap:var(--archive-space-4,1rem);margin:.75rem 0 .625rem;min-inline-size:0;min-block-size:0}
.continue-dossier{position:relative;isolation:isolate;display:flex;flex-direction:column;inline-size:100%;min-inline-size:0;min-block-size:0;padding:clamp(.625rem,1.2cqi,1rem);text-align:start;color:#f5f3eb;background:#202824;border:1px solid #53615a;border-radius:0;box-shadow:inset 0 0 0 .3125rem #ffffff06;clip-path:polygon(0 0,96% 0,98% 4%,100% 4%,100% 93%,97% 100%,0 100%);cursor:pointer}
.continue-dossier:before{content:'';position:absolute;z-index:-1;inset:.4375rem;border:1px solid #ffffff18;pointer-events:none}
.continue-dossier:after{content:'';position:absolute;z-index:-2;inset:0;background-image:linear-gradient(#d9e1db0a 1px,transparent 1px),linear-gradient(90deg,#d9e1db0a 1px,transparent 1px);background-size:4rem 4rem;pointer-events:none}
.continue-dossier:hover{background:#2c3530}
.continue-dossier>header{display:flex;justify-content:space-between;align-items:center;gap:1rem;padding-block-end:.5rem;border-block-end:1px solid #d6d9d42e}
.dossier-kicker{display:block;font:.5625rem/1.4 var(--sans);letter-spacing:.15em;color:#edaa51}
.continue-dossier header strong{display:flex;align-items:center;gap:.75rem;margin-block-start:.2rem;font:600 clamp(1.5rem,3.2cqi,2rem)/1.15 var(--serif);color:#f5f3eb}
.continue-dossier header strong svg{inline-size:.8em;block-size:.8em}.dossier-side-note{margin-inline-start:auto;color:#c3cbc4;font:500 .4rem/1.3 var(--sans);letter-spacing:.12em}.dossier-arrow{color:#8ac0af;inline-size:1.375rem;block-size:1.375rem}
.dossier-book{display:flex;flex:1;align-items:stretch;gap:clamp(.75rem,2cqi,1.25rem);padding-block-start:.5rem;min-inline-size:0;min-block-size:0}
.dossier-book :deep(.library-book-cover){inline-size:clamp(4.5rem,10cqi,7.25rem);block-size:auto;min-block-size:0;aspect-ratio:auto;border-radius:0;box-shadow:none;border:1px solid #bac4bd55;padding:.75rem .5rem}
.dossier-book :deep(.library-book-cover>span){font-size:clamp(.875rem,1.5cqi,1rem)}
.dossier-copy{min-inline-size:0;display:flex;flex:1;flex-direction:column}
.dossier-copy h2{margin:.125rem 0 .25rem;color:#f6f4ec;font:600 clamp(1.25rem,2.55cqi,1.75rem)/1.25 var(--serif);overflow-wrap:anywhere}
.dossier-copy>p{margin:0;color:#c3c9c2;font:.8125rem/1.65 var(--sans)}
.dossier-stat{display:flex;align-items:center;flex-wrap:wrap;gap:.75rem;margin-block-start:auto;padding-block-start:.5rem}
.dossier-stat b{font:500 clamp(1.0625rem,2.5cqi,1.5rem)/1.4 var(--sans);color:#f6f4ec}
.dossier-stat>span{font:.75rem var(--sans);color:#b8cfc3}
.dossier-baseline{block-size:1px;background:#83928670;margin:.5rem 0}
.dossier-copy footer{display:flex;justify-content:space-between;align-items:end;gap:.75rem;font:.6875rem/1.6 var(--serif);color:#b7beb7}
.dossier-copy footer>span:last-child{font:.5rem/1.5 var(--sans);letter-spacing:.07em;white-space:nowrap}
.archive-quick-actions{display:grid;grid-template-rows:repeat(4,minmax(0,1fr));gap:.4rem;min-inline-size:0;min-block-size:0}
.archive-action{display:flex;align-items:center;gap:clamp(.5rem,1.15cqi,.875rem);inline-size:100%;block-size:100%;min-block-size:0;overflow:hidden;padding:.25rem clamp(.5rem,1.25cqi,.875rem);border:1px solid #9da39a;border-radius:0;text-align:start;cursor:pointer}
.archive-action>svg:first-child{flex:none;box-sizing:content-box;inline-size:1.25rem;block-size:1.25rem;padding:.375rem;border:1px solid #788c7966;background:#7c958a26}
.archive-action>svg:last-child{align-self:stretch;flex:none;box-sizing:content-box;inline-size:1rem;block-size:auto;margin-inline-start:.25rem;padding-inline-start:.625rem;border-inline-start:1px solid #788c7966}
.archive-action>span{display:grid;min-inline-size:0;gap:.05rem}
.archive-action strong{font:600 clamp(1rem,2.15cqi,1.35rem)/1.08 var(--serif);white-space:nowrap}
.archive-action small{font:.4375rem/1.2 var(--sans);letter-spacing:.15em;white-space:nowrap}
.archive-action.dark{background:#252d29;color:#f5f3eb;border-color:#4a5850;clip-path:polygon(3% 0,100% 0,100% 93%,97% 100%,0 100%,0 9%)}
.archive-action.dark small{color:#abb8b0}
.archive-action.dark>b{font:500 clamp(1.25rem,2.8cqi,1.875rem)/1 var(--sans);color:#bac4bc;margin-inline-start:auto}
.archive-action.dark:hover{background:#344039}
.archive-action.light{background:color-mix(in srgb,var(--library-surface,#f6f3eb) 92%,transparent);color:var(--library-ink,#242b26);border-color:var(--library-line-strong,#9da39a)}.archive-action.light:hover{background:var(--library-surface-muted,#e8e7dc)}
.archive-action.light>svg:first-child{border-color:transparent;background:transparent}
.archive-action.orange{background:#efa348;color:#202722;border-color:#d8933f;position:relative}
.archive-action.orange>svg:first-child{background:#28332b;color:#f6f2e8;border-color:#354b3e}
.archive-action.orange:after{content:'';position:absolute;inset-inline-end:0;inset-block-end:0;inline-size:2.375rem;block-size:.5rem;background:repeating-linear-gradient(130deg,#253029 0 .25rem,transparent .25rem .5rem)}
.archive-action.orange:hover{background:#ffb760}
.empty-dossier{cursor:default;display:flex;flex-direction:column;gap:1rem;justify-content:center;min-block-size:16rem}
.empty-dossier h2{color:#f5f3eb;margin:0;font:600 clamp(1.5rem,3cqi,1.875rem)/1.4 var(--serif)}
.empty-dossier p{color:#c4cec5;margin:0;font:.8125rem/1.7 var(--sans)}.empty-dossier>svg{color:#8bab9a}
button:focus-visible{outline:.1875rem solid #d78627;outline-offset:.25rem}.continue-dossier:focus-visible{clip-path:none;outline-offset:.125rem}
@container library-content (max-width:47rem){
  .archive-hero{grid-template-columns:minmax(0,1.9fr) minmax(0,1fr);gap:.75rem}
  .archive-action{gap:.5rem;padding:.625rem}.archive-action>svg:first-child{inline-size:1.125rem;block-size:1.125rem;padding:.375rem}
  .archive-action>svg:last-child{inline-size:.875rem;block-size:.875rem}
  .archive-action.dark>b{font-size:1.375rem}.archive-action strong{font-size:1.0625rem}
  .dossier-copy footer>span:first-child{display:none}
}
@container library-content (max-width:29rem){
  .archive-hero{grid-template-columns:minmax(0,1fr)}
  .archive-quick-actions{grid-template-columns:repeat(4,minmax(0,1fr));grid-template-rows:auto;gap:.5rem}
  .archive-action{min-block-size:3.75rem;gap:.375rem;padding:.5rem}
  .archive-action>svg:first-child{inline-size:1rem;block-size:1rem;padding:.1875rem}
  .archive-action>svg:last-child,.archive-action.dark>b{display:none}
  .archive-action strong{font-size:1rem}.archive-action small{font-size:.4375rem;letter-spacing:.05em}
  .dossier-book :deep(.library-book-cover){inline-size:5.625rem}
  .continue-dossier{clip-path:none}.dossier-copy h2{font-size:1.5rem}
}
@container library-content (max-width:29rem){.archive-quick-actions{grid-template-columns:repeat(2,minmax(0,1fr))}.dossier-copy h2{font-size:1.3125rem}.dossier-book{gap:.75rem}}
@container library-content (max-height:38rem){.archive-hero{margin-block:.625rem}.continue-dossier>header{padding-block-end:.375rem}.continue-dossier header strong{font-size:1.5rem}.dossier-copy h2{font-size:1.125rem;margin-block:0 .25rem}.dossier-copy>p{font-size:.6875rem}.dossier-stat{padding-block-start:.375rem;gap:.25rem}.dossier-stat b{font-size:1.0625rem}.dossier-baseline{margin-block:.375rem}.dossier-copy footer>span:first-child{display:none}.archive-action strong{font-size:1rem}.archive-action>svg:first-child{padding:.25rem;inline-size:1.125rem;block-size:1.125rem}.archive-action small{font-size:.4375rem}.archive-quick-actions{gap:.375rem}.archive-action{padding-block:.25rem}}
/* Reference dossier: tall editorial cover, two factual counters, index meter and a narrow action stack. */
/* The collapse wrapper is not a flex parent: size this grid explicitly, not via flex-basis. */
.archive-hero{block-size:clamp(19rem,38cqb,20rem);grid-template-rows:minmax(0,1fr);grid-template-columns:minmax(0,2.1fr) minmax(15rem,1fr);gap:.75rem;margin-block:.75rem .625rem}
.continue-dossier{padding:.5rem;clip-path:polygon(0 0,94.5% 0,96.5% 4.5%,99.2% 4.5%,100% 6%,100% 91%,97.5% 100%,2.5% 100%,0 95%);box-shadow:inset 0 0 1.5rem #06110c80}
.continue-dossier:before{inset:.55rem;border-color:#b6c7bd30;clip-path:polygon(0 0,96% 0,100% 7%,100% 88%,97% 100%,0 100%)}
.continue-dossier:after{background-image:linear-gradient(#d9e1db0a 1px,transparent 1px),linear-gradient(90deg,#d9e1db0a 1px,transparent 1px),radial-gradient(circle at 74% 64%,#93b8a30c,transparent 32%);background-size:3rem 3rem,3rem 3rem,100% 100%}
.continue-dossier>header{flex:0 0 27%;align-items:center;padding-block:.15rem .7rem;padding-inline:.75rem 1rem;border-block-end-color:#d6d9d43d}
.dossier-kicker{font-size:.625rem;font-weight:600;letter-spacing:.17em}.continue-dossier header strong{gap:.9rem;margin-block-start:.3rem;font-size:clamp(1.8rem,3.45cqi,2.5rem);line-height:1}.continue-dossier header strong:before{content:'';position:absolute;inset-inline-start:1rem;block-size:3.1rem;border-inline-start:.2rem solid #e9a13f}.continue-dossier header strong svg{margin-inline-start:.25rem}.dossier-side-note{font-size:.43rem;line-height:1.35;letter-spacing:.14em}.dossier-arrow{color:#61b092}
.dossier-book{gap:clamp(.9rem,2cqi,1.4rem);padding-block:.75rem .55rem;padding-inline:.75rem 1rem}
.dossier-book :deep(.library-book-cover){inline-size:auto;block-size:100%;min-block-size:0;aspect-ratio:.69;border-color:#c8d6ce55;border-radius:0;padding:clamp(.7rem,1.4cqi,1.1rem) .55rem;box-shadow:0 0 0 .2rem #08100c66,inset .2rem 0 #ffffff24}
.dossier-book :deep(.library-book-cover img){opacity:.58;mix-blend-mode:soft-light;object-position:right}.dossier-book :deep(.library-book-cover>span){display:block;color:#f5f2e9;font-size:clamp(.8rem,1.4cqi,1.05rem);max-block-size:8em}
.dossier-copy{justify-content:flex-start;min-block-size:0}.dossier-copy h2{flex:none;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;margin:.15rem 0 .2rem;font-size:clamp(1.45rem,2.8cqi,2.15rem);line-height:1.15}.dossier-copy>p{flex:none;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:clamp(.7rem,1.25cqi,.9rem);line-height:1.55}
.dossier-data-row{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));margin-block-start:auto;border-block-start:1px solid #b4c3ba35}.dossier-data-row>span{display:flex;align-items:baseline;gap:.35rem;padding-block:.55rem .3rem}.dossier-data-row>span+span{padding-inline-start:1rem;border-inline-start:1px solid #b4c3ba24}.dossier-data-row b{color:#f4f2e9;font:500 clamp(1rem,2.2cqi,1.5rem)/1.2 var(--sans)}.dossier-data-row small{color:#aebbb3;font:.55rem/1.3 var(--sans);letter-spacing:.08em}
.dossier-progress{display:grid;gap:.2rem}.dossier-progress>div{display:flex;align-items:end;justify-content:space-between;gap:.75rem}.dossier-progress>div>span{overflow:hidden;color:#93a098;font:.42rem/1.3 var(--sans);letter-spacing:.11em;text-overflow:ellipsis;white-space:nowrap}.dossier-progress>div>b{color:#f0eee7;font:600 .8rem/1 var(--sans)}.dossier-progress>i{display:block;block-size:.45rem;overflow:hidden;border-radius:.15rem;background:#66736d66}.dossier-progress>i>span{display:block;block-size:100%;background:linear-gradient(90deg,#397f68,#68b99a);box-shadow:0 0 .5rem #5bb39344}
.dossier-copy footer{margin-block-start:.45rem;padding-block-start:.35rem;border-block-start:1px solid #b4c3ba1f;font-size:.57rem}.dossier-copy footer>span:last-child{font-size:.43rem}.dossier-registration{position:absolute;z-index:2;inset-inline-start:.95rem;inset-block-end:.85rem;inline-size:.42rem;block-size:.42rem;border:1px solid #a6d8c1;border-radius:50%;box-shadow:0 0 .45rem #6ec5a4}
.archive-quick-actions{gap:.55rem}.archive-action{padding-inline:.7rem .65rem;border-color:#697a70}.archive-action>svg:first-child{inline-size:1.35rem;block-size:1.35rem;padding:.45rem}.archive-action>span{gap:.1rem}.archive-action strong{font-size:clamp(1.05rem,2.1cqi,1.55rem)}.archive-action small{font-size:.48rem}.archive-action.dark>b{font-size:clamp(1.5rem,3cqi,2.25rem)}.archive-action>svg:last-child{margin-inline-start:auto;padding-inline-start:.75rem}.archive-action.dark{background:linear-gradient(90deg,#26322d,#1e2824);clip-path:polygon(4% 0,100% 0,100% 91%,96% 100%,0 100%,0 10%)}.archive-action.orange{background:linear-gradient(90deg,#eea044,#f3aa4b)}
@container library-content (max-width:47rem){.archive-hero{grid-template-columns:minmax(0,1.55fr) minmax(13rem,1fr)}.dossier-book{padding-inline:.5rem .7rem}.dossier-book :deep(.library-book-cover){inline-size:5.75rem}.dossier-side-note{display:none}.dossier-data-row>span+span{padding-inline-start:.5rem}.dossier-data-row small{display:none}}
@container library-content (max-height:38rem){.archive-hero{block-size:15.5rem}.continue-dossier>header{flex-basis:25%}.dossier-book{padding-block:.45rem}.dossier-copy footer{margin-block-start:.25rem;padding-block-start:.2rem}.dossier-progress>div>span{display:none}.dossier-progress{gap:.1rem}.dossier-data-row>span{padding-block:.3rem}.dossier-book :deep(.library-book-cover){inline-size:5.25rem}.dossier-copy h2{font-size:1.15rem}.continue-dossier header strong{font-size:1.5rem}.continue-dossier header strong:before{block-size:2.35rem}.archive-action strong{font-size:1rem}}

/* Surface language and interaction timing adapted from the supplied dossier prototype. */
.continue-dossier{transform-origin:52% 52%;transition:transform .18s ease,filter .18s ease,background-color .18s ease,box-shadow .18s ease}
.continue-dossier:hover:not(.is-previewing){transform:translateY(-1px);filter:brightness(1.035);box-shadow:inset 0 0 1.5rem #06110c80,0 .35rem .9rem #0b130e22}
.continue-dossier>header,.dossier-book{position:relative;z-index:6}
.dossier-texture,.dossier-click-fx{position:absolute;inset:0;pointer-events:none}
.dossier-aging{z-index:2;opacity:.28;mix-blend-mode:screen;background-image:radial-gradient(circle at 13% 18%,#d9e4db22 0 .035rem,transparent .06rem),radial-gradient(circle at 72% 66%,#07100b99 0 .04rem,transparent .075rem),radial-gradient(circle at 39% 91%,#cbd8cf18 0 .025rem,transparent .055rem);background-size:2.7rem 2.15rem,3.5rem 2.8rem,1.9rem 2.45rem;background-position:.4rem .75rem,1.6rem .2rem,.1rem 1.2rem}
.dossier-creases{z-index:3;opacity:.44;mix-blend-mode:screen;background-image:linear-gradient(to bottom,transparent 24.4%,#a9bcb010 24.7%,#06100b50 25%,transparent 25.5%),linear-gradient(to bottom,transparent 61%,#bfd0c21c 61.35%,#050b0875 61.8%,transparent 62.3%),linear-gradient(to right,transparent 10.7%,#c8d8cd10 10.9%,#07100b47 11.15%,transparent 11.5%,transparent 48.5%,#c8d8cd0d 48.75%,#07100b4f 49%,transparent 49.3%,transparent 78.5%,#c8d8cd0c 78.7%,#07100b3d 79%,transparent 79.25%)}
.dossier-scratches{z-index:4;opacity:.17;mix-blend-mode:screen;background-image:repeating-linear-gradient(174deg,transparent 0 1.75rem,#d6e0d81c 1.77rem 1.8rem,transparent 1.83rem 3.9rem),linear-gradient(101deg,transparent 17%,#d7e0d714 17.1%,transparent 17.3%,transparent 82%,#d7e0d70f 82.15%,transparent 82.35%)}
.dossier-dot-field{position:absolute;z-index:4;inset-inline-end:5%;inset-block-start:17%;inline-size:30%;block-size:55%;opacity:.38;pointer-events:none;background-image:radial-gradient(circle,#91a99b52 0 .0375rem,transparent .045rem);background-size:.54rem .54rem;mask-image:radial-gradient(ellipse at center,#000 0,transparent 72%)}
.dossier-tech-lines{position:absolute;z-index:9;inset-inline-start:.55rem;inset-block-start:1.15rem;inline-size:1.65rem;block-size:5.5rem;pointer-events:none;color:#70af96}
.dossier-tech-lines:before{content:'';position:absolute;inset-inline-start:.17rem;inset-block-start:0;inline-size:1px;block-size:100%;background:linear-gradient(transparent,#64a98b7a 18%,#64a98b28 76%,transparent)}
.dossier-tech-lines i{position:absolute;inset-inline-start:0;inline-size:1.08rem;block-size:1px;background:linear-gradient(90deg,#77c2a5aa,transparent);box-shadow:0 0 .3rem #59ad8b55}
.dossier-tech-lines i:nth-child(1){inset-block-start:.35rem}.dossier-tech-lines i:nth-child(2){inset-block-start:1.25rem;inline-size:.7rem}.dossier-tech-lines i:nth-child(3){inset-block-start:2.1rem;inline-size:1.3rem}
.dossier-tech-lines b{position:absolute;inset-inline-start:0;inset-block-end:.35rem;inline-size:.36rem;block-size:.36rem;border:1px solid #9bd5bc;border-radius:50%;background:#274237;box-shadow:0 0 .45rem #67c09d}
.dossier-bolt{position:absolute;z-index:9;inline-size:.28rem;block-size:.28rem;border:1px solid #9ec1ae80;border-radius:50%;background:#7db39c55;box-shadow:0 0 .25rem #71c19f66;pointer-events:none}
.bolt-1{inset-inline-start:.55rem;inset-block-start:.55rem}.bolt-2{inset-inline-end:.72rem;inset-block-start:.58rem}.bolt-3{inset-inline-start:.6rem;inset-block-end:.55rem}.bolt-4{inset-inline-end:.82rem;inset-block-end:.64rem}
.dossier-corner{position:absolute;z-index:9;inset-block-end:.48rem;inline-size:1.5rem;block-size:.9rem;pointer-events:none}.corner-start{inset-inline-start:.5rem;border-inline-start:1px solid #8cc0a8aa;border-block-end:1px solid #8cc0a8aa}.corner-end{inset-inline-end:.68rem;border-inline-end:1px solid #8cc0a8aa;border-block-end:1px solid #8cc0a8aa}
.dossier-corner:after{content:'';position:absolute;inset-block-end:.16rem;inline-size:.35rem;block-size:1px;background:#9bceb7}.corner-start:after{inset-inline-start:.18rem}.corner-end:after{inset-inline-end:.18rem}
.dossier-click-fx{z-index:12;overflow:hidden;opacity:0;mix-blend-mode:screen}
.dossier-click-fx:before,.dossier-click-fx:after{content:'';position:absolute;pointer-events:none}
.dossier-click-fx:before{inset-block:-6%;inset-inline:-8%;background:linear-gradient(105deg,transparent 0 41%,#74e6bd42 48%,#ffffff6b 50%,#74e6bd2e 52%,transparent 59%),repeating-linear-gradient(0deg,transparent 0 .4375rem,#ffffff0e .4375rem .5rem);transform:translateX(-115%) skewX(-10deg)}
.dossier-click-fx:after{inset-block:1rem 1.125rem;inset-inline:1.125rem;border:1px solid transparent;clip-path:polygon(0 0,22% 0,24% .1875rem,100% .1875rem,100% 92%,97% 100%,4% 100%,0 96%)}
.continue-dossier.is-previewing{animation:dossier-hit .62s cubic-bezier(.2,.75,.15,1) both}
.continue-dossier.is-previewing .dossier-click-fx{opacity:1;animation:dossier-flash .62s ease-out both}
.continue-dossier.is-previewing .dossier-click-fx:before{animation:dossier-scan .62s cubic-bezier(.2,.8,.2,1) both}
.continue-dossier.is-previewing .dossier-click-fx:after{animation:dossier-lock .62s ease-out both}
.continue-dossier.is-previewing>header,.continue-dossier.is-previewing>.dossier-book{animation:dossier-content-glitch .62s steps(1,end) both}
.continue-dossier.is-previewing .dossier-copy h2,.continue-dossier.is-previewing header strong{text-shadow:1px 0 #5fe6b575,-1px 0 #ffffff1a,0 .1875rem .4375rem #00000059}
@keyframes dossier-hit{0%{transform:translateY(0) scale(1);filter:brightness(1)}12%{transform:translateY(1px) scale(.992) skewX(-.18deg);filter:brightness(.92) contrast(1.08)}24%{transform:translateY(-1px) scale(1.006) skewX(.12deg);filter:brightness(1.12) contrast(1.05)}42%{transform:translateY(0) scale(.998);filter:brightness(1.02)}100%{transform:translateY(0) scale(1);filter:brightness(1)}}
@keyframes dossier-scan{0%{transform:translateX(-115%) skewX(-10deg);opacity:0}12%{opacity:1}64%{opacity:.9}100%{transform:translateX(115%) skewX(-10deg);opacity:0}}
@keyframes dossier-lock{0%{border-color:#69d8ae00;box-shadow:0 0 0 #5bc49d00}18%{border-color:#7aecC294;box-shadow:inset 0 0 1.125rem #5bc49d1f,0 0 .75rem #5bc49d1f}70%{border-color:#7aecC233}100%{border-color:#7aecC200;box-shadow:none}}
@keyframes dossier-flash{0%{opacity:0}10%{opacity:1}72%{opacity:.72}100%{opacity:0}}
@keyframes dossier-content-glitch{0%,100%{transform:translate(0,0)}14%{transform:translate(-1px,0)}18%{transform:translate(1px,0)}22%{transform:translate(0,0)}34%{transform:translate(.6px,-.3px)}38%{transform:translate(0,0)}}
</style>
