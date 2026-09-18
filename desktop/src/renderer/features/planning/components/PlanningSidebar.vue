<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import StudioIcon from '../../../ui/StudioIcon.vue'
import { matchesPlanningSearch, type PlanningChapter } from '../services/planning-directory'
import '../../../assets/planning.css'

const props = defineProps<{
  bookKey: string
  activeLeaf?: string
  mode: string
  selectedVolume: number | null
  selectedStage: number | null
  selectedChapter: number | null
  volumes: { volume: number; title: string }[]
  stages: { stage: number; volume: number; title: string; chapterIds: number[] }[]
  chapters: PlanningChapter[]
  loading: string
  error: string
  disabled?: boolean
}>()
const emit = defineEmits<{
  navigate: [leaf: string]
  volume: [id: number]
  stage: [stage: { stage: number; volume: number; title: string; chapterIds: number[] }]
  chapter: [chapter: PlanningChapter]
  createVolume: []
  createChapter: []
  recovery: []
  retry: []
}>()
const host = ref<HTMLElement | null>(null)
const query = ref('')
const openGroups = ref(['total', 'volume', 'chapter'])
const openVolumes = ref<number[]>([])
const toggleGroup = (key: string) => { openGroups.value = openGroups.value.includes(key) ? openGroups.value.filter(item => item !== key) : [...openGroups.value, key] }
const toggleVolume = (key: number) => { openVolumes.value = openVolumes.value.includes(key) ? openVolumes.value.filter(item => item !== key) : [...openVolumes.value, key] }
const visibleVolumes = computed(() => props.volumes.filter(volume => matchesPlanningSearch(query.value, `第${volume.volume}卷`, volume.title)
  || props.stages.some(stage => stage.volume === volume.volume && matchesPlanningSearch(query.value, stage.title))))
const visibleChapters = computed(() => props.chapters.filter(chapter => matchesPlanningSearch(query.value,
  `第${chapter.position}章`, chapter.title, chapter.volume ? `第${chapter.volume}卷` : '待归卷', props.volumes.find(volume => volume.volume === chapter.volume)?.title)))
const chapterGroups = computed(() => props.volumes.map(volume => ({ ...volume, chapters: visibleChapters.value.filter(chapter => chapter.volume === volume.volume) })).filter(volume => !query.value || volume.chapters.length))
const unassigned = computed(() => visibleChapters.value.filter(chapter => !chapter.volume))
const isChapter = (chapter: PlanningChapter) => props.selectedChapter === chapter.id && props.mode === (chapter.plannedOnly ? 'plannedChapter' : 'chapter') && props.activeLeaf === 'chapter-outline'
watch(() => props.bookKey, () => { query.value = ''; openGroups.value = ['total', 'volume', 'chapter']; openVolumes.value = [] })
watch(() => [props.mode, props.selectedChapter, props.selectedVolume, props.selectedStage, props.activeLeaf, props.chapters, query.value] as const, async () => {
  const volume = props.mode === 'chapter' || props.mode === 'plannedChapter' ? props.chapters.find(chapter => chapter.id === props.selectedChapter)?.volume : props.selectedVolume
  if (volume && !openVolumes.value.includes(volume)) openVolumes.value = [...openVolumes.value, volume]
  await nextTick()
  host.value?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest' })
}, { immediate: true })
</script>

