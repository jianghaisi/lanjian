import type { CharacterStateEvent, CharacterStateView, ConsistencyFinding, RealmLevel } from '../../../../contracts/index'

const movementCues = /来到|抵达|赶到|赶赴|返回|回到|前往|进入|离开|穿过|传送|瞬移|迁往|转移|动身|赶路/
const powerLossCues = /跌落|跌境|倒退|散功|封印|压制|受损|失去|削弱|重伤|境界不稳/
const revivalCues = /复活|复生|重生|还魂|死而复生|起死回生|涅槃|重新苏醒|从死亡中醒来/
const possessionTransferCues = /交给|递给|借给|送给|归还|还给|转交|接过|拿到|收到|取回|领回/

export function auditCharacterContinuity(
  state: CharacterStateView | undefined,
  realms: RealmLevel[],
  throughChapter?: number
): ConsistencyFinding[] {
  if (!state) return []
  const nameById = new Map(state.anchors.map((anchor) => [anchor.id, anchor.name]))
  const events = state.events
    .filter((event) => event.active && (!throughChapter || event.chapterPosition <= throughChapter))
    .sort((left, right) => left.characterId.localeCompare(right.characterId)
      || left.chapterPosition - right.chapterPosition
      || left.acceptedAt.localeCompare(right.acceptedAt))
  const findings: ConsistencyFinding[] = []
  findings.push(...possessionFindings(events, nameById))
  const previousByCharacterAndField = new Map<string, Partial<Record<AuditedField, CharacterStateEvent>>>()

  for (const current of events) {
    const characterName = nameById.get(current.characterId) || current.characterId
    const previous = previousByCharacterAndField.get(current.characterId) || {}
    if (current.changes.location && previous.location && current.chapterPosition > previous.location.chapterPosition) {
      findings.push(...locationFindings(previous.location, current, characterName))
    }
    if (current.changes.power && previous.power && current.chapterPosition > previous.power.chapterPosition) {
      findings.push(...powerFindings(previous.power, current, characterName, realms))
    }
    if (current.changes.vitality && previous.vitality && current.chapterPosition > previous.vitality.chapterPosition) {
      findings.push(...vitalityFindings(previous.vitality, current, characterName))
    }
    if (current.changes.location) previous.location = current
    if (current.changes.power) previous.power = current
    if (current.changes.vitality) previous.vitality = current
    previousByCharacterAndField.set(current.characterId, previous)
    if (findings.length >= 200) break
  }
  return findings.slice(0, 200)
}

function possessionFindings(events: CharacterStateEvent[], nameById: Map<string, string>): ConsistencyFinding[] {
  const holders = new Map<string, { event: CharacterStateEvent; name: string; item: string }>()
  const findings: ConsistencyFinding[] = []
  const ordered = [...events].sort((left, right) => left.chapterPosition - right.chapterPosition
    || left.acceptedAt.localeCompare(right.acceptedAt)
    || left.characterId.localeCompare(right.characterId))
  for (const current of ordered) {
    const state = possessionState(current.changes.possession)
    if (!state) continue
    const currentName = nameById.get(current.characterId) || current.characterId
    if (state.kind === 'released') {
      const holder = holders.get(state.key)
      if (holder?.event.characterId === current.characterId) holders.delete(state.key)
      continue
    }
    const previous = holders.get(state.key)
    if (previous && previous.event.characterId !== current.characterId && current.chapterPosition >= previous.event.chapterPosition) {
      const evidence = fieldEvidence(current, 'possession')
      const explicitHandoff = possessionTransferCues.test(evidence)
        && evidence.includes(previous.name)
        && evidence.includes(currentName)
      if (!explicitHandoff) {
        findings.push(finding('POSSESSION_HANDOFF', 'attention', previous.event, current, currentName,
          `关键物品“${state.item}”先由${previous.name}持有，后由${currentName}持有，但当前正文证据没有明确交代双方交接。`,
          evidencePair(previous.event, current, 'possession')))
      }
    }
    holders.set(state.key, { event: current, name: currentName, item: state.item })
    if (findings.length >= 200) break
  }
  return findings
}

