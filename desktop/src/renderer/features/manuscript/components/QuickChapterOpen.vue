<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import StudioIcon from '../../../ui/StudioIcon.vue'
import { searchQuickChapters, type QuickChapter } from '../services/quick-chapter-search'

const props = defineProps<{ chapters: QuickChapter[]; selectedId: number | null; openChapter: (id: number) => Promise<boolean> }>()
const dialog = ref<HTMLDialogElement | null>(null)
const input = ref<HTMLInputElement | null>(null)
const query = ref('')
const index = ref(0)
const pending = ref(false)
const error = ref('')
const results = computed(() => searchQuickChapters(props.chapters, query.value))
// Bound DOM size while preserving every result through explicit "more".
const visibleCount = ref(40)
const visible = computed(() => results.value.slice(0, visibleCount.value))
let restoreFocus: HTMLElement | null = null
watch(query, () => { index.value = 0; visibleCount.value = 40; error.value = '' })
watch(results, () => { index.value = Math.min(index.value, Math.max(0, results.value.length - 1)) })

async function open() {
  if (dialog.value?.open) return input.value?.focus()
  restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  query.value = ''; index.value = 0; visibleCount.value = 40; error.value = ''
  dialog.value?.showModal()
  await nextTick()
  if (dialog.value?.open) input.value?.focus()
}
function close() {
  if (pending.value) return
  dialog.value?.close()
}
function restore() {
  if (dialog.value?.open) return
  if (restoreFocus?.isConnected && !restoreFocus.closest('[inert]') && (document.activeElement === document.body || dialog.value?.contains(document.activeElement))) restoreFocus.focus({ preventScroll: true })
  restoreFocus = null
}
async function choose(id: number) {
  if (pending.value) return
  pending.value = true; error.value = ''
  try {
    if (!await props.openChapter(id)) { error.value = '未能切换。请先处理当前稿件的保存提示，再重试。'; return }
    restoreFocus = null
    dialog.value?.close()
    await nextTick()
    document.querySelector<HTMLElement>('[data-testid="manuscript-input"]')?.focus({ preventScroll: true })
  } catch {
    error.value = '章节未能打开，当前稿件仍保留。请关闭此窗口查看提示，或重新尝试。'
  } finally { pending.value = false }
}
async function onKey(event: KeyboardEvent) {
  if (event.isComposing || pending.value) return
  if (event.key === 'Enter') { event.preventDefault(); const item = results.value[index.value]; if (item) await choose(item.id) }
  else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    index.value = Math.max(0, Math.min(results.value.length - 1, index.value + (event.key === 'ArrowDown' ? 1 : -1)))
    visibleCount.value = Math.max(visibleCount.value, index.value + 1)
    await nextTick()
    dialog.value?.querySelector(`#quick-chapter-${results.value[index.value]?.id}`)?.scrollIntoView({ block: 'nearest' })
  }
}
defineExpose({ open, close })
</script>

<template>
  <dialog ref="dialog" class="quick-chapter-open" data-testid="quick-chapter-open" aria-labelledby="quick-chapter-title" @cancel.prevent="close" @close="restore">
    <header><div><small>CHAPTER INDEX</small><h2 id="quick-chapter-title">快速打开章节</h2></div><button type="button" class="control-button secondary" aria-label="关闭快速打开" :disabled="pending" @click="close"><StudioIcon name="close" :size="18"/></button></header>
    <label for="quick-chapter-query">章名或章号</label>
    <input v-assist-field="{ id: 'QuickChapterOpen.query', read: () => query, write: value => { query = String(value) } }" id="quick-chapter-query" ref="input" v-model="query" data-testid="quick-chapter-query" role="combobox" aria-autocomplete="list" aria-controls="quick-chapter-results" aria-expanded="true" :aria-activedescendant="visible[index] ? `quick-chapter-${visible[index].id}` : undefined" :disabled="pending" autocomplete="off" placeholder="例如：雨夜，或第 12 章" @keydown="onKey">
    <p class="quick-chapter-hint" role="status">{{ pending ? '正在保存当前稿件并打开章节…' : `找到 ${results.length} 章 · ↑↓ 选择 · Enter 打开 · Esc 返回` }}</p>
    <div id="quick-chapter-results" class="quick-chapter-results" role="listbox" aria-label="章节搜索结果">
      <button v-for="(item, itemIndex) in visible" :id="`quick-chapter-${item.id}`" :key="item.id" type="button" role="option" :aria-selected="itemIndex === index" :disabled="pending" :title="item.title" @pointermove="index = itemIndex" @click="choose(item.id)">
        <span>第 {{ item.position }} 章</span><b>{{ item.title || '未命名' }}</b><small>{{ item.id === selectedId ? '当前章节' : `${item.wordCount.toLocaleString()} 字` }}</small>
      </button>
    </div>
    <p v-if="!results.length" class="quick-chapter-empty">{{ chapters.length ? '没有匹配的章节，请换一个章名或章号。' : '这部作品还没有正文，先从书稿创建一章。' }}</p>
    <button v-if="visible.length < results.length" type="button" class="control-button secondary" :disabled="pending" @click="visibleCount += 40">显示更多章节</button>
    <p v-if="error" role="alert" class="quick-chapter-error">{{ error }}</p>
  </dialog>
</template>

<style scoped>
.quick-chapter-open{box-sizing:border-box;inline-size:min(38rem,calc(100vw - 2rem));max-block-size:calc(100dvh - 2rem);margin:auto;padding:1.5rem;border:1px solid var(--color-line);border-block-start:.2rem solid var(--color-orange);background:var(--color-surface);color:var(--color-ink);font-family:var(--font-ui,sans-serif);border-radius:var(--radius-panel)}
.quick-chapter-open::backdrop{background:rgb(20 25 22 / .45)}
.quick-chapter-open header{display:flex;align-items:center;justify-content:space-between;gap:1rem;margin-block-end:1rem}
.quick-chapter-open h2{font:600 1.4rem/1.5 var(--font-ui,sans-serif);margin:.25rem 0 0}
.quick-chapter-open small,.quick-chapter-hint{color:var(--color-muted);font-size:.8rem;line-height:1.5}
.quick-chapter-open label{display:block;font-size:.875rem;margin-block-end:.5rem}
.quick-chapter-open input{box-sizing:border-box;inline-size:100%;min-block-size:2.75rem;padding:.65rem .75rem;background:var(--color-paper);color:var(--color-ink);border:1px solid var(--color-line);font:inherit}
.quick-chapter-results{max-block-size:45dvh;overflow:auto;display:grid;align-content:start}
.quick-chapter-results button{display:grid;grid-template-columns:5em minmax(0,1fr) auto;align-items:center;gap:.75rem;min-block-size:3.5rem;padding:.75rem;border:0;border-block-end:1px solid var(--color-line);text-align:start;background:transparent;color:var(--color-ink);font:inherit;cursor:pointer}
.quick-chapter-results b{font-weight:500;overflow-wrap:anywhere}
.quick-chapter-results button[aria-selected=true]{background:var(--color-ink);color:var(--color-surface)}
.quick-chapter-results button[aria-selected=true] small{color:inherit}
.quick-chapter-open :focus-visible{outline:2px solid var(--color-jade);outline-offset:-2px}
.quick-chapter-empty{padding:1rem 0;line-height:1.6}.quick-chapter-error{color:var(--color-danger);line-height:1.6}
@media(max-width:30rem){.quick-chapter-open{padding:1rem}.quick-chapter-results button{grid-template-columns:4em minmax(0,1fr)}.quick-chapter-results small{grid-column:2}}
</style>
