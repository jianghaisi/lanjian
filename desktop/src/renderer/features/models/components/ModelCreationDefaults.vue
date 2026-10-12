<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { hostedModelMode } from '../services/hosted-model-mode'
import type { ModelConnectionsApi, ModelCreationPreview } from '../../../../contracts/models/model-connections-contracts'
const props = defineProps<{ api: ModelConnectionsApi; disabled?: boolean }>()
const emit = defineEmits<{ ready: [value: ModelCreationPreview | null] }>()
const preview = ref<ModelCreationPreview | null>(null), manual = ref(false), loading = ref(false), error = ref('')
let generation = 0
async function refresh() {
  const request = ++generation; loading.value = true; error.value = ''; preview.value = null; emit('ready', null)
  try { const result = await props.api.previewCreation(manual.value); if (request !== generation) return; preview.value = result; emit('ready', result) }
  catch (cause) { if (request === generation) error.value = cause && typeof cause === 'object' && 'message' in cause ? String(cause.message) : '默认分配读取失败，请重试或明确选择手写建书。' }
  finally { if (request === generation) loading.value = false }
}
onMounted(refresh); watch(manual, refresh)
onBeforeUnmount(() => { generation++; emit('ready', null) })
</script>
<template>
  <p v-if="hostedModelMode() && (loading || error)" role="status">{{ error || '正在准备作品…' }}</p>
  <section v-else-if="!hostedModelMode()" class="creation-defaults" data-testid="creation-model-defaults" aria-label="新书模型分配">
    <header><b>本书的写作模型</b><button class="text-action compact" type="button" :disabled="disabled || loading" @click="refresh">重新读取</button></header>
    <p v-if="loading" role="status">正在读取已配置的模型…</p>
    <p v-else-if="error" role="alert">{{ error }}</p>
    <template v-else-if="preview">
      <p v-if="!preview.defaults.template">{{ manual ? '不继承默认模型，可先手动写作。' : '尚未配置模型，可先手动写作。' }}</p>
      <template v-else><p>自动使用已配置的写作模型，无需重新填写 API 和密钥。</p><dl v-if="preview.defaults.template.routingMode === 'perTask'"><template v-for="(label, task) in { outline: '总纲', chapterOutline: '章纲', prose: '正文', review: '审校' }" :key="task"><dt>{{ label }}</dt><dd>{{ preview.defaults.template.tasks[task].model }}</dd></template></dl><p v-else>统一模型：{{ preview.defaults.template.shared.model }}</p></template>
    </template>
    <label class="creation-manual-choice"><input v-model="manual" type="checkbox" :disabled="disabled || loading"><span>这本书暂不使用 AI</span></label>
  </section>
</template>
<style scoped>
.creation-defaults { border-block:1px solid var(--line); padding-block:16px; display:grid; gap:10px; }
header { display:flex; align-items:center; justify-content:space-between; gap:12px; }
p { margin:0; font-size:var(--form-help); line-height:1.6; }
dl { display:grid; grid-template-columns:auto minmax(0,1fr); gap:6px 16px; margin:0; }
dd { margin:0; overflow-wrap:anywhere; }
label { display:flex; align-items:center; gap:8px; font-size:var(--form-help); }
.creation-defaults > label.creation-manual-choice { display:flex; flex-direction:row; justify-content:flex-start; gap:10px; width:fit-content; max-width:100%; cursor:pointer; }
.creation-defaults .creation-manual-choice > input[type=checkbox] { flex:0 0 16px; width:16px; height:16px; min-width:16px; min-height:16px; padding:0; margin:0; appearance:auto; accent-color:var(--jade); }
</style>
