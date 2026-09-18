<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { OutlineMirrorRecoveryPreview, OutlineMirrorRecoveryResult } from '../../../../contracts/index'

const props = defineProps<{ workItemId: string; chapterId: number; draft: string; dirty: boolean; disabled?: boolean }>()
const emit = defineEmits<{ adopted: [value: { workItemId: string; chapterId: number; draft: string; result: OutlineMirrorRecoveryResult }] }>()
const preview = ref<OutlineMirrorRecoveryPreview | null>(null)
const busy = ref(false), message = ref('')
const trigger = ref<HTMLButtonElement | null>(null)
let requestGeneration = 0
watch(() => [props.workItemId, props.chapterId], () => { requestGeneration++; preview.value = null; busy.value = false; message.value = '' })
onBeforeUnmount(() => requestGeneration++)

async function inspect() {
  const request = ++requestGeneration
  busy.value = true; message.value = ''; preview.value = null
  try {
    const result = await window.novelDesktop.chapterOutlines.previewExternalMirror(props.chapterId)
    if (request !== requestGeneration) return
    preview.value = result
  } catch (error) {
    if (request === requestGeneration) message.value = error instanceof Error ? error.message : '暂时无法核对外部章纲。'
  } finally { if (request === requestGeneration) busy.value = false }
}

async function close() {
  if (busy.value) return
  requestGeneration++; preview.value = null; message.value = ''
  await nextTick(); trigger.value?.focus()
}

async function adopt() {
  if (!preview.value || busy.value || props.dirty || props.disabled) return
  const request = ++requestGeneration, token = preview.value.token
  const target = { workItemId: props.workItemId, chapterId: props.chapterId, draft: props.draft }
  busy.value = true; message.value = ''
  try {
    const result = await window.novelDesktop.chapterOutlines.adoptExternalMirror(token)
    if (request !== requestGeneration) return
    preview.value = null
    message.value = result.mirrorPending ? '正式章纲已恢复，外部文件仍需核对；请勿重复采用。' : '外部章纲已作为新版本恢复，原版本已保留。'
    emit('adopted', { ...target, result })
  } catch (error) {
    if (request === requestGeneration) {
      preview.value = null
      message.value = error instanceof Error ? error.message : '未能恢复章纲，请重新核对当前版本。'
    }
  } finally { if (request === requestGeneration) busy.value = false }
}
</script>

<template>
  <section class="outline-recovery" aria-label="核对外部章纲" @keydown.esc.stop.prevent="close">
    <button ref="trigger" class="control-button secondary compact" type="button" data-testid="preview-outline-mirror" :disabled="busy || disabled" @click="inspect">{{ busy ? '正在核对…' : '核对外部章纲' }}</button>
    <p v-if="message" role="status" data-testid="outline-mirror-message">{{ message }}</p>
    <section v-if="preview" class="outline-recovery-review" data-testid="outline-mirror-preview">
      <p>比较两份完整章纲。采用后会保留原版本；章名和所属篇卷保持当前值。</p>
      <div class="outline-recovery-columns">
        <label>当前正式章纲<textarea :value="preview.sqliteContent" readonly aria-label="当前正式章纲内容" /></label>
        <label>外部 Markdown 章纲<textarea :value="preview.externalContent" readonly aria-label="外部章纲内容" /></label>
      </div>
      <p v-if="dirty">当前章纲有未保存修改，请先处理这些修改，再采用外部稿。</p>
      <footer>
        <button class="control-button secondary compact" type="button" data-testid="cancel-outline-mirror" :disabled="busy" @click="close">取消</button>
        <button class="control-button primary compact" type="button" data-testid="adopt-outline-mirror" :disabled="busy || dirty || disabled" @click="adopt">采用外部章纲为新版本</button>
      </footer>
    </section>
  </section>
</template>

<style scoped>
.outline-recovery { flex: 0 0 auto; min-width: 0; padding: 8px 12px; border-bottom: 1px solid var(--border, #b8b8ad); }
.outline-recovery p { margin: 8px 0; font-size: 13px; line-height: 1.6; }
.outline-recovery-review { max-height: 48vh; overflow: auto; }
.outline-recovery-columns { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.outline-recovery-columns label { display: flex; flex-direction: column; min-width: 0; gap: 6px; font-size: 13px; }
.outline-recovery-columns textarea { width: 100%; min-width: 0; height: 180px; resize: vertical; box-sizing: border-box; font: inherit; line-height: 1.7; white-space: pre-wrap; padding: 10px; color: inherit; background: transparent; border: 1px solid var(--border, #b8b8ad); }
.outline-recovery footer { display: flex; justify-content: flex-end; gap: 10px; padding: 10px 0; }
@media (max-width: 800px) { .outline-recovery-columns { grid-template-columns: 1fr; } }
</style>
