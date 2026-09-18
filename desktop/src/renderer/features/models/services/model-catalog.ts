import { type LocalModelView, isLocalConnection } from '../../../../contracts/models/local-model-contracts'
export type ModelFamilyId = 'gpt' | 'gemini' | 'doubao' | 'deepseek' | 'claude' | 'qwen' | 'kimi' | 'glm' | 'other'

export type ModelFamily = {
  id: ModelFamilyId
  label: string
  mark: string
  order: number
}

export type ModelConnectionSummary = {
  id: string
  name: string
  baseUrl?: string
  disabledReason?: string
  enabled?: boolean
}

export type RoutedModelProfile = {
  connectionId: string
  model: string
}

export type ModelCatalogChoice = {
  key: string
  connectionId: string
  connectionName: string
  connectionHost: string
  model: string
  label: string
  family: ModelFamily
  duplicateModel: boolean
  discovered: boolean
  disabledReason?: string
  recommendedOutputTokens?: number
}

export const modelFamilies: ModelFamily[] = [
  { id: 'gpt', label: 'GPT', mark: 'G', order: 10 },
  { id: 'gemini', label: 'Gemini', mark: 'Gem', order: 20 },
  { id: 'doubao', label: '豆包', mark: '豆', order: 30 },
  { id: 'deepseek', label: 'DeepSeek', mark: '深', order: 40 },
  { id: 'claude', label: 'Claude', mark: 'C', order: 50 },
  { id: 'qwen', label: '通义千问', mark: '千', order: 60 },
  { id: 'kimi', label: 'Kimi', mark: '月', order: 70 },
  { id: 'glm', label: '智谱', mark: '智', order: 80 },
  { id: 'other', label: '其他', mark: '其', order: 99 }
]

export function modelRouteKey(connectionId: string, model: string): string {
  return JSON.stringify([connectionId.trim(), model.trim()])
}

export function classifyModelFamily(modelValue: string): ModelFamily {
  const model = modelValue.trim().toLocaleLowerCase('en-US')
  const family = model.includes('gemini') ? 'gemini'
    : model.includes('doubao') || model.includes('豆包') || /^ark[-_.]/.test(model) ? 'doubao'
      : model.includes('deepseek') ? 'deepseek'
        : model.includes('claude') ? 'claude'
          : model.includes('qwen') || model.includes('qwq') || model.includes('tongyi') || model.includes('千问') ? 'qwen'
            : model.includes('kimi') || model.includes('moonshot') ? 'kimi'
              : model.includes('glm') || model.includes('zhipu') || model.includes('智谱') ? 'glm'
                : model.includes('gpt') || model.includes('openai') || /^o(?:1|3|4)(?:[-_.]|$)/.test(model) ? 'gpt'
                  : 'other'
  return modelFamilies.find((item) => item.id === family)!
}

export function buildModelCatalog(
  connections: ModelConnectionSummary[],
  discoveredModels: Record<string, string[]>,
  assignedProfiles: RoutedModelProfile[] = [],
  localModels: LocalModelView[] = []
): ModelCatalogChoice[] {
  const rows: Array<Omit<ModelCatalogChoice, 'duplicateModel'>> = []
  const exactModels = new Map<string, number>()
  for (const connection of connections) {
    const discovered = new Set((discoveredModels[connection.id] || []).map((model) => model.trim()).filter(Boolean))
    const assigned = assignedProfiles
      .filter((profile) => profile.connectionId === connection.id)
      .map((profile) => profile.model.trim())
      .filter(Boolean)
    const models = [...new Set([...discovered, ...assigned])]
    for (const model of models) {
      const family = classifyModelFamily(model)
      const connectionName = connection.name.trim() || '未命名接口'
      const connectionHost = isLocalConnection(connection.id) ? '本机运行 · 无需密钥' : safeConnectionHost(connection.baseUrl)
      const normalized = model.toLocaleLowerCase('en-US')
      exactModels.set(normalized, (exactModels.get(normalized) || 0) + 1)
      rows.push({
        key: modelRouteKey(connection.id, model),
        connectionId: connection.id,
        connectionName,
        connectionHost,
        model,
        label: `${model} · ${connectionName}`,
        family,
        discovered: discovered.has(model),
        ...(connection.disabledReason || connection.enabled === false ? { disabledReason: connection.disabledReason || '接口已停用' } : {}),
        ...(isLocalConnection(connection.id) ? { disabledReason: localModels.find(m => m.id === model)?.state === 'ready' ? undefined : '请先到本地模型商店检测', recommendedOutputTokens: localModels.find(m => m.id === model)?.recommendedOutputTokens ?? 2048 } : {})
      })
    }
  }
  return rows
    .map((row) => ({ ...row, duplicateModel: (exactModels.get(row.model.toLocaleLowerCase('en-US')) || 0) > 1 }))
    .sort((left, right) => left.family.order - right.family.order
      || left.model.localeCompare(right.model, 'en-US')
      || left.connectionName.localeCompare(right.connectionName, 'zh-CN'))
}

function safeConnectionHost(value = ''): string {
  try { return new URL(value).host || '地址待填写' }
  catch { return '地址待核对' }
}