function locationFindings(previous: CharacterStateEvent, current: CharacterStateEvent, name: string): ConsistencyFinding[] {
  const before = previous.changes.location?.trim()
  const after = current.changes.location?.trim()
  if (!before || !after || normalize(before) === normalize(after) || current.chapterPosition !== previous.chapterPosition + 1) return []
  const evidence = fieldEvidence(current, 'location')
  if (movementCues.test(evidence)) return []
  return [finding('LOCATION_JUMP', 'attention', previous, current, name,
    `${name}从“${before}”直接出现在“${after}”，相邻章节的正文证据没有交代移动承接。`, evidencePair(previous, current, 'location'))]
}

function powerFindings(previous: CharacterStateEvent, current: CharacterStateEvent, name: string, realms: RealmLevel[]): ConsistencyFinding[] {
  const before = realmIndex(previous.changes.power, realms)
  const after = realmIndex(current.changes.power, realms)
  if (before < 0 || after < 0 || before === after) return []
  const evidence = fieldEvidence(current, 'power')
  if (after > before + 1) {
    return [finding('POWER_SKIP', 'blocked', previous, current, name,
      `${name}从“${realms[before].name}”跨到“${realms[after].name}”，越过了 ${after - before - 1} 个已定义境界。`, evidencePair(previous, current, 'power'))]
  }
  if (after < before && !powerLossCues.test(evidence)) {
    return [finding('POWER_REGRESSION', 'attention', previous, current, name,
      `${name}从“${realms[before].name}”降至“${realms[after].name}”，正文证据没有说明跌境、封印或受损原因。`, evidencePair(previous, current, 'power'))]
  }
  return []
}

function vitalityFindings(previous: CharacterStateEvent, current: CharacterStateEvent, name: string): ConsistencyFinding[] {
  if (previous.changes.vitality !== 'dead' || current.changes.vitality !== 'alive') return []
  const evidence = fieldEvidence(current, 'vitality')
  if (revivalCues.test(evidence)) return []
  return [finding('UNEXPLAINED_REVIVAL', 'blocked', previous, current, name,
    `${name}在前章已明确死亡，后章又被标记为存活，但正文证据没有交代复活依据。`, evidencePair(previous, current, 'vitality'))]
}

function finding(
  code: ConsistencyFinding['code'], severity: ConsistencyFinding['severity'],
  previous: CharacterStateEvent, current: CharacterStateEvent, characterName: string,
  message: string, evidence: string[]
): ConsistencyFinding {
  return {
    code, severity, message,
    characterId: current.characterId,
    characterName,
    fromChapter: previous.chapterPosition,
    toChapter: current.chapterPosition,
    evidence
  }
}

type AuditedField = 'location' | 'possession' | 'power' | 'vitality'

function evidencePair(previous: CharacterStateEvent, current: CharacterStateEvent, field: AuditedField): string[] {
  return unique([fieldEvidence(previous, field), fieldEvidence(current, field)]).map((value) => value.slice(0, 500))
}

function fieldEvidence(event: CharacterStateEvent, field: AuditedField): string {
  return event.changeEvidence?.[field] || event.evidence
}

function realmIndex(value: string | undefined, realms: RealmLevel[]): number {
  if (!value) return -1
  const normalized = normalize(value)
  let match = -1
  let length = -1
  realms.forEach((realm, index) => {
    const name = normalize(realm.name)
    if (name && normalized.includes(name) && name.length > length) {
      match = index
      length = name.length
    }
  })
  return match
}

function normalize(value: string): string {
  return value.replace(/[\s，。、“”‘’：:；;（）()【】\[\]]/g, '').toLocaleLowerCase('zh-CN')
}

function possessionState(value: string | undefined): { kind: 'held' | 'released'; item: string; key: string } | null {
  const text = value?.trim()
  if (!text) return null
  const released = text.match(/^(?:已|已经)?(?:不再持有|归还|还给|交给|借给|送给|失去)[：:\s]*(.{1,80})$/)
  const held = text.match(/^(?:仍|当前|现在)?(?:持有|保管|拿着|带着|拥有)[：:\s]*(.{1,80})$/)
  const match = released || held
  if (!match) return null
  const item = match[1].replace(/(?:给|由).{1,20}$/u, '').trim()
  const key = normalize(item)
  if (key.length < 2 || key.length > 80) return null
  return { kind: released ? 'released' : 'held', item, key }
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}
