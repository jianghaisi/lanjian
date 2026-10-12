import { draftProfile, type ProfileDraft } from '../services/model-connections-state'
import { checkedModelProbe } from '../services/model-quick-setup'
import { catalogTextSupport, type ModelCatalogSnapshot } from '../../../../contracts/models/model-catalog-metadata'
import { decodeThinkingLevel, type ThinkingLevel } from '../../../../contracts/models/thinking-level'
import { decodeParameterPolicy } from '../../../../contracts/models/parameter-policy'
import { sessionModelCatalogs } from './model-catalog-session'
import { computed, ref } from 'vue'
import type { ModelConnectionsApi, ModelCatalogQuery, ModelProbeResult } from '../../../../contracts/models/model-connections-contracts'

export type ModelTestRow = { model: string; status: 'idle' | 'queued' | 'testing' | 'passed' | 'failed' | 'cancelled'; message: string; result?: ModelProbeResult; profile?: ProfileDraft }
export function useModelTests(api: Pick<ModelConnectionsApi, 'catalog' | 'test' | 'cancelTest'>) {
  const rows = ref<ModelTestRow[]>([]), selected = ref<string[]>([]), error = ref('')
  const catalog = ref<ModelCatalogSnapshot>()
  const thinkingLevel = ref<ThinkingLevel>('default')
  const loading = ref(false), testing = ref(false), busy = computed(() => loading.value || testing.value)
  let source: ModelCatalogQuery | undefined, generation = 0, stopped = false
  // Refresh invalidates evidence, not the author's parameter intent. Keep only
  // drafts for this source/revision while a failed or cancelled fetch is retried.
  let retainedProfiles = new Map<string, ProfileDraft>()
  const message = (cause: unknown) => cause && typeof cause === 'object' && 'message' in cause && typeof cause.message === 'string' ? cause.message : '测试未完成，请重试。'
  async function load(connection: ModelCatalogQuery) {
    if (busy.value) return
    const request = ++generation
    if (source?.id !== connection.id || source.revision !== connection.revision) retainedProfiles.clear()
    else for (const row of rows.value) if (row.profile) retainedProfiles.set(row.model, row.profile)
    source = { id: connection.id, revision: connection.revision }
    delete sessionModelCatalogs.value[`global:${connection.id}`]
    catalog.value = undefined; rows.value = []; selected.value = []; error.value = ''; stopped = false; loading.value = true
    try {
      const result = await api.catalog(source)
      if (request !== generation || stopped) return
      if (result.id !== source.id || result.revision !== source.revision) throw Error('接口已变化，请重新获取模型。')
      if (!result.success) throw Error(result.message)
      catalog.value = result.catalog
      if (result.catalog) sessionModelCatalogs.value[`global:${connection.id}`] = result.catalog
      const nextProfiles = new Map<string, ProfileDraft>()
      rows.value = [...new Set(result.models)].filter(model => catalogTextSupport(result.catalog?.entries.find(e => e.id === model)) !== 'unsupported').map(model => {
        const profile: ProfileDraft = retainedProfiles.get(model) ?? { selection: `global:${result.id}`, model, parameterPolicy: { version: 1, mode: 'auto' } }
        nextProfiles.set(model, profile)
        return { model, status: 'idle', message: '', profile }
      })
      retainedProfiles = nextProfiles
      if (!rows.value.length) error.value = result.models.length ? '目录中的型号均不支持文本生成，请选择提供写作模型的接口。' : '接口没有返回模型，请检查接口权限或服务商的模型列表支持后重试。'
    } catch (cause) { if (request === generation && !stopped) error.value = message(cause) }
    finally { if (request === generation) loading.value = false }
  }
  async function testModels(models: string[]) {
    if (busy.value || !source) return
    const requested = new Set(models), queue = rows.value.filter(row => requested.has(row.model))
    if (!queue.length) return
    const request = generation, connection = { ...source }, level = decodeThinkingLevel(thinkingLevel.value)
    stopped = false; testing.value = true; error.value = ''
    for (const row of queue) { row.status = 'queued'; row.message = ''; delete row.result }
    try {
      for (const row of queue) {
        if (request !== generation || stopped) break
        row.status = 'testing'
        try {
          // The context bridge clones before preload can normalize arguments.
          const parameterPolicy = decodeParameterPolicy((row.profile ? draftProfile(row.profile, connection.id).parameterPolicy : undefined) ?? { version: 1, mode: 'auto' })
          const input = { ...connection, model: row.model, ...(level !== 'default' ? { thinkingLevel: level } : { parameterPolicy }) }
          const response = await api.test(input)
          if (request !== generation || stopped) break
          const result = checkedModelProbe(input, response)
          row.status = result.success ? 'passed' : 'failed'; row.message = result.message
          if (result.success) row.result = result
        } catch (cause) {
          if (request !== generation || stopped) break
          row.status = 'failed'; row.message = message(cause)
          if (cause && typeof cause === 'object' && 'code' in cause && cause.code === 'CONFLICT') {
            error.value = '接口配置已变化，剩余测试已停止。请重新获取模型列表。'; stopped = true
          }
        }
      }
    } finally {
      if (request === generation) {
        for (const row of queue) if (row.status === 'testing' || row.status === 'queued') { row.status = 'cancelled'; row.message = '已停止' }
        testing.value = false
      }
    }
  }
  function setParameters(model: string, profile: ProfileDraft) {
    if (busy.value) return
    const row = rows.value.find(r => r.model === model)
    if (!row) return
    row.profile = profile; row.status = 'idle'; row.message = ''; delete row.result
  }
  function setThinkingLevel(value: ThinkingLevel) {
    if (busy.value) return
    const level = decodeThinkingLevel(value)
    if (level === thinkingLevel.value) return
    thinkingLevel.value = level; error.value = ''
    for (const row of rows.value) { row.status = 'idle'; row.message = ''; delete row.result }
  }
  async function cancel() {
    if (!busy.value) return
    stopped = true
    try { await api.cancelTest() } catch { error.value = '停止请求未确认，正在等待当前请求结束；不会继续测试其他模型。' }
  }
  function dispose() { generation++; stopped = true; retainedProfiles.clear(); if (busy.value) void api.cancelTest().catch(() => {}) }
  return { catalog, setParameters, thinkingLevel: computed(() => thinkingLevel.value), setThinkingLevel, rows, selected, error, loading, testing, busy, load, testModels, cancel, dispose }
}
