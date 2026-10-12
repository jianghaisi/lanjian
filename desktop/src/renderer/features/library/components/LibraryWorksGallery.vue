<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onBeforeUpdate, onMounted, ref, watch } from 'vue'
import { ArrowRight, ArrowUpLeft, BookOpen, Grid2X2, List, MoreHorizontal, Trash2, X } from '@lucide/vue'
import type { ProjectSummary } from '../../../../contracts/index'
import LibraryBookCover from './LibraryBookCover.vue'
import { useGalleryMotion } from '../composables/use-gallery-motion'

type SortMode = 'recent' | 'title' | 'words'
type DisplayMode = 'grid' | 'list'

const props = withDefaults(defineProps<{ projects: ProjectSummary[]; search: string; sceneArtwork?: string; expanded?: boolean }>(), { expanded: false })
const emit = defineEmits<{
  back: []
  open: [project: ProjectSummary]
  'open-chapter': [project: ProjectSummary, chapterId: number]
  forget: [project: ProjectSummary]
  trash: [project: ProjectSummary]
  create: []
}>()

const sortMode = ref<SortMode>('recent')
const displayMode = ref<DisplayMode>('grid')
const menuPath = ref('')
const menuTrigger = ref<HTMLButtonElement[]>([])
const menuPosition = ref<Record<string, string>>({})
const gallery = ref<HTMLElement>()
const cardGeometry = new WeakMap<HTMLElement, { width: number; height: number; left: number; top: number }>()

// Capture the whole grid before the first leaving card is removed from flow.
onBeforeUpdate(() => {
  for (const card of gallery.value?.querySelectorAll<HTMLElement>('.work-card') ?? []) {
    cardGeometry.set(card, { width: card.offsetWidth, height: card.offsetHeight, left: card.offsetLeft, top: card.offsetTop })
  }
})

function leaveCard(element: Element) {
  const card = element as HTMLElement
  leaveSurface(card)
  const bounds = cardGeometry.get(card)
  if (!bounds) return
  card.style.width = `${bounds.width}px`
  card.style.height = `${bounds.height}px`
  card.style.left = `${bounds.left}px`
  card.style.top = `${bounds.top}px`
}

const visibleProjects = computed(() => {
  const query = props.search.trim().toLocaleLowerCase()
  const projects = props.projects.filter(project => `${project.title} ${project.genre}`.toLocaleLowerCase().includes(query))
  if (sortMode.value === 'title') return [...projects].sort((left, right) => left.title.localeCompare(right.title, 'zh-CN'))
  if (sortMode.value === 'words') return [...projects].sort((left, right) => (right.manuscript.wordCount ?? -1) - (left.manuscript.wordCount ?? -1))
  return projects
})
useGalleryMotion(gallery, () => [visibleProjects.value, displayMode.value])
// A teleported menu cannot follow a card that is filtering out or changing layout.
watch(() => [visibleProjects.value, displayMode.value], closeMenu)
function enterCard(element: Element) {
  const card = element as HTMLElement
  enterSurface(card)
  for (const property of ['width', 'height', 'left', 'top', 'transform']) card.style.removeProperty(property)
}

