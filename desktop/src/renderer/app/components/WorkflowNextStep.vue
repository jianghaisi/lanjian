<script setup lang="ts">
import { computed } from 'vue'
import type { ConsistencyItem, ConsistencyOverview, WorkflowStatus, WorkflowStep } from '../../../contracts/index'
import StudioIcon from '../../ui/StudioIcon.vue'

const props = defineProps<{ workflow: WorkflowStatus; overview?: ConsistencyOverview | null; busy?: boolean }>()
defineEmits<{ navigate: [step: WorkflowStep]; 'select-item': [item: ConsistencyItem]; write: [] }>()
const next = computed(() => props.workflow.steps.find(step => step.id === props.workflow.currentStep))
const requiredItem = computed(() => props.overview?.items.find(item => item.status === 'blocked'))
const actionLabels: Record<WorkflowStep['id'], string> = {
  definition: '填写作品设想', materials: '整理创作素材', foundation: '补充故事设定',
  events: '安排故事事件', outline: '编写全书总纲', chapterPlan: '准备本章章纲'
}
</script>

<template>
  <section class="workflow-next-step" aria-label="下一步创作指引" data-testid="workflow-next-step">
    <span class="guidance-caption">{{ requiredItem ? 'AI 生成前，先处理这一项' : next ? '建议下一步' : '创作准备已齐备' }}</span>
    <p>{{ requiredItem ? requiredItem.summary : next ? next.missing.join('；') || next.detail : '进入书稿继续写作，无需额外确认。' }}</p>
    <button v-if="requiredItem" class="control-button primary compact" type="button" :disabled="busy" @click="$emit('select-item', requiredItem)">处理{{ requiredItem.label }}<StudioIcon name="arrow" :size="14"/></button>
    <button v-else class="control-button primary compact" type="button" :disabled="busy" @click="next ? $emit('navigate', next) : $emit('write')">{{ next ? actionLabels[next.id] : '进入书稿继续写' }}<StudioIcon name="arrow" :size="14"/></button>
    <details><summary>查看创作流程</summary><ol><li v-for="step in workflow.steps" :key="step.id"><span>{{ step.state === 'complete' ? '已完成' : step.id === workflow.currentStep ? '当前' : '待准备' }}</span><button type="button" :disabled="busy" @click="$emit('navigate', step)">{{ actionLabels[step.id] }}</button></li></ol></details>
  </section>
</template>
