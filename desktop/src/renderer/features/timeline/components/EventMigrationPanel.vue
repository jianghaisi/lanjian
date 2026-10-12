<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ state: any; busy: boolean; error: string; ready: boolean }>()
const emit = defineEmits<{
  close: []; commit: []; page: [page: number]; acknowledge: [collection: string, value: string | number, checked: boolean]
}>()
const pageSize = 100
const restoring = computed(() => props.state.kind === 'state-initialization')
const pages = computed(() => Math.max(1, Math.ceil((props.state.rows?.length || 0) / pageSize)))
const visibleRows = computed(() => (props.state.rows || []).slice(props.state.page * pageSize, (props.state.page + 1) * pageSize))
const sourceLabel = (source: string) => ({ sources: '资料来源', events: '资料事件', timeline: '作者纪事' }[source] || source)
const statusLabel = (status: string) => ({ source: '仅保留来源', candidate: '候选', approved: '已确认',
  'direct-unconfirmed': '作者纪事', invalid: '无效记录' }[status] || status)
</script>

<template>
  <section class="event-migration-panel" role="dialog" aria-modal="true" aria-labelledby="event-migration-title" data-testid="event-migration-panel">
    <header><div><small>{{ restoring ? '统一事件恢复' : '统一事件迁移' }}</small><h2 id="event-migration-title">{{ restoring ? '恢复已迁移作品的事件状态' : '逐项核对旧纪事去向' }}</h2><p>{{ restoring ? '将从已封存的迁移记录恢复事件顺序和归档状态，不重跑迁移，也不修改原文件。' : '这里只建立版本、顺序和来源映射。原文件保留，候选不会自动变成正式事实。' }}</p></div><button type="button" :disabled="busy" @click="emit('close')">暂不处理</button></header>
    <template v-if="restoring">
      <div class="event-migration-summary"><b>{{ state.preview.eventCount }} 个事件身份</b><span>迁移记录 {{ state.preview.migrationOperationId }}</span><span>顺序校验 {{ state.preview.orderHash.slice(0, 12) }}</span></div>
      <p class="chronicle-warning">当前作品已有完整迁移凭据，但缺少早期版本未写入的事件状态。确认后会再次校验全部事件身份和版本头，并以原迁移顺序初始化。</p>
      <p v-if="error" class="chronicle-warning" role="alert">{{ error }}</p>
      <footer class="event-migration-actions"><span>若作品、会话或数据库证据变化，恢复会中止且不写入。</span><button type="button" class="chronicle-primary" :disabled="busy || !ready" @click="emit('commit')">{{ busy ? '正在核对…' : '确认恢复事件顺序' }}</button></footer>
    </template>
    <template v-else>
    <div class="event-migration-summary">
      <b>{{ state.preview.summary.rowCount }} 条记录</b><span>{{ state.preview.summary.referenceCount }} 个引用</span><span>{{ state.preview.summary.groupCount }} 组重复或相似项</span><span>{{ state.preview.summary.planningFindingCount }} 项谋篇核对</span>
    </div>
    <p v-if="state.preview.summary.blockedRowCount || state.preview.summary.blockingGroupCount || state.preview.summary.blockedReferenceCount || state.preview.summary.planningBlockingCount" class="chronicle-warning" role="alert">当前有无效记录或断裂引用，不能提交迁移。原文件未修改；请按下方问题修复后重新预览。</p>
    <p v-if="error" class="chronicle-warning" role="alert">{{ error }}</p>
    <section class="event-migration-rows"><header><b>记录 {{ state.page * pageSize + 1 }}–{{ Math.min((state.page + 1) * pageSize, state.rows.length) }}</b><span>第 {{ state.page + 1 }} / {{ pages }} 页</span></header>
      <ol><li v-for="row in visibleRows" :key="row.index" :class="{ blocked: row.recordCheck === 'invalid' }"><i>{{ row.index + 1 }}</i><div><b>{{ sourceLabel(row.ref.source) }} · {{ statusLabel(row.legacyStatus) }}</b><small>{{ row.ref.originalId || '无原始 ID' }} · {{ row.ref.contentHash.slice(0, 12) }}</small><p v-if="row.recordProblem">{{ row.recordProblem }}</p><p v-else>{{ row.defaultDisposition === 'retain-source' ? '保留为可追溯资料，不建立事件。' : '保留为独立事件身份；相同内容不会被静默合并。' }}</p></div><span>{{ row.recordCheck === 'valid' ? '已指定去向' : '需要修复' }}</span></li></ol>
      <footer><button type="button" :disabled="state.page <= 0" @click="emit('page', state.page - 1)">上一页</button><button type="button" :disabled="state.page >= pages - 1" @click="emit('page', state.page + 1)">下一页</button></footer>
    </section>
    <section v-if="state.groups.some((item: any) => item.severity === 'review')" class="event-migration-checks"><h3>重复与相似项</h3><label v-for="group in state.groups.filter((item: any) => item.severity === 'review')" :key="group.id"><input type="checkbox" :checked="state.acknowledgedGroups.includes(group.id)" @change="emit('acknowledge', 'acknowledgedGroups', group.id, ($event.target as HTMLInputElement).checked)"><span>第 {{ group.id + 1 }} 组 · {{ group.memberCount }} 条 · 已理解它们会按上述去向分别保留</span></label></section>
    <section v-if="state.findings.some((item: any) => item.severity === 'review')" class="event-migration-checks"><h3>谋篇与章节引用</h3><label v-for="(finding, index) in state.findings" v-show="finding.severity === 'review'" :key="`${finding.path}:${index}`"><input type="checkbox" :checked="state.acknowledgedPlanningFindings.includes(index)" @change="emit('acknowledge', 'acknowledgedPlanningFindings', index, ($event.target as HTMLInputElement).checked)"><span>{{ finding.path }} · {{ finding.code }} · 已知该引用需要后续复核</span></label></section>
    <section v-if="state.preview.requiredMirrorAcknowledgements.length" class="event-migration-checks"><h3>原文件与可读镜像</h3><label v-for="kind in state.preview.requiredMirrorAcknowledgements" :key="kind"><input type="checkbox" :checked="state.acknowledgedMirrors.includes(kind)" @change="emit('acknowledge', 'acknowledgedMirrors', kind, ($event.target as HTMLInputElement).checked)"><span>{{ sourceLabel(kind) }} 当前缺失、待同步或有外部改动；迁移事务不会覆盖原文件</span></label></section>
    <footer class="event-migration-actions"><span>确认时会再次核对作品、原文件、事件版本和章节引用；任何变化都会中止。</span><button type="button" class="chronicle-primary" :disabled="busy || !ready" @click="emit('commit')">{{ busy ? '正在核对…' : '确认并切换到统一事件' }}</button></footer>
    </template>
  </section>
</template>
