import { computed, ref } from 'vue'

// Explicit live ports preserve the existing book/request scope and draft ownership.
export function createCompanionState(ports) {
  const companionTyping = ref(false)

  const companionComposing = ref(false)

  const companionTask = computed(
    () =>
      ports.activeWritingAgentTask.value ||
      [...ports.writingAgentTasks.value]
        .reverse()
        .find((task) => task.workItemId === ports.current.value?.id && task.chapterId === ports.selectedId.value) ||
      null
  )

  return { companionTyping, companionComposing, companionTask }
}
