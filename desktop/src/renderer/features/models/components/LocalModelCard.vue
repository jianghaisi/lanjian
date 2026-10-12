<script setup lang="ts">
import { computed } from 'vue'
import type { AiTask } from '../../../../contracts/index'
import type { LocalModelView } from '../../../../contracts/models/local-model-contracts'

const props = defineProps<{
  model: LocalModelView; active: boolean; preparing: boolean; busy?: boolean; stopping?: boolean
  stopOperation?: Pick<LocalModelView, 'id' | 'operation' | 'operationId'>
  assigned: string; target: 'shared' | AiTask
}>()
const retryInspection = computed(() => !props.active && props.model.operation === 'inspect' && ['failed', 'cancelled', 'interrupted'].includes(props.model.state))
const stopOperation = computed(() => props.stopOperation?.id === props.model.id && props.stopOperation.operationId ? props.stopOperation : props.model)
const awaitingStatus = computed(() => props.active && (!props.model.operationId || props.model.operationId !== stopOperation.value.operationId))
const installationUnavailable = computed(() => props.model.state === 'not-installed' && !props.model.canDownload)
const emit = defineEmits<{
  install: []; inspect: []; cancel: []; use: []; 'update:target': [value: 'shared' | AiTask]
}>()
const labels: Record<LocalModelView['state'], string> = {
  'not-installed': '未安装', detected: '待检测', downloading: '下载中', verifying: '校验中',
  installing: '安装中', checking: '检测中', ready: '本机可用', failed: '准备失败',
  cancelled: '已停止', interrupted: '已中断'
}
const size = (bytes: number) => bytes >= 1e9 ? (bytes / 1e9).toFixed(2) + ' GB' : (bytes / 1e6).toFixed(0) + ' MB'
function changeTarget(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  if (['shared', 'outline', 'chapterOutline', 'prose', 'review'].includes(value)) emit('update:target', value as 'shared' | AiTask)
}
</script>

