<script setup lang="ts">
import { computed } from 'vue'
import StudioIcon from '../../../ui/StudioIcon.vue'
import { consistencyGuidance } from '../services/consistency-guidance'
import type { ConsistencyItem, ConsistencyItemStatus, ConsistencyOverview } from '../../../../contracts/index'

const props = defineProps<{
  overview: ConsistencyOverview
  busy?: boolean
}>()

defineEmits<{
  'select-item': [item: ConsistencyItem]
  'write': []
}>()

const guidance = computed(() => consistencyGuidance(props.overview))
const nextItem = computed(() => guidance.value.requiredItem)
function actionLabel(item: ConsistencyItem) {
  if (item.status === 'deferred') return '查看说明'
  if (item.id === 'events') return item.target === 'outline' ? '查看总纲事件关联（可选）' : '查看纪事'
  if (item.id === 'foundation' && item.status === 'ready') return '查看设定'
  if (item.id === 'characterState' || item.id === 'literaryStyle') return item.status === 'ready' ? '查看结果' : '核对并处理'
  return ({ foundation: '去补充设定', totalOutline: '打开总纲', volumeOutline: '打开卷纲', events: '打开事件', chapterOutline: '打开章纲', chapterContract: '打开章纲' })[item.id]
}

function statusMarker(status: ConsistencyItemStatus) {
  if (status === 'ready') return '合'
  if (status === 'blocked') return '阻'
  if (status === 'attention') return '察'
  return '待'
}
</script>

<template>
  <article class="consistency-overview" :class="`status-${overview.status}`" data-testid="consistency-overview">
    <section class="consistency-next-step" data-testid="consistency-next-step">
      <span class="guidance-caption">{{ guidance.heading }}</span>
      <p>{{ guidance.description }}</p>
      <button v-if="nextItem" class="control-button primary compact" type="button" :disabled="busy" @click="$emit('select-item', nextItem)">{{ actionLabel(nextItem) }}<StudioIcon name="arrow" :size="14"/></button>
      <button v-else class="control-button primary compact" type="button" :disabled="busy" @click="$emit('write')">{{ overview.readyForProse ? '进入书稿继续写' : '先手写正文' }}<StudioIcon name="arrow" :size="14"/></button>
      <small v-if="nextItem?.status === 'blocked'">这项影响 AI 正文生成；手写正文仍可继续。</small>
      <small v-else-if="guidance.optionalNote">下方有{{ guidance.optionalNote }}，不是继续写作前必须确认的事项。</small>
    </section>
    <header>
      <div><span>一致性总览</span><b>{{ overview.chapterPosition ? `第 ${overview.chapterPosition} 章` : '当前作品' }}</b></div>
      <em>{{ overview.summary }}</em>
    </header>
    <div class="consistency-layers">
      <button v-for="item in overview.items" :key="item.id" type="button" :class="`status-${item.status}`" :disabled="busy" :data-consistency-id="item.id" @click="$emit('select-item', item)">
        <i aria-hidden="true">{{ statusMarker(item.status) }}</i>
        <span><b>{{ item.label }}<em class="consistency-state-label">{{ { ready: '已通过', attention: '建议核对', blocked: '需要处理', deferred: '待检查' }[item.status] }}</em></b><small>{{ item.summary }}</small><span class="consistency-action-label">{{ actionLabel(item) }} →</span></span>
      </button>
    </div>
    <footer v-if="overview.blockers.length"><b>生成正文前还需处理</b><span>{{ overview.blockers.join(' · ') }}</span></footer>
  </article>
</template>
