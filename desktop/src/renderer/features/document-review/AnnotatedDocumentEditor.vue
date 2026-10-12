<script setup lang="ts">
import { computed, ref, useAttrs, watch } from 'vue'
import ManuscriptEditor from '../manuscript/components/ManuscriptEditor.vue'
import OutlineHistory from './OutlineHistory.vue'
import type { DocumentKind } from '../../../contracts/document-review/types'

defineOptions({ inheritAttrs: false })
const props = defineProps<{
  workItemId: string; kind: DocumentKind; legacyId?: number; modelValue: string
  documentTitle?: string; documentLabel?: string; titlePrefix?: string; titleEditable?: boolean; titleAriaLabel?: string
  readOnly?: boolean; saveState?: 'saved' | 'dirty' | 'saving' | 'error'
  savedLabel?: string; saveErrorMessage?: string; saveDisabled?: boolean; saveButtonId?: string
  assistantOpen?: boolean
}>()
const emit = defineEmits<{
  'update:modelValue': [value: string]; 'update:documentTitle': [value: string]
  'composition-start': []; 'composition-end': [value: string]
  save: []; 'focus-mode': [value: boolean]; 'assistant-toggle': []; guidance: [event: MouseEvent]
}>()
const attrs = useAttrs()
const editor = ref<InstanceType<typeof ManuscriptEditor> | null>(null)
const historyOpen = ref(false)
const identity = computed(() => JSON.stringify([props.workItemId, props.kind, props.legacyId]))
watch(identity, () => { historyOpen.value = false })
const label = computed(() => props.documentLabel || ({ total: '总纲', volume: '卷纲', stage: '阶段纲', 'chapter-outline': '章纲', body: '正文' }[props.kind]))
const editorAttrs = computed(() => Object.fromEntries(Object.entries(attrs).filter(([key]) => !['class', 'style', 'editing-tools', 'document-key', 'comfortable-caret', 'aria-label'].includes(key))))
defineExpose({
  insertText: (text: string) => editor.value?.insertText(text) || false,
  focus: () => editor.value?.focus(),
  flush: () => editor.value?.flush(),
  saveReviewedDraft: (value: { title?: string; content: string }) => editor.value?.saveReviewedDraft(value),
  openReview: (taskId: string) => editor.value?.openReview(taskId)
})
</script>
<template>
  <div class="annotated-document-editor">
  <ManuscriptEditor ref="editor" :key="identity" v-bind="editorAttrs"
    :work-item-id="workItemId" :document-kind="kind" :chapter-id="legacyId || 0" :position="legacyId || 0" :project-word-count="0"
    :document-label="label" :title-prefix="titlePrefix" :title="documentTitle ?? label" :title-read-only="!titleEditable"
    :title-aria-label="titleAriaLabel || label + '标题'" :content-aria-label="String(attrs['aria-label'] || label + '正文')"
    :content="modelValue" :read-only="readOnly" :save-state="saveState || 'saved'" :saved-label="savedLabel || label + '已保存'"
    :save-error-message="saveErrorMessage" :save-disabled="saveDisabled" :save-button-id="saveButtonId || 'save-outline-document'"
    :assistant-open="assistantOpen" @history="historyOpen = true" @save="emit('save')"
    @update:content="emit('update:modelValue', $event)" @update:title="emit('update:documentTitle', $event)"
    @composition-start="emit('composition-start')" @composition-end="emit('composition-end', $event)"
    @focus-mode="emit('focus-mode', $event)" @assistant-toggle="emit('assistant-toggle')" @guidance="emit('guidance', $event)" />
  <OutlineHistory v-if="historyOpen" :key="identity" :work-item-id="workItemId" :kind="kind" :legacy-id="legacyId"
    :read-only="readOnly" :current-content="modelValue" @close="historyOpen = false"
    @restore="content => { if (editor?.restoreContent(content)) historyOpen = false }" />
  </div>
</template>
<style scoped>
.annotated-document-editor { display:flex; flex-direction:column; height:100%; min-width:0; min-height:0; overflow:hidden; }
.annotated-document-editor > .manuscript-editor { flex:1; height:auto; }
</style>
