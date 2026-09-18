<script setup lang="ts">
import type { FieldCandidate } from '../../../../contracts/assistant/field-assistant-contracts'
defineProps<{candidate:FieldCandidate;current:boolean;busy:boolean;canUndo:boolean;message:string}>()
defineEmits<{apply:[];undo:[]}>()
</script>
<template>
  <section class="field-assistant-candidate" data-testid="field-assistant-candidate">
    <header><b>{{ candidate.target.label }}</b><span>{{ candidate.model }} · 修改候选</span></header>
    <div class="field-candidate-comparison"><section><h4>修改前</h4><pre>{{ candidate.before === '' ? '（空白）' : candidate.before }}</pre></section><section><h4>建议修改为</h4><pre data-testid="field-candidate-after">{{ candidate.after }}</pre></section></div>
    <p v-if="message" role="status">{{ message }}</p>
    <footer><button v-if="candidate.status === 'candidate'" type="button" class="control-button primary" :disabled="busy || !current" data-testid="apply-field-candidate" @click="$emit('apply')">应用到此字段</button><button v-if="canUndo" type="button" class="control-button secondary" :disabled="busy" data-testid="undo-field-candidate" @click="$emit('undo')">撤销本次回填</button></footer>
  </section>
</template>
