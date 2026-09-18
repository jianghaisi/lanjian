<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
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
  <section class="creation-defaults" data-testid="creation-model-defaults" aria-label="新书模型分配">
    <header><b>本书的初始模型分配</b><button class="text-action compact" type="button" :disabled="disabled || loading" @click="refresh">重新读取</button></header>
    <p v-if="loading" role="status">正在核对默认分配…</p>
    <p v-else-if="error" role="alert">{{ error }}</p>
    <template v-else-if="preview">
      <p v-if="!preview.defaults.template">{{ manual ? '明确不继承默认分配。' : '尚未设置默认分配。' }}可以正常手写，之后再配置 AI。</p>
      <template v-else><p>复制默认版本 {{ preview.defaults.revision }}；之后修改默认，不会改变本书。</p><dl v-if="preview.defaults.template.routingMode === 'perTask'"><template v-for="(label, task) in { outline: '总纲', chapterOutline: '章纲', prose: '正文', review: '审校' }" :key="task"><dt>{{ label }}</dt><dd>{{ preview.defaults.template.tasks[task].model }}</dd></template></dl><p v-else>统一模型：{{ preview.defaults.template.shared.model }}</p></template>
    </template>
    <label><input v-model="manual" type="checkbox" :disabled="disabled || loading">本次不继承默认，先手写建书</label>
  </section>
</template>
<style scoped>
.creation-defaults { border-block:1px solid var(--line); padding-block:16px; display:grid; gap:10px; }
header { display:flex; align-items:center; justify-content:space-between; gap:12px; }
p { margin:0; font-size:var(--form-help); line-height:1.6; }
dl { display:grid; grid-template-columns:auto minmax(0,1fr); gap:6px 16px; margin:0; }
dd { margin:0; overflow-wrap:anywhere; }
label { display:flex; align-items:center; gap:8px; font-size:var(--form-help); }
input { width:auto; }
</style>
