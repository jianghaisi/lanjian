<script setup lang="ts">
import type { RoutingDraft, ModelSlot } from '../services/model-connections-state'
import { modelTaskLabels, copySharedProfiles } from '../services/model-connections-state'
import ArchiveFormField from '../../../ui/ArchiveFormField.vue'
import ArchiveAction from '../../../ui/ArchiveAction.vue'
const draft = defineModel<RoutingDraft>({ required: true })
defineProps<{ options: Array<{ value: string; label: string; disabled?: boolean }>; disabled?: boolean }>()
const slots = Object.keys(modelTaskLabels) as ModelSlot[]
</script>
<template>
  <div class="model-routing-form" data-testid="model-routing-form">
    <div class="routing-heading">
      <ArchiveFormField label="分配方式"><select v-model="draft.routingMode" aria-label="分配方式" :disabled="disabled"><option value="shared">统一模型</option><option value="perTask">按任务分别设置</option></select></ArchiveFormField>
      <ArchiveAction :disabled="disabled" @click="draft = copySharedProfiles(draft)">把统一选择复制到四项任务</ArchiveAction>
    </div>
    <p class="routing-help">切换方式不会删除另一组参数。型号可手动填写；保存不会自动联网测试。</p>
    <fieldset v-for="slot in slots" :key="slot" :disabled="disabled" :class="{ inactive: (slot === 'shared') !== (draft.routingMode === 'shared') }" :data-model-slot="slot">
      <legend>{{ modelTaskLabels[slot] }} <small v-if="(slot === 'shared') !== (draft.routingMode === 'shared')">当前不启用，参数仍保留</small></legend>
      <div class="model-profile-grid">
        <ArchiveFormField label="接口来源"><select v-model="draft.profiles[slot].selection" :aria-label="`${modelTaskLabels[slot]}接口`"><option value="" disabled>请选择接口</option><option v-if="draft.profiles[slot].selection && !options.some(o => o.value === draft.profiles[slot].selection)" :value="draft.profiles[slot].selection" disabled>原选择不可用，请重新分配</option><option v-for="option in options" :key="option.value" :value="option.value" :disabled="option.disabled">{{ option.label }}</option></select></ArchiveFormField>
        <ArchiveFormField label="模型型号"><input v-model="draft.profiles[slot].model" :aria-label="`${modelTaskLabels[slot]}型号`" maxlength="500" autocomplete="off" placeholder="填写接口实际支持的型号"></ArchiveFormField>
        <ArchiveFormField label="创造性"><input v-model.number="draft.profiles[slot].temperature" :aria-label="`${modelTaskLabels[slot]}创造性`" type="number" min="0" max="2" step="0.05"></ArchiveFormField>
        <ArchiveFormField label="采样范围"><input v-model.number="draft.profiles[slot].topP" :aria-label="`${modelTaskLabels[slot]}采样范围`" type="number" min="0" max="1" step="0.05"></ArchiveFormField>
        <ArchiveFormField label="最大输出 tokens"><input v-model.number="draft.profiles[slot].maxTokens" :aria-label="`${modelTaskLabels[slot]}最大输出`" type="number" min="128" :max="draft.profiles[slot].selection === 'local' ? 4096 : 128000" step="128"></ArchiveFormField>
      </div>
    </fieldset>
  </div>
</template>
<style scoped>
.model-routing-form { display:grid; gap:16px; }
.routing-heading { display:flex; align-items:end; gap:16px; flex-wrap:wrap; }
.routing-help, legend small { color:var(--muted); font-size:var(--form-help); line-height:1.6; }
fieldset { border:1px solid var(--line); padding:16px; min-width:0; }
legend { font-size:var(--form-heading); padding:0 8px; }
legend small { display:inline-block; margin-left:8px; font-weight:400; }
.model-profile-grid { display:grid; grid-template-columns:minmax(140px,1fr) minmax(180px,1.4fr) repeat(3,minmax(80px,.6fr)); gap:12px; }
input, select { min-width:0; width:100%; min-height:var(--form-control-height,40px); }
input, select { background:var(--surface); color:var(--ink); border:1px solid var(--line); padding:6px 8px; font:inherit; }
:is(input,select):focus-visible { outline:2px solid var(--jade); outline-offset:2px; }
@container (max-width:800px) { .model-profile-grid { grid-template-columns:repeat(2,minmax(0,1fr)); } }
@media (max-width:900px) { .model-profile-grid { grid-template-columns:repeat(2,minmax(0,1fr)); } }
</style>
