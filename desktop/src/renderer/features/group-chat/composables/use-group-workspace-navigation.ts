import { ref, watch, type Ref } from 'vue'
import type { ProjectSummary } from '../../../../contracts'
export function useGroupWorkspaceNavigation(ports: { current: Ref<ProjectSummary | null>; open?: Ref<boolean>; prepareLeave(): Promise<boolean>; selectBook(book: ProjectSummary): Promise<void>; closeBook(): Promise<void>; activate(book: ProjectSummary): Promise<void>; refresh(): Promise<void> }) {
  const open = ports.open ?? ref(false)
  let navigation = 0, closing: Promise<void> | undefined
  watch(ports.current, book => { if (!book) hide() })
  function hide() { ++navigation; open.value = false }
  async function show() { const ticket = ++navigation; await closing; if (ticket !== navigation || !ports.current.value) return; if (open.value || await ports.prepareLeave()) { if (ticket === navigation && ports.current.value) open.value = true } }
  async function leaveAfter(operation: () => Promise<boolean>) { const ticket = ++navigation, path = ports.current.value?.path; const opened = await operation(); if (opened && ticket === navigation && path === ports.current.value?.path) open.value = false; return opened }
  async function select(book: ProjectSummary | undefined) { const ticket = ++navigation; if (!book) { await ports.refresh(); return } if (ports.current.value?.path === book.path) { if (await ports.prepareLeave() && ticket === navigation) open.value = false } else { await ports.selectBook(book); if (ticket === navigation && ports.current.value?.path === book.path) open.value = false } }
  async function library() { const ticket = ++navigation, operation = ports.closeBook(); closing = operation; try { await operation; if (ticket === navigation && !ports.current.value) open.value = false } finally { if (closing === operation) closing = undefined } }
  async function created(book: ProjectSummary) { await ports.activate(book); await ports.refresh(); open.value = true }
  return { open, show, hide, leaveAfter, select, library, created }
}