<template>
  <aside ref="host" class="planning-sidebar" aria-label="谋篇目录">
    <header class="planning-sidebar-heading"><div><h2>谋篇</h2><small>STORY PLANNING</small></div><span>{{ chapters.length }} 章</span></header>
    <label class="planning-search"><StudioIcon name="search" :size="15"/><input v-assist-field="{ id: 'AppShell.outlineChapterSearch', read: () => query, write: value => { query = String(value) } }" v-model="query" type="search" placeholder="查找大纲、卷名、章节" aria-label="搜索全部大纲"></label>
    <nav class="planning-directory" aria-label="大纲文档">
      <section class="planning-group">
        <header><button type="button" :aria-expanded="openGroups.includes('total')" @click="toggleGroup('total')"><StudioIcon name="chevron-right" :size="13"/><StudioIcon name="folder" :size="16"/><b>总纲</b></button></header>
        <button v-if="openGroups.includes('total') && matchesPlanningSearch(query, '全书总纲')" type="button" class="planning-document" data-nav-leaf="total-outline" :aria-current="activeLeaf === 'total-outline' ? 'page' : undefined" @click="emit('navigate', 'total-outline')"><StudioIcon name="outline" :size="15"/><span>全书总纲</span></button>
      </section>
      <section class="planning-group">
        <header><button type="button" :aria-expanded="openGroups.includes('volume')" @click="toggleGroup('volume')"><StudioIcon name="chevron-right" :size="13"/><StudioIcon name="folder" :size="16"/><b>卷纲</b></button><button type="button" class="planning-view-link" data-nav-leaf="volume-lines" :aria-current="activeLeaf === 'volume-lines' ? 'page' : undefined" @click="emit('navigate', 'volume-lines')">概览</button><button type="button" class="planning-add" :disabled="disabled" aria-label="新建卷" title="新建卷" @click="emit('createVolume')"><StudioIcon name="plus" :size="15"/></button></header>
        <div v-if="openGroups.includes('volume')">
          <template v-for="volume in visibleVolumes" :key="volume.volume">
            <button type="button" class="planning-document" :data-testid="`planning-volume-${volume.volume}`" :title="`第 ${volume.volume} 卷 · ${volume.title}`" :aria-current="activeLeaf === 'volume-outline' && selectedVolume === volume.volume && mode === 'volume' ? 'page' : undefined" @click="emit('volume', volume.volume)"><i>{{ volume.volume }}</i><span>{{ volume.title }}</span></button>
            <button v-for="stage in stages.filter(item => item.volume === volume.volume && (!query || matchesPlanningSearch(query, item.title, volume.title)))" :key="stage.stage" type="button" class="planning-document planning-stage" :data-testid="`open-stage-${stage.stage}`" :title="stage.title" :aria-current="mode === 'stage' && selectedStage === stage.stage && activeLeaf === 'chapter-outline' ? 'page' : undefined" @click="emit('stage', stage)"><span class="planning-branch" aria-hidden="true">└</span><span>{{ stage.title }}</span><small>阶段</small></button>
          </template>
          <p v-if="!volumes.length" class="planning-empty">还没有分卷。<button type="button" :disabled="disabled" @click="emit('createVolume')">建立第一卷</button></p>
        </div>
      </section>
      <section class="planning-group">
        <header><button type="button" :aria-expanded="openGroups.includes('chapter')" @click="toggleGroup('chapter')"><StudioIcon name="chevron-right" :size="13"/><StudioIcon name="folder" :size="16"/><b>章纲</b></button><button type="button" class="planning-view-link" data-nav-leaf="chapter-skeleton" :aria-current="activeLeaf === 'chapter-skeleton' ? 'page' : undefined" @click="emit('navigate', 'chapter-skeleton')">章节安排</button><button type="button" class="planning-add" :disabled="disabled" aria-label="新建章节并写章纲" title="新建章节，同时加入书稿目录" @click="emit('createChapter')"><StudioIcon name="plus" :size="15"/></button></header>
        <div v-if="openGroups.includes('chapter')">
          <section v-for="volume in chapterGroups" :key="volume.volume" class="planning-chapter-group">
            <button type="button" class="planning-volume-folder" :aria-expanded="Boolean(query) || openVolumes.includes(volume.volume)" @click="toggleVolume(volume.volume)"><StudioIcon name="chevron-right" :size="12"/><span :title="volume.title">第 {{ volume.volume }} 卷 · {{ volume.title }}</span><small>{{ volume.chapters.length }}</small></button>
            <div v-if="query || openVolumes.includes(volume.volume)">
              <button v-for="chapter in volume.chapters" :key="chapter.id" type="button" class="planning-document planning-chapter" :data-testid="chapter.plannedOnly ? `open-planned-chapter-${chapter.id}` : `planning-chapter-${chapter.id}`" :title="`第 ${chapter.position} 章 · ${chapter.title}${chapter.plannedOnly ? ' · 正文未写' : ''}`" :aria-current="isChapter(chapter) ? 'page' : undefined" @click="emit('chapter', chapter)"><i>{{ chapter.position }}</i><span>{{ chapter.title }}</span><small v-if="chapter.plannedOnly">纲</small></button>
              <p v-if="!volume.chapters.length" class="planning-empty">本卷还没有章节。</p>
            </div>
          </section>
          <p v-if="unassigned.length" class="planning-unassigned">待归卷 <span>{{ unassigned.length }}</span></p>
          <button v-for="chapter in unassigned" :key="chapter.id" type="button" class="planning-document planning-chapter" :data-testid="chapter.plannedOnly ? `open-planned-chapter-${chapter.id}` : `planning-chapter-${chapter.id}`" :title="`第 ${chapter.position} 章 · ${chapter.title}`" :aria-current="isChapter(chapter) ? 'page' : undefined" @click="emit('chapter', chapter)"><i>{{ chapter.position }}</i><span>{{ chapter.title }}</span><small v-if="chapter.plannedOnly">纲</small></button>
          <p v-if="!chapters.length" class="planning-empty">先写下这一章会发生什么。<button type="button" :disabled="disabled" @click="emit('createChapter')">新建章节并写章纲</button></p>
        </div>
      </section>
      <p v-if="query && !visibleVolumes.length && !visibleChapters.length && !matchesPlanningSearch(query, '全书总纲')" class="planning-empty" role="status">没有找到对应大纲，试试卷名或章号。</p>
    </nav>
    <div v-if="loading || error" class="planning-feedback" :role="error ? 'alert' : 'status'"><span>{{ error || loading }}</span><button v-if="error" type="button" @click="emit('retry')">重试打开</button></div>
    <footer class="planning-tools"><p>写作工具 <small>TOOLS</small></p><button type="button" data-nav-leaf="preparation" :aria-current="activeLeaf === 'preparation' ? 'page' : undefined" @click="emit('navigate', 'preparation')"><StudioIcon name="spark" :size="15"/><span>创作筹备</span><span aria-hidden="true">↗</span></button><button type="button" data-testid="open-outline-recovery-shelf" :aria-current="mode === 'recovery' && activeLeaf === 'chapter-outline' ? 'page' : undefined" @click="emit('recovery')"><StudioIcon name="undo" :size="15"/><span>恢复稿</span><span aria-hidden="true">↗</span></button></footer>
  </aside>
</template>
