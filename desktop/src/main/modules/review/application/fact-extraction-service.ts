import { AppError } from '../../../core/errors/app-error'
import type { Chapter, CharacterDynamicChange } from '../../../../contracts/index'
import { AiClient } from '../../models/application/ai-client'
import { completeStructured } from '../../assistant/application/structured-response-repair'

/** Extracts reviewable facts only; it never writes manuscript text or author facts. */
export class FactExtractionService {
  constructor(private readonly ai: AiClient, private readonly repairAttempts: () => Promise<number> = async () => 1) {}

  async extract(chapter: Chapter, signal?: AbortSignal): Promise<CharacterDynamicChange[]> {
    if (!chapter.content.trim()) throw new AppError('VALIDATION_ERROR', '空正文无法提炼变化。', { recoverable: true })
    const instruction = '从当前已保存正文中提取“本章新增或改变”的人物状态。只返回 JSON 数组，不要 Markdown。每项必须有 character、field、value、event、evidence；可增加 importance（high/medium/low）和 reviewClass（reviewable/low_value）。event 是触发本次状态变化的简短事件标签；同一人物、同一字段、同一事件和同一结果若有多处逐字依据，可以分别返回，应用会合并并保留全部证据。field 只能是 location、injury、relationship、knowledge、possession、goal、power、vitality；evidence 必须是正文中包含角色名的连续原文。一次性动作细节、无后续价值的环境信息、重复称谓标为 low_value；没有可靠变化时返回 []。不要猜测。'
    return completeStructured({
      ai: this.ai,
      instruction,
      draft: chapter.content,
      systemContext: '你是小说事实抽取器。输出只供作者审批，绝不直接修改正文或正式设定。',
      task: 'review', signal, repairAttempts: await this.repairAttempts(),
      parse: (content) => parseChanges(content, chapter.content)
    })
  }
}

function parseChanges(content: string, body: string): CharacterDynamicChange[] {
  const raw = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  let values: unknown
  try { values = JSON.parse(raw) } catch { throw new AppError('AI_RESPONSE_INVALID', '事实提炼结果格式无效，未建立任何候选。', { recoverable: true }) }
  if (!Array.isArray(values) || values.length > 100) throw new AppError('AI_RESPONSE_INVALID', '事实提炼结果数量无效，未建立任何候选。', { recoverable: true })
  const allowed = new Set<CharacterDynamicChange['field']>(['location', 'injury', 'relationship', 'knowledge', 'possession', 'goal', 'power', 'vitality'])
  const result: CharacterDynamicChange[] = []
  for (const item of values) {
    if (!item || typeof item !== 'object') continue
    const value = item as Record<string, unknown>
    const character = text(value.character, 40)
    const field = text(value.field, 40) as CharacterDynamicChange['field']
    const next = text(value.value, 500)
    const event = text(value.event, 120)
    const evidence = text(value.evidence, 500)
    if (!character || !allowed.has(field) || !next || !evidence || !evidence.includes(character) || !body.includes(evidence)) continue
    if (field === 'vitality' && next !== '存活' && next !== '死亡') continue
    const importance = value.importance === 'high' || value.importance === 'medium' || value.importance === 'low' ? value.importance : undefined
    const reviewClass = value.reviewClass === 'low_value' ? 'low_value' as const : value.reviewClass === 'reviewable' ? 'reviewable' as const : undefined
    result.push({ character, field, value: next, evidence, ...(event ? { event } : {}), ...(importance ? { importance } : {}), ...(reviewClass ? { reviewClass } : {}) })
  }
  return result
}

function text(value: unknown, max: number): string { return typeof value === 'string' ? value.trim().slice(0, max) : '' }
