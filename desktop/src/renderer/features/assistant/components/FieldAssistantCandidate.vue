<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { buildWritingAgentDiff } from '../../../../contracts/assistant/writing-diff'
import { assistantCharacterCount } from '../services/assistant-presentation'
import type { FieldCandidate } from '../../../../contracts/assistant/field-assistant-contracts'
const props=defineProps<{candidate:FieldCandidate;current:boolean;busy:boolean;canUndo:boolean;hasUndo?:boolean;confirmationPending?:boolean;message:string}>()
defineEmits<{apply:[];undo:[];retry:[]}>()
const root=ref<HTMLElement>(), selected=ref(-1)
const blocks=computed(()=>buildWritingAgentDiff(String(props.candidate.before),String(props.candidate.after)))
const changes=computed(()=>blocks.value.filter(block=>block.kind==='change'))
watch(()=>props.candidate.id,()=>{selected.value=-1})
function jump(){selected.value=(selected.value+1)%changes.value.length;root.value?.querySelector(`[data-change="${changes.value[selected.value]?.id}"]`)?.scrollIntoView({block:'center',behavior:'smooth'})}
</script>
<template>
  <section ref="root" class="field-assistant-candidate" data-testid="field-assistant-candidate">
    <header><b>{{ candidate.target.label }}</b><span>{{ candidate.model }} · 修改候选</span></header>
    <div class="assistant-diff-nav"><span>标色处为修改 · {{ changes.length }} 处</span><button v-if="changes.length" type="button" @click="jump">下一处变化 {{ selected>=0?`${selected+1}/${changes.length}`:'' }}</button></div>
    <div class="field-candidate-comparison"><section><h4>修改前 <span>{{ assistantCharacterCount(String(candidate.before)) }} 字</span></h4><pre><template v-if="candidate.before === ''">（空白）</template><span v-for="block in blocks" :key="block.id" :class="{'assistant-diff-removed':block.kind==='change'}" :data-change="block.kind==='change'?block.id:undefined">{{ block.before }}</span></pre></section><section><h4>建议修改为 <span>{{ assistantCharacterCount(String(candidate.after)) }} 字</span></h4><pre data-testid="field-candidate-after"><span v-for="block in blocks" :key="block.id" :class="{'assistant-diff-added':block.kind==='change'}">{{ block.after }}</span></pre></section></div>
    <p v-if="message" role="status">{{ message }}</p>
    <footer><button v-if="confirmationPending" type="button" class="control-button primary" :disabled="busy" data-field-receipt-retry data-testid="retry-field-receipt" @click="$emit('retry')">重试确认</button><button v-if="candidate.status === 'candidate' && !confirmationPending" type="button" class="control-button primary" :disabled="busy || !current" data-testid="apply-field-candidate" @click="$emit('apply')">应用到此字段</button><button v-if="hasUndo || canUndo" type="button" class="control-button secondary" :disabled="busy || confirmationPending || !canUndo" data-testid="undo-field-candidate" @click="$emit('undo')">撤销本次回填</button></footer>
  </section>
</template>