function closeMenu() { menuPath.value = '' }
function enterSurface(element: Element) {
  if (!(element instanceof HTMLElement)) return
  element.inert = false
  element.removeAttribute('aria-hidden')
}
function leaveSurface(element: Element) {
  if (!(element instanceof HTMLElement)) return
  element.inert = true
  element.setAttribute('aria-hidden', 'true')
}
function enterMenu(element: Element) {
  enterSurface(element)
  void nextTick(() => {
    if (element instanceof HTMLElement && element.isConnected && !element.inert && element.dataset.menuPath === menuPath.value) {
      element.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
    }
  })
}
function menuKey(event: KeyboardEvent) {
  if (event.isComposing || event.defaultPrevented || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  const panel = event.currentTarget as HTMLElement
  const buttons = [...panel.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
    : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
  event.preventDefault()
  buttons[next]?.focus()
}
function menuFocusOut(event: FocusEvent) {
  if (event.relatedTarget instanceof Node && !(event.currentTarget as HTMLElement).contains(event.relatedTarget)) closeMenu()
}
function dismissDetachedMenu(event: Event) {
  if (event.target instanceof Element && event.target.closest('.library-card-menu')) return
  closeMenu()
}
function toggleMenu(project: ProjectSummary, event: MouseEvent) {
  if (menuPath.value === project.path) return closeMenu()
  const trigger = event.currentTarget as HTMLButtonElement
  const rootSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
  const bounds = trigger.getBoundingClientRect()
  const above = window.innerHeight - bounds.bottom < rootSize * 10
  menuPosition.value = {
    '--menu-origin': above ? 'right bottom' : 'right top',
    insetInlineEnd: `${Math.max(rootSize * .5, window.innerWidth - bounds.right)}px`,
    ...(above
      ? { insetBlockEnd: `${window.innerHeight - bounds.top + rootSize * .25}px` }
      : { insetBlockStart: `${bounds.bottom + rootSize * .25}px` })
  }
  menuPath.value = project.path
}
function handleKey(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !menuPath.value || event.isComposing || event.defaultPrevented) return
  event.preventDefault()
  event.stopPropagation()
  const path = menuPath.value
  closeMenu()
  menuTrigger.value.find(button => button.dataset.menuPath === path)?.focus()
}
function openProject(project: ProjectSummary) {
  const chapter = project.manuscript.lastEditedChapter
  if (chapter) emit('open-chapter', project, chapter.id)
  else emit('open', project)
}
function latestChapter(project: ProjectSummary) {
  const chapter = project.manuscript.lastEditedChapter
  if (chapter) return `第 ${chapter.position} 章 · ${chapter.title}`
  if (project.manuscript.chapterCount) return `已有 ${project.manuscript.chapterCount} 章正文`
  return '尚未开始正文'
}
function cardAction(project: ProjectSummary) {
  const chapter = project.manuscript.lastEditedChapter
  return chapter ? `继续第 ${chapter.position} 章` : '进入作品'
}
function words(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(value) || value < 0 ? '打开后查看' : `${value.toLocaleString('zh-CN')} 字`
}
function updated(value?: string) {
  const date = new Date(value ?? '')
  return !value || Number.isNaN(date.getTime()) ? '暂无记录' : date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
}
function state(project: ProjectSummary) {
  if (!project.manuscript.chapterCount) return '等待动笔'
  return project.manuscript.status === 'ready' ? '写作中' : '需要核对'
}

onMounted(() => {
  document.addEventListener('keydown', handleKey)
  window.addEventListener('resize', closeMenu)
  window.addEventListener('scroll', dismissDetachedMenu, true)
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleKey)
  window.removeEventListener('resize', closeMenu)
  window.removeEventListener('scroll', dismissDetachedMenu, true)
})
</script>

