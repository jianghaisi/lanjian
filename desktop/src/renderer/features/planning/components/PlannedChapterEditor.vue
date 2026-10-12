<script setup lang="ts">
import { ref } from 'vue'
import PlanningWritingHelp from './PlanningWritingHelp.vue'
import AnnotatedDocumentEditor from '../../document-review/AnnotatedDocumentEditor.vue'
import type { PlannedChapterOutline } from '../../../../contracts/index'
import type { ManuscriptRecoveryDraft } from '../../manuscript/services/manuscript-recovery-store'

// A review receipt confirms content/version before file metadata is reread.
type DocumentView = Omit<PlannedChapterOutline, 'mirrorStatus'> & { mirrorStatus?: PlannedChapterOutline['mirrorStatus'] }
const props = defineProps<{ workItemId: string; document: DocumentView; title: string; content: string; dirty: boolean; busy: boolean; starting: boolean; error: string; recovery: ManuscriptRecoveryDraft | null; recoveryError: string; assistantOpen?: boolean }>()
const emit = defineEmits<{ 'update:title': [value: string]; 'update:content': [value: string]; save: []; start: []; reload: [checkSavedOnly?: boolean]; restoreRecovery: []; discardRecovery: []; composing: [value: boolean]; 'focus-mode': [value: boolean]; 'assistant-toggle': []; guidance: [event: MouseEvent] }>()
const editor = ref<InstanceType<typeof AnnotatedDocumentEditor> | null>(null)
const composing = ref(false)
function setComposing(value: boolean) { composing.value = value; emit('composing', value) }
function insertTemplate(text: string) { return !props.busy && !composing.value && (editor.value?.insertText(text) || false) }
defineExpose({ flush: () => editor.value?.flush(), insertText: insertTemplate, saveReviewedDraft: (value: { title?: string; content: string }) => editor.value?.saveReviewedDraft(value) })
</script>

<template>
  <section class="planned-chapter-editor" :class="{ recovering: Boolean(recovery) }" data-testid="planned-chapter-editor" aria-label="独立章纲编辑">
    <header class="planned-toolbar">
      <div><b>章纲 · 尚未开始正文</b><small>{{ document.volume ? `第 ${document.volume} 卷` : '待归卷' }}{{ document.stage ? ` · 阶段 ${document.stage}` : '' }}</small></div>
      <nav class="planned-actions" aria-label="章纲操作">
        <button v-if="document.mirrorStatus === undefined" class="control-button secondary compact" type="button" data-testid="check-planned-save" :disabled="busy || starting" @click="emit('reload', true)">核对文件状态</button>
        <button class="control-button secondary compact" type="button" data-testid="start-planned-chapter" :disabled="busy || Boolean(recovery) || !title.trim() || !content.trim()" @click="emit('start')">{{ starting ? '正在交接…' : '开始写正文' }}</button>
      </nav>
    </header>
    <PlanningWritingHelp v-if="!recovery" kind="chapter" :empty="!content.trim()" :disabled="busy || composing" @insert="insertTemplate" />
    <section v-if="recovery" class="planned-recovery" data-testid="planned-outline-recovery" aria-label="章纲恢复对比">
      <header><b>发现尚未保存的章纲草稿</b><p>{{ recovery.baseRevision === document.revision ? '正式版本没有变化，可恢复后继续编辑。' : '正式章纲已更新，请先对比两份内容；不会自动覆盖。' }}</p></header>
      <div class="recovery-comparison"><section><h3>当前正式章纲 · {{ document.title }}</h3><pre>{{ document.content }}</pre></section><section><h3>恢复稿 · {{ recovery.title }}</h3><pre>{{ recovery.content }}</pre></section></div>
      <div class="planned-actions"><button class="control-button secondary compact" :disabled="busy" data-testid="discard-planned-recovery" @click="emit('discardRecovery')">丢弃恢复稿</button><button class="control-button primary compact" :disabled="busy" data-testid="restore-planned-recovery" @click="emit('restoreRecovery')">恢复到编辑器</button></div>
    </section>
    <AnnotatedDocumentEditor ref="editor" :work-item-id="workItemId" kind="chapter-outline" :legacy-id="document.chapterId" :document-title="title" @update:document-title="emit('update:title', $event)" title-editable title-aria-label="独立章纲标题" document-label="章纲" title-prefix="章纲" save-button-id="save-planned-chapter" :save-state="error ? 'error' : busy ? 'saving' : dirty ? 'dirty' : 'saved'" :save-error-message="error" :save-disabled="busy || !title.trim()" :saved-label="document.mirrorStatus === undefined ? '章纲已保存 · 文件状态待核对' : document.mirrorStatus === 'synced' ? '章纲已保存 · 可读文件已同步' : '章纲已保存 · 可读文件待同步'" :assistant-open="assistantOpen" @focus-mode="emit('focus-mode', $event)" @assistant-toggle="emit('assistant-toggle')" @guidance="emit('guidance', $event)" :assistant-field="{id:'PlannedChapterEditor.content',read:()=>content,write:value=>emit('update:content',String(value))}" v-else :model-value="content" :read-only="starting" :document-key="`planned-chapter:${document.chapterId}`"  aria-label="独立章纲正文" comfortable-caret @update:model-value="emit('update:content', $event)" @save="emit('save')" @composition-start="setComposing(true)" @composition-end="emit('update:content', $event); setComposing(false)" />
    <footer v-if="recovery || recoveryError || error"><p v-if="recoveryError" class="planned-error" role="alert">{{ recoveryError }}</p><p v-if="error" class="planned-error" role="alert">{{ error }} <button class="control-button secondary compact" type="button" :disabled="busy" @click="emit('save')">重试保存</button> <button class="control-button secondary compact" type="button" data-testid="reload-planned-chapter" :disabled="busy" @click="emit('reload')">重新读取已保存稿</button></p><p v-else role="status" data-testid="planned-chapter-status">{{ recovery ? '恢复稿等待处理，正式章纲保持不变' : busy ? '正在保存章纲…' : dirty ? '有修改待保存' : document.mirrorStatus === 'synced' ? '章纲已保存 · 可读文件已同步' : '章纲已保存 · 可读文件待同步，请在项目数据中检查' }}</p><small>保存只修改章纲；只有明确开始写正文才会建章。未处理的恢复稿可稍后再打开处理。</small></footer>
  </section>
