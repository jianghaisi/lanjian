<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, watch } from 'vue'
import { CheckCheck, Download, Folder, X } from '@lucide/vue'
import type { Chapter, ManuscriptExportResult } from '../../../../contracts/index'
import type { ManuscriptExportSelection } from '../../../../contracts/manuscript/types'
import { projectChapterVolumeGroups, type ChapterTreeVolume, type ChapterTreePlacement } from '../../../../contracts/manuscript/chapter-tree-window'

type Book = { id: string; path: string; title: string }
const props = withDefaults(defineProps<{
  workItem: Book | null
  chapters: Chapter[]
  selectedId: number | null
  volumes?: ChapterTreeVolume[]
  placements?: ChapterTreePlacement[]
  blocked?: boolean
  exportSelection: (selection: ManuscriptExportSelection) => Promise<ManuscriptExportResult | null>
}>(), { volumes: () => [], placements: () => [], blocked: false })
const dialog = ref<HTMLDialogElement | null>(null)
const book = shallowRef<Book | null>(null)
const selected = ref(new Set<number>())
const pending = ref(false)
const error = ref('')
const groups = computed(() => projectChapterVolumeGroups(
  [...props.chapters].sort((a, b) => a.position - b.position || a.id - b.id), props.volumes, props.placements
))
const selectedChapters = computed(() => props.chapters.filter(chapter => selected.value.has(chapter.id)))
const wordCount = computed(() => selectedChapters.value.reduce((count, chapter) => count + chapter.word_count, 0))
let focusTarget: HTMLElement | null = null
let epoch = 0

function countSelected(chapters: Chapter[]) { return chapters.filter(chapter => selected.value.has(chapter.id)).length }
function selectChapters(chapters: Chapter[], checked: boolean) {
  const next = new Set(selected.value)
  for (const chapter of chapters) checked ? next.add(chapter.id) : next.delete(chapter.id)
  selected.value = next
  error.value = ''
}
async function open() {
  if (!props.workItem || props.blocked || pending.value) return
  const opening = ++epoch
  book.value = { ...props.workItem }
  selected.value = new Set(props.chapters.some(chapter => chapter.id === props.selectedId) ? [props.selectedId!] : [])
  error.value = ''
  focusTarget = document.querySelector<HTMLElement>('[data-testid="chapter-transfer-toggle"]')
  dialog.value?.showModal()
  await nextTick()
  if (opening === epoch && dialog.value?.open) {
    dialog.value.querySelector<HTMLElement>('[data-testid="export-select-all"]')?.focus({ preventScroll: true })
  }
}
function close() { if (!pending.value) dialog.value?.close() }
function restoreFocus() {
  // Native close is queued; a newer showModal already owns its own focus.
  if (dialog.value?.open) return
  const owned = document.activeElement === document.body || dialog.value?.contains(document.activeElement)
  if (owned && focusTarget?.isConnected && !focusTarget.closest('[inert]')) focusTarget.focus({ preventScroll: true })
  focusTarget = null
}
watch([() => props.workItem?.id, () => props.workItem?.path], () => {
  epoch++
  focusTarget = null
  dialog.value?.close()
  book.value = null
  selected.value = new Set()
  pending.value = false
  error.value = ''
})
async function confirm() {
  if (pending.value || props.blocked || !book.value || !selected.value.size) return
  const request = ++epoch
  pending.value = true
  error.value = ''
  try {
    const result = await props.exportSelection({ workItemId: book.value.id, workItemPath: book.value.path, chapterIds: [...selected.value] })
    if (request !== epoch) return
    if (result) dialog.value?.close()
  } catch (cause) {
    if (request === epoch) error.value = (cause as { message?: string })?.message || '导出未完成，章节选择和正文已保留，请重试。'
  } finally {
    if (request === epoch) pending.value = false
  }
}
defineExpose({ open, close })
</script>