<template>
  <section ref="gallery" class="all-works" aria-labelledby="all-works-title" @click="closeMenu">
    <header class="all-works-toolbar">
      <button v-if="expanded" class="all-works-back" type="button" data-testid="library-all-works-back" @click.stop="emit('back')"><ArrowUpLeft :size="17" /><span><small>RETURN</small>返回作品概览</span></button>
      <div class="all-works-title">
        <span class="section-rule" aria-hidden="true" />
        <div><span>PROJECT INDEX / 作品总览</span><h2 id="all-works-title" tabindex="-1">全部作品</h2></div>
        <b :key="visibleProjects.length" class="works-result-count" aria-live="polite" :aria-label="`${visibleProjects.length} 部作品`">{{ visibleProjects.length.toString().padStart(2, '0') }}</b>
      </div>
      <div class="all-works-controls">
        <span>共 {{ visibleProjects.length }} 部作品</span>
        <label>排序方式<select data-assistant-protected="library-without-assistant" v-model="sortMode" aria-label="作品排序"><option value="recent">最近编辑</option><option value="title">作品名称</option><option value="words">作品字数</option></select></label>
        <div class="display-switch" :data-mode="displayMode" role="group" aria-label="作品显示方式">
          <span class="display-switch-rail" aria-hidden="true"></span>
          <button type="button" :class="{ selected: displayMode === 'grid' }" :aria-pressed="displayMode === 'grid'" aria-label="网格显示" @click.stop="displayMode = 'grid'"><Grid2X2 :size="16" /></button>
          <button type="button" :class="{ selected: displayMode === 'list' }" :aria-pressed="displayMode === 'list'" aria-label="列表显示" @click.stop="displayMode = 'list'"><List :size="16" /></button>
        </div>
      </div>
    </header>

    <div class="all-works-body">
      <img v-if="sceneArtwork" class="works-watermark" :src="sceneArtwork" alt="" draggable="false">
      <span class="surface-coordinates" aria-hidden="true">N37.2304° E112.5487°　/　ARCHIVE SECTOR 03</span>
      <div class="all-works-surface" :class="`display-${displayMode}`">
      <span class="registration-mark mark-start" aria-hidden="true" />
      <span class="registration-mark mark-top-end" aria-hidden="true" />
      <span class="registration-mark mark-bottom-start" aria-hidden="true" />
      <span class="registration-mark mark-end" aria-hidden="true" />
      <TransitionGroup tag="ul" name="archive-list" class="works-grid" @before-enter="enterCard" @before-leave="leaveCard">
        <li v-for="(project, index) in visibleProjects" :key="project.path" class="work-card" :class="{ 'menu-open': menuPath === project.path }" :data-project-path="project.path" :data-project-title="project.title">
          <button class="work-card-main work-item-open" type="button" :data-library-open-path="project.path" :data-library-open-title="project.title" :aria-label="`${cardAction(project)}：${project.title}`" @click="openProject(project)">
            <LibraryBookCover :title="project.title" />
            <span class="work-card-copy">
              <span class="work-card-index">LJ / {{ (index + 1).toString().padStart(2, '0') }}</span>
              <strong>{{ project.title }}</strong>
              <span class="work-card-tags"><i>{{ project.genre || '未分类' }}</i><i>{{ state(project) }}</i></span>
              <span class="work-card-meta"><span><b>{{ project.manuscript.chapterCount }}</b> 章</span><span>{{ words(project.manuscript.wordCount) }}</span></span>
              <span class="work-card-chapter" :title="latestChapter(project)">最新：{{ latestChapter(project) }}</span>
              <span class="work-card-action">{{ cardAction(project) }} <ArrowRight :size="15" /></span>
            </span>
          </button>
          <button ref="menuTrigger" class="work-card-menu-trigger" :data-menu-path="project.path" type="button" :aria-label="`管理作品《${project.title}》`" :aria-expanded="menuPath === project.path" @click.stop="toggleMenu(project, $event)"><MoreHorizontal :size="18" /></button>
          <footer>
            <time :datetime="project.manuscript.lastEditedChapter?.updatedAt || project.updated_at">{{ updated(project.manuscript.lastEditedChapter?.updatedAt || project.updated_at) }}</time>
            <span aria-hidden="true">LOCAL / {{ (index + 1).toString().padStart(2, '0') }}</span>
            <Teleport to="body">
              <Transition name="gallery-menu" @before-enter="enterMenu" @before-leave="leaveSurface">
              <div v-if="menuPath === project.path" class="library-popup library-card-menu" :data-menu-path="project.path" role="dialog" :aria-label="`管理作品《${project.title}》`" :style="menuPosition" @click.stop @keydown="menuKey" @focusout="menuFocusOut">
                <button type="button" @click="emit('forget', project); closeMenu()"><X :size="16" /><span>从书架移除<small>保留磁盘中的全部文件</small></span></button>
                <button class="danger" type="button" data-testid="trash-work-item" @click="emit('trash', project); closeMenu()"><Trash2 :size="16" /><span>移入系统回收站<small>整部作品，可恢复</small></span></button>
              </div>
              </Transition>
            </Teleport>
          </footer>
        </li>
      </TransitionGroup>
      <Transition name="gallery-empty" @before-enter="enterSurface" @before-leave="leaveSurface">
      <div v-if="!visibleProjects.length" :key="search.trim() ? 'filtered' : 'empty'" class="works-empty-state" role="status">
        <BookOpen :size="34" :stroke-width="1.25" />
        <h3>{{ search.trim() ? '没有找到匹配的作品' : '还没有作品' }}</h3>
        <p>{{ search.trim() ? '可以换一个书名或类型关键词。' : '创建第一部作品，开始记录一个新世界。' }}</p>
        <button v-if="!search.trim()" type="button" @click="emit('create')">新建作品 <ArrowRight :size="16" /></button>
      </div>
      </Transition>
      </div>
    </div>
  </section>