</template>

<style scoped>
.planned-chapter-editor { display: flex; flex-direction: column; height: 100%; min-width: 0; min-height: 0; padding: 0; color: var(--ink); font-family: var(--sans); }
.planned-chapter-editor > header, .planned-chapter-editor > footer { flex: none; }
.planned-chapter-editor > .annotated-document-editor, .planned-recovery { flex: 1; }
.planned-chapter-editor .planning-writing-help { max-height:180px; margin-inline:.75rem; flex:none; overflow:auto; }
.planned-chapter-editor:has(.is-focus-mode) > .planned-toolbar, .planned-chapter-editor:has(.is-focus-mode) > .planning-writing-help { display:none; }
.planned-chapter-editor .planned-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 64px; padding: 8px 12px; border-bottom: 1px solid var(--line); }
.planned-toolbar > div { display: grid; gap: 5px; font-size: 15px; }
.planned-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
.planned-toolbar small, footer small { color: var(--ink-soft); font-size: 12px; }
.planned-chapter-editor > footer { display: block; padding: 12px 0; border-top: 1px solid var(--line); }
.planned-chapter-editor > footer p { margin: 0 0 6px; font-size: 13px; line-height: 1.7; }
.planned-error { color: var(--cinnabar); }
.planned-recovery { display: grid; grid-template-rows: auto minmax(0, 1fr) auto; gap: 16px; min-height: 0; padding-bottom: 16px; }
.planned-recovery header p { font-size: 13px; color: var(--ink-soft); }
.recovery-comparison { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; min-height: 0; overflow: auto; }
.recovery-comparison section { min-width: 0; border: 1px solid var(--line); padding: 16px; overflow: auto; }
.recovery-comparison h3 { margin: 0 0 12px; font: 600 14px/1.5 var(--sans); }
.recovery-comparison pre { white-space: pre-wrap; overflow-wrap: anywhere; font: 14px/1.8 var(--sans); margin: 0; }
@media (max-width: 900px) { .recovery-comparison { grid-template-columns: minmax(0, 1fr); } }
</style>