<template>
  <article class="store-model" :class="{ 'is-active': active, 'is-ready': model.state === 'ready' }" :data-model-id="model.id">
    <div class="model-heading">
      <span class="model-series"><span aria-hidden="true">MODEL /</span> {{ model.family }}</span>
      <span class="model-state" :data-state="awaitingStatus ? 'pending' : model.state" role="status"><i aria-hidden="true" />{{ awaitingStatus ? '准备中' : labels[model.state] }}</span>
    </div>
    <h3>{{ model.name }}</h3>
    <div class="model-badges">
      <span>{{ model.publisherKind === 'community' ? '社区量化' : '官方权重' }}</span>
      <span v-if="model.developmentStatus === 'tested'" class="tested">有实测记录</span>
      <span v-else>未开发实测</span>
    </div>
    <p class="model-description">{{ model.description }}</p>
    <dl class="model-summary">
      <div><dt>权重大小</dt><dd>{{ size(model.bytes) }}</dd></div>
      <div><dt>量化</dt><dd>{{ model.quantization }}</dd></div>
      <div><dt>运行方式</dt><dd>本机 CPU</dd></div>
    </dl>
    <div v-if="active" class="model-progress" aria-live="polite">
      <span v-if="awaitingStatus">正在确认准备状态…</span>
      <template v-else>
        <div><span>{{ model.message }}</span><strong>{{ model.progress }}%</strong></div>
        <progress :value="model.progress" max="100" :aria-label="model.name + '：' + model.message" />
        <span v-if="model.totalBytes">{{ size(model.receivedBytes || 0) }} / {{ size(model.totalBytes) }}</span>
      </template>
    </div>
    <p v-else-if="model.state !== 'not-installed' || installationUnavailable" class="model-message" :class="{ 'store-error': model.state === 'failed' }">{{ model.message }}</p>
    <p v-if="assigned" class="model-assigned">当前用于 · {{ assigned }}</p>
    <div class="model-actions" :class="{ 'model-retry': retryInspection }">
      <button v-if="active" type="button" class="model-button secondary" :disabled="stopping || !stopOperation.operationId" @click="emit('cancel')">{{ stopping ? '正在停止…' : !stopOperation.operationId ? '等待状态…' : stopOperation.operation === 'install' ? '停止安装' : '停止检测' }}</button>
      <button v-else-if="installationUnavailable" type="button" class="model-button secondary" disabled>暂不支持安装</button>
      <template v-else-if="retryInspection">
        <button type="button" class="model-button primary" :disabled="busy || preparing" :data-testid="'inspect-' + model.id" @click="emit('inspect')">重新检测</button>
        <button v-if="model.canDownload" type="button" class="model-button secondary" :disabled="busy || preparing" :data-testid="'install-' + model.id" @click="emit('install')">继续安装<span aria-hidden="true">↓</span></button>
      </template>
      <button v-else-if="model.canDownload && !['ready', 'detected'].includes(model.state)" type="button" class="model-button primary" :disabled="busy || preparing" :data-testid="'install-' + model.id" @click="emit('install')">
        {{ model.state === 'not-installed' ? '下载安装' : '继续安装' }}<span aria-hidden="true">↓</span>
      </button>
      <button v-else type="button" class="model-button secondary" :disabled="busy || preparing || model.state === 'not-installed'" :data-testid="'inspect-' + model.id" @click="emit('inspect')">{{ model.state === 'ready' ? '重新检测' : '检测并启用' }}</button>
      <div v-if="model.state === 'ready'" class="model-assign">
        <select :value="target" :aria-label="model.name + '使用模块'" :disabled="busy || preparing" @change="changeTarget">
          <option value="shared">全部写作任务</option><option value="outline">总纲</option><option value="chapterOutline">章纲</option><option value="prose">正文</option><option value="review">审校</option>
        </select>
        <button type="button" class="model-button primary" :disabled="busy || preparing" data-testid="assign-local-model" @click="emit('use')">选用模型</button>
      </div>
    </div>
    <p v-if="retryInspection" class="model-estimate">重新检测不下载文件<span v-if="model.canDownload">；需要补齐资源时，可继续安装</span>。</p>
    <p v-if="preparing && !active" class="model-estimate">另一模型正在准备，完成或停止后可开始。</p>
    <p v-else-if="model.canDownload && !active && model.state !== 'ready'" class="model-estimate">{{ retryInspection ? '继续安装预计下载' : '预计下载' }} {{ size(model.downloadBytes ?? model.bytes) }} · 需可用空间 {{ size(model.requiredDiskBytes ?? model.bytes) }}</p>
    <details class="model-details">
      <summary>模型详情<span>{{ model.license }}</span></summary>
      <div class="model-detail-body">
        <dl>
          <div><dt>发布者</dt><dd>{{ model.publisher || model.family }} · {{ model.publisherKind === 'community' ? '社区量化来源' : '官方来源' }}</dd></div>
          <div><dt>许可</dt><dd>{{ model.license }}</dd></div>
          <div><dt>应用上下文</dt><dd>{{ model.contextTokens.toLocaleString() }} tokens</dd></div>
          <div><dt>推荐输出</dt><dd>{{ model.recommendedOutputTokens.toLocaleString() }} tokens</dd></div>
          <div><dt>最大输出</dt><dd>{{ model.maxOutputTokens.toLocaleString() }} tokens</dd></div>
          <div><dt>固定版本</dt><dd :title="model.revision">{{ model.revision.slice(0, 12) }}</dd></div>
        </dl>
        <div class="model-runtime-note">
          <strong>运行说明</strong>
          <p>Windows x64 · 无需密钥 · 无需独立显卡。运行还会占用额外内存，权重体积不等于内存需求。</p>
          <p v-if="model.developmentStatus !== 'tested'">此型号尚未进行开发实测。下载后会在本机校验文件并检测文字、结构化输出与工具请求，通过后才能选用。</p>
          <p v-else>已有实测记录；本机仍需通过检测。生成篇幅、速度和质量以实际使用为准。</p>
          <p v-if="model.bytes >= 8e9">大体积模型在 CPU 上可能耗时较长，请按设备条件选择。</p>
        </div>
      </div>
    </details>
  </article>