</template>

<style scoped>
.works-grid{position:relative}
.work-card{transform-origin:top left}
.archive-list-move{transition:none!important}
.archive-list-enter-active{transition:opacity .24s ease!important}
.archive-list-leave-active{position:absolute!important;pointer-events:none;transition:opacity .16s ease!important}
.archive-list-enter-from,.archive-list-leave-to{opacity:0}
.library-card-menu{transform-origin:var(--menu-origin, right top)}
.gallery-menu-enter-active{transition:opacity 180ms ease,transform 180ms cubic-bezier(.2,.8,.2,1)}
.gallery-menu-leave-active{transition:opacity 120ms ease,transform 120ms ease;pointer-events:none}
.gallery-menu-enter-from,.gallery-menu-leave-to{opacity:0;transform:scale(.975)}
.gallery-empty-enter-active{transition:opacity 220ms ease,translate 220ms cubic-bezier(.2,.8,.2,1)}
.gallery-empty-leave-active{position:absolute;inset-inline:0;inset-block-start:0;transition:opacity 120ms ease;pointer-events:none}
.gallery-empty-enter-from{opacity:0;translate:0 8px}
.gallery-empty-leave-to{opacity:0}
.works-result-count{animation:gallery-count-in 180ms ease-out}
@keyframes gallery-count-in{from{opacity:.25;translate:0 3px}to{opacity:1;translate:0 0}}
@media(prefers-reduced-motion:reduce){
  .library-card-menu,.works-empty-state,.gallery-menu-enter-active,.gallery-menu-leave-active,.gallery-empty-enter-active,.gallery-empty-leave-active{transition:none!important}
  .gallery-menu-enter-from,.gallery-menu-leave-to{transform:none}
  .gallery-empty-enter-from{translate:none}
  .works-result-count{animation:none}
  .work-card,.work-card::after{transition:none!important}
  .work-card:hover{translate:none!important}
  .display-switch-rail,.display-switch button svg{transition:none!important}
  .display-switch button:active svg{scale:none!important}
}
@media(prefers-reduced-motion:reduce){.archive-list-enter-active,.archive-list-leave-active{transition:none!important}}
.all-works{display:flex;flex:1;flex-direction:column;min-inline-size:0;min-block-size:0;border-block-start:1px solid var(--library-line,#c7c9bf)}
.all-works-toolbar{position:relative;z-index:4;display:flex;flex:none;align-items:center;justify-content:space-between;gap:1rem;min-block-size:3.5rem;padding-block:.5rem;border-block-end:1px solid var(--library-line,#c7c9bf);background:var(--library-paper,#f2efe8)}
.all-works-back{position:relative;display:flex;align-items:center;gap:.5rem;align-self:stretch;min-inline-size:8.75rem;padding-block:.3rem;padding-inline:.75rem;border:1px solid color-mix(in srgb,var(--library-jade) 55%,var(--library-line));background:color-mix(in srgb,var(--library-jade) 32%,#17211e);color:#f4f1e9;clip-path:polygon(.5rem 0,100% 0,100% calc(100% - .5rem),calc(100% - .5rem) 100%,0 100%,0 .5rem);cursor:pointer;animation:all-works-back-in .36s .2s ease-out both}.all-works-back::after{content:'';position:absolute;inset-inline-end:.35rem;inset-block-end:.25rem;inline-size:1.75rem;block-size:.2rem;background:repeating-linear-gradient(130deg,var(--library-orange,#efa348) 0 .2rem,transparent .2rem .4rem)}.all-works-back>span{display:grid;text-align:start;font:600 .75rem/1.2 var(--serif)}.all-works-back small{color:#c2cec6;font:.4rem/1.3 var(--sans);letter-spacing:.16em}.all-works-back:hover{background:color-mix(in srgb,var(--library-jade) 46%,#17211e)}.all-works-back:focus-visible{outline:2px solid var(--library-orange,#c47e29);outline-offset:.1875rem}
.all-works-title{display:flex;align-items:center;gap:.625rem;min-inline-size:0}.section-rule{inline-size:.1875rem;block-size:2rem;background:var(--library-orange,#d79035)}.all-works-title>div{display:grid;gap:.125rem}.all-works-title span{color:var(--library-muted,#697367);font:.5rem/1.35 var(--sans);letter-spacing:.12em}.all-works-title h2{margin:0;color:var(--library-ink,#222922);font:600 1.125rem/1.25 var(--serif)}.all-works-title h2:focus-visible{outline:2px solid var(--library-orange,#c47e29);outline-offset:.1875rem}.all-works-title>b{align-self:flex-end;color:var(--library-muted,#9aa198);font:500 .6875rem/1 var(--sans)}
.all-works-controls{display:flex;align-items:center;gap:.75rem;color:var(--library-muted,#697367);font:.625rem/1.4 var(--sans)}.all-works-controls>span{white-space:nowrap}.all-works-controls label{display:flex;align-items:center;gap:.375rem;white-space:nowrap}.all-works-controls select{min-block-size:2rem;padding-block:.25rem;padding-inline:.5rem 1.75rem;border:0;border-block-end:1px solid var(--library-line-strong,#aeb5aa);border-radius:0;background-color:transparent;color:var(--library-ink,#2b332d);font:.6875rem var(--sans)}
.display-switch{position:relative;isolation:isolate;display:grid;grid-template-columns:repeat(2,2rem);flex:none;border:1px solid var(--library-line,#bdc2b9);background:var(--library-surface,#f8f6ef)}
.display-switch-rail{position:absolute;z-index:0;inset-block:0;inset-inline-start:0;inline-size:50%;pointer-events:none;background:color-mix(in srgb,var(--library-jade,#33493f) 68%,#17211e);translate:0 0;transition:translate 260ms cubic-bezier(.2,.8,.2,1)}
.display-switch[data-mode=list] .display-switch-rail{translate:100% 0}
.display-switch:dir(rtl)[data-mode=list] .display-switch-rail{translate:-100% 0}
.display-switch button{position:relative;z-index:1;display:grid;place-items:center;inline-size:2rem;block-size:2rem;padding:0;border:0;border-inline-end:1px solid var(--library-line,#bdc2b9);background:transparent;color:var(--library-muted,#747d74);cursor:pointer}
.display-switch button:last-child{border-inline-end:0}.display-switch button.selected{color:#f4f2e9}
.display-switch button svg{transition:scale 120ms ease}.display-switch button:active svg{scale:.86}
.all-works-body{position:relative;isolation:isolate;flex:1;min-block-size:0;overflow:hidden}
.all-works-surface{position:relative;z-index:2;block-size:100%;min-inline-size:0;min-block-size:0;overflow:auto;padding-block:clamp(.625rem,1.2cqb,.875rem) 1.75rem;padding-inline:0;background:transparent;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:transparent transparent}.all-works-surface:hover,.all-works-surface:focus-within{scrollbar-color:#879087 transparent}
.all-works-surface::before{content:'';position:absolute;z-index:0;inset-block:0;inset-inline:0;background-image:linear-gradient(#78857a18 1px,transparent 1px),linear-gradient(90deg,#78857a18 1px,transparent 1px),linear-gradient(#78857a0b 1px,transparent 1px),linear-gradient(90deg,#78857a0b 1px,transparent 1px);background-size:8rem 8rem,8rem 8rem,2rem 2rem,2rem 2rem;pointer-events:none}
.all-works-surface::after{content:'';position:absolute;z-index:1;inset-inline-end:.75rem;inset-block-start:.5rem;inline-size:4.5rem;block-size:.4375rem;background:repeating-linear-gradient(130deg,#db9139 0 .32rem,transparent .32rem .64rem);opacity:.9;pointer-events:none}
.works-watermark{position:absolute;z-index:1;inset-inline-end:0;inset-block-end:0;inline-size:clamp(21rem,49cqi,40rem);block-size:min(100%,25rem);object-fit:contain;object-position:100% 100%;opacity:.19;filter:grayscale(1) contrast(.92);mix-blend-mode:multiply;pointer-events:none;user-select:none}
:global(:root[data-theme="moye"] .works-watermark){opacity:.14;filter:grayscale(1) brightness(.8) contrast(1.15);mix-blend-mode:screen}
.surface-coordinates{position:absolute;z-index:2;inset-inline-end:.75rem;inset-block-end:.375rem;color:var(--library-muted,#687269);font:500 .4rem/1 var(--sans);letter-spacing:.12em;pointer-events:none}
.registration-mark{position:absolute;z-index:2;inline-size:.75rem;block-size:.75rem;border:1px solid #7e897e80;border-radius:50%;pointer-events:none}.registration-mark::before,.registration-mark::after{content:'';position:absolute;background:#7e897e80}.registration-mark::before{inset-inline:-.3rem;inset-block-start:50%;block-size:1px}.registration-mark::after{inset-block:-.3rem;inset-inline-start:50%;inline-size:1px}.mark-start{inset-inline-start:.25rem;inset-block-start:.25rem}.mark-top-end{inset-inline-end:33.333%;inset-block-start:.25rem}.mark-bottom-start{inset-inline-start:33.333%;inset-block-end:.25rem}.mark-end{inset-inline-end:.25rem;inset-block-end:.25rem}
.works-grid{position:relative;z-index:3;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));align-content:start;gap:.625rem;min-inline-size:0;margin:0;padding:0;background:transparent;list-style:none}
.work-card{position:relative;display:grid;grid-template-rows:minmax(0,1fr) 1.75rem;min-inline-size:0;min-block-size:9.25rem;overflow:visible;border:1px solid var(--library-line-strong,#aeb6ad);background:transparent;clip-path:polygon(0 0,calc(100% - .7rem) 0,100% .7rem,100% 100%,0 100%);transition:border-color 150ms ease,background 150ms ease,translate 150ms ease}.work-card::before{content:'ARCHIVE / PROJECT';position:absolute;inset-inline-end:1.75rem;inset-block-start:.2rem;color:var(--library-muted,#7d857d);font:500 .34rem/1 var(--sans);letter-spacing:.12em}.work-card::after{content:'';position:absolute;inset-inline-start:0;inset-block-start:0;inline-size:2.75rem;block-size:.1875rem;background:var(--library-orange,#d79035);transform-origin:inline-start;transition:inline-size 150ms ease}.work-card:hover,.work-card:focus-within{border-color:var(--library-jade,#6e7c71);background:color-mix(in srgb,var(--library-surface,#faf9f3) 18%,transparent)}/* Hover lift composes with the transform owned by keyed layout motion. */
.work-card:hover{translate:0 -.125rem}.work-card:hover::after,.work-card:focus-within::after{inline-size:5rem}.work-card.menu-open{z-index:6}
/* Keep the legacy open-work hook for navigation without inheriting its button skin. */
.work-card>.work-card-main{display:flex;gap:.75rem;min-inline-size:0;margin:0;padding-block:.5rem .25rem;padding-inline:.75rem 2rem;border:0;border-radius:0;background:transparent;color:var(--library-ink,#1c241f);text-align:start;transform:none;cursor:pointer}.work-card-main :deep(.library-book-cover){flex:none;inline-size:clamp(4.25rem,6.5cqi,5.25rem);block-size:6.75rem;aspect-ratio:auto;border:1px solid color-mix(in srgb,var(--library-line-strong,#909c91) 55%,transparent);border-radius:0;padding:.625rem .375rem;box-shadow:inset .1875rem 0 #ffffff24}.work-card-main :deep(.library-book-cover>span){color:#f5f2e9;font-size:clamp(.6875rem,.95cqi,.8125rem);max-block-size:7em}
.work-card-copy{display:flex;flex:1;flex-direction:column;min-inline-size:0}.work-card-index{color:var(--library-muted,#6e786f);font:500 .4375rem/1.3 var(--sans);letter-spacing:.16em}.work-card-copy>strong{margin-block:.25rem .1875rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--library-ink,#172019);font:600 clamp(1rem,1.35cqi,1.25rem)/1.25 var(--serif);letter-spacing:.01em}.work-card-tags{display:flex;gap:.3125rem;flex-wrap:wrap}.work-card-tags i,.work-card:hover .work-card-tags i,.work-card-main:hover .work-card-tags i,.work-card-main:focus-visible .work-card-tags i{padding-block:.1rem;padding-inline:.3125rem;border:1px solid color-mix(in srgb,var(--library-jade,#536057) 38%,var(--library-line));background:color-mix(in srgb,var(--library-jade,#536057) 10%,var(--library-surface));color:var(--library-ink,#273129)!important;font:normal .475rem/1.35 var(--sans)}.work-card-meta{display:flex;gap:.5rem;margin-block:.42rem 0;color:var(--library-muted,#616c63);font:.5625rem/1.35 var(--sans)}.work-card-meta>span+span{padding-inline-start:.5rem;border-inline-start:1px solid var(--library-line-strong,#adb5ac)}.work-card-meta b{color:var(--library-ink,#1f2923);font-weight:650}.work-card-chapter{margin-block:.2rem 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--library-muted,#58645b);font:.55rem/1.4 var(--sans)}.work-card-action{display:flex;align-items:center;align-self:flex-end;gap:.25rem;margin-block-start:auto;color:var(--library-jade,#216b58);font:600 .5875rem/1.3 var(--sans)}
.work-card>footer{display:flex;align-items:center;justify-content:space-between;gap:.5rem;min-block-size:1.75rem;padding-block:.25rem;padding-inline:.75rem;border-block-start:1px solid var(--library-line-strong,#adb5ac);color:var(--library-muted,#69736b);font:.4375rem/1.25 var(--sans);letter-spacing:.05em}.work-card>footer time{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.work-card>footer>span{color:var(--library-muted,#8a918a);letter-spacing:.12em}.work-card-menu-trigger{position:absolute;z-index:4;inset-inline-end:.15rem;inset-block-start:.35rem;display:grid;place-items:center;inline-size:1.75rem;block-size:1.75rem;padding:0;border:0;background:transparent;color:var(--library-ink,#39483f);cursor:pointer}.work-card-menu-trigger:hover,.work-card-menu-trigger[aria-expanded=true]{background:var(--library-surface-muted,#e4e6dc);color:var(--library-ink,#1d2921)}
.library-popup{position:fixed;inset:auto;z-index:160;inline-size:max-content;max-inline-size:min(20rem,80vw);max-block-size:calc(100dvb - 1rem);overflow:auto;padding:.375rem;border:1px solid var(--line,#c7c9bf);background:var(--surface,#faf9f5);color:var(--ink,#222922);box-shadow:0 .5rem 1.5rem #0004}.library-popup button{display:flex;align-items:center;gap:.625rem;inline-size:100%;padding-block:.625rem;padding-inline:.75rem;border:0;background:transparent;text-align:start;color:var(--ink,#222922);font:.8125rem/1.4 var(--sans);cursor:pointer}.library-popup button:hover{background:var(--surface-muted,#e8e9df)}.library-popup small{display:block;color:var(--muted,#697367);font-size:.6875rem}.library-popup .danger{color:var(--danger,#b4473e)}
.display-list .works-grid{grid-template-columns:minmax(0,1fr);gap:.5rem}.display-list .work-card{min-block-size:7.25rem}.display-list .work-card-main{align-items:center}.display-list .work-card-main :deep(.library-book-cover){inline-size:3.5rem;block-size:5rem;padding:.5rem .25rem}.display-list .work-card-copy{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr) auto;align-items:center;column-gap:1rem}.display-list .work-card-index,.display-list .work-card-tags{display:none}.display-list .work-card-copy>strong{grid-column:1;grid-row:1;margin:0}.display-list .work-card-chapter{grid-column:1;grid-row:2;margin:0}.display-list .work-card-meta{grid-column:2;grid-row:1/3;margin:0}.display-list .work-card-action{grid-column:3;grid-row:1/3;margin:0;padding:0}.display-list .work-card-menu-trigger{inset-block-start:.25rem}
.works-empty-state{position:relative;z-index:1;display:grid;place-items:center;align-content:center;gap:.625rem;min-block-size:14rem;color:var(--library-muted,#687269);text-align:center}.works-empty-state h3,.works-empty-state p{margin:0}.works-empty-state h3{font:600 1.125rem/1.4 var(--serif)}.works-empty-state p{font:.6875rem/1.5 var(--sans)}.works-empty-state button{display:flex;align-items:center;gap:.5rem;margin-block-start:.5rem;padding-block:.625rem;padding-inline:1rem;border:1px solid var(--library-jade,#33493f);background:var(--library-jade,#33493f);color:var(--surface,#f7f4ec);font:.75rem var(--sans)}
button:focus-visible,select:focus-visible{outline:2px solid #c47e29;outline-offset:.1875rem}
@keyframes all-works-back-in{0%{opacity:0;transform:translateX(-.75rem)}100%{opacity:1;transform:translateX(0)}}
@container library-content (max-width:58rem){.works-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.all-works-controls>span{display:none}}
@container library-content (max-width:40rem){.all-works-toolbar{align-items:flex-start}.all-works-controls label{font-size:0}.works-grid{grid-template-columns:minmax(0,1fr)}.work-card{min-block-size:10rem}.display-list .work-card-copy{display:flex}.display-list .work-card-tags{display:flex}.display-list .work-card-index{display:block}}
@container library-content (max-height:37rem){.all-works-toolbar{min-block-size:2.75rem;padding-block:.25rem}.all-works-title>div>span{display:none}.all-works-title h2{font-size:1rem}.all-works-surface{padding-block:.5rem 1.5rem}.work-card{min-block-size:8.5rem}.work-card-main{padding-block:.5rem .25rem}.work-card-main :deep(.library-book-cover){inline-size:3.75rem;block-size:5.75rem}.work-card-chapter{margin-block:.15rem 0}.work-card-copy>strong{font-size:.9375rem}}
</style>
