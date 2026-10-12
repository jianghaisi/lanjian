/** Temporary reading offsets, never task state or persisted author content. */
export function createAssistantHistoryPositions() {
  const positions = new Map<string, { content: string; top: number }>()
  return {
    save(key: string, content: string, top: number) {
      if (!key || !Number.isFinite(top) || top < 0) return
      positions.delete(key)
      positions.set(key, { content, top })
      if (positions.size > 32) positions.delete(positions.keys().next().value!)
    },
    restore(key: string, content: string) {
      const position = positions.get(key)
      if (!position || position.content !== content) { positions.delete(key); return 0 }
      // The sticky header still occupies normal flow. Its height moves the body
      // and the visible reading edge equally; compensating here would do it twice.
      return position.top
    },
    clear() { positions.clear() },
  }
}
