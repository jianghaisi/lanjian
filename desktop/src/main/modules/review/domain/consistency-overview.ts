import type {
  ConsistencyItem,
  ConsistencyOverview,
  CharacterStateView,
  OutlinePlanningStatus,
  RealmLevel,
  WorkflowStatus
} from '../../../../contracts/index'
import { auditCharacterContinuity } from '../../characters/domain/character-continuity'

type ConsistencyInput = {
  workflow: WorkflowStatus
  planning: OutlinePlanningStatus
  chapterId?: number
  chapterPosition?: number
  characterState?: CharacterStateView
  realms?: RealmLevel[]
  literaryFindings?: ConsistencyItem['findings']
}

export function buildConsistencyOverview(input: ConsistencyInput): ConsistencyOverview {
  const { workflow, planning, chapterId, chapterPosition } = input
  const items: ConsistencyItem[] = [
    foundationItem(workflow),
    totalOutlineItem(planning),
    volumeOutlineItem(planning, chapterId),
    eventItem(planning, chapterId),
    chapterOutlineItem(planning, chapterId),
    chapterContractItem(planning, chapterId),
    characterStateItem(input.characterState, chapterPosition, input.realms || []),
    literaryStyleItem(chapterId, input.literaryFindings || [])
  ]
  const blockers = unique([
    ...workflow.missingForProse,
    ...items.filter((item) => item.status === 'blocked').flatMap((item) => item.issues)
  ])
  const status = blockers.length > 0
    ? 'blocked'
    : items.some((item) => item.status === 'attention') ? 'attention' : 'ready'
  return {
    status,
    readyForProse: workflow.readyForProse && blockers.length === 0,
    ...(chapterId ? { chapterId, chapterPosition: chapterPosition || chapterId } : {}),
    summary: status === 'blocked'
      ? `${blockers.length} 项前置需要处理`
      : status === 'attention' ? '可以继续写作，另有可选建议' : '写作前置已齐备',
    blockers,
    items
  }
}

function literaryStyleItem(chapterId: number | undefined, findings: NonNullable<ConsistencyItem['findings']>): ConsistencyItem {
  if (!chapterId) return item('literaryStyle', '表达提示', 'deferred', '选择章节后检查局部重复和表达节奏。', 'outline')
  if (!findings.length) return item('literaryStyle', '表达提示', 'ready', '未发现明确的机械重复信号；这不代表文学质量评分。', 'outline')
  return item('literaryStyle', '表达提示', 'attention', `发现 ${findings.length} 项可选表达建议；不会阻断手写、保存或采用正文。`, 'outline', [], undefined, undefined, findings)
}

function characterStateItem(state: CharacterStateView | undefined, chapterPosition: number | undefined, realms: RealmLevel[]): ConsistencyItem {
  if (!state?.anchors.length) return item('characterState', '人物状态', 'deferred', '尚无已采用正文的人物状态；当前不会把“未知”伪装成已校验。', 'world')
  const activeSnapshots = state.snapshots.filter((snapshot) => snapshot.lastEventId)
  if (!activeSnapshots.length) return item('characterState', '人物状态', 'attention', `保留了 ${state.anchors.length} 名人物的来源锚点，但当前正文没有可重放的人物动态状态。`, 'world')
  const findings = auditCharacterContinuity(state, realms, chapterPosition)
  const blockedFindings = findings.filter((finding) => finding.severity === 'blocked')
  const attentionFindings = findings.filter((finding) => finding.severity === 'attention')
  if (blockedFindings.length) return item('characterState', '人物连续性', 'blocked', `发现 ${blockedFindings.length} 项高风险跨章矛盾，需要先核对正文或人物状态证据。`, 'world', blockedFindings.map((finding) => finding.message), undefined, undefined, findings)
  const latestChapter = Math.max(0, ...state.snapshots.map((snapshot) => snapshot.throughChapter))
  const affected = chapterPosition ? state.events.filter((event) => event.active && event.chapterPosition === chapterPosition).length : 0
  const unresolved = state.pendingConflicts.filter((conflict) => conflict.status === 'pending').length
  if (attentionFindings.length || unresolved) {
    const summaries = [
      ...(attentionFindings.length ? [`${attentionFindings.length} 项跨章承接需核对`] : []),
      ...(unresolved ? [`${unresolved} 项身份、动机或人物弧冲突待确认`] : [])
    ]
    return item('characterState', '人物连续性', 'attention', `人物动态状态已结算；${summaries.join('，')}。`, 'world', [], undefined, undefined, findings)
  }
  if (affected) return item('characterState', '人物状态', 'ready', `本章已结算 ${affected} 名人物；快照可追溯到正文证据。`, 'world')
  return item('characterState', '人物状态', 'attention', `已有 ${state.anchors.length} 名人物快照，最近结算至第 ${latestChapter} 章；当前章尚未采用正文。`, 'world')
}

