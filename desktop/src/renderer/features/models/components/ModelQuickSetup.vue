<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { ModelConnectionsApi, ModelDefaultsView, ModelProbeResult } from '../../../../contracts/models/model-connections-contracts'
import type { GlobalConnectionsView, GlobalConnectionView, RemoteModelProtocol } from '../../../../contracts/models/model-connections'
import { saveTestedModelDefault } from '../services/model-quick-setup'
import ModelTestPanel from './ModelTestPanel.vue'
import ArchiveAction from '../../../ui/ArchiveAction.vue'
import ArchiveFormField from '../../../ui/ArchiveFormField.vue'
const props = defineProps<{ api: ModelConnectionsApi; catalog: GlobalConnectionsView; defaults: ModelDefaultsView; disabled?: boolean }>()
const emit = defineEmits<{ saved: []; dirty: [value: boolean] }>()
const connectionId = ref(''), name = ref('我的写作接口'), baseUrl = ref(''), apiKey = ref('')
const protocol = ref<RemoteModelProtocol>('openai-compatible')
const pending = ref(false), error = ref(''), message = ref(''), uncertainCreate = ref(false), completed = ref(false)
const testConnection = ref<GlobalConnectionView | null>(null), testing = ref(false), panelGeneration = ref(0)
const busy = computed(() => pending.value || testing.value)
const editing = ref(!props.defaults.template)
const dirty = computed(() => busy.value || (editing.value && !completed.value && Boolean(connectionId.value || baseUrl.value || apiKey.value)))
watch(dirty, value => emit('dirty', value))
const defaultLabel = computed(() => props.defaults.template?.routingMode === 'shared' ? props.defaults.template.shared.model : '已按任务设置模型')
watch(connectionId, () => { uncertainCreate.value = false; completed.value = false; if (testConnection.value?.id !== connectionId.value) testConnection.value = null })
watch(() => props.catalog, catalog => { if (testConnection.value && !catalog.connections.some(item => item.id === testConnection.value?.id && item.revision === testConnection.value?.revision && item.enabled)) testConnection.value = null })
async function save() {
  if (busy.value) return
  pending.value = true; error.value = ''; message.value = ''; completed.value = false
  try {
    if (!connectionId.value) {
      if (uncertainCreate.value) throw Error('上次保存回执未确认，请从已有接口中选择后继续，避免重复创建。')
      const before = await props.api.list()
      let saved: GlobalConnectionsView
      try {
        saved = await props.api.create({ expectedRevision: before.revision, name: name.value.trim(), baseUrl: baseUrl.value.trim(), protocol: protocol.value, ...(apiKey.value.trim() ? { apiKey: apiKey.value } : {}) })
      } catch (cause) {
        const code = cause && typeof cause === 'object' && 'code' in cause ? cause.code : ''
        uncertainCreate.value = code !== 'VALIDATION_ERROR' && code !== 'CONFLICT'
        emit('saved'); throw cause
      }
      const created = saved.connections.filter(item => !before.connections.some(old => old.id === item.id))
      if (created.length !== 1) { uncertainCreate.value = true; throw Error('接口保存回执不明确，请重新读取后选择已保存接口。') }
      connectionId.value = created[0].id; apiKey.value = ''; emit('saved')
    } else if (apiKey.value.trim()) {
      const catalog = await props.api.list(), connection = catalog.connections.find(item => item.id === connectionId.value)
      if (!connection) throw Error('接口已移除，请重新选择。')
      await props.api.update({ expectedRevision: catalog.revision, id: connection.id, connectionRevision: connection.revision, apiKey: apiKey.value })
      apiKey.value = ''; emit('saved')
    }
    const latest = await props.api.list(), selected = latest.connections.find(item => item.id === connectionId.value)
    if (!selected?.enabled) throw Error('接口已停用或移除，请重新选择。')
    testConnection.value = selected; panelGeneration.value++
    message.value = '接口已保存。选择单个模型或全部测试，再将可用模型设为新书默认。'
  } catch (cause) {
    message.value = connectionId.value ? '接口已保留；修正问题后可继续测试，无需重新创建。' : ''
    error.value = cause && typeof cause === 'object' && 'message' in cause && typeof cause.message === 'string' ? cause.message : '配置未完成，输入已保留。'
  } finally { pending.value = false }
}
async function chooseDefault(result: ModelProbeResult) {
  if (busy.value) return
  pending.value = true; error.value = ''
  try {
    await saveTestedModelDefault(props.api, result)
    completed.value = true; editing.value = false; testConnection.value = null
    message.value = `配置完成。新书将直接使用 ${result.model}，已有作品可在“本书模型”中使用当前默认。`
    emit('saved')
  } catch (cause) { error.value = cause && typeof cause === 'object' && 'message' in cause ? String(cause.message) : '默认模型保存失败，请重试。' }
  finally { pending.value = false }
}
function cancel() { if (busy.value) return; apiKey.value = ''; baseUrl.value = ''; connectionId.value = ''; testConnection.value = null; editing.value = false; completed.value = true; error.value = ''; message.value = '' }
onBeforeUnmount(() => { apiKey.value = ''; emit('dirty', false) })
defineExpose({ cancel, pending: busy })
</script>
<template>
  <section class="quick-setup" data-testid="model-quick-setup" :aria-busy="pending">
    <header><div><span class="eyebrow">所有作品 · 共用接口</span><h3>{{ defaults.template ? '新书默认模型' : '配置一次，开始写作' }}</h3><p>{{ defaults.template ? `已保存：${defaultLabel}` : '填入接口后自动获取模型，选择测试通过的模型即可用于之后新建的每一本书。' }}</p></div><ArchiveAction v-if="!editing" :disabled="disabled" @click="editing = true; completed = false">{{ defaults.template ? '更换默认模型' : '开始配置' }}</ArchiveAction></header>
    <p v-if="defaults.references.some(item => item.state !== 'enabled')" class="error" role="alert">默认模型引用了已停用或缺失的接口，请重新选择并测试。</p>
    <form v-if="editing" @submit.prevent="save">
      <fieldset :disabled="busy || disabled">
        <ArchiveFormField v-if="catalog.connections.length" label="写作接口" v-slot="{ controlProps }"><select v-bind="controlProps" v-model="connectionId" data-testid="quick-connection"><option value="">新增接口</option><option v-for="item in catalog.connections" :key="item.id" :value="item.id" :disabled="!item.enabled">{{ item.name }}{{ item.enabled ? '' : '（已停用）' }}</option></select></ArchiveFormField>
        <div v-if="!connectionId" class="fields">
          <ArchiveFormField label="接口名称" v-slot="{ controlProps }"><input v-bind="controlProps" v-model="name" required maxlength="80" data-testid="quick-name"></ArchiveFormField>
          <ArchiveFormField label="接口协议" v-slot="{ controlProps }"><select v-bind="controlProps" v-model="protocol" data-testid="quick-protocol"><option value="openai-compatible">OpenAI 兼容</option><option value="gemini-native">Gemini 原生</option><option value="anthropic-native">Anthropic Messages</option><option value="openai-responses">OpenAI Responses</option></select></ArchiveFormField>
          <ArchiveFormField label="服务地址" :help="protocol === 'gemini-native' ? '服务根地址，不附加 /v1。' : '通常以 /v1 结尾，以服务商说明为准。'" v-slot="{ controlProps }"><input v-bind="controlProps" v-model="baseUrl" type="url" required maxlength="2048" placeholder="https://…" data-testid="quick-url"></ArchiveFormField>
          <ArchiveFormField label="API Key" v-slot="{ controlProps }"><input v-bind="controlProps" v-model="apiKey" type="password" required maxlength="4096" autocomplete="new-password" data-testid="quick-key"></ArchiveFormField>
        </div>
        <ArchiveFormField v-else label="更换 API Key（可选）" help="留空沿用已保存的密钥。更换会影响引用这个接口的作品。" v-slot="{ controlProps }"><input v-bind="controlProps" v-model="apiKey" type="password" maxlength="4096" autocomplete="new-password" data-testid="quick-replacement-key"></ArchiveFormField>
        <div class="actions"><ArchiveAction type="submit" variant="primary" :disabled="uncertainCreate && !connectionId" data-testid="quick-save">{{ pending ? '正在保存…' : connectionId ? '获取模型列表' : '保存并获取模型' }}</ArchiveAction><ArchiveAction @click="cancel">收起</ArchiveAction></div>
      </fieldset>
    </form>
    <ModelTestPanel v-if="editing && testConnection" :key="`${testConnection.id}:${testConnection.revision}:${panelGeneration}`" :api="api" :connection="testConnection" :disabled="pending || disabled" allow-default @busy="testing = $event" @choose="chooseDefault" />
    <p v-if="message" role="status">{{ message }}</p><p v-if="error" class="error" role="alert">{{ error }}</p>
  </section>
</template>
<style scoped>
.quick-setup { border:1px solid var(--line); border-top:3px solid var(--jade); background:var(--surface); padding:24px; display:grid; gap:18px; }
header { display:flex; justify-content:space-between; align-items:center; gap:20px; }
.eyebrow { font-size:12px; color:var(--jade); letter-spacing:.08em; }
h3 { margin:8px 0; font-size:22px; font-weight:600; }
p { margin:0; color:var(--muted); line-height:1.7; font-size:var(--form-help); }
fieldset { border:0; margin:0; padding:0; display:grid; gap:16px; min-width:0; }
.fields { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px; }
input,select { width:100%; min-width:0; min-height:40px; padding:8px 10px; color:var(--ink); background:var(--surface); border:1px solid var(--line); font:inherit; }
:is(input,select):focus-visible { outline:2px solid var(--jade); outline-offset:2px; }
.actions { display:flex; flex-wrap:wrap; gap:12px; }.error { color:var(--danger, #a33); }
@media(max-width:700px) { .fields { grid-template-columns:1fr; } header { align-items:start; flex-direction:column; } .quick-setup { padding:16px; } }
</style>