</template>

<style scoped>
.store-model {
  --model-accent: var(--market-accent, var(--folio-action, #efa348));
  position: relative;
  min-width: 0;
  border: 1px solid var(--line-strong);
  border-radius: 0;
  background: color-mix(in srgb, var(--surface) 56%, var(--canvas));
  padding: 1rem 1rem .75rem;
  transition: border-color 160ms ease, background-color 160ms ease;
}
.store-model::before { content: ''; position: absolute; top: -1px; left: -1px; width: 2.75rem; height: 3px; background: var(--model-accent); transition: width 160ms ease; pointer-events: none; }
.store-model::after { content: ''; position: absolute; top: -1px; right: -1px; width: .7rem; height: .7rem; background: linear-gradient(45deg, transparent calc(50% - 1px), var(--line-strong) 50%, var(--canvas) calc(50% + 1px)); pointer-events: none; }
.store-model:hover, .store-model:focus-within { border-color: var(--jade); background: var(--surface); }
.store-model:hover::before, .store-model:focus-within::before { width: 4.5rem; }
.store-model.is-active { border-color: var(--jade); box-shadow: inset 3px 0 var(--jade); }
.model-heading { display: flex; justify-content: space-between; align-items: center; gap: .5rem; }
.model-series { color: var(--muted); font: 500 .62rem/1.5 var(--sans); letter-spacing: .07em; text-transform: uppercase; }
.model-series > span { margin-right: .3rem; font-size: .45rem; letter-spacing: .1em; }
.narrative-terminal.redesigned-studio.archive-workspace .store-model > h3 { margin: .5rem 0 .6rem; color: var(--ink); font: 600 1.18rem/1.4 var(--serif); overflow-wrap: anywhere; }
.model-state { display: flex; align-items: center; gap: .3rem; color: var(--muted); font-size: .62rem; white-space: nowrap; }
.model-state i { width: 4px; height: 4px; background: currentColor; }
.is-ready .model-state, .is-active .model-state { color: var(--jade); }
.model-state[data-state=failed] { color: var(--danger, #a64c3c); }
.model-badges { display: flex; flex-wrap: wrap; gap: .35rem; }
.model-badges span { padding: .1rem .35rem; border: 1px solid var(--line); border-radius: 0; background: color-mix(in srgb, var(--jade) 5%, var(--surface)); color: var(--muted); font-size: .59rem; line-height: 1.5; }
.model-badges .tested { color: var(--jade); background: var(--jade-wash); border-color: color-mix(in srgb, var(--jade) 30%, var(--line)); }
.model-description { margin: .7rem 0; min-height: 2.6rem; color: var(--muted); font-size: .71rem; line-height: 1.8; }
.model-summary { display: grid; grid-template-columns: 1.1fr 1fr 1fr; gap: .4rem; margin: .7rem 0 .8rem; padding: .6rem 0; border-block: 1px solid var(--line); }
.model-summary > div + div { padding-left: .6rem; border-left: 1px solid var(--line); }
.model-summary dt { color: var(--muted); font-size: .57rem; margin-bottom: .25rem; }
.model-summary dd { margin: 0; color: var(--ink); font-size: .77rem; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.model-actions { display: flex; flex-wrap: wrap; gap: .5rem; }
.model-button { position: relative; display: flex; align-items: center; justify-content: center; gap: .6rem; min-height: 2.2rem; padding: .5rem .7rem; border: 1px solid var(--line-strong); border-radius: 0; font: 500 .74rem/1.5 var(--sans); cursor: pointer; transition: background-color 160ms ease, border-color 160ms ease; }
.model-button.primary { background: var(--market-dark, var(--dark, #222b25)); border-color: var(--line-strong); color: var(--market-light, var(--dark-text, #f3f3ec)); }
.model-button.primary > span { display: grid; place-items: center; margin-left: auto; width: 1.2rem; color: var(--model-accent); font-size: 1rem; }
.model-actions > .primary { width: 100%; justify-content: space-between; border-left: 3px solid var(--model-accent); }
.model-button.secondary { background: transparent; color: var(--ink); }
.model-button:disabled { opacity: .48; cursor: not-allowed; }
.model-button.primary:not(:disabled):hover { background: color-mix(in srgb, var(--jade) 26%, var(--market-dark, #222b25)); border-color: var(--jade); }
.model-button.secondary:not(:disabled):hover { background: var(--jade-wash); border-color: var(--jade); }
.model-assign { display: flex; flex-wrap: wrap; gap: .4rem; flex: 1 1 100%; min-width: 0; }
.model-assign select { min-width: 0; flex: 1 1 7rem; padding: .4rem; min-height: 2.2rem; border: 1px solid var(--line-strong); border-radius: 0; background: var(--surface); color: var(--ink); font: .7rem/1.5 var(--sans); }
.model-assign .model-button.primary { white-space: nowrap; background: var(--model-accent); color: var(--folio-action-ink, #202722); border-color: var(--model-accent); }
.model-assign .model-button.primary:not(:disabled):hover { background: color-mix(in srgb, var(--model-accent) 85%, white); border-color: var(--model-accent); }
.model-retry > .model-button { flex: 1; width: auto; justify-content: center; }
.model-estimate, .model-message, .model-assigned { margin: .55rem 0; color: var(--muted); font-size: .64rem; line-height: 1.7; overflow-wrap: anywhere; }
.model-assigned { color: var(--jade); }
.store-error { color: var(--danger, #a64c3c); }
.model-progress { display: grid; gap: .4rem; margin: .7rem 0; color: var(--jade); font-size: .67rem; }
.model-progress > div { display: flex; justify-content: space-between; gap: .5rem; }
.model-progress strong { font-weight: 500; white-space: nowrap; }
progress { width: 100%; height: .3rem; accent-color: var(--jade); }
.model-details { margin-top: .7rem; padding-top: .5rem; border-top: 1px solid var(--line-strong); color: var(--muted); font-size: .65rem; line-height: 1.75; }
.model-details summary { position: relative; min-height: 1.6rem; padding-right: 5.6rem; cursor: pointer; }
.model-details summary > span { position: absolute; right: 0; top: .15rem; max-width: 5.2rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: .56rem/1.7 var(--sans); }
.model-detail-body { margin-top: .45rem; padding-top: .45rem; border-top: 1px solid var(--line); }
.model-details dl { margin: 0; }
.model-details dl > div { display: grid; grid-template-columns: 5em minmax(0, 1fr); gap: .6rem; padding: .4rem 0; border-bottom: 1px solid var(--line); }
.model-details dt { color: var(--muted); }
.model-details dd { min-width: 0; margin: 0; color: var(--ink); overflow-wrap: anywhere; text-align: right; font-variant-numeric: tabular-nums; }
.model-runtime-note { margin-top: .7rem; padding: .6rem .7rem; border-left: 2px solid var(--model-accent); background: color-mix(in srgb, var(--jade) 5%, var(--surface)); }
.model-runtime-note strong { color: var(--ink); font-weight: 500; }
.model-runtime-note p { margin: .45rem 0 0; }
.model-details[open] summary { margin-bottom: .6rem; color: var(--ink); }
button:focus-visible, select:focus-visible, summary:focus-visible { outline: 2px solid var(--focus, var(--jade)); outline-offset: 3px; }
@container (max-width: 390px) { .store-model { padding: .85rem; } .model-series > span { display: none; } }
@media (prefers-reduced-motion: reduce) { .store-model, .store-model::before, .model-button { transition: none; } }
</style>
