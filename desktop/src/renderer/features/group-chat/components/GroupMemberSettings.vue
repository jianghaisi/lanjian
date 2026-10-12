<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue'
import type { DesktopApi } from '../../../../contracts'
import type { MemberAssignment, MemberId } from '../../../../contracts/group-chat/group-chat'
import type { CreativeTeam } from '@lanjian/writing-plugin-contracts'
import type { ModelProfile } from '../../../../contracts/models/types'
import type { GlobalConnectionsView } from '../../../../contracts/models/model-connections'
import type { LocalModelView } from '../../../../contracts/models/local-model-contracts'
import { buildModelCatalog, type ModelCatalogChoice } from '../../models/services/model-catalog'
import { draftProfile, type ProfileDraft } from '../../models/services/model-connections-state'
import { decodeGroupProfile } from '../../../../contracts/group-chat/group-chat'
import ModelCatalogPicker from '../../models/components/ModelCatalogPicker.vue'
import ModelParameterEditor from '../../models/components/ModelParameterEditor.vue'
const props = defineProps<{ api: DesktopApi; member: MemberAssignment; team: CreativeTeam; busy: boolean }>()
const emit = defineEmits<{ save: [id: MemberId, profile: ModelProfile]; close: []; setup: [] }>()
const info = computed(() => props.team.members.find(member => member.id === props.member.memberId))
const catalog = shallowRef<GlobalConnectionsView>(), local = ref<LocalModelView[]>([]), discovered = ref<Record<string, string[]>>({}), loading = ref(true), error = ref('')
const initial = props.member.profile
const draft = ref<ProfileDraft>(initial ? { ...initial, selection: initial.connectionId.startsWith('local:') ? 'local' : `global:${initial.connectionId}` } : { selection: '', model: '', parameterPolicy: { version: 2, mode: 'auto' } })
const connectionId = computed(() => draft.value.selection === 'local' ? 'local:llama-cpp' : draft.value.selection.replace(/^global:/, ''))
const connections = computed(() => (catalog.value?.connections ?? []).map(c => ({ ...c, disabledReason: !c.enabled || c.credentialState !== 'stored' ? '接口不可用' : undefined })))
const choices = computed(() => buildModelCatalog(connections.value, discovered.value, initial ? [initial] : [], local.value))
const target = computed(() => ({ model: draft.value.model, protocol: draft.value.selection === 'local' ? 'local' as const : catalog.value?.connections.find(c => c.id === connectionId.value)?.protocol ?? 'openai-compatible' as const, ...(draft.value.selection === 'local' ? { localLimits: local.value.find(m => m.id === draft.value.model) } : {}) }))
function choose(choice: ModelCatalogChoice | null) { if (choice) draft.value = { model: choice.model, selection: choice.connectionId.startsWith('local:') ? 'local' : `global:${choice.connectionId}`, parameterPolicy: { version: 2, mode: 'auto' } } }
function save() {
  try { if (!info.value) throw new Error('该成员已不在当前讨论，请返回原讨论重新选择。'); const profile = draftProfile(draft.value, connectionId.value); emit('save', info.value.id, decodeGroupProfile({ ...profile, connectionId: connectionId.value })) } catch (e) { error.value = e instanceof Error ? e.message : '请核对所选模型和参数。' }
}
onMounted(async () => {
  try {
    if (props.api.app.platform === 'browser') {
      const groupCatalog = await props.api.groupChat.modelCatalog(); catalog.value = groupCatalog.connections; discovered.value = groupCatalog.models; return
    }
    const [globals, locals] = await Promise.all([props.api.modelConnections.list(), props.api.localModels.list()]); catalog.value = globals; local.value = locals
    // The existing catalog capability owns one cancellable probe at a time.
    for (const c of globals.connections.filter(c => c.enabled && c.credentialState === 'stored')) {
      try { discovered.value[c.id] = (await props.api.modelConnections.catalog({ id: c.id, revision: c.revision })).models }
      catch { /* Retain configured/manual choices when one catalog is unavailable. */ }
    }
  } catch (e) { error.value = e && typeof e === 'object' && 'message' in e ? String(e.message) : '模型列表无法读取。' } finally { loading.value = false }
})
</script>
<template>
  <section class="group-member-settings" aria-label="成员设置">
    <header><div><small>成员设置</small><h2>{{ info?.name || '成员不可用' }}</h2></div><button type="button" aria-label="关闭成员设置" @click="emit('close')">×</button></header>
    <p>{{ info?.responsibility || '请返回原讨论重新选择成员。' }}</p><p class="group-settings-hint">选择已配置的模型，也可以与其他成员共用。正在执行的目标继续使用原分配。</p>
    <p v-if="loading" role="status">读取模型列表…</p><p v-if="error" role="alert">{{ error }}</p>
    <ModelCatalogPicker :choices="choices" :connections="connections" :connection-id="connectionId" :model="draft.model" label="成员模型" allow-hosted-selection :allow-manual="api.app.platform !== 'browser'" :disabled="busy || loading" @select="choose" />
    <ModelParameterEditor v-if="draft.model && info" v-model="draft" :target="target" :task="info.task" label="生成参数" :disabled="busy" />
    <footer><button v-if="api.app.platform !== 'browser'" class="control-button secondary" type="button" @click="emit('setup')">管理模型接口</button><span v-else>选择站长开放的创作模型。</span><button class="control-button primary" type="button" :disabled="busy || !info || !draft.model || !connectionId" @click="save">保存成员设置</button></footer>
  </section>
</template>
<style scoped>
.group-member-settings{width:min(590px,100%);color:var(--ink);font:13px/1.75 var(--sans)}header{display:flex;justify-content:space-between;align-items:center}h2{font:600 24px/1.5 var(--serif);margin:4px 0}small,.group-settings-hint{color:var(--muted)}header button{border:0;background:transparent;color:var(--muted);font-size:24px;cursor:pointer}footer{display:flex;flex-wrap:wrap;justify-content:space-between;gap:10px;margin-top:24px}
</style>
