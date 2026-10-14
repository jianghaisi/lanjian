<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { ModelConnectionsApi, ModelProbeResult } from '../../../../contracts/models/model-connections-contracts'
import type { GlobalConnectionView } from '../../../../contracts/models/model-connections'
import ModelParameterEditor from './ModelParameterEditor.vue'
import { useModelTests } from '../composables/use-model-tests'
import ArchiveAction from '../../../ui/ArchiveAction.vue'
const props = defineProps<{ api: ModelConnectionsApi; connection: GlobalConnectionView; disabled?: boolean; allowDefault?: boolean }>()
const emit = defineEmits<{ busy: [value: boolean]; choose: [result: ModelProbeResult] }>()
const { catalog, setParameters, rows, selected, error, loading, testing, busy, load, testModels, cancel, dispose } = useModelTests(props.api)
const query = ref('')
const batchOpen = ref(false)
const visible = computed(() => rows.value.filter(row => row.model.toLowerCase().includes(query.value.trim().toLowerCase())))
const finished = computed(() => rows.value.filter(row => ['passed', 'failed', 'cancelled'].includes(row.status)).length)
const labels = { idle: '未测试', queued: '等待中', testing: '测试中', passed: '文字测试通过', failed: '失败', cancelled: '已停止' }
watch(busy, value => emit('busy', value), { immediate: true })
// Parent keys this panel by connection identity/revision; every entry is an explicit user action.
void load(props.connection)
onBeforeUnmount(() => { dispose(); emit('busy', false) })
</script>
<template>
  <section class="model-tests" data-testid="model-test-panel" :aria-busy="busy">
    <header><div><h4>选择一个模型试用</h4><p>仅测试文字回复，尚未验证工具调用。测试会发送一条简短请求，可能产生费用；不会发送书稿。</p></div><ArchiveAction compact :disabled="busy || disabled" @click="load(connection)">重新获取模型</ArchiveAction></header>
    <p>重新获取会保留当前接口同名型号的参数，并清除旧测试结果；刷新失败可重试，参数不会改成自动。</p>
    <p v-if="catalog">{{ connection.name }} · 已获取 {{ catalog.entries.length }} 个型号 · 可文本测试 {{ rows.length }} 个<span v-if="catalog.entries.length > rows.length"> · 已排除 {{ catalog.entries.length - rows.length }} 个非文本型号</span> · {{ new Date(catalog.fetchedAt).toLocaleString() }}</p>
    <p v-if="loading" role="status">正在获取模型列表…</p><p v-if="error" class="error" role="alert">{{ error }}</p>
    <div v-if="rows.length" class="test-actions">
      <input v-model="query" type="search" aria-label="筛选模型" placeholder="搜索模型" :disabled="busy || disabled">
      <ArchiveAction compact :disabled="busy || disabled" :aria-expanded="batchOpen" @click="batchOpen = !batchOpen">{{ batchOpen ? '收起批量操作' : '批量测试…' }}</ArchiveAction>
    </div>
    <div v-if="rows.length && batchOpen" class="test-actions"><ArchiveAction :disabled="busy || disabled" @click="selected = selected.length === rows.length ? [] : rows.map(row => row.model)">{{ selected.length === rows.length ? '取消全选' : '全选' }}</ArchiveAction><ArchiveAction :disabled="busy || disabled || !selected.length" @click="testModels(selected)">测试所选（{{ selected.length }}）</ArchiveAction><ArchiveAction :disabled="busy || disabled" data-testid="test-all-models" @click="testModels(rows.map(row => row.model))">全部测试（{{ rows.length }}）</ArchiveAction><p>全部测试会逐一调用此接口返回的所有型号，包括搜索结果以外的型号。</p></div>
    <div v-if="busy" class="test-actions" role="status"><span>{{ testing ? `正在逐项测试 · ${finished}/${rows.length} 已处理` : '正在读取接口' }}</span><ArchiveAction @click="cancel" data-testid="stop-model-tests">停止</ArchiveAction></div>
    <div v-if="rows.length" class="test-list">
      <article v-for="row in visible" :key="row.model" :data-model="row.model" class="test-row">
        <label><input v-if="batchOpen" v-model="selected" type="checkbox" :value="row.model" :disabled="busy || disabled"><span>{{ row.model }}</span></label>
        <span :class="['result', row.status]" role="status">{{ labels[row.status] }}</span>
        <ArchiveAction :disabled="busy || disabled" @click="testModels([row.model])">测试</ArchiveAction>
        <ArchiveAction v-if="allowDefault && row.result?.success" :disabled="busy || disabled" @click="emit('choose', row.result)">设为新书默认</ArchiveAction>
        <p v-if="row.result" class="test-time">测试于 {{ new Date(row.result.testedAt).toLocaleString() }} · 仅代表当前接口、型号与参数组合</p>
        <p v-if="row.result?.diagnostics" class="test-time">结束原因 {{ row.result.diagnostics.stopReason ?? '未知' }} · 输入 {{ row.result.diagnostics.inputTokens ?? '未知' }} · 输出 {{ row.result.diagnostics.outputTokens ?? '未知' }} · 思考 {{ row.result.diagnostics.reasoningTokens ?? '未知' }} tokens · 响应型号 {{ row.result.diagnostics.responseModel ?? '未知' }}（服务自报）</p>
        <details v-if="row.profile" class="row-parameters"><summary>此型号的测试参数</summary><ModelParameterEditor operation="probe" :model-value="row.profile" :target="{ protocol: connection.protocol, baseUrl: connection.baseUrl, model: row.model, metadata: catalog?.entries.find(e => e.id === row.model) }" task="prose" :label="row.model" :disabled="busy || disabled" @update:model-value="setParameters(row.model, $event)"/></details>
        <p v-if="row.message" :class="{ error: row.status === 'failed' }">{{ row.message }}</p>
      </article>
      <p v-if="!visible.length">没有匹配的模型。</p>
    </div>
  </section>
</template>
<style scoped>
.row-parameters { flex-basis:100%; min-width:0; } .row-parameters summary { cursor:pointer; color:var(--jade); font-size:13px; }
.thinking-control { flex:none; justify-content:flex-start; } .thinking-control select { min-height:40px; max-width:100%; border:1px solid var(--line); padding:6px 8px; background:var(--surface); color:var(--ink); font:inherit; }
.model-tests { display:grid; gap:14px; border-top:1px solid var(--line); padding-top:20px; min-width:0; }
header { display:flex; flex-wrap:wrap; justify-content:space-between; gap:12px; } h4,p { margin:0; } h4 { font-size:16px; margin-bottom:6px; } p { color:var(--muted); font-size:13px; line-height:1.7; }
.test-actions { display:flex; flex-wrap:wrap; align-items:center; gap:10px; }.test-actions input { flex:1; min-width:160px; border:1px solid var(--line); padding:9px; background:var(--surface); color:var(--ink); font:inherit; }
.test-list { max-height:360px; overflow:auto; border:1px solid var(--line); }.test-row { display:flex; align-items:center; flex-wrap:wrap; gap:10px; padding:12px; border-bottom:1px solid var(--line); }.test-row:last-child { border-bottom:0; }
label { display:flex; align-items:center; gap:8px; flex:1; min-width:160px; overflow-wrap:anywhere; } label input { flex:none; } .test-row p { flex-basis:100%; }
.result { font-size:13px; color:var(--muted); }.passed { color:var(--jade); }.failed,.error { color:var(--danger, #a33); } input:focus-visible { outline:2px solid var(--jade); outline-offset:2px; }
</style>
