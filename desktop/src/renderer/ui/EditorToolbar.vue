<script setup lang="ts">
import StudioIcon from './StudioIcon.vue'
withDefaults(defineProps<{
  prefix: string
  readOnly?: boolean
  composing?: boolean
  canUndo: boolean
  canRedo: boolean
  empty: boolean
  findOpen?: boolean
  formatTitle?: string
}>(), { formatTitle: '一键排版：整理段落空白' })
defineEmits<{ undo: []; redo: []; find: []; format: [] }>()
</script>

<template>
  <div class="editor-common-tools">
    <span class="history-tool-group" role="group" aria-label="编辑与查找">
      <button type="button" class="editor-icon-tool" :data-testid="prefix + '-undo'" title="撤销（Ctrl+Z）" aria-label="撤销" :disabled="readOnly || composing || !canUndo" @mousedown.prevent @click="$emit('undo')"><StudioIcon name="undo" :size="18"/></button>
      <button type="button" class="editor-icon-tool" :data-testid="prefix + '-redo'" title="重做（Ctrl+Y 或 Ctrl+Shift+Z）" aria-label="重做" :disabled="readOnly || composing || !canRedo" @mousedown.prevent @click="$emit('redo')"><StudioIcon name="redo" :size="18"/></button>
      <button type="button" class="editor-icon-tool" :data-testid="prefix + '-find'" title="查找与替换（Ctrl+F）" aria-label="查找与替换" :aria-pressed="findOpen" :disabled="composing" @mousedown.prevent @click="$emit('find')"><StudioIcon name="search" :size="18"/></button>
    </span>
    <button type="button" class="direct-format-action" :data-testid="prefix + '-format'" :title="formatTitle" aria-label="一键排版" :disabled="readOnly || composing || empty" @mousedown.prevent @click="$emit('format')"><StudioIcon name="outline" :size="17"/><span class="tool-label">一键排版</span></button>
    <slot />
  </div>
</template>

<style scoped>
.editor-common-tools, .history-tool-group { display: flex; align-items: center; gap: 3px; flex-wrap: wrap; min-width: 0; }
.editor-common-tools { flex: 0 1 auto; }
button { display: inline-flex; align-items: center; justify-content: center; gap: 5px; padding: 6px 8px; min-height: 32px; border: 0; background: transparent; color: var(--ink); font: 500 12px/1.4 var(--sans); cursor: pointer; }
button:hover:not(:disabled) { background: var(--surface-muted); }
button:focus-visible { outline: 2px solid var(--jade); outline-offset: -2px; }
button:disabled { opacity: .38; cursor: default; }
</style>