<template>
  <dialog ref="dialog" class="manuscript-export-dialog" data-testid="manuscript-export-dialog" aria-labelledby="manuscript-export-title" :aria-busy="pending" @cancel.prevent="close" @close="restoreFocus">
    <header class="export-heading">
      <div><p>文稿 · 导出</p><h2 id="manuscript-export-title">批量导出</h2><span class="export-book" :title="book?.title">{{ book?.title }}</span></div>
      <button class="export-close" type="button" aria-label="关闭批量导出" :disabled="pending" @click="close"><X :size="20" /></button>
    </header>
    <div class="export-selection-tools">
      <button type="button" class="export-all" data-testid="export-select-all" :disabled="pending || blocked || !chapters.length" @click="selectChapters(chapters, true)"><CheckCheck :size="17" />整书全选</button>
      <button type="button" class="export-clear" data-testid="export-clear" :disabled="pending || !selected.size" @click="selected = new Set(); error = ''">清空选择</button>
      <span>{{ chapters.length.toLocaleString() }} 章可选</span>
    </div>
    <div class="export-chapter-list" aria-label="选择导出章节">
      <section v-for="group in groups" :key="group.key" class="export-volume">
        <label class="export-volume-heading">
          <input type="checkbox" :checked="countSelected(group.chapters) === group.chapters.length" :indeterminate.prop="countSelected(group.chapters) > 0 && countSelected(group.chapters) < group.chapters.length" :disabled="pending || blocked" :aria-label="`选择${group.volume ? `第 ${group.volume} 卷 · ` : ''}${group.title}全部章节`" :data-export-group="group.key" @change="selectChapters(group.chapters, ($event.target as HTMLInputElement).checked)" />
          <Folder :size="16" /><b>{{ group.volume ? `第 ${group.volume} 卷 · ` : '' }}{{ group.title }}</b><small>{{ group.chapters.length }} 章</small>
        </label>
        <label v-for="chapter in group.chapters" :key="chapter.id" class="export-chapter" :class="{ 'is-selected': selected.has(chapter.id) }" :title="`第 ${chapter.position} 章 · ${chapter.title}`">
          <input type="checkbox" :data-export-chapter="chapter.id" :aria-label="`导出第 ${chapter.position} 章 ${chapter.title}`" :checked="selected.has(chapter.id)" :disabled="pending || blocked" @change="selectChapters([chapter], ($event.target as HTMLInputElement).checked)" />
          <span class="export-chapter-number">第 {{ chapter.position }} 章</span><span class="export-chapter-title">{{ chapter.title || '未命名章节' }}</span><small>{{ chapter.word_count.toLocaleString() }} 字</small>
        </label>
      </section>
      <p v-if="!chapters.length" class="export-empty">这部作品还没有可导出的章节。</p>
    </div>
    <footer class="export-footer">
      <p class="export-summary" role="status" data-testid="export-selection-summary">已选 <strong>{{ selectedChapters.length }}</strong> / {{ chapters.length }} 章<span>约 {{ wordCount.toLocaleString() }} 字</span></p>
      <p class="export-hint">按原章序导出；TXT / Markdown 格式在保存时选择。</p>
      <p v-if="error" class="export-error" role="alert">{{ error }}</p>
      <div class="export-actions"><button type="button" class="export-cancel" :disabled="pending" @click="close">取消</button><button type="button" class="export-confirm" data-testid="export-confirm" :disabled="pending || blocked || !selectedChapters.length" @click="confirm"><Download :size="17" />{{ pending ? '正在准备导出…' : `导出所选 ${selectedChapters.length} 章` }}</button></div>
    </footer>
  </dialog>
</template>

