import { computed, ref } from 'vue'

// Explicit live ports preserve the existing book/request scope and draft ownership.
export function createTimelineState(ports) {
  const timelineMode = ref('events')

  const chronicleMapLocation = ref('')

  const timeline = ref([])

  const expandedTimelineEntry = ref('')

  const timelineAiCandidates = ref([])

  const timelineAiGenerating = ref(false)

  const timelineVolumeContent = ref('')

  const timelineVolumeLoading = ref(false)

  const timelineVolumeError = ref('')

  const canonicalEvents = ref([])

  const eventDraft = ref({ sourceId: '', time: '', characters: '', location: '', event: '', result: '' })

  const approvedEvents = computed(() => canonicalEvents.value.filter((item) => item.status === 'approved'))

  const timelineEntryCount = computed(() => approvedEvents.value.length + timeline.value.length)

  const timelineVolumeCards = computed(() =>
    ports.outlinePlanning.value.volumes.map((volume) => {
      const placements = ports.outlinePlanning.value.chapterPlacements
        .filter((item) => item.volume === volume.volume)
        .map((item) => ports.chapters.value.find((chapter) => chapter.id === item.chapterId))
        .filter(Boolean)
        .sort((left, right) => left.position - right.position)
      return {
        ...volume,
        chapterCount: placements.length,
        firstChapter: placements[0]?.position || null,
        lastChapter: placements.at(-1)?.position || null,
        eventCount: volume.eventIds.length
      }
    })
  )

  return {
    timelineMode,
    chronicleMapLocation,
    timeline,
    expandedTimelineEntry,
    timelineAiCandidates,
    timelineAiGenerating,
    timelineVolumeContent,
    timelineVolumeLoading,
    timelineVolumeError,
    canonicalEvents,
    eventDraft,
    approvedEvents,
    timelineEntryCount,
    timelineVolumeCards
  }
}