function foundationItem(workflow: WorkflowStatus): ConsistencyItem {
  const foundation = workflow.steps.find((step) => step.id === 'foundation')
  if (!foundation || foundation.missing.length) {
    const issues = foundation?.missing.length ? foundation.missing : ['世界观与启用体系']
    return item('foundation', '世界与体系', 'blocked', foundation?.detail || '世界观与启用体系尚未完成。', 'world', issues)
  }
  return item('foundation', '世界与体系', 'ready', foundation.detail, 'world')
}

function totalOutlineItem(planning: OutlinePlanningStatus): ConsistencyItem {
  const approval = planning.totalApproval
  if (!planning.totalOutlineExists || approval.status === 'missing') {
    return item('totalOutline', '全书总纲', 'blocked', '尚未建立可追溯的正式总纲。', 'outline', ['全局总纲'])
  }
  if (approval.status === 'stale' || planning.externalChangeDetected) {
    return item('totalOutline', '全书总纲', 'blocked', `第 ${planning.totalRevision} 版发生变化，需要重新审核确认。`, 'outline', ['全局总纲确认已失效'], planning.totalRevision, approval.fingerprint)
  }
  if (approval.status === 'confirmed') {
    return item('totalOutline', '全书总纲', 'ready', `第 ${planning.totalRevision} 版已正式确认。`, 'outline', [], planning.totalRevision, approval.fingerprint)
  }
  return item('totalOutline', '全书总纲', 'attention', approval.reason || '总纲已保存，尚未正式确认。', 'outline', [], planning.totalRevision, approval.fingerprint)
}

function volumeOutlineItem(planning: OutlinePlanningStatus, chapterId?: number): ConsistencyItem {
  if (!chapterId) return item('volumeOutline', '当前卷纲', 'deferred', '选择章节后核对它所属篇卷。', 'outline')
  const volumeNumber = planning.chapterPlacements.find((entry) => entry.chapterId === chapterId)?.volume
  if (!volumeNumber) return item('volumeOutline', '当前卷纲', 'deferred', '当前章节尚未归卷；短篇可只受总纲约束。', 'outline')
  const volume = planning.volumes.find((entry) => entry.volume === volumeNumber)
  if (!volume) return item('volumeOutline', '当前卷纲', 'blocked', `第 ${volumeNumber} 卷引用不存在。`, 'outline', ['当前章节所属卷不存在'])
  if (volume.externalChangeDetected || volume.approval.status === 'stale') {
    return item('volumeOutline', '当前卷纲', 'blocked', `第 ${volume.volume} 卷第 ${volume.revision} 版发生变化，需要重新确认。`, 'outline', ['当前卷纲确认已失效'], volume.revision, volume.approval.fingerprint)
  }
  if (volume.approval.status === 'confirmed') {
    return item('volumeOutline', '当前卷纲', 'ready', `第 ${volume.volume} 卷《${volume.title}》第 ${volume.revision} 版已确认。`, 'outline', [], volume.revision, volume.approval.fingerprint)
  }
  return item('volumeOutline', '当前卷纲', 'blocked', volume.approval.reason || '当前卷纲尚未确认。', 'outline', ['当前卷纲待正式确认'], volume.revision, volume.approval.fingerprint)
}

