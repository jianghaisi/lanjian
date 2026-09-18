<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { Chapter } from '../../../../contracts/index'
import {
  projectChapterTree,
  projectChapterVolumeGroups,
  type ChapterTreeGroup,
  type ChapterTreePlacement,
  type ChapterTreeVolume
} from '../../../../contracts/manuscript/chapter-tree-window'
import StudioIcon from '../../../ui/StudioIcon.vue'

const props = withDefaults(defineProps<{
  chapters: Chapter[]
  selectedId: number | null
  selectedTitle: string
  volumes?: ChapterTreeVolume[]
  placements?: ChapterTreePlacement[]
  externalSearch?: boolean
  deletable?: boolean
}>(), { volumes: () => [], placements: () => [], deletable: false })

const emit = defineEmits<{ select: [chapter: Chapter]; delete: [chapter: Chapter] }>()
const query = defineModel<string>('query', { default: '' })
const list = ref<HTMLElement | null>(null)
const expandedGroups = ref(new Set<string>())
const projected = computed(() => projectChapterTree(props.chapters, query.value))
const groups = computed(() => projectChapterVolumeGroups(projected.value.items, props.volumes, props.placements))
const allGroups = computed(() => projectChapterVolumeGroups(props.chapters, props.volumes, props.placements))
const grouped = computed(() => props.volumes.length > 0)

watch(query, () => {
  void revealCurrentChapter()
})
watch(() => [props.chapters, props.selectedId, props.volumes, props.placements] as const, () => {
  const selectedGroup = allGroups.value.find((group) => group.chapters.some((chapter) => chapter.id === props.selectedId))
    ?? allGroups.value[0]
  if (selectedGroup && grouped.value) {
    expandedGroups.value = new Set([...expandedGroups.value, selectedGroup.key])
  }
  void revealCurrentChapter()
}, { immediate: true, deep: true, flush: 'post' })

function volumeLabel(group: ChapterTreeGroup) {
  return group.volume === null ? group.title : `第 ${group.volume} 卷 · ${group.title}`
}

function groupIsOpen(group: ChapterTreeGroup) {
  return !grouped.value || Boolean(query.value.trim()) || expandedGroups.value.has(group.key)
}

function toggleGroup(group: ChapterTreeGroup) {
  const next = new Set(expandedGroups.value)
  next.has(group.key) ? next.delete(group.key) : next.add(group.key)
  expandedGroups.value = next
}

function chooseChapter(chapter: Chapter) {
  if (chapter.id !== props.selectedId) emit('select', chapter)
}

async function revealCurrentChapter() {
  await nextTick()
  list.value?.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView({ block: 'nearest' })
}
</script>

<template>
  <section ref="list" class="chapter-tree-list" data-testid="chapter-tree-window" :data-rendered-count="projected.items.length" :data-total-count="projected.total">
    <label v-if="!externalSearch" class="chapter-tree-search">
      <span>查找章节</span>
      <input v-assist-field="{ id: 'ChapterTreeList.query', read: () => query, write: value => { query = String(value) } }" v-model="query" type="search" data-testid="chapter-tree-search" placeholder="章名或第 X 章" autocomplete="off" />
      <small v-if="query.trim()">{{ projected.total }} 项</small>
    </label>
    <article v-for="group in groups" :key="group.key" class="chapter-volume-group" :data-volume="group.volume ?? 'unassigned'">
      <button v-if="grouped" class="chapter-volume-toggle" type="button" :aria-expanded="groupIsOpen(group)" :aria-label="`${groupIsOpen(group) ? '收起' : '展开'}${volumeLabel(group)}`" @click="toggleGroup(group)">
        <StudioIcon name="chevron-right" :size="14" />
        <b :title="volumeLabel(group)">{{ volumeLabel(group) }}</b>
        <small>{{ group.chapters.length }} 章</small>
      </button>
      <div v-show="groupIsOpen(group)" class="chapter-volume-children">
        <div v-for="chapter in group.chapters" :key="chapter.id" class="chapter-tree-row-shell" :class="{ selected: selectedId === chapter.id }">
          <button class="tree-item chapter-tree-row" :class="{ selected: selectedId === chapter.id }" type="button" :title="`第 ${chapter.position} 章 · ${selectedId === chapter.id ? selectedTitle : chapter.title} · ${chapter.word_count.toLocaleString()} 字`" :aria-label="`第 ${chapter.position} 章，${selectedId === chapter.id ? selectedTitle : chapter.title}，${chapter.word_count.toLocaleString()} 字${selectedId === chapter.id ? '，当前编辑' : ''}`" :aria-current="selectedId === chapter.id ? 'page' : undefined" @click="chooseChapter(chapter)">
            <span class="chapter-no">第{{ chapter.position }}章</span>
            <b class="chapter-row-title">{{ selectedId === chapter.id ? selectedTitle : chapter.title }}</b>
            <small class="archive-chapter-meta">{{ chapter.word_count.toLocaleString() }}字</small>
          </button>
          <button v-if="deletable" class="chapter-row-delete" type="button" :title="`删除第 ${chapter.position} 章《${selectedId === chapter.id ? selectedTitle : chapter.title}》`" :aria-label="`删除第 ${chapter.position} 章《${selectedId === chapter.id ? selectedTitle : chapter.title}》`" @click="emit('delete', chapter)"><StudioIcon name="trash" :size="15" /></button>
        </div>
      </div>
    </article>
    <div v-if="!projected.items.length" class="tree-empty">{{ chapters.length ? '没有匹配的章节' : '还没有章节' }}</div>
  </section>
</template>
