import { nextTick } from 'vue'

// Explicit live ports preserve the existing book/request scope and draft ownership.
export function createTimelineNavigationActions(ports) {
  async function selectTimelineMode(mode) {
    if (mode !== ports.timelineMode.value && !ports.worldMapWorkspace.canLeave()) return
    if (ports.timelineMode.value === 'map' && mode !== 'map') ports.worldMapWorkspace.cancelRead()
    ports.timelineMode.value = mode
    if (mode === 'map') await ports.worldMapWorkspace.load()
    if (mode === 'characters') await ports.loadCharacterLines(true)
    if (mode === 'volumes') await ports.ensureTimelineVolumeSelected()
    if (mode === 'foreshadows') await ports.loadForeshadowLedger(true)
  }

  async function openChronicleMap(location) {
    ports.chronicleMapLocation.value = location.trim()
    await ports.selectWorkspaceLeaf('world-map')
    if (
      ports.timelineMode.value === 'map' &&
      ports.worldMapView.value &&
      !ports.worldMapView.value.events.some((event) => event.location.trim() === location.trim()) &&
      !ports.worldMapView.value.document.markers.some((marker) => marker.location === location.trim())
    )
      ports.notice('地图只读取已保存的地点；请先保存这条事件，再到地图中定位。')
  }

  async function openWorldMapEvent(target) {
    if (!ports.worldMapWorkspace.canLeave()) return
    const entries = target.source === 'canonical' ? ports.approvedEvents.value : ports.timeline.value
    if (!entries.some((item) => item.id === target.sourceId))
      return ports.notice('该事件已变化，请返回事件时间线核对，或重新读取地图。')
    ports.timelineMode.value = 'events'
    ports.expandedTimelineEntry.value = ports.timelineEntryId(
      target.source === 'canonical' ? 'formal' : 'direct',
      target.sourceId
    )
    await nextTick()
    document.querySelector('.timeline-node.open')?.scrollIntoView({ block: 'nearest' })
  }

  async function openWorldMapCharacter(name) {
    if (!ports.worldMapWorkspace.canLeave() || !ports.current.value) return
    const request = ports.workspaceRequests.capture(ports.current.value)
    await ports.loadCharacterLines(true)
    if (!ports.workspaceRequests.isCurrent(request, ports.current.value)) return
    const matches = ports.characterLines.value.lines.filter((line) => line.name.trim() === name.trim())
    if (matches.length !== 1)
      return ports.notice(
        matches.length
          ? '存在同名人物，请到人物档案选择具体记录。'
          : '该人物还没有已批准的正文状态记录；事件中的姓名已保留。'
      )
    ports.characterAtlasThroughPosition.value = null
    ports.characterDisplayMode.value = 'cards'
    ports.selectedCharacterLineId.value = matches[0].characterId
    ports.timelineMode.value = 'characters'
  }

  return { selectTimelineMode, openChronicleMap, openWorldMapEvent, openWorldMapCharacter }
}