<style scoped>
dialog.manuscript-export-dialog {
  flex-direction:column;
  opacity:0; translate:0 8px; scale:.985; pointer-events:none;
  transition:opacity 180ms ease,translate 220ms var(--interaction-ease),scale 220ms var(--interaction-ease),display 220ms allow-discrete,overlay 220ms allow-discrete;
}
dialog.manuscript-export-dialog[open] { opacity:1; translate:0 0; scale:1; pointer-events:auto; animation:none; }
dialog.manuscript-export-dialog::backdrop {
  opacity:0; pointer-events:none; animation:none;
  transition:opacity 180ms ease,display 220ms allow-discrete,overlay 220ms allow-discrete;
}
dialog.manuscript-export-dialog[open]::backdrop { opacity:1; pointer-events:auto; animation:none; }
@starting-style {
  dialog.manuscript-export-dialog[open] { opacity:0; translate:0 8px; scale:.985; }
  dialog.manuscript-export-dialog[open]::backdrop { opacity:0; }
}
.export-chapter { transition:background-color 160ms ease; }
.manuscript-export-dialog button { transition:background-color 140ms ease,border-color 140ms ease,color 140ms ease; }
@media(prefers-reduced-motion:reduce) {
  dialog.manuscript-export-dialog,dialog.manuscript-export-dialog::backdrop,
  .export-chapter,.manuscript-export-dialog button { transition:none!important; }
  dialog.manuscript-export-dialog[open] { translate:none; scale:none; }
}
.manuscript-export-dialog{box-sizing:border-box;inline-size:min(36rem,calc(100vw - 2rem));max-block-size:calc(100dvh - 2rem);padding:0;margin:auto;border:1px solid var(--color-line);border-radius:var(--radius-panel,6px);background:var(--color-surface);color:var(--color-ink);font-family:var(--font-ui,sans-serif);box-shadow:0 20px 70px #0003;overflow:hidden}
.manuscript-export-dialog[open]{display:flex}
.manuscript-export-dialog::backdrop{background:rgb(17 29 24 / .45)}
.export-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;padding:1.3rem 1.5rem 1rem;border-block-start:3px solid var(--color-jade)}
.export-heading p{margin:0 0 .35rem;color:var(--color-muted);font-size:.7rem;letter-spacing:.16em}.export-heading h2{margin:0;font-size:1.35rem;line-height:1.5;font-weight:650}.export-heading>div{min-width:0}.export-book{display:block;max-width:25rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.85rem;color:var(--color-muted);margin-top:.3rem}
.manuscript-export-dialog button{display:inline-flex;align-items:center;justify-content:center;gap:.45rem;min-height:2.25rem;padding:.4rem .8rem;border:1px solid var(--color-line);border-radius:3px;background:transparent;color:inherit;font:500 .85rem/1.4 var(--font-ui,sans-serif);cursor:pointer}.manuscript-export-dialog button:disabled{opacity:.45;cursor:default}.manuscript-export-dialog button:focus-visible,.manuscript-export-dialog input:focus-visible{outline:2px solid var(--color-jade);outline-offset:3px}
.manuscript-export-dialog .export-close{border:0;padding:.4rem;flex:none}
.export-selection-tools{display:flex;align-items:center;gap:.6rem;padding:.6rem 1.5rem .9rem;border-bottom:1px solid var(--color-line)}.export-selection-tools>span{margin-left:auto;color:var(--color-muted);font-size:.75rem;white-space:nowrap}.manuscript-export-dialog .export-all{background:color-mix(in srgb,var(--color-jade) 10%,transparent);border-color:color-mix(in srgb,var(--color-jade) 35%,var(--color-line));color:var(--color-jade)}.manuscript-export-dialog .export-clear{border-color:transparent;color:var(--color-muted)}
.export-chapter-list{min-height:0;max-height:46dvh;overflow:auto;overscroll-behavior:contain;padding:.5rem 1rem}.export-volume-heading{display:flex;align-items:center;gap:.65rem;padding:.8rem .5rem;color:var(--color-muted);font-size:.8rem;cursor:pointer}.export-volume-heading b{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}.export-volume-heading svg{flex:none}
.export-chapter{display:grid;grid-template-columns:1.1rem 5em minmax(0,1fr) auto;align-items:center;gap:.6rem;min-height:2.7rem;padding:.3rem .5rem;border-radius:3px;cursor:pointer;font-size:.85rem}.export-chapter.is-selected{background:color-mix(in srgb,var(--color-jade) 9%,transparent)}.export-chapter:hover{background:color-mix(in srgb,var(--color-jade) 13%,transparent)}.export-chapter-number{color:var(--color-muted);font-size:.8rem;white-space:nowrap}.export-chapter-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.export-chapter small,.export-volume-heading small{color:var(--color-muted);font-size:.72rem;white-space:nowrap;font-variant-numeric:tabular-nums}.manuscript-export-dialog input[type=checkbox]{width:1rem;height:1rem;margin:0;accent-color:var(--color-jade);cursor:pointer;flex:none}
.export-footer{flex:none;padding:1rem 1.5rem 1.25rem;border-top:1px solid var(--color-line)}.export-summary{display:flex;align-items:baseline;gap:.3rem;margin:0;font-size:.85rem}.export-summary strong{color:var(--color-jade);font-size:1.05rem}.export-summary span{margin-left:auto;color:var(--color-muted);font-size:.8rem}.export-hint{margin:.45rem 0 1rem;color:var(--color-muted);font-size:.75rem;line-height:1.5}.export-actions{display:flex;justify-content:flex-end;gap:.6rem}.manuscript-export-dialog .export-confirm{background:var(--color-jade);color:var(--color-surface);border-color:var(--color-jade);min-width:10rem}.export-error{color:var(--color-danger);font-size:.85rem;line-height:1.5;overflow-wrap:anywhere}.export-empty{padding:1rem;color:var(--color-muted)}
@media(max-width:30rem){.export-heading,.export-footer{padding:1rem}.export-selection-tools{padding:.5rem 1rem}.export-chapter-list{padding:.5rem}.export-chapter{grid-template-columns:1rem 4.2em minmax(0,1fr) auto;gap:.35rem}.export-selection-tools{gap:.25rem}}
</style>
