<script setup lang="ts">
import { computed } from 'vue'
import { renderAssistantDocument } from '../services/assistant-presentation'
const props = defineProps<{ content: string }>()
const html = computed(() => renderAssistantDocument(props.content))
</script>

<template><div class="assistant-document" v-html="html" /></template>

<style scoped>
.assistant-document { font:400 12.5px/1.7 var(--sans); overflow-wrap:anywhere; white-space:normal; }
.assistant-document :deep(p) { margin:.35em 0; white-space:normal; }
.assistant-document :deep(:is(h1,h2,h3,h4,h5,h6)) { margin:.8em 0 .3em; font:600 13px/1.6 var(--sans); }
.assistant-document :deep(:first-child) { margin-top:0; }
.assistant-document :deep(:last-child) { margin-bottom:0; }
.assistant-document :deep(:is(ul,ol)) { padding-left:1.5em; margin:.35em 0; }
.assistant-document :deep(li+li) { margin-top:.15em; }
.assistant-document :deep(blockquote) { margin:.6em 0; padding:.2em .8em; border-left:2px solid var(--jade); color:var(--muted); }
.assistant-document :deep(pre) { white-space:pre-wrap; overflow-wrap:anywhere; margin:.6em 0; padding:.75em; background:var(--surface-raised); border:1px solid var(--line); font:inherit; }
.assistant-document :deep(code) { font-size:.95em; }
.assistant-document :deep(table) { width:100%; border-collapse:collapse; table-layout:fixed; margin:.7em 0; font-size:12px; }
.assistant-document :deep(:is(th,td)) { border:1px solid var(--line); padding:.45em .6em; text-align:left; vertical-align:top; }
.assistant-document :deep(th) { background:var(--surface-raised); font-weight:600; }
.assistant-document :deep(hr) { border:0; border-top:1px solid var(--line); margin:1em 0; }
.assistant-document :deep(.assistant-document-link) { text-decoration:underline; text-underline-offset:3px; }
</style>
