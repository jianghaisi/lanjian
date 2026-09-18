<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ChevronDown, ChevronRight, FileText, Folder } from '@lucide/vue'
import type { LibraryOutlineChapter } from '../../../../contracts/library/library-outline-preview'
import { useLibraryOutline } from '../composables/library-outline'
const props = defineProps<{ path: string; selectedId?: number | null }>()
const emit = defineEmits<{ select: [chapter: LibraryOutlineChapter]; volume: [volume: { id: number | null; title: string }] }>()
const { preview, loading, error, load } = useLibraryOutline()
const openGroups = ref(new Set<number | null>())
const groups = computed(() => {
  if (!preview.value) return []
  const volumeMap = new Map(preview.value.volumes.map(volume => [volume.id, volume.title]))
  return [...new Set([...preview.value.volumes.map(volume => volume.id), ...preview.value.chapters.map(chapter => chapter.volume)])].map(id => ({ id, title: id === null ? '未分卷章节' : volumeMap.get(id) || `第 ${id} 卷`, chapters: preview.value!.chapters.filter(chapter => chapter.volume === id) }))
})
watch(() => props.path, path => { openGroups.value.clear(); void load(path) }, { immediate: true })
watch(groups, values => { const initial = values.find(group => group.chapters.some(chapter => chapter.id === props.selectedId)) ?? values.find(group => group.chapters.length) ?? values[0]; if (initial) openGroups.value = new Set([initial.id]) })
function toggle(id: number | null) { const next = new Set(openGroups.value); if (next.has(id)) next.delete(id); else next.add(id); openGroups.value = next }
</script>
<template>
  <section class="library-project-tree" aria-label="作品卷章目录" data-testid="library-project-tree">
    <p v-if="loading" class="tree-status" role="status">正在读取卷章目录…</p>
    <div v-else-if="error" class="tree-status tree-error" role="alert"><p>{{ error }}</p><button type="button" @click="load(path)">重试目录预览</button></div>
    <template v-else-if="preview">
      <p v-if="!preview.chapters.length" class="tree-status">还没有正文。打开作品后可创建章节；已有章纲保留在谋篇中。</p>
      <div v-for="group in groups" :key="group.id ?? 'unassigned'" class="volume-group">
        <div class="volume-row"><button type="button" class="tree-expand" :aria-label="`${openGroups.has(group.id) ? '收起' : '展开'}${group.title}`" :aria-expanded="openGroups.has(group.id)" @click="toggle(group.id)"><component :is="openGroups.has(group.id) ? ChevronDown : ChevronRight" :size="15"/></button><button type="button" class="volume-title" @click="emit('volume', { id: group.id, title: group.title }); if (!openGroups.has(group.id)) toggle(group.id)"><Folder :size="15"/><span>{{ group.title }}</span><small>本页 {{ group.chapters.length }} 章</small></button></div>
        <ul v-if="openGroups.has(group.id)" class="chapter-list"><li v-for="chapter in group.chapters" :key="chapter.id"><button type="button" class="chapter-row" data-testid="library-tree-chapter" :class="{ selected: selectedId === chapter.id }" :aria-pressed="selectedId === chapter.id" :title="chapter.title" @click="emit('select', chapter)"><FileText :size="14"/><span class="chapter-number">第 {{ chapter.id }} 章</span><span class="chapter-title">{{ chapter.title }}</span><small v-if="!chapter.canOpen">待核对</small><small v-else-if="chapter.wordCount !== null">{{ chapter.wordCount.toLocaleString() }} 字</small></button></li></ul>
      </div>
      <footer v-if="preview.totalChapters > 60" class="tree-pagination"><button type="button" :disabled="preview.offset === 0" @click="load(path, Math.max(0, preview.offset - 60))">上一页</button><span>{{ preview.offset + 1 }}–{{ preview.offset + preview.chapters.length }} / {{ preview.totalChapters }} 章</span><button type="button" :disabled="preview.nextOffset === null" @click="preview.nextOffset !== null && load(path, preview.nextOffset)">下一页</button></footer><p v-if="preview.notice" class="tree-notice">{{ preview.notice }}</p>
    </template>
  </section>
</template>
<style scoped>
.library-project-tree{border-top:1px solid var(--color-line,#d8d6cf);padding:8px 12px 12px;background:var(--color-surface,#faf9f5);font:13px/1.5 var(--sans);min-width:0}.volume-row{display:flex;align-items:center;min-width:0;height:40px}.tree-expand{display:grid;place-items:center;width:28px;height:32px;flex:none;border:0;background:transparent;color:var(--color-muted,#777c78)}.volume-title{display:flex;align-items:center;gap:8px;min-width:0;flex:1;border:0;padding:4px 0;background:transparent;text-align:left;color:var(--color-ink,#1d2220);font:600 13px/1.5 var(--sans)}.volume-title span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.volume-title small{margin-left:auto;flex:none;font-weight:400;color:var(--color-muted,#777c78);font-size:10px}.chapter-list{list-style:none;margin:0 0 4px 13px;padding:0 0 0 14px;border-left:1px solid var(--color-line,#d8d6cf)}.chapter-row{display:flex;gap:8px;align-items:center;min-width:0;width:100%;min-height:36px;padding:8px;border:0;background:transparent;color:var(--color-ink,#1d2220);text-align:left;font:13px/1.5 var(--sans)}.chapter-row>svg{flex:none;color:var(--color-muted,#777c78)}.chapter-row:hover,.volume-title:hover,.tree-expand:hover{background:color-mix(in srgb,var(--color-surface,#faf9f5) 92%,var(--color-ink,#1d2220))}.chapter-row.selected{background:var(--color-ink,#1d2220);color:var(--color-surface,#faf9f5)}.chapter-row.selected>svg,.chapter-row.selected small{color:color-mix(in srgb,var(--color-surface,#faf9f5) 85%,var(--color-ink,#1d2220))}.chapter-number{font-size:11px;color:var(--color-muted,#777c78);flex:none}.selected .chapter-number{color:color-mix(in srgb,var(--color-surface,#faf9f5) 85%,var(--color-ink,#1d2220))}.chapter-title{min-width:0;overflow-wrap:anywhere;flex:1}.chapter-row small{font-size:10px;flex:none;color:var(--color-muted,#777c78)}.tree-status{padding:16px 8px;color:var(--color-muted,#777c78)}.tree-error{color:var(--color-danger,#b4473e)}.tree-status p{margin:0 0 8px}.tree-pagination{display:flex;gap:12px;align-items:center;justify-content:space-between;margin-top:12px;font-size:11px}.tree-pagination button,.tree-error button{font:12px var(--sans);padding:6px 8px;background:var(--color-surface,#faf9f5);border:1px solid var(--color-line,#d8d6cf);color:var(--color-ink,#1d2220)}button:disabled{opacity:.4;cursor:default}.tree-notice{margin:12px 4px 0;font-size:11px;color:var(--color-muted,#777c78);line-height:1.7}button:focus-visible{outline:2px solid var(--color-jade,#287a68);outline-offset:2px}
@media(max-width:1100px){.chapter-row small{display:none}.chapter-row{gap:6px}.chapter-number{font-size:10px}.chapter-list{padding-left:6px}}
</style>