function eventItem(planning: OutlinePlanningStatus, chapterId?: number): ConsistencyItem {
  const chapterCount = chapterId ? planning.eventChapterPlacements.filter((entry) => entry.chapterId === chapterId).length : 0
  if (!planning.assignedEventIds.length) {
    return item('events', '正式事件', 'attention', '尚未将事件关联到总纲。这是可选整理，无需在纪事中重复确认；已保存的纪事仍可供 AI 参考。', 'outline')
  }
  if (chapterId && chapterCount > 0) {
    return item('events', '正式事件', 'ready', `本章契约已引用 ${chapterCount} 项正式事件；另有 ${planning.unplacedEventIds.length} 项待分卷。`, 'timeline')
  }
  return item('events', '正式事件', planning.unplacedEventIds.length ? 'attention' : 'ready',
    chapterId ? `本章未绑定资料库事件；全书已有 ${planning.assignedEventIds.length} 项事件入纲。` : `已有 ${planning.assignedEventIds.length} 项事件入纲。`,
    'timeline')
}

function chapterOutlineItem(planning: OutlinePlanningStatus, chapterId?: number): ConsistencyItem {
  if (!chapterId) return item('chapterOutline', '当前章纲', 'deferred', '选择章节后核对章纲版本。', 'outline')
  const chapter = planning.chapter
  if (!chapter?.hasContent || chapter.review.status === 'missing') return item('chapterOutline', '当前章纲', 'blocked', '当前章节还没有章纲。', 'outline', ['当前章节大纲'])
  if (chapter.stale || chapter.review.status === 'stale') return item('chapterOutline', '当前章纲', 'blocked', '章纲依赖的总纲、卷纲或正式事件已经变化。', 'outline', ['当前章节大纲已过期'])
  if (chapter.review.status === 'confirmed') {
    return item('chapterOutline', '当前章纲', 'ready', `基于总纲第 ${chapter.basedOnTotalRevision} 版${chapter.volume ? `、卷纲第 ${chapter.basedOnVolumeRevision} 版` : ''}，结构已确认。`, 'outline', [], undefined, chapter.contractVersion?.outlineHash)
  }
  return item('chapterOutline', '当前章纲', 'blocked', chapter.review.status === 'ready' ? '结构检查通过，等待作者确认本版。' : '章纲结构检查尚未通过。', 'outline', ['当前章节大纲待审核确认'])
}

function chapterContractItem(planning: OutlinePlanningStatus, chapterId?: number): ConsistencyItem {
  if (!chapterId) return item('chapterContract', '章节契约', 'deferred', '选择章节后编译进入、节点、退出与禁写边界。', 'outline')
  const version = planning.chapter?.contractVersion
  if (!version || planning.chapter?.stale) return item('chapterContract', '章节契约', 'blocked', '尚无可用于正文生成的有效契约。', 'outline', ['章节契约尚未锁定'])
  return item('chapterContract', '章节契约', 'ready', `${version.eventIds.length} 项正式事件 · 指纹 ${version.fingerprint.slice(0, 8)}。`, 'outline', [], undefined, version.fingerprint)
}

function item(
  id: ConsistencyItem['id'], label: string, status: ConsistencyItem['status'], summary: string,
  target: ConsistencyItem['target'], issues: string[] = [], revision?: number, fingerprint?: string,
  findings?: ConsistencyItem['findings']
): ConsistencyItem {
  return { id, label, status, summary, target, issues, ...(revision === undefined ? {} : { revision }), ...(fingerprint ? { fingerprint } : {}), ...(findings?.length ? { findings } : {}) }
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}
