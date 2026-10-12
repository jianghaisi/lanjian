import { createHash } from 'node:crypto'
import { readWorldbookProfile } from '../../../../contracts/characters/worldbook'
import type { ContextCandidate } from '../../assistant/domain/context-compiler'

export type WorldbookEntity = { id: string; type: string; name: string; profile: unknown }
export type WorldbookChapter = { id: number; position: number }
export type WorldbookRelation = { subjectEntityId: string; objectEntityId: string; predicate: string; notes: string }
export const worldbookVersionPrefix = '世界书依据指纹：'

export function worldbookFingerprint(entities: WorldbookEntity[], chapters: WorldbookChapter[], relations: WorldbookRelation[] = []): string {
  return createHash('sha256').update(JSON.stringify({
    entities: [...entities].sort((a, b) => a.id.localeCompare(b.id)),
    chapters: [...chapters].sort((a, b) => a.id - b.id),
    relations: [...relations].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  })).digest('hex')
}

export function worldbookContextVersion(context: string): string | null {
  return context.match(/(?:^|\n)世界书依据指纹：([a-f0-9]{64})(?:\n|$)/)?.[1] ?? null
}

export function selectWorldbookContext(input: {
  entities: WorldbookEntity[]; chapters: WorldbookChapter[]; relations: WorldbookRelation[]; chapterId?: number; focus: string
}): ContextCandidate[] {
  const { entities, chapters, chapterId, relations } = input
  const position = chapters.find(item => item.id === chapterId)?.position
  const characters = new Map(entities.filter(item => item.type === 'character').map(item => [item.id, item.name]))
  const selected: ContextCandidate[] = []
  const included = new Set<string>()
  const focus = input.focus.normalize('NFKC').toLocaleLowerCase()
  for (const entity of entities) {
    const book = readWorldbookProfile(entity.profile)
    const reasons: string[] = []
    if (book?.alwaysInclude || entity.type === 'world_rule') reasons.push('全书规则')
    if (chapterId && book?.chapterIds.includes(chapterId)) reasons.push('作者绑定本章')
    if ([entity.name, ...(book?.aliases ?? [])].some(name => name.trim() && focus.includes(name.normalize('NFKC').toLocaleLowerCase()))) reasons.push('本章名称或别名命中')
    if (!reasons.length) continue
    included.add(entity.id)
    const secrets = (book?.secrets ?? []).flatMap(secret => {
      const reveal = chapters.find(item => item.id === secret.revealChapterId)?.position
      if (position === undefined || reveal === undefined || position < reveal || secret.knownBy.some(id => !characters.has(id))) return []
      return [{ text: secret.text, knownBy: secret.knownBy.map(id => ({ id, name: characters.get(id) })),
        boundary: '读者获知不等于人物获知；未列出的角色不得据此行动或说话。' }]
    })
    const projection = book ? { description: book.description, secrets }
      : { legacyProfile: entity.profile, limitation: '旧条目尚未配置披露规则，请作者核对其中的秘密。' }
    selected.push({ id: `worldbook:${entity.id}`, sourceId: entity.id, sourceType: 'worldbook-entry',
      label: `世界书 · ${entity.name}`, content: `世界书条目（稳定设定，不代替章前状态）：\n${JSON.stringify({ id: entity.id, type: entity.type, name: entity.name, ...projection })}`,
      authority: 'required', priority: 790, truncationPolicy: 'never', relevanceReasons: reasons })
  }
  // Relationship notes have no disclosure metadata. Names and predicates may
  // also encode a secret, so do not send unclassified relationships as a bypass.
  selected.push({ id: 'workspace:worldbook-state', sourceId: 'worldbook-state', sourceType: 'worldbook-state',
    label: '世界书使用边界', content: `${worldbookVersionPrefix}${worldbookFingerprint(entities, chapters, relations)}\n已按本章选择 ${included.size} 项设定。未列出的设定不是不存在。作者备注和未到披露章节的秘密未发送。未分类关系备注不作为生成依据。其他大纲或正文若重复写有秘密，仍需作者核对。审校请引用条目身份及正文证据指出冲突，不得把未发生计划当作事实。`,
    authority: 'required', priority: 890, truncationPolicy: 'never', relevanceReasons: ['信息边界与来源版本'] })
  return selected
}
