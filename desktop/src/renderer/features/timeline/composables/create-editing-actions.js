import { parseTimelineCandidates, timelineEventTitle } from '../timeline-workbench'

// Explicit live ports preserve the existing book/request scope and draft ownership.
export function createTimelineEditingActions(ports) {
  function timelineEntryId(kind, id) {
    return `${kind}:${id}`
  }

  function isTimelineEntryOpen(kind, id) {
    return ports.expandedTimelineEntry.value === timelineEntryId(kind, id)
  }

  function toggleTimelineEntry(kind, id) {
    const key = timelineEntryId(kind, id)
    ports.expandedTimelineEntry.value = ports.expandedTimelineEntry.value === key ? '' : key
  }

  function addTimeline() {
    const event = { id: crypto.randomUUID(), title: '', time: '', characters: '', location: '', event: '', result: '' }
    ports.timeline.value.push(event)
    ports.expandedTimelineEntry.value = timelineEntryId('direct', event.id)
  }

  function updateChronicleField(kind, id, field, value) {
    if (!['title', 'time', 'characters', 'location', 'event', 'result'].includes(field)) return
    const collection =
      kind === 'direct' ? ports.timeline.value : kind === 'candidate' ? ports.timelineAiCandidates.value : []
    const item = collection.find((entry) => entry.id === id)
    if (item) item[field] = value
  }

  function removeTimelineEvent(index) {
    const [removed] = ports.timeline.value.splice(index, 1)
    if (removed && isTimelineEntryOpen('direct', removed.id)) ports.expandedTimelineEntry.value = ''
  }

  function moveTimelineEvent(index, direction) {
    const target = index + direction
    if (target < 0 || target >= ports.timeline.value.length) return
    const [event] = ports.timeline.value.splice(index, 1)
    ports.timeline.value.splice(target, 0, event)
  }

  async function generateTimelineCandidates() {
    ports.timelineAiGenerating.value = true
    const existing = [...ports.approvedEvents.value, ...ports.timeline.value]
      .map((item) => `${item.time}｜${timelineEventTitle(item.event, item.title)}`)
      .join('\n')
      .slice(0, 6_000)
    const context = {
      title: ports.current.value?.title || ports.current.value?.name || '',
      genre: ports.bookProfile.value.genre,
      subgenre: ports.bookProfile.value.subgenre,
      coreIdea: ports.bookProfile.value.coreIdea,
      plannedVolumes: ports.bookProfile.value.plannedVolumes,
      chaptersPerVolume: ports.bookProfile.value.chaptersPerVolume,
      targetWordsPerChapter: ports.bookProfile.value.targetWordsPerChapter,
      materials: ports.foundation.value.sourceNotes.slice(0, 6_000),
      worldView: ports.foundation.value.worldView.slice(0, 6_000),
      totalOutline: ports.totalOutline.value.slice(0, 12_000),
      existingEvents: existing
    }
    const instruction = `你正在为一本中文小说起草“全局事件时间线”候选。请只依据下面这本书自己的资料，不得套用任何示例作品、固定人名、学校、都市或战斗模板。不同题材可以使用具体日期、朝代纪年、任务阶段、旅程日数或“开端/转折/结局”等相对顺序。\n\n${JSON.stringify(context, null, 2)}\n\n生成 8 至 16 个覆盖全书因果主线的关键事件，不要把每章都列成事件，也不要重复“已有事件”。每项必须包含：title（12字左右的事件标题）、time（具体时间或清楚的相对顺序）、characters（人物名，用顿号连接）、location（地点）、event（发生了什么）、result（对后续的影响）。只输出 JSON 数组，不要 Markdown，不要解释。`
    try {
      const result = await ports.guard(
        () => ports.desktop.ai.complete(instruction, '', 'outline'),
        'AI 事件候选已生成；逐条采用前不会进入正式时间线'
      )
      ports.timelineAiCandidates.value = parseTimelineCandidates(result.content).map((item) => ({
        id: crypto.randomUUID(),
        ...item
      }))
      ports.expandedTimelineEntry.value = ports.timelineAiCandidates.value[0]
        ? timelineEntryId('candidate', ports.timelineAiCandidates.value[0].id)
        : ''
    } catch {
      // guard has already reported the actionable model or parsing error.
    } finally {
      ports.timelineAiGenerating.value = false
    }
  }

  function adoptTimelineCandidate(candidate) {
    const event = {
      id: crypto.randomUUID(),
      title: candidate.title,
      time: candidate.time,
      characters: candidate.characters,
      location: candidate.location,
      event: candidate.event,
      result: candidate.result
    }
    ports.timeline.value.push(event)
    ports.timelineAiCandidates.value = ports.timelineAiCandidates.value.filter((item) => item.id !== candidate.id)
    ports.expandedTimelineEntry.value = timelineEntryId('direct', event.id)
    ports.notice('候选已放入作者时间线；保存后才会进入写作上下文')
  }

  function discardTimelineCandidate(id) {
    ports.timelineAiCandidates.value = ports.timelineAiCandidates.value.filter((item) => item.id !== id)
    if (isTimelineEntryOpen('candidate', id)) ports.expandedTimelineEntry.value = ''
  }

  function reviewCanonicalEvents() {
    ports.active.value = 'research'
    ports.materialSection.value = 'events'
  }

  async function saveTimeline() {
    if (!ports.current.value || ports.busy.value) return
    const request = ports.workspaceRequests.capture(ports.current.value)
    const submitted = ports.plainDto(ports.timeline.value)
    const result = await ports.guard(() => ports.desktop.workspace.saveTimeline(submitted))
    if (!ports.workspaceRequests.isCurrent(request, ports.current.value)) return
    const unchanged = JSON.stringify(ports.timeline.value) === JSON.stringify(submitted)
    if (unchanged) ports.timeline.value = result.events
    ports.notice(unchanged ? '时间线已保存' : '本次提交已保存；保存期间的新修改仍保留，请再次保存。')
    await ports.refreshWorkflow()
  }

  async function createEventCandidate() {
    const input = {
      ...ports.eventDraft.value,
      characters: ports.eventDraft.value.characters
        .split(/[、,，]/)
        .map((item) => item.trim())
        .filter(Boolean)
    }
    const created = await ports.guard(
      () => ports.desktop.research.createEventCandidate(ports.plainDto(input)),
      '事件候选已建立，确认前不会进入作品事实'
    )
    ports.canonicalEvents.value = [created, ...ports.canonicalEvents.value]
    ports.eventDraft.value = { sourceId: '', time: '', characters: '', location: '', event: '', result: '' }
  }

  async function approveCanonicalEvent(id) {
    const approved = await ports.guard(() => ports.desktop.research.approveEvent(id), '事件已确认进入本书事件库')
    const index = ports.canonicalEvents.value.findIndex((item) => item.id === id)
    if (index >= 0) ports.canonicalEvents.value.splice(index, 1, approved)
  }

  return {
    timelineEntryId,
    isTimelineEntryOpen,
    toggleTimelineEntry,
    addTimeline,
    updateChronicleField,
    removeTimelineEvent,
    moveTimelineEvent,
    generateTimelineCandidates,
    adoptTimelineCandidate,
    discardTimelineCandidate,
    reviewCanonicalEvents,
    saveTimeline,
    createEventCandidate,
    approveCanonicalEvent
  }
}
