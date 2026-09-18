import { characterStateDetails } from '../../characters/services/character-atlas'

// Explicit live ports preserve the existing book/request scope and draft ownership.
export function createTimelineProjectionsActions(ports) {
  async function loadCharacterLines(force = false) {
    if (!ports.current.value || (ports.characterLinesLoaded.value && !force)) return
    const request = ports.workspaceRequests.capture(ports.current.value)
    const generation = ++ports.characterLinesRefreshGeneration
    const isCurrent = () =>
      generation === ports.characterLinesRefreshGeneration &&
      ports.workspaceRequests.isCurrent(request, ports.current.value)
    ports.characterLinesLoading.value = true
    ports.characterLinesError.value = ''
    if (!ports.characterAtlasInitialized) {
      ports.characterAtlasThroughPosition.value =
        ports.chapters.value.find((item) => item.id === ports.selectedId.value)?.position ?? null
      ports.characterAtlasInitialized = true
    }
    try {
      const result = await ports.desktop.workspace.getCharacterLines()
      if (!isCurrent()) return
      if (result.workItemId !== request.workItemId) throw new Error('人物记录不属于当前作品，请重新读取。')
      ports.characterLines.value = result
      ports.characterLinesLoaded.value = true
      if (!ports.characterAtlasCards.value.some((item) => item.characterId === ports.selectedCharacterLineId.value)) {
        ports.selectedCharacterLineId.value = ports.characterAtlasCards.value[0]?.characterId || ''
      }
    } catch (error) {
      if (!isCurrent()) return
      ports.characterLines.value = {
        version: 1,
        workItemId: request.workItemId,
        source: 'legacy-accepted-prose',
        lines: []
      }
      ports.characterLinesLoaded.value = false
      ports.selectedCharacterLineId.value = ''
      ports.characterLinesError.value = error?.message || '人物记录暂时无法读取，请重试。'
    } finally {
      if (isCurrent()) ports.characterLinesLoading.value = false
    }
  }

  async function openCharacterAtlasChapter(chapterId) {
    if (!ports.current.value) return
    const request = ports.workspaceRequests.capture(ports.current.value)
    if (!ports.chapters.value.some((item) => item.id === chapterId)) return ports.notice('来源章节已不在当前目录中。')
    try {
      await ports.openQuickChapter(chapterId)
    } catch (error) {
      if (ports.workspaceRequests.isCurrent(request, ports.current.value))
        ports.notice(error?.message || '暂时无法打开来源章节，当前内容保持不变。')
    }
  }

  async function ensureTimelineVolumeSelected() {
    const preferred = ports.timelineVolumeCards.value.some((item) => item.volume === ports.selectedTimelineVolume.value)
      ? ports.selectedTimelineVolume.value
      : ports.selectedChapterVolume.value || ports.timelineVolumeCards.value[0]?.volume || 0
    if (preferred) await loadTimelineVolume(preferred)
    else {
      ports.selectedTimelineVolume.value = 0
      ports.timelineVolumeContent.value = ''
    }
  }

  async function loadTimelineVolume(volume) {
    if (!volume || !ports.current.value) return
    const generation = ++ports.timelineVolumeGeneration
    const request = ports.workspaceRequests.capture(ports.current.value)
    const isCurrent = () =>
      generation === ports.timelineVolumeGeneration &&
      ports.workspaceRequests.isCurrent(request, ports.current.value) &&
      ports.active.value === 'timeline' &&
      ports.timelineMode.value === 'volumes'
    ports.timelineVolumeLoading.value = true
    ports.timelineVolumeError.value = ''
    try {
      const result = await ports.desktop.outlines.get(volume)
      if (!isCurrent()) return
      ports.selectedTimelineVolume.value = volume
      ports.timelineVolumeContent.value = result.content
    } catch (error) {
      if (isCurrent())
        ports.timelineVolumeError.value = `第 ${volume} 卷概览未打开：${error?.message || '读取失败，请重新选择该卷。'}`
    } finally {
      if (generation === ports.timelineVolumeGeneration) ports.timelineVolumeLoading.value = false
    }
  }

  async function openTimelineVolumeInOutline(volume) {
    await ports.openVolumeOutline(volume)
  }

  function characterPointDetails(point) {
    return characterStateDetails(point)
  }

  function volumeLineRange(volume) {
    if (!volume.chapterCount) return '尚未归入章节'
    if (volume.firstChapter === volume.lastChapter) return `第 ${volume.firstChapter} 章`
    return `第 ${volume.firstChapter}—${volume.lastChapter} 章`
  }

  function volumeLineStatus(volume) {
    return (
      {
        confirmed: '本版已确认',
        stale: '确认已失效',
        ready: '可以确认',
        blocked: '等待上游',
        missing: '卷纲待写',
        'needs-review': '等待复核'
      }[volume.approval?.status] || '等待整理'
    )
  }

  return {
    loadCharacterLines,
    openCharacterAtlasChapter,
    ensureTimelineVolumeSelected,
    loadTimelineVolume,
    openTimelineVolumeInOutline,
    characterPointDetails,
    volumeLineRange,
    volumeLineStatus
  }
}
