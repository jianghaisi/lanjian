<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { X } from '@lucide/vue'
import type { ProjectSummary } from '../../../../contracts/index'
import { selectContinueProject } from '../composables/continue-project'
import LibraryArchiveHero from './LibraryArchiveHero.vue'
import InteractiveArchiveCharacter from '../../companion/components/InteractiveArchiveCharacter.vue'
import LibraryWorksGallery from './LibraryWorksGallery.vue'
import defaultBackgroundArtwork from '../../../assets/visuals/background-industrial-city.png'
import defaultSceneArtwork from '../../../assets/visuals/scene-satellite-city.png'
import { defaultLibraryCharacterPlacement, type LibraryCharacterPlacement } from '../composables/library-appearance'
import { useCompanionRuntime } from '../../companion/composables/use-companion-runtime'

const props = withDefaults(defineProps<{
  search?: string
  projects: ProjectSummary[]
  continueProjectId?: string | null
  loading: boolean
  loaded: boolean
  presented?: boolean
  recentlyTrashedProject: { title: string } | null
  backgroundArtwork?: string
  sceneArtwork?: string
  characterPlacement?: LibraryCharacterPlacement
}>(), { search: '', presented: true, backgroundArtwork: defaultBackgroundArtwork, sceneArtwork: defaultSceneArtwork, characterPlacement: () => ({ ...defaultLibraryCharacterPlacement }) })
useCompanionRuntime(computed(() => !props.loading))
const emit = defineEmits<{
  open: [project: ProjectSummary]
  'open-chapter': [project: ProjectSummary, chapterId: number]
  create: []
  'import-project': []
  forget: [project: ProjectSummary]
  trash: [project: ProjectSummary]
  'open-trash': []
  settings: []
  'dismiss-trash': []
}>()

const dialogueUnavailable = ref(false)
const allWorks = ref<HTMLElement>()
const overviewPanel = ref<HTMLElement>()
const allWorksExpanded = ref(false)
let viewRevision = 0
const now = ref(new Date())
let clockTimer = 0
const continueProject = computed(() => selectContinueProject(props.projects, props.continueProjectId))
const continueIntent = ref(false)
const clockTime = computed(() => new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(now.value))
const clockDate = computed(() => {
  const year = now.value.getFullYear()
  const month = String(now.value.getMonth() + 1).padStart(2, '0')
  const day = String(now.value.getDate()).padStart(2, '0')
  return `${year}.${month}.${day}`
})
const clockWeekday = computed(() => new Intl.DateTimeFormat('zh-CN', { weekday: 'long' }).format(now.value))
const clockIso = computed(() => now.value.toISOString())
const characterStyle = computed(() => ({
  '--character-scale': props.characterPlacement.scale,
  '--character-inline-offset': `${props.characterPlacement.inlineOffset}%`,
  '--character-block-offset': `${props.characterPlacement.blockOffset}%`
}))

async function showAllWorks() {
  if (allWorksExpanded.value) return
  const revision = ++viewRevision
  allWorksExpanded.value = true
  await nextTick()
  const section = allWorks.value
  if (!section?.isConnected || revision !== viewRevision || !allWorksExpanded.value) return
  section.querySelector<HTMLElement>('#all-works-title')?.focus({ preventScroll: true })
}
async function returnToOverview() {
  const revision = ++viewRevision
  const previousFocus = document.activeElement
  allWorksExpanded.value = false
  await nextTick()
  const overview = overviewPanel.value
  if (!overview?.isConnected || revision !== viewRevision) return
  // The button cannot receive focus while its ancestor is still clipped to zero.
  await Promise.allSettled(overview.getAnimations().map(animation => animation.finished))
  if (revision !== viewRevision || allWorksExpanded.value || !overview.isConnected || document.querySelector('dialog[open]')) return
  if (document.activeElement !== document.body && document.activeElement !== previousFocus && !overview.contains(document.activeElement)) return
  overview.querySelector<HTMLElement>('[data-testid="library-all-works"]')?.focus({ preventScroll: true })
}
function openChapter(project: ProjectSummary, chapterId: number) { emit('open-chapter', project, chapterId) }

