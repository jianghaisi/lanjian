<script setup lang="ts">
import { pluginError } from '../plugin-error'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import ArchiveAction from '../../../ui/ArchiveAction.vue'
import PluginDraftEditor from './PluginDraftEditor.vue'
import type { PluginDraft, DraftTemplate } from '../../../../contracts/writing-plugins/authoring'
import type { PluginInstallPreview, WritingPluginsApi } from '../../../../contracts/writing-plugins/management-contracts'
const props = defineProps<{ api: WritingPluginsApi; active?: boolean; openDraftId?: string }>()
const emit = defineEmits<{ preview: [preview: PluginInstallPreview]; action: [] }>()
const drafts = ref<PluginDraft[]>([]), selected = ref<PluginDraft | null>(null), busy = ref(false), error = ref(''), notice = ref('')
let alive = true, openedDraftId = ''
onBeforeUnmount(() => { alive = false })
const name = (d: PluginDraft) => { try { const value = JSON.parse(d.manifestText); return typeof value.name === 'string' && value.name || '未完成的插件' } catch { return '未完成的插件' } }
async function act(operation: () => Promise<void>) { if (busy.value) return; busy.value = true; error.value = ''; notice.value = ''; try { await operation() } catch (cause) { if (alive) error.value = pluginError(cause, '插件草稿无法读取。') } finally { if (alive) busy.value = false } }
async function load() {
  const result = await props.api.listDrafts()
  if (alive) {
    drafts.value = result
    if (selected.value) selected.value = result.find(d => d.id === selected.value?.id) ?? selected.value
    if (props.openDraftId && props.openDraftId !== openedDraftId) {
      const draft = result.find(d => d.id === props.openDraftId)
      if (draft) { selected.value = draft; openedDraftId = draft.id }
    }
  }
}
async function create(template: DraftTemplate) { emit('action'); await act(async () => { const draft = await props.api.createDraft(template); if (alive) { drafts.value.push(draft); selected.value = draft } }) }
async function importPackage() {
  emit('action')
  await act(async () => {
    const draft = await props.api.importDraftPackage()
    if (!alive) return
    if (draft) { drafts.value.push(draft); selected.value = draft; notice.value = '已创建可编辑的个人副本，原插件包保持不变。' }
    else notice.value = '已取消复制。'
  })
}
function saved(draft: PluginDraft) { drafts.value = drafts.value.map(d => d.id === draft.id ? draft : d) }
onMounted(() => { void act(load) })
watch([() => props.active, () => props.openDraftId], ([active]) => { if (active) void act(load) })
</script>
<template>
  <section class="personal-plugins" data-testid="personal-plugins" :aria-busy="busy">
    <header><div><h3>把写作方法，变成自己的插件</h3><p>从模板创建，或把收到的 ZIP 插件包复制为个人草稿，继续修改与试用。</p></div><div class="header-actions"><ArchiveAction compact :disabled="busy" @click="importPackage">从插件包复制</ArchiveAction><ArchiveAction compact :disabled="busy" @click="emit('action'); act(load)">刷新草稿</ArchiveAction></div></header>
    <div class="templates"><button :disabled="busy" type="button" @click="create('context')"><strong>新建风格 / 题材指导</strong><small>保存文风偏好、题材规则与写作资料</small></button><button :disabled="busy" type="button" @click="create('workflow')"><strong>新建交互流程</strong><small>组织创作步骤，让助笔在适当时机提问</small></button><button :disabled="busy" type="button" @click="create('code')"><strong>新建代码工具</strong><small>编写工具代码，扩展新的写作能力</small></button></div>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <p v-if="busy" role="status">正在读取或创建草稿…</p>
    <p v-if="!busy && !drafts.length">还没有个人草稿。上面的模板都可以继续扩展类别与贡献。</p>
    <nav v-if="drafts.length" aria-label="个人插件草稿"><button v-for="draft in drafts" :key="draft.id" :disabled="busy" :aria-pressed="selected?.id === draft.id" @click="selected = draft">{{ name(draft) }}<small>草稿 {{ draft.revision }}</small></button></nav>
    <PluginDraftEditor v-if="selected" :key="selected.id" :inert="busy" :draft="selected" :api="api" :active="active !== false" @saved="saved" @preview="emit('preview', $event)" />
  </section>
</template>
<style scoped>
.header-actions{display:flex;gap:8px;flex-wrap:wrap}
.personal-plugins{display:grid;gap:22px;min-width:0;grid-template-columns:minmax(0,1fr)}h3{margin:0;font:600 22px/1.5 var(--serif)}header{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}header p{color:var(--ink-muted);font-size:13px;line-height:1.7;margin:6px 0 0}.templates{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.templates button{border:1px solid var(--line);background:var(--paper);color:var(--ink);text-align:left;padding:18px;cursor:pointer;min-width:0}.templates strong{font:600 16px/1.5 var(--serif)}.templates small{font:400 12px/1.8 var(--sans)}.templates button:hover{border-color:var(--jade)}nav{display:flex;gap:8px;overflow-x:auto;padding:3px 3px 8px}nav button{border:1px solid var(--line);background:var(--surface);color:var(--ink);padding:10px 14px;text-align:left;min-width:140px;border-radius:var(--radius-panel,2px);cursor:pointer}nav button[aria-pressed=true]{border-color:var(--jade);background:var(--paper)}small{display:block;margin-top:5px;color:var(--ink-muted)}button:focus-visible{outline:2px solid var(--jade);outline-offset:2px}[role=alert]{color:var(--danger,#b74536)}@container(max-width:600px){.templates{grid-template-columns:minmax(0,1fr)}.templates button{padding:12px 16px}}
</style>
