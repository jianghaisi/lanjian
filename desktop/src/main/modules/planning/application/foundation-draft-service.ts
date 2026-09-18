import { AppError } from '../../../core/errors/app-error'
import type { AiTask, FoundationDraftProposal, RealmLevel } from '../../../../contracts/index'
import { WorkspaceService } from '../../library/application/workspace-service'
import { completeStructured } from '../../assistant/application/structured-response-repair'

type TextGenerator = {
  complete: (instruction: string, draft?: string, systemContext?: string, task?: AiTask) => Promise<{ content: string }>
}

export class FoundationDraftService {
  constructor(private readonly ai: TextGenerator, private readonly workspace: WorkspaceService) {}

  async generate(): Promise<FoundationDraftProposal> {
    const [profile, foundation] = await Promise.all([this.workspace.bookProfile(), this.workspace.foundation()])
    if (!(await this.workspace.hasPlanningMaterials())) {
      throw new AppError('VALIDATION_ERROR', '请先在“素材”中保存核心设想或资料，再生成作品设定。', {
        recoverable: true,
        details: { field: 'sourceNotes' }
      })
    }
    const instruction = [
      '根据当前作品定义和作者素材，起草一份“作品设定候选”。这是候选草案，作者确认前不得视为正式设定。',
      `当前作品谋篇策略：${await this.workspace.effectivePrompt('outline')}`,
      '只输出一个 JSON 对象，不要使用 Markdown 代码块或补充说明。字段必须为：',
      '{"worldView":"时代、空间、秩序、规则、核心冲突和不可违反边界","useRealms":true,"realms":[{"name":"层级名","description":"能力边界、代价和突破条件"}],"useSystem":true,"systemTemplate":"固定显示模板","rationale":"为何这样设计以及它怎样服务核心设想"}',
      '不适合境界体系的题材应令 useRealms=false 且 realms=[]；不适合系统/金手指的作品应令 useSystem=false 且 systemTemplate=""。',
      '不得凭空声称素材中不存在的事实；可以提出创作性设定，但必须与核心设想和题材承诺相容。'
    ].join('\n')
    return completeStructured({
      ai: this.ai,
      instruction,
      systemContext: await this.workspace.promptContext(undefined, 'outline'),
      task: 'outline',
      repairAttempts: (await this.workspace.contextBudgetPreferences()).structuredRepairAttempts,
      parse: parseFoundationDraft
    })
  }
}

export function parseFoundationDraft(content: string): FoundationDraftProposal {
  const candidate = extractJsonObject(content)
  let raw: unknown
  try { raw = JSON.parse(candidate) }
  catch { throw invalidDraft('模型返回的设定候选不是有效 JSON，请重试。') }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw invalidDraft('模型返回的设定候选结构无效，请重试。')
  const value = raw as Record<string, unknown>
  const worldView = cleanString(value.worldView, 100_000)
  const rationale = cleanString(value.rationale, 20_000)
  if (!worldView || !rationale || typeof value.useRealms !== 'boolean' || typeof value.useSystem !== 'boolean' || !Array.isArray(value.realms)) {
    throw invalidDraft('设定候选缺少世界观、采用理由或体系开关，请重试。')
  }
  const realms: RealmLevel[] = value.realms.slice(0, 100).map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw invalidDraft(`第 ${index + 1} 层境界结构无效。`)
    const realm = item as Record<string, unknown>
    const name = cleanString(realm.name, 120)
    const description = cleanString(realm.description, 5_000)
    if (!name || !description) throw invalidDraft(`第 ${index + 1} 层境界缺少名称或能力边界。`)
    return { id: crypto.randomUUID(), name, description }
  })
  if (value.useRealms && realms.length === 0) throw invalidDraft('候选启用了境界体系，却没有返回境界层级。')
  const systemTemplate = cleanString(value.systemTemplate, 100_000)
  if (value.useSystem && !systemTemplate) throw invalidDraft('候选启用了系统或金手指，却没有返回固定界面模板。')
  return { worldView, useRealms: value.useRealms, realms, useSystem: value.useSystem, systemTemplate, rationale }
}

function extractJsonObject(content: string): string {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  return start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed
}

function cleanString(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.trim().slice(0, limit) : ''
}

function invalidDraft(message: string): AppError {
  return new AppError('AI_RESPONSE_INVALID', message, { recoverable: true })
}