function scheduleClock() {
  window.clearTimeout(clockTimer)
  const update = () => {
    now.value = new Date()
    clockTimer = window.setTimeout(update, 1_000 - (Date.now() % 1_000) + 20)
  }
  clockTimer = window.setTimeout(update, 1_000 - (Date.now() % 1_000) + 20)
}

onMounted(scheduleClock)
onBeforeUnmount(() => { viewRevision++; window.clearTimeout(clockTimer) })
</script>

<template>
  <div class="project-library" :class="{ 'is-presented': presented }" data-testid="project-library">
    <aside class="library-companion-stage" aria-label="作品库主题插画" :style="characterStyle">
      <img class="archive-companion-background" :src="backgroundArtwork" alt="" draggable="false">
      <div class="library-character-viewport">
        <InteractiveArchiveCharacter class="archive-companion-puppet" :style="characterStyle" :continue-work-id="continueProject?.id || null" :continue-intent="continueIntent && !allWorksExpanded" @unavailable="dialogueUnavailable = true" />
      </div>
      <div class="stage-manifesto"><p>记录<br>人类的想象<br>也守护<br>未完成的世界。</p><span>ARCHIVE<br>IDEAS<br>FOR A BRIGHTER<br>TOMORROW.</span><i /></div>
      <div class="stage-colophon"><span>FICTION IS ANOTHER<br>KIND OF TRUTH.</span><p>用文字，保存更多可能。</p></div>
    </aside>

    <main class="library-content" :class="{ 'works-expanded': allWorksExpanded }">
      <p v-if="dialogueUnavailable" class="library-feedback dialogue-unavailable" role="status">当前立绘覆盖了对话框的可用位置。<button type="button" class="library-button" @click="emit('settings')">调整立绘位置</button><button type="button" class="library-icon-button" aria-label="关闭提示" @click="dialogueUnavailable = false"><X :size="16" /></button></p>
      <header class="library-heading">
        <span class="heading-registration" aria-hidden="true" />
        <div class="heading-title"><span class="terminal-label">MY WORKS / 作品档案</span><h1>我的作品</h1></div>
        <p class="heading-motto">在文字的废墟上，<br>我们重建更大的真实。</p>
        <time class="heading-clock" :datetime="clockIso" :aria-label="`${clockDate} ${clockWeekday} ${clockTime}`">
          <span>{{ clockTime }}</span><small>{{ clockDate }}<b>{{ clockWeekday }}</b></small><i>LOCAL / ARCHIVE TIME</i>
        </time>
      </header>

      <div ref="overviewPanel" class="library-overview-panel" :aria-hidden="allWorksExpanded" :inert="allWorksExpanded || undefined">
        <div class="library-overview-panel-inner"><LibraryArchiveHero :project="continueProject" :project-count="projects.length" :loading="loading" @continue-intent="continueIntent = $event" @open="emit('open', $event)" @create="emit('create')" @all="showAllWorks" @trash="emit('open-trash')" @import-project="emit('import-project')" /></div>
      </div>

      <section v-if="recentlyTrashedProject" class="library-feedback" role="status" data-testid="project-trash-success">
        <span>《{{ recentlyTrashedProject.title }}》已移入系统回收站，可恢复</span>
        <button class="library-button secondary" type="button" @click="emit('open-trash')">打开回收站</button>
        <button class="library-icon-button" type="button" aria-label="关闭提示" @click="emit('dismiss-trash')"><X :size="16" /></button>
      </section>

      <p v-if="loading" class="library-empty-state" role="status">正在整理作品…</p>
      <div v-else ref="allWorks" class="all-works-anchor" :class="{ expanded: allWorksExpanded }"><LibraryWorksGallery :projects="projects" :search="search" :scene-artwork="sceneArtwork" :expanded="allWorksExpanded" @back="returnToOverview" @open="emit('open', $event)" @open-chapter="openChapter" @create="emit('create')" @forget="emit('forget', $event)" @trash="emit('trash', $event)" /></div>
    </main>

    <footer class="library-bottom-colophon"><span>岚笺　—　用文字，保存更多可能。</span><span>—　// FOR A MORE HUMAN TOMORROW.</span><span>LOCAL FICTION ARCHIVE</span></footer>
  </div>
</template>

