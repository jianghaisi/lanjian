<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import type { DocumentKind, DocumentRef } from '../../../contracts/document-review/types'
import type { OutlineHistoryEntry } from '../../../contracts/document-review/api'

const props = defineProps<{ workItemId: string; kind: DocumentKind; legacyId?: number; currentContent: string; readOnly?: boolean }>()
const emit = defineEmits<{ close: []; restore: [content: string] }>()
const dialog = ref<HTMLDialogElement | null>(null)
const versions = shallowRef<OutlineHistoryEntry[]>([])
const selected = shallowRef<{ version: OutlineHistoryEntry; content: string } | null>(null)
const loading = ref(false), error = ref('')
const api = window.novelDesktop!.documentReview
let document: DocumentRef | null = null, sequence = 0, disposed = false
const returnFocus = window.document.activeElement as HTMLElement | null
async function load() {
  const request = ++sequence
  loading.value = true; error.value = ''; selected.value = null
  try {
    const snapshot = await api.readSnapshot({ workItemId: props.workItemId, kind: props.kind, ...(props.legacyId ? { legacyId: props.legacyId } : {}) })
    const result = await api.outlineHistory(snapshot.ref)
    if (disposed || request !== sequence) return
    document = snapshot.ref; versions.value = result
  } catch (cause) { if (!disposed && request === sequence) error.value = cause instanceof Error ? cause.message : '历史暂时无法读取，请重试。' }
  finally { if (!disposed && request === sequence) loading.value = false }
}
async function select(versionId: string) {
  if (!document) return
  const request = ++sequence
  loading.value = true; error.value = ''; selected.value = null
  try {
    const result = await api.outlineVersion({ document, versionId })
    if (!disposed && request === sequence) selected.value = result
  } catch (cause) { if (!disposed && request === sequence) error.value = cause instanceof Error ? cause.message : '该版本暂时无法读取。' }
  finally { if (!disposed && request === sequence) loading.value = false }
}
function date(value: string) { return new Date(value).toLocaleString('zh-CN', { hour12: false }) }
function source(value: string) { return ({ manual: '作者编辑', ai: 'AI 修订', legacy_import: '导入', restore: '历史恢复' } as Record<string, string>)[value] || '已保存版本' }
onMounted(() => { dialog.value?.showModal(); void load() })
onBeforeUnmount(() => { disposed = true; sequence++; dialog.value?.close(); returnFocus?.focus() })
</script>
<template>
  <Teleport to="body">
    <dialog ref="dialog" class="outline-history-dialog" aria-labelledby="outline-history-title" data-testid="outline-history" @cancel.prevent="emit('close')">
      <header><div><h2 id="outline-history-title">历史版本</h2><p>查看最近 50 个已保存版本。恢复到编辑稿后，可撤销或保存为新版本。</p></div><button type="button" aria-label="关闭历史版本" @click="emit('close')">关闭</button></header>
      <p v-if="error" role="alert">{{ error }} <button type="button" @click="load">重新读取</button></p>
      <div class="outline-history-workspace">
        <nav aria-label="大纲历史版本"><p v-if="loading" role="status">读取中…</p><p v-else-if="!versions.length">尚无可读取的历史版本。</p><button v-for="version in versions" :key="version.versionId" type="button" :aria-pressed="selected?.version.versionId === version.versionId" @click="select(version.versionId)"><b>第 {{ version.versionNo }} 版 · {{ source(version.sourceType) }}</b><small>{{ date(version.createdAt) }}</small></button></nav>
        <section v-if="selected" class="outline-history-comparison"><section><h3>当前编辑稿</h3><pre>{{ currentContent || '（空白）' }}</pre></section><section><h3>历史 · 第 {{ selected.version.versionNo }} 版</h3><pre>{{ selected.content || '（空白）' }}</pre></section></section>
        <p v-else class="outline-history-placeholder">选择一个版本查看内容。</p>
      </div>
      <footer><button type="button" :disabled="loading || readOnly || !selected || selected.content === currentContent" @click="selected && emit('restore', selected.content)">恢复到编辑稿</button></footer>
    </dialog>
  </Teleport>
</template>
<style scoped>
.outline-history-dialog { width:min(980px, calc(100vw - 3rem)); height:min(680px, calc(100dvh - 3rem)); padding:0; border:1px solid var(--line); background:var(--surface); color:var(--ink); }
.outline-history-dialog[open] { display:flex; flex-direction:column; }
.outline-history-dialog::backdrop { background:rgba(0,0,0,.4); }
header, footer { display:flex; flex:none; align-items:center; justify-content:space-between; gap:1rem; padding:1rem; }
header { border-bottom:1px solid var(--line); } footer { border-top:1px solid var(--line); justify-content:flex-end; }
h2 { margin:0; font-size:1.1rem; } p { font-size:.8125rem; line-height:1.6; }
header p { margin:.25rem 0 0; color:var(--muted); }
button { padding:.5rem .75rem; border:1px solid var(--line); background:var(--surface); color:inherit; cursor:pointer; }
button:disabled { opacity:.4; cursor:default; } button[aria-pressed=true] { background:var(--jade-wash); }
.outline-history-workspace { flex:1; display:flex; min-height:0; overflow:hidden; }
nav { width:13rem; flex:none; padding:.75rem; overflow:auto; border-right:1px solid var(--line); }
nav button { display:grid; width:100%; gap:.5rem; margin-bottom:.5rem; text-align:left; font-size:.8125rem; }
small { font-size:.6875rem; color:var(--muted); }
.outline-history-comparison { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); min-width:0; flex:1; }
.outline-history-comparison > section { display:flex; flex-direction:column; min-width:0; min-height:0; padding:1rem; }
h3 { margin:0 0 .75rem; font-size:.875rem; } pre { flex:1; min-height:0; overflow:auto; white-space:pre-wrap; overflow-wrap:anywhere; margin:0; font:14px/1.8 var(--serif); user-select:text; }
.outline-history-placeholder { padding:1rem; }
@media(max-width:800px) { nav { width:10rem; } .outline-history-comparison { grid-template-columns:1fr; grid-template-rows:repeat(2,minmax(0,1fr)); } }
</style>