<style scoped>
.is-presented .heading-title{animation:library-reveal .55s cubic-bezier(.2,.8,.2,1) both}
.is-presented .heading-motto,.is-presented .heading-clock{animation:library-reveal .55s .07s cubic-bezier(.2,.8,.2,1) both}
.is-presented :deep(.archive-quick-actions>button){animation:library-reveal .5s .08s cubic-bezier(.2,.8,.2,1) both}
.is-presented :deep(.archive-quick-actions>button:nth-child(2)){animation-delay:.12s}
.is-presented :deep(.archive-quick-actions>button:nth-child(3)){animation-delay:.16s}
.is-presented :deep(.archive-quick-actions>button:nth-child(4)){animation-delay:.2s}
.is-presented .all-works-anchor{animation:library-gallery-reveal .6s .16s ease both}
.is-presented .stage-manifesto,.is-presented .stage-colophon{animation:library-reveal .7s .1s cubic-bezier(.2,.8,.2,1) both}
@keyframes library-reveal{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
@keyframes library-gallery-reveal{from{opacity:0}to{opacity:1}}
@media(prefers-reduced-motion:reduce){.project-library *,.project-library :deep(*){animation:none!important;transition:none!important}}
.library-character-viewport{position:absolute;inset-block:0;inset-inline:0;overflow:visible;min-block-size:0}
.dialogue-unavailable{position:absolute;z-index:220;inset-block-start:0;inset-inline-end:1rem;max-inline-size:25rem}
</style>

<style scoped>
.project-library{--library-line:var(--line,#c7c9bf);--library-line-strong:var(--line-strong,#a7b2aa);--library-paper:var(--canvas,#f2efe8);--library-surface:var(--surface,#f7f5ef);--library-surface-muted:var(--surface-muted,#e4e6dc);--library-ink:var(--ink,#222922);--library-muted:var(--muted,#697367);--library-jade:var(--jade,#287a68);--library-orange:#eaa247;--library-art-filter:saturate(.72) contrast(.92) brightness(1.04);grid-column:1/-1;grid-row:1/-1;display:grid;grid-template:0 minmax(0,1fr) auto/minmax(0,29fr) minmax(0,71fr);block-size:100%;min-inline-size:0;min-block-size:0;overflow:clip;color:var(--library-ink);background:var(--library-paper);font:400 var(--archive-text-body,.875rem)/1.5 var(--sans);letter-spacing:0}
:global(:root[data-theme="moye"] .project-library){--library-art-filter:saturate(.62) contrast(1.04) brightness(.58)}
.terminal-label{color:var(--library-muted);font:.625rem/1.5 var(--sans);letter-spacing:.13em}

.library-icon-button{display:inline-grid;place-items:center;inline-size:2.25rem;block-size:2.25rem;padding:.375rem;border:0;border-radius:0;background:transparent;color:var(--library-muted);cursor:pointer}.library-icon-button:hover{background:var(--library-surface-muted);color:var(--library-ink)}
.library-companion-stage{grid-column:1;grid-row:2;position:relative;z-index:2;isolation:isolate;overflow:visible;min-inline-size:0;min-block-size:0;border-inline-end:1px solid var(--library-line);background:var(--library-surface-muted)}.archive-companion-background{position:absolute;z-index:-2;inset-block:0;inset-inline:0;inline-size:100%;block-size:100%;object-fit:cover;object-position:center;filter:var(--library-art-filter);transition:filter .3s ease}.archive-companion-puppet{position:absolute;z-index:0;inset-inline-start:-12%;inset-block-end:0;inline-size:132%;block-size:100%;pointer-events:none;transform:translate(var(--character-inline-offset,0%),var(--character-block-offset,0%)) scale(var(--character-scale,1));transition:transform .24s ease}.library-companion-stage:hover .archive-companion-puppet{transform:translate(var(--character-inline-offset,0%),var(--character-block-offset,0%)) scale(calc(var(--character-scale,1) * 1.004))}.library-companion-stage::before{content:'';position:absolute;z-index:-1;inset-block:0;inset-inline:0;pointer-events:none;background:linear-gradient(90deg,color-mix(in srgb,var(--library-surface) 12%,transparent),transparent 25%,transparent 82%,var(--library-paper))}.library-companion-stage::after{content:'';position:absolute;z-index:1;inset-block:0;inset-inline:0;pointer-events:none;background:linear-gradient(180deg,color-mix(in srgb,var(--library-surface) 9%,transparent),transparent 18%,transparent 88%,color-mix(in srgb,var(--library-ink) 8%,transparent))}
.stage-manifesto,.stage-colophon{position:absolute;z-index:1;inset-inline-start:clamp(1rem,1.5vw,1.5rem);color:var(--library-ink);text-shadow:0 .0625rem .3125rem var(--library-surface)}.stage-manifesto{inset-block-start:clamp(1.25rem,3vh,2.25rem)}.stage-manifesto p{margin:0 0 1rem;font:500 .875rem/1.6 var(--serif)}.stage-manifesto span,.stage-colophon>span{display:block;font:.5rem/1.45 var(--sans);letter-spacing:.1em}.stage-manifesto i{display:block;inline-size:.875rem;margin-block-start:.875rem;border-block-start:1px solid var(--library-ink)}.stage-colophon{inset-block-end:1.125rem}.stage-colophon p{display:none}
.library-content{grid-column:2;grid-row:2;position:relative;z-index:1;container:library-content/size;display:flex;flex-direction:column;min-inline-size:0;min-block-size:0;overflow:hidden;padding-block:clamp(.5rem,1.1vh,.875rem) .75rem;padding-inline:clamp(.875rem,1.3vw,1.75rem) clamp(1rem,1.5vw,2rem);background:linear-gradient(90deg,color-mix(in srgb,var(--library-muted) 10%,transparent) 1px,transparent 1px),linear-gradient(color-mix(in srgb,var(--library-muted) 10%,transparent) 1px,transparent 1px),var(--library-paper);background-size:clamp(4rem,8cqi,8rem) clamp(4rem,8cqi,8rem)}
.project-library .library-heading{position:relative;display:flex;flex:0 0 clamp(7.5rem,17cqb,9.5rem);flex-direction:row;align-items:center;justify-content:flex-start;gap:clamp(1rem,2.5cqi,2rem);max-inline-size:none;min-block-size:0;margin:0;padding:0;border:0;border-block-end:1px solid var(--library-line);text-align:start}.project-library .library-heading::after{content:'';position:absolute;inset-inline-end:clamp(12rem,19cqi,16rem);inset-block-end:-1px;inline-size:clamp(5.5rem,9cqi,8rem);block-size:.625rem;background:repeating-linear-gradient(130deg,var(--library-orange) 0 .4375rem,transparent .4375rem .875rem)}.project-library .library-heading h1{margin-block:.4375rem 0;white-space:nowrap;color:var(--library-ink);font:700 clamp(3rem,7.3cqi,5.25rem)/.98 var(--serif);letter-spacing:.01em}.project-library .library-heading .terminal-label{font-size:.5rem;letter-spacing:.2em}.heading-title{position:relative;padding-inline-start:1rem}.heading-title::before{content:'';position:absolute;inset-inline-start:0;inset-block:.15rem .1rem;inline-size:.1875rem;background:var(--library-ink)}.heading-motto{margin:0;white-space:nowrap;color:var(--library-muted);font:clamp(.75rem,1.45cqi,1rem)/1.65 var(--serif)}.heading-clock{display:grid;grid-template-columns:minmax(5.75rem,1fr) auto;grid-template-rows:1fr auto;align-self:flex-end;align-items:end;column-gap:clamp(.75rem,1.4cqi,1.25rem);min-inline-size:clamp(19rem,36cqi,29rem);min-block-size:clamp(5.75rem,11cqb,7rem);margin-inline-start:auto;padding-block:0 .7rem;padding-inline:.75rem .5rem;border-inline-start:1px solid color-mix(in srgb,var(--library-muted) 35%,transparent);color:var(--library-ink);font-style:normal;text-align:end}.heading-clock>span{grid-column:2;grid-row:1/3;align-self:end;font:700 clamp(3.5rem,7.2cqi,6rem)/.78 "Bahnschrift Condensed","DIN Condensed","Arial Narrow",sans-serif;font-stretch:condensed;font-variant-numeric:tabular-nums;letter-spacing:-.045em;opacity:.5}.heading-clock small{grid-column:1;grid-row:2;display:flex;align-items:center;justify-self:end;gap:.45rem;margin:0 0 .15rem;color:var(--library-muted);font:600 clamp(.48rem,.6cqi,.65rem)/1 var(--sans);font-variant-numeric:tabular-nums;letter-spacing:.06em}.heading-clock small b{padding-inline-start:.45rem;border-inline-start:1px solid var(--library-line-strong);color:var(--library-ink);font-weight:600}.heading-clock>i{grid-column:1;grid-row:1;align-self:end;justify-self:end;margin-block-end:.55rem;color:var(--library-muted);font:500 .38rem/1 var(--sans);letter-spacing:.16em}.heading-registration{position:absolute;z-index:1;inset-inline-start:50%;inset-block-end:-.4375rem;inline-size:.75rem;block-size:.75rem;border:1px solid color-mix(in srgb,var(--library-muted) 45%,transparent);border-radius:50%}.heading-registration::before,.heading-registration::after{content:'';position:absolute;background:color-mix(in srgb,var(--library-muted) 45%,transparent)}.heading-registration::before{inset-inline:-.3rem;inset-block-start:50%;block-size:1px}.heading-registration::after{inset-block:-.3rem;inset-inline-start:50%;inline-size:1px}
.library-feedback{display:flex;align-items:center;gap:.75rem;flex-wrap:wrap;margin-block:.5rem;padding-block:.625rem;padding-inline:.875rem;border:1px solid var(--library-line);background:var(--library-surface-muted);font-size:.75rem}.library-feedback>.library-icon-button{margin-inline-start:auto}.library-button{display:inline-flex;align-items:center;justify-content:center;gap:.5rem;min-block-size:2.25rem;padding-block:.5rem;padding-inline:.875rem;border:1px solid var(--library-line-strong);border-radius:0;background:var(--library-surface);color:var(--library-ink);font:600 .75rem/1.4 var(--sans);cursor:pointer}.library-empty-state{display:grid;flex:1;place-items:center;align-content:center;color:var(--library-muted);text-align:center}
.library-overview-panel{display:grid;flex:none;grid-template-rows:minmax(0,1fr);overflow:clip;opacity:1;transform:translateY(0);transform-origin:center top;transition:grid-template-rows .62s cubic-bezier(.22,.78,.18,1),opacity .28s ease,transform .62s cubic-bezier(.22,.78,.18,1),visibility 0s linear}
.library-overview-panel-inner{min-block-size:0;overflow:clip}
.library-content.works-expanded .library-overview-panel{grid-template-rows:minmax(0,0fr);opacity:0;transform:translateY(-2.25rem) scale(.985);visibility:hidden;pointer-events:none;transition:grid-template-rows .62s cubic-bezier(.22,.78,.18,1),opacity .24s ease,transform .62s cubic-bezier(.22,.78,.18,1),visibility 0s linear .62s}
.all-works-anchor{display:flex;flex:1;min-inline-size:0;min-block-size:0;transform-origin:center top}
.library-bottom-colophon{grid-column:1/-1;display:flex;justify-content:space-between;align-items:center;gap:1rem;min-block-size:2.5rem;padding-block:.5rem;padding-inline:1.5rem;border-block-start:1px solid var(--library-line);background:var(--library-surface);font:.75rem/1.5 var(--serif)}.library-bottom-colophon>span:not(:first-child){color:var(--library-muted);font:.5rem/1.5 var(--sans);letter-spacing:.1em}
button:focus-visible{outline:2px solid #c47e29;outline-offset:.1875rem}
@container library-content (max-width:45rem){.heading-motto{display:none}}
@container library-content (max-height:37rem){.project-library .library-heading{flex-basis:clamp(6rem,15cqb,7.5rem)}.project-library .library-heading h1{font-size:clamp(2.5rem,6cqi,4rem)}.heading-clock{min-block-size:5rem;padding-block-end:.4rem}.heading-clock>span{font-size:clamp(2.75rem,6.2cqi,4.5rem)}.heading-clock>i{display:none}}
@media(max-width:74rem){.stage-manifesto p{font-size:.75rem}}
@media(max-width:55rem){.library-bottom-colophon>span:last-child{display:none}}
@media(max-width:43.75rem){.project-library{grid-template-columns:minmax(0,1fr)}.library-companion-stage{display:none}.library-content{grid-column:1}.library-bottom-colophon>span:not(:first-child){display:none}}
</style>
